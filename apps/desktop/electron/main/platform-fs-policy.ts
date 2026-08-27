import { constants, promises as fs } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

interface RendererPath {
  absolutePath: string;
  appDataRoot: string;
  segments: readonly string[];
}

/** A main-validated renderer read target; never a generic app-data path. */
export type RendererReadablePath = RendererPath;

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

function resolveRendererReadablePath(
  appDataRoot: string,
  segments: readonly string[],
): RendererReadablePath {
  const absolutePath = join(appDataRoot, ...segments);
  assertContainedByAppDataRoot(appDataRoot, absolutePath);
  return { absolutePath, appDataRoot, segments };
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
