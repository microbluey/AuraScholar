import { constants, lstatSync, mkdirSync, promises as fs } from "node:fs";
import { join, relative, sep } from "node:path";

export function assertOpaqueDownloadId(
  value: unknown,
  pattern: RegExp,
  maxLength: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    !pattern.test(value)
  ) {
    throw new Error("Research download id is invalid");
  }
}

export function assertOpaqueText(
  value: unknown,
  label: string,
  maxLength: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value
  ) {
    throw new Error(`${label} is invalid`);
  }
}

export function assertSafeFileName(fileName: string): void {
  assertOpaqueText(fileName, "Research download file name", 255);
  if (
    fileName === "." ||
    fileName === ".." ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("\0") ||
    fileName.endsWith(".") ||
    fileName.endsWith(" ")
  ) {
    throw new Error("Research download file name is unsafe");
  }
}

/** Create/check the only directory that the research browser may write. */
export function ensureSafeResearchDownloadDirectory(root: string): string {
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Research download root is unsafe");
  }
  const directory = join(root, "research-downloads");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStat = lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("Research download directory is unsafe");
  }
  return directory;
}

export async function assertSafeParentDirectories(
  root: string,
  absolutePath: string,
): Promise<void> {
  const directory = join(root, "research-downloads");
  const rel = relative(directory, absolutePath);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || rel.includes(sep)) {
    throw new Error("Research download path is invalid");
  }
  const rootStat = await lstatOrMissing(root);
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Research download root is unsafe");
  }
  const directoryStat = await lstatOrMissing(directory);
  if (!directoryStat || !directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("Research download directory is unsafe");
  }
}

export function assertSafeRegularFile(stat: {
  isFile(): boolean;
  isSymbolicLink(): boolean;
  nlink: number | bigint;
}): void {
  const hasMultipleLinks = typeof stat.nlink === "bigint" ? stat.nlink > 1n : stat.nlink > 1;
  if (!stat.isFile() || stat.isSymbolicLink() || hasMultipleLinks) {
    throw new Error("Research download file is unsafe");
  }
}

export function assertByteSize(size: number | bigint, max: number): number {
  const value = typeof size === "bigint" ? Number(size) : size;
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error("Research download file is too large");
  }
  return value;
}

export function assertSameFile(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): void {
  if (left.dev !== right.dev || left.ino !== right.ino) {
    throw new Error("Research download file changed during validation");
  }
}

export function readFlags(): number {
  return process.platform === "win32"
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW;
}

export async function lstatOrMissing(
  path: string,
): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
