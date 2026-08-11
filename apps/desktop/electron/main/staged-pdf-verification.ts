import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { LibraryStagePdfCommandResult } from "../library-ingest-command-contract";

type StagedPdfReceipt = Pick<LibraryStagePdfCommandResult, "byteSize" | "sha">;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type StagedPdfVerificationReason =
  | "blob-missing"
  | "blob-unsafe"
  | "hash-mismatch"
  | "invalid-receipt"
  | "size-mismatch"
  | "unavailable";

/** A safe, path-free failure exposed through the data command transport. */
export class StagedPdfVerificationError extends Error {
  readonly reason: StagedPdfVerificationReason;

  constructor(reason: StagedPdfVerificationReason) {
    super(`Staged PDF verification failed: ${reason}`);
    this.name = "StagedPdfVerificationError";
    this.reason = reason;
  }
}

/**
 * Main-process verifier used by durable ingest commands. A renderer may submit
 * a content receipt, never a filesystem path; the target is derived solely
 * from Electron's canonical userData blob store.
 */
export function verifyStagedPdf(pdf: StagedPdfReceipt): Promise<void> {
  return verifyStagedPdfAtUserDataRoot(app.getPath("userData"), pdf);
}

/**
 * Testable canonical verifier. `userDataRoot` is main-owned configuration,
 * not an IPC input; callers only provide the content receipt.
 */
export async function verifyStagedPdfAtUserDataRoot(
  userDataRoot: string,
  pdf: StagedPdfReceipt,
): Promise<void> {
  assertCanonicalReceipt(pdf);
  const blobDirectory = join(userDataRoot, "blobs");
  const bucketDirectory = join(blobDirectory, pdf.sha.slice(0, 2));
  const target = join(bucketDirectory, `${pdf.sha}.pdf`);

  await requireSafeDirectory(blobDirectory);
  await requireSafeDirectory(bucketDirectory);

  let initialStat;
  try {
    initialStat = await fs.lstat(target);
  } catch (error) {
    throw verificationErrorFor(error);
  }
  if (!initialStat.isFile() || initialStat.isSymbolicLink()) {
    throw new StagedPdfVerificationError("blob-unsafe");
  }
  if (initialStat.size !== pdf.byteSize) {
    throw new StagedPdfVerificationError("size-mismatch");
  }

  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    try {
      // O_NOFOLLOW makes a leaf symlink fail on POSIX. Windows does not
      // implement it consistently, so retain lstat + opened-handle identity
      // checks there instead of rejecting every valid staged PDF.
      handle = await fs.open(target, openReadFlags());
    } catch (error) {
      throw verificationErrorFor(error);
    }
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) throw new StagedPdfVerificationError("blob-unsafe");
    if (!sameFile(initialStat, openedStat)) {
      throw new StagedPdfVerificationError("blob-unsafe");
    }
    if (openedStat.size !== pdf.byteSize) throw new StagedPdfVerificationError("size-mismatch");

    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const finalStat = await handle.stat();
    if (finalStat.size !== pdf.byteSize) throw new StagedPdfVerificationError("size-mismatch");
    if (hash.digest("hex") !== pdf.sha) throw new StagedPdfVerificationError("hash-mismatch");
  } catch (error) {
    if (error instanceof StagedPdfVerificationError) throw error;
    throw verificationErrorFor(error);
  } finally {
    await handle?.close().catch(() => {});
  }
}

function assertCanonicalReceipt(pdf: StagedPdfReceipt): void {
  if (
    typeof pdf.sha !== "string" ||
    !SHA256_PATTERN.test(pdf.sha) ||
    !Number.isSafeInteger(pdf.byteSize) ||
    pdf.byteSize <= 0
  ) {
    throw new StagedPdfVerificationError("invalid-receipt");
  }
}

function openReadFlags(): number {
  return process.platform === "win32"
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW;
}

function sameFile(
  before: { dev: number; ino: number },
  opened: { dev: number; ino: number },
): boolean {
  return before.dev === opened.dev && before.ino === opened.ino;
}

async function requireSafeDirectory(path: string): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(path);
  } catch (error) {
    throw verificationErrorFor(error);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new StagedPdfVerificationError("blob-unsafe");
  }
}

function verificationErrorFor(error: unknown): StagedPdfVerificationError {
  if (isNodeError(error) && error.code === "ENOENT") {
    return new StagedPdfVerificationError("blob-missing");
  }
  if (isNodeError(error) && error.code === "ELOOP") {
    return new StagedPdfVerificationError("blob-unsafe");
  }
  return new StagedPdfVerificationError("unavailable");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
