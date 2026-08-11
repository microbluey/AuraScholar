import { constants, promises as fs } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

/** These directories are exclusively written by main-process workflows. */
export const MAIN_OWNED_MUTATION_DIRECTORIES = new Set([".ingest-staging", "blobs"]);

export type RendererMutationOperation = "delete" | "mkdirp" | "write";

export interface RendererMutablePath {
  absolutePath: string;
  appDataRoot: string;
  segments: readonly string[];
}

/** A main-validated renderer read target; never a generic app-data path. */
export interface RendererReadablePath {
  absolutePath: string;
  appDataRoot: string;
  segments: readonly string[];
}

const MUTABLE_ROOTS_BY_OPERATION: Readonly<Record<RendererMutationOperation, ReadonlySet<string>>> =
  {
    // Downloads are created by the research-browser main process. The renderer
    // only needs to remove its completed/cancelled top-level temporary file.
    delete: new Set(["exports", "research-downloads"]),
    // Export creation remains available without granting a generic app-data
    // writer that could reach databases, secrets, staged receipts, or blobs.
    mkdirp: new Set(["exports"]),
    write: new Set(["exports"]),
  };

const WINDOWS_DEVICE_SEGMENT =
  /^(?:aux|clock\$|com[1-9¹²³]|con|conin\$|conout\$|lpt[1-9¹²³]|nul|prn)(?:\..*)?$/iu;

/**
 * Resolve a renderer mutation target through a small, operation-specific
 * allowlist. The parser intentionally treats both slash styles as separators
 * on every platform, so a value rejected on Windows cannot become accepted by
 * a POSIX-only test run.
 */
export function resolveRendererMutableAppDataPath(
  appDataRoot: string,
  rel: string,
  operation: RendererMutationOperation,
): RendererMutablePath {
  const segments = parseRendererRelativePath(rel);
  const root = segments[0]!.toLowerCase();

  if (MAIN_OWNED_MUTATION_DIRECTORIES.has(root)) {
    throw new Error("Renderer may not mutate main-owned app data");
  }
  if (!MUTABLE_ROOTS_BY_OPERATION[operation].has(root)) {
    throw new Error("Renderer may not mutate this app-data directory");
  }
  if (root === "research-downloads" && (operation !== "delete" || segments.length !== 2)) {
    throw new Error("Renderer may only delete individual research downloads");
  }

  const absolutePath = join(appDataRoot, ...segments);
  assertContainedByAppDataRoot(appDataRoot, absolutePath);
  return { absolutePath, appDataRoot, segments };
}

/** Resolve the only durable file renderer code may read: a canonical PDF blob. */
export function resolveRendererBlobPdfPath(
  appDataRoot: string,
  sha256: string,
): RendererReadablePath {
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new Error("Renderer PDF blob id is invalid");
  }
  return resolveRendererReadablePath(appDataRoot, ["blobs", sha256.slice(0, 2), `${sha256}.pdf`]);
}

/** Resolve a single main-created research download, never an arbitrary file. */
export function resolveRendererResearchDownloadPath(
  appDataRoot: string,
  relPath: string,
): RendererReadablePath {
  const segments = parseRendererRelativePath(relPath);
  if (segments[0]!.toLowerCase() !== "research-downloads" || segments.length !== 2) {
    throw new Error("Renderer research download path is invalid");
  }
  return resolveRendererReadablePath(appDataRoot, segments);
}

/**
 * Compatibility predicate for callers that only need to know whether a path
 * is mutable by at least one renderer operation. Mutations must still resolve
 * with their concrete operation before touching disk.
 */
export function isRendererMutableAppDataPath(appDataRoot: string, absolutePath: string): boolean {
  const rel = relative(appDataRoot, absolutePath);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
  return (Object.keys(MUTABLE_ROOTS_BY_OPERATION) as RendererMutationOperation[]).some(
    (operation) => {
      try {
        resolveRendererMutableAppDataPath(appDataRoot, rel, operation);
        return true;
      } catch {
        return false;
      }
    },
  );
}

/** Write an export file without following a symlink at any mutable path segment. */
export async function writeRendererMutableFile(
  target: RendererMutablePath,
  data: Uint8Array,
): Promise<void> {
  if (!(data instanceof Uint8Array)) throw new Error("Renderer file payload is invalid");
  await ensureSafeDirectories(target, target.segments.slice(0, -1), true);

  const before = await lstatOrMissing(target.absolutePath);
  if (before) assertSafeRegularFile(before);

  // Do not truncate until the opened handle is proved to refer to the inode
  // we checked. This matters on Windows, where O_NOFOLLOW is not reliable.
  const handle = before
    ? await fs.open(target.absolutePath, existingWriteFlags())
    : await fs.open(target.absolutePath, newWriteFlags(), 0o600);
  try {
    const opened = await handle.stat();
    assertSafeRegularFile(opened);
    if (before && !sameFile(before, opened)) {
      throw new Error("Renderer mutation target changed during validation");
    }

    await ensureSafeDirectories(target, target.segments.slice(0, -1), false);
    const current = await fs.lstat(target.absolutePath);
    assertSafeRegularFile(current);
    if (!sameFile(current, opened)) {
      throw new Error("Renderer mutation target changed during validation");
    }

    const beforeWrite = await handle.stat();
    assertSafeRegularFile(beforeWrite);
    if (!sameFile(beforeWrite, opened)) {
      throw new Error("Renderer mutation target changed during validation");
    }
    await handle.truncate(0);
    await handle.writeFile(data);
  } finally {
    await handle.close().catch(() => {});
  }
}

