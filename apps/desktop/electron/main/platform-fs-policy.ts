import { constants, promises as fs } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

interface CanonicalPdfBlobTarget {
  absolutePath: string;
  appDataRoot: string;
  segments: readonly string[];
}

/** A main-validated canonical PDF target; never a generic app-data path. */
export type CanonicalPdfBlobPath = CanonicalPdfBlobTarget;

/** Main-owned byte expectations for one bounded canonical blob read. */
export interface CanonicalPdfBlobReadOptions {
  expectedByteSize?: number;
  maxBytes?: number;
}

/** The caller can map this safe, non-path-bearing failure to its own UX. */
export class CanonicalPdfBlobReadLimitError extends Error {
  constructor(readonly maxBytes: number) {
    super("Canonical PDF blob exceeds the configured read limit");
    this.name = "CanonicalPdfBlobReadLimitError";
  }
}

/** Resolve one durable content-addressed PDF blob under the main-owned store. */
export function resolveCanonicalPdfBlobPath(
  appDataRoot: string,
  sha256: string,
): CanonicalPdfBlobPath {
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new Error("Canonical PDF blob id is invalid");
  }
  return resolveCanonicalPdfBlobPathInternal(appDataRoot, [
    "blobs",
    sha256.slice(0, 2),
    `${sha256}.pdf`,
  ]);
}

/** Read an already-existing regular canonical blob without following a symlink. */
export async function readCanonicalPdfBlobFile(
  target: CanonicalPdfBlobPath,
  options: CanonicalPdfBlobReadOptions = {},
): Promise<Uint8Array> {
  const expectedByteSize = optionalByteSize(
    options.expectedByteSize,
    "Canonical PDF blob expected byte size",
  );
  const maxBytes = optionalByteSize(options.maxBytes, "Canonical PDF blob read limit");
  const parentsExist = await ensureSafeDirectories(target, target.segments.slice(0, -1));
  if (!parentsExist) throw new Error("Canonical PDF blob is unavailable");
  const before = await lstatOrMissing(target.absolutePath);
  if (!before) throw new Error("Canonical PDF blob is unavailable");
  assertSafeReadableFile(before);

  const handle = await fs.open(target.absolutePath, readFlags());
  try {
    const opened = await handle.stat();
    assertSafeReadableFile(opened);
    const openedByteSize = requireByteSize(opened.size, "Canonical PDF blob byte size");
    if (!sameFile(before, opened)) {
      throw new Error("Canonical PDF blob changed during validation");
    }
    const current = await fs.lstat(target.absolutePath);
    assertSafeReadableFile(current);
    if (!sameFile(current, opened)) {
      throw new Error("Canonical PDF blob changed during validation");
    }
    if (maxBytes !== undefined && openedByteSize > maxBytes) {
      throw new CanonicalPdfBlobReadLimitError(maxBytes);
    }
    if (expectedByteSize !== undefined && openedByteSize !== expectedByteSize) {
      throw new Error("Canonical PDF blob size does not match its attachment record");
    }

    // Read into the validated fixed-size buffer. `readFile()` would determine
    // a new allocation from a file that could have grown after `handle.stat()`.
    const bytes = await readFixedSizeBlob(handle, openedByteSize);
    const after = await handle.stat();
    assertSafeReadableFile(after);
    if (
      !sameFile(opened, after) ||
      requireByteSize(after.size, "Canonical PDF blob byte size") !== openedByteSize
    ) {
      throw new Error("Canonical PDF blob changed during read");
    }
    return bytes;
  } finally {
    await handle.close().catch(() => {});
  }
}

async function readFixedSizeBlob(
  handle: Awaited<ReturnType<typeof fs.open>>,
  byteSize: number,
): Promise<Uint8Array> {
  const bytes = Buffer.allocUnsafe(byteSize);
  let offset = 0;
  while (offset < byteSize) {
    const { bytesRead } = await handle.read(bytes, offset, byteSize - offset, offset);
    if (bytesRead <= 0) break;
    offset += bytesRead;
  }
  if (offset !== byteSize) throw new Error("Canonical PDF blob changed during read");
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function resolveCanonicalPdfBlobPathInternal(
  appDataRoot: string,
  segments: readonly string[],
): CanonicalPdfBlobPath {
  const absolutePath = join(appDataRoot, ...segments);
  assertContainedByAppDataRoot(appDataRoot, absolutePath);
  return { absolutePath, appDataRoot, segments };
}

async function ensureSafeDirectories(
  target: CanonicalPdfBlobPath,
  segments: readonly string[],
): Promise<boolean> {
  let current = target.appDataRoot;
  for (const segment of segments) {
    current = join(current, segment);
    const stat = await lstatOrMissing(current);
    if (!stat) return false;
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Canonical PDF blob path contains an unsafe directory");
    }
  }
  return true;
}

function assertContainedByAppDataRoot(appDataRoot: string, absolutePath: string): void {
  const rel = relative(appDataRoot, absolutePath);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Canonical PDF blob path escapes app data");
  }
}

function assertSafeReadableFile(stat: {
  isFile(): boolean;
  isSymbolicLink(): boolean;
  nlink: number | bigint;
}): void {
  const hasMultipleLinks = typeof stat.nlink === "bigint" ? stat.nlink > 1n : stat.nlink > 1;
  if (!stat.isFile() || stat.isSymbolicLink() || hasMultipleLinks) {
    throw new Error("Canonical PDF blob is unsafe");
  }
}

function optionalByteSize(value: number | undefined, label: string): number | undefined {
  return value === undefined ? undefined : requireByteSize(value, label);
}

function requireByteSize(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
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
