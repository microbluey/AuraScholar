import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, promises as fs, rmdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  assertSameFile,
  assertSafeResearchDownloadStreamDirectory,
  assertSafeRegularFile,
  ensureSafeResearchDownloadDirectory,
  isNodeError,
  lstatOrMissing,
  readFlags,
} from "./research-download-store-io";

export const MAX_RESEARCH_DOWNLOAD_STREAM_TARGET_ATTEMPTS = 4;

const STREAM_DIRECTORY_PREFIX = ".stream-";
const STREAM_OWNER_FILE_NAME = ".aurascholar-owner";
const STREAM_PAYLOAD_FILE_NAME = "download";
const STREAM_DIRECTORY_NAME =
  /^\.stream-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface ResearchDownloadStreamStorage {
  directoryName: string;
}

export interface ResearchDownloadStreamTarget extends ResearchDownloadStreamStorage {
  absolutePath: string;
  directory: string;
}

export interface ResearchDownloadStreamTargetOptions {
  id?(): string;
}

function ownerMarkerPath(directory: string): string {
  return join(directory, STREAM_OWNER_FILE_NAME);
}

function ownerMarkerContents(directoryName: string): string {
  return `AuraScholar research download stream ${directoryName}\n`;
}

/**
 * Allocate a unique parent directory before giving Electron a stream target.
 * The payload itself remains absent so DownloadItem owns the file it writes.
 */
export function createResearchDownloadStreamTarget(
  userDataRoot: string,
  options: ResearchDownloadStreamTargetOptions = {},
): ResearchDownloadStreamTarget {
  ensureSafeResearchDownloadDirectory(userDataRoot);
  const createId = options.id ?? randomUUID;

  for (let attempt = 0; attempt < MAX_RESEARCH_DOWNLOAD_STREAM_TARGET_ATTEMPTS; attempt += 1) {
    const directoryName = `${STREAM_DIRECTORY_PREFIX}${createId()}`;
    const target = resolveResearchDownloadStreamTarget(userDataRoot, { directoryName });
    try {
      mkdirSync(target.directory, { mode: 0o700 });
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") continue;
      throw error;
    }
    const stat = lstatSync(target.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Research download stream directory is unsafe");
    }
    try {
      writeFileSync(ownerMarkerPath(target.directory), ownerMarkerContents(directoryName), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      try {
        rmdirSync(target.directory);
      } catch {
        // Keep a directory that became non-empty while allocation failed.
      }
      throw error;
    }
    return target;
  }

  throw new Error("Research download stream directory is already in use");
}

export function resolveResearchDownloadStreamTarget(
  userDataRoot: string,
  storage: ResearchDownloadStreamStorage,
): ResearchDownloadStreamTarget {
  const directoryName = storage?.directoryName;
  if (typeof directoryName !== "string" || !STREAM_DIRECTORY_NAME.test(directoryName)) {
    throw new Error("Research download stream directory is invalid");
  }
  const directory = join(userDataRoot, "research-downloads", directoryName);
  return {
    directoryName,
    directory,
    absolutePath: join(directory, STREAM_PAYLOAD_FILE_NAME),
  };
}

export function isResearchDownloadStreamDirectoryName(value: string): boolean {
  return STREAM_DIRECTORY_NAME.test(value);
}

/** Validate an app-allocated stream directory before cleanup after a restart. */
export async function assertOwnedResearchDownloadStreamDirectory(
  userDataRoot: string,
  directory: string,
): Promise<void> {
  await assertSafeResearchDownloadStreamDirectory(userDataRoot, directory);
  const directoryName = basename(directory);
  if (!isResearchDownloadStreamDirectoryName(directoryName)) {
    throw new Error("Research download stream directory is invalid");
  }
  const markerPath = ownerMarkerPath(directory);
  const expected = ownerMarkerContents(directoryName);
  const before = await lstatOrMissing(markerPath);
  if (!before) throw new Error("Research download stream ownership is unavailable");
  assertSafeRegularFile(before);
  if (before.size !== Buffer.byteLength(expected)) {
    throw new Error("Research download stream ownership is invalid");
  }

  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(markerPath, readFlags());
    const opened = await handle.stat();
    assertSafeRegularFile(opened);
    assertSameFile(before, opened);
    const bytes = Buffer.allocUnsafe(Buffer.byteLength(expected));
    const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, 0);
    const after = await handle.stat();
    assertSameFile(opened, after);
    if (bytesRead !== bytes.byteLength || bytes.toString("utf8") !== expected) {
      throw new Error("Research download stream ownership is invalid");
    }
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function removeEmptyResearchDownloadStreamDirectory(
  userDataRoot: string,
  directory?: string,
): Promise<void> {
  if (!directory) return;
  try {
    await assertOwnedResearchDownloadStreamDirectory(userDataRoot, directory);
    const names = await fs.readdir(directory);
    if (names.length !== 1 || names[0] !== STREAM_OWNER_FILE_NAME) return;
    await fs.unlink(ownerMarkerPath(directory));
    await fs.rmdir(directory);
  } catch {
    // Keep non-empty or suspicious stream directories for safe recovery.
  }
}