/** Delete only a regular, unlinked renderer-owned temporary/export file. */
export async function deleteRendererMutableFile(target: RendererMutablePath): Promise<void> {
  const parentsExist = await ensureSafeDirectories(target, target.segments.slice(0, -1), false);
  if (!parentsExist) return;
  const stat = await lstatOrMissing(target.absolutePath);
  if (!stat) return;
  assertSafeRegularFile(stat);
  // unlink never follows a symlink. We reject symlinks above so the target is
  // necessarily within an allowlisted, main-verified directory tree.
  await fs.unlink(target.absolutePath);
}

/** Create export directories one component at a time, rejecting symlinks. */
export async function mkdirpRendererMutablePath(target: RendererMutablePath): Promise<void> {
  await ensureSafeDirectories(target, target.segments, true);
}

/** Read an already-existing regular file without following a symlink. */
export async function readRendererReadableFile(target: RendererReadablePath): Promise<Uint8Array> {
  const parentsExist = await ensureSafeDirectories(target, target.segments.slice(0, -1), false);
  if (!parentsExist) throw new Error("Renderer readable file is unavailable");
  const before = await lstatOrMissing(target.absolutePath);
  if (!before) throw new Error("Renderer readable file is unavailable");
  assertSafeReadableFile(before);

  const handle = await fs.open(target.absolutePath, readFlags());
  try {
    const opened = await handle.stat();
    assertSafeReadableFile(opened);
    if (!sameFile(before, opened)) {
      throw new Error("Renderer readable file changed during validation");
    }
    const current = await fs.lstat(target.absolutePath);
    assertSafeReadableFile(current);
    if (!sameFile(current, opened)) {
      throw new Error("Renderer readable file changed during validation");
    }
    return new Uint8Array(await handle.readFile());
  } finally {
    await handle.close().catch(() => {});
  }
}

function parseRendererRelativePath(rel: string): string[] {
  if (typeof rel !== "string" || rel.length === 0 || rel.length > 4096) {
    throw new Error("Renderer filesystem path is invalid");
  }
  if (rel.startsWith("/") || rel.startsWith("\\")) {
    throw new Error("Renderer filesystem path must be relative");
  }

  const segments = rel.split(/[\\/]/u);
  if (segments.length === 0) throw new Error("Renderer filesystem path is invalid");
  for (const segment of segments) assertSafePathSegment(segment);
  return segments;
}

function resolveRendererReadablePath(
  appDataRoot: string,
  segments: readonly string[],
): RendererReadablePath {
  const absolutePath = join(appDataRoot, ...segments);
  assertContainedByAppDataRoot(appDataRoot, absolutePath);
  return { absolutePath, appDataRoot, segments };
}

function assertSafePathSegment(segment: string): void {
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment.includes("\0") ||
    segment.includes(":") ||
    segment.endsWith(".") ||
    segment.endsWith(" ") ||
    WINDOWS_DEVICE_SEGMENT.test(segment)
  ) {
    // Colon rejects NTFS alternate data streams and drive-qualified forms;
    // trailing dot/space rejects Win32 aliases such as `blobs. `.
    throw new Error("Renderer filesystem path contains an unsafe segment");
  }
}

async function ensureSafeDirectories(
  target: RendererMutablePath,
  segments: readonly string[],
  createMissing: boolean,
): Promise<boolean> {
  let current = target.appDataRoot;
  for (const segment of segments) {
    current = join(current, segment);
    let stat = await lstatOrMissing(current);
    if (!stat) {
      if (!createMissing) return false;
      try {
        await fs.mkdir(current, { mode: 0o700 });
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      }
      stat = await fs.lstat(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Renderer mutation path contains an unsafe directory");
    }
  }
  return true;
}

function assertContainedByAppDataRoot(appDataRoot: string, absolutePath: string): void {
  const rel = relative(appDataRoot, absolutePath);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Renderer filesystem path escapes app data");
  }
}

function assertSafeRegularFile(stat: {
  isFile(): boolean;
  isSymbolicLink(): boolean;
  nlink: number | bigint;
}): void {
  // A hard link can make an otherwise ordinary export name alias a canonical
  // blob, so do not mutate a file with more than one directory entry.
  const hasMultipleLinks = typeof stat.nlink === "bigint" ? stat.nlink > 1n : stat.nlink > 1;
  if (!stat.isFile() || stat.isSymbolicLink() || hasMultipleLinks) {
    throw new Error("Renderer mutation target is unsafe");
  }
}

function assertSafeReadableFile(stat: {
  isFile(): boolean;
  isSymbolicLink(): boolean;
  nlink: number | bigint;
}): void {
  const hasMultipleLinks = typeof stat.nlink === "bigint" ? stat.nlink > 1n : stat.nlink > 1;
  if (!stat.isFile() || stat.isSymbolicLink() || hasMultipleLinks) {
    throw new Error("Renderer readable file is unsafe");
  }
}

function existingWriteFlags(): number {
  return process.platform === "win32"
    ? constants.O_WRONLY
    : constants.O_WRONLY | constants.O_NOFOLLOW;
}

function newWriteFlags(): number {
  return process.platform === "win32"
    ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
    : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
}

function readFlags(): number {
  return process.platform === "win32"
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW;
}

async function lstatOrMissing(path: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function sameFile(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
