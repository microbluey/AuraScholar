import { constants, promises as fs } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

interface RendererPath {
  absolutePath: string;
  appDataRoot: string;
  segments: readonly string[];
}

/** The only app-data path the renderer may mutate: a temporary download. */
export type RendererDeletablePath = RendererPath;

/** A main-validated renderer read target; never a generic app-data path. */
export type RendererReadablePath = RendererPath;

const WINDOWS_DEVICE_SEGMENT =
  /^(?:aux|clock\$|com[1-9¹²³]|con|conin\$|conout\$|lpt[1-9¹²³]|nul|prn)(?:\..*)?$/iu;

/**
 * Resolve the single renderer deletion target. The parser intentionally treats
 * both slash styles as separators on every platform, so a value rejected on
 * Windows cannot become accepted by a POSIX-only test run.
 */
export function resolveRendererResearchDownloadDeletePath(
  appDataRoot: string,
  rel: string,
): RendererDeletablePath {
  const segments = parseRendererRelativePath(rel);
  const root = segments[0]!.toLowerCase();

  if (root !== "research-downloads" || segments.length !== 2) {
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

/** Delete only a regular, unlinked main-created research download. */
export async function deleteRendererResearchDownloadFile(
  target: RendererDeletablePath,
): Promise<void> {
  const parentsExist = await ensureSafeDirectories(target, target.segments.slice(0, -1));
  if (!parentsExist) return;
  const stat = await lstatOrMissing(target.absolutePath);
  if (!stat) return;
  assertSafeRegularFile(stat);
  // unlink never follows a symlink. We reject symlinks above so the target is
  // necessarily within an allowlisted, main-verified directory tree.
  await fs.unlink(target.absolutePath);
}

/** Read an already-existing regular file without following a symlink. */
export async function readRendererReadableFile(target: RendererReadablePath): Promise<Uint8Array> {
  const parentsExist = await ensureSafeDirectories(target, target.segments.slice(0, -1));
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
  target: RendererPath,
  segments: readonly string[],
): Promise<boolean> {
  let current = target.appDataRoot;
  for (const segment of segments) {
    current = join(current, segment);
    const stat = await lstatOrMissing(current);
    if (!stat) return false;
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Renderer path contains an unsafe directory");
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
  // A hard link can make a seemingly ordinary temporary-download name alias a
  // canonical blob, so do not mutate a file with more than one directory entry.
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
