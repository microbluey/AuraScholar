import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { LibraryStagePdfCommandResult } from "../library-ingest-command-contract";
import { withMainDatabaseTransaction } from "./db";
import { removeUnreferencedCanonicalPdfBlobAtUserDataRoot } from "./library-pdf-blob-gc";
import {
  createLibraryPdfStagingJournal,
  type LibraryPdfStagingJournal,
} from "./library-pdf-staging-journal";
import {
  StagedPdfVerificationError,
  verifyStagedPdfAtUserDataRoot,
} from "./staged-pdf-verification";

const MAX_PDF_BYTE_SIZE = 2 * 1024 * 1024 * 1024;
export const MAX_PENDING_RECEIPTS = 128;
/** Limits uncommitted PDF receipts, including concurrent write reservations. */
export const MAX_PENDING_STAGED_BYTES = 4 * 1024 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STAGE_ID_BYTES = 32;
/** A receipt is invalidated and nominated for guarded GC after 30 minutes. */
export const STAGED_PDF_TTL_MS = 30 * 60 * 1000;

export interface StagedPdfClaim {
  readonly receipt: LibraryStagePdfCommandResult;
  consume(): void;
  release(): void;
}

export interface LibraryPdfStagingStore {
  claim(stageId: string): Promise<StagedPdfClaim>;
  clear(): Promise<void>;
  recover(): Promise<void>;
  release(stageId: string): Promise<boolean>;
  stage(bytes: Uint8Array): Promise<LibraryStagePdfCommandResult>;
}

export interface LibraryPdfStagingStoreOptions {
  /** Test seam for a durable, SHA-only main-process staging journal. */
  journal?: LibraryPdfStagingJournal;
  maxPendingBytes?: number;
  now?(): number;
  /**
   * Main-only deletion seam. It must check attachment and document-revision
   * references transactionally before unlinking a canonical blob.
   */
  removeUnreferencedCanonicalPdfBlob?(userDataRoot: string, sha: string): Promise<boolean>;
  stageId?(): string;
  /** Test seam for controlling filesystem latency and failure behavior. */
  writeCanonicalPdfBlob?(userDataRoot: string, sha: string, bytes: Uint8Array): Promise<void>;
}

interface StageEntry {
  claimed: boolean;
  expiresAt: number;
  receipt: LibraryStagePdfCommandResult;
  retiring: boolean;
}

/**
 * Main-only registry for a one-time PDF receipt. Its lifetime is intentionally
 * short. Receipt expiry, explicit release, and window cleanup nominate an
 * unreferenced canonical blob for transactionally guarded main-process GC.
 */
export function createLibraryPdfStagingStore(
  userDataRoot: string,
  options: LibraryPdfStagingStoreOptions = {},
): LibraryPdfStagingStore {
  const entries = new Map<string, StageEntry>();
  const stagedShaPins = new Map<string, number>();
  const orphanCandidates = new Set<string>();
  const recoveryCandidates = new Set<string>();
  const pendingBlobCollections = new Map<string, Promise<void>>();
  const journal = options.journal ?? createLibraryPdfStagingJournal(userDataRoot);
  const maxPendingBytes = options.maxPendingBytes ?? MAX_PENDING_STAGED_BYTES;
  const now = options.now ?? Date.now;
  const newStageId = options.stageId ?? (() => randomBytes(STAGE_ID_BYTES).toString("base64url"));
  const removeUnreferencedCanonicalPdfBlob = options.removeUnreferencedCanonicalPdfBlob;
  const writeCanonicalPdfBlob =
    options.writeCanonicalPdfBlob ?? writeCanonicalPdfBlobAtUserDataRoot;
  let pendingStageReservations = 0;
  let pendingReservationBytes = 0;
  let pendingReceiptBytes = 0;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;

  if (!Number.isSafeInteger(maxPendingBytes) || maxPendingBytes <= 0) {
    throw new Error("Pending PDF staging byte limit is invalid");
  }

  function pinSha(sha: string): void {
    stagedShaPins.set(sha, (stagedShaPins.get(sha) ?? 0) + 1);
  }

  function unpinSha(sha: string): void {
    const count = stagedShaPins.get(sha);
    if (!count) throw new Error("PDF staging SHA pin is unavailable");
    if (count === 1) stagedShaPins.delete(sha);
    else stagedShaPins.set(sha, count - 1);
  }

  function isShaPinned(sha: string): boolean {
    return (stagedShaPins.get(sha) ?? 0) > 0;
  }

  async function orphanEntry(stageId: string, entry: StageEntry): Promise<boolean> {
    if (entries.get(stageId) !== entry || entry.claimed || entry.retiring) return false;
    entry.retiring = true;
    // Persist the candidate before allowing its in-memory pin to disappear.
    // If this fails, retaining the receipt is safer than creating an
    // untracked crash orphan.
    try {
      await journal.markOrphaned(entry.receipt.sha);
      entries.delete(stageId);
      pendingReceiptBytes -= entry.receipt.byteSize;
      unpinSha(entry.receipt.sha);
      orphanCandidates.add(entry.receipt.sha);
      return true;
    } catch (error) {
      entry.retiring = false;
      throw error;
    }
  }

  function consumeEntry(stageId: string, entry: StageEntry): boolean {
    if (entries.get(stageId) !== entry) return false;
    entries.delete(stageId);
    pendingReceiptBytes -= entry.receipt.byteSize;
    unpinSha(entry.receipt.sha);
    // The durable ingest transaction completed before consume(). A failed
    // journal cleanup is safe: startup recovery will see the DB reference.
    void journal.markCommitted(entry.receipt.sha).catch(() => {});
    return true;
  }

  async function waitForPendingBlobCollection(sha: string): Promise<void> {
    await pendingBlobCollections.get(sha);
  }

  function queueBlobCollection(sha: string): Promise<void> {
    const previous = pendingBlobCollections.get(sha) ?? Promise.resolve();
    const collection = previous.then(async () => {
      if (!orphanCandidates.has(sha) || isShaPinned(sha)) return;
      try {
        await removeUnreferencedCanonicalPdfBlob?.(userDataRoot, sha);
        if (recoveryCandidates.has(sha)) {
          await journal.clearRecoveredCandidate(sha);
          recoveryCandidates.delete(sha);
        } else {
          await journal.clearOrphanCandidate(sha);
        }
        orphanCandidates.delete(sha);
      } catch {
        // Keep the candidate for a later stage/claim/release retry. Receipt
        // deletion is still allowed so a transient disk error cannot exhaust
        // the bounded in-memory quota forever.
      }
    });
    pendingBlobCollections.set(sha, collection);
    void collection.then(() => {
      if (pendingBlobCollections.get(sha) === collection) pendingBlobCollections.delete(sha);
    });
    return collection;
  }

  async function collectOrphanedBlobs(): Promise<void> {
    if (!removeUnreferencedCanonicalPdfBlob) return;
    for (const sha of orphanCandidates) await queueBlobCollection(sha);
  }

  function scheduleExpiryPurge(): void {
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = null;
    let earliestExpiry: number | null = null;
    for (const entry of entries.values()) {
      if (
        !entry.claimed &&
        !entry.retiring &&
        (earliestExpiry === null || entry.expiresAt < earliestExpiry)
      ) {
        earliestExpiry = entry.expiresAt;
      }
    }
    if (earliestExpiry === null) return;
    expiryTimer = setTimeout(
      () => {
        expiryTimer = null;
        void purgeExpired().catch(() => {});
      },
      Math.max(0, earliestExpiry - now()),
    );
    expiryTimer.unref?.();
  }

  async function purgeExpired(): Promise<void> {
    const at = now();
    for (const [stageId, entry] of entries) {
      if (!entry.claimed && !entry.retiring && entry.expiresAt <= at) {
        await orphanEntry(stageId, entry);
      }
    }
    await collectOrphanedBlobs();
    scheduleExpiryPurge();
  }

  async function recover(): Promise<void> {
    let staleShas: string[];
    try {
      staleShas = await journal.recoveryCandidates();
    } catch {
      // A malformed or unreadable journal is deliberately fail-safe: without
      // trustworthy candidate identities we neither scan blobs nor delete.
      return;
    }
    for (const sha of staleShas) {
      orphanCandidates.add(sha);
      recoveryCandidates.add(sha);
    }
    await collectOrphanedBlobs();
  }

  return {
    async stage(bytes) {
      assertPdfBytes(bytes);
      await purgeExpired();
      const byteSize = bytes.byteLength;
      if (entries.size + pendingStageReservations >= MAX_PENDING_RECEIPTS) {
        throw new Error("Too many pending PDF staging receipts");
      }
      if (pendingReceiptBytes + pendingReservationBytes + byteSize > maxPendingBytes) {
        throw new Error("Pending PDF staging byte quota exceeded");
      }
      const sha = sha256Hex(bytes);
      pendingStageReservations += 1;
      pendingReservationBytes += byteSize;
      pinSha(sha);
      let journalRecorded = false;
      let retainedReceipt = false;
      try {
        // A previous GC may already be past its in-memory pin check. Let it
        // finish before recording this new stage, so it cannot settle a fresh
        // journal entry that belongs to the next writer.
        await waitForPendingBlobCollection(sha);
        // The durable SHA-only journal must exist before a canonical pathname
        // can be written, so a process crash cannot create an untracked blob.
        await journal.recordStage(sha);
        journalRecorded = true;
        await writeCanonicalPdfBlob(userDataRoot, sha, bytes);
        const receipt = { byteSize, sha, stageId: newStageId() };
        if (entries.has(receipt.stageId))
          throw new Error("PDF staging receipt id is already in use");
        entries.set(receipt.stageId, {
          claimed: false,
          expiresAt: now() + STAGED_PDF_TTL_MS,
          receipt,
          retiring: false,
        });
        pendingReceiptBytes += byteSize;
        retainedReceipt = true;
        scheduleExpiryPurge();
        return receipt;
      } finally {
        pendingStageReservations -= 1;
        pendingReservationBytes -= byteSize;
        if (!retainedReceipt) {
          if (journalRecorded) {
            try {
              await journal.markOrphaned(sha);
              orphanCandidates.add(sha);
            } finally {
              unpinSha(sha);
            }
            await collectOrphanedBlobs();
          } else {
            unpinSha(sha);
          }
        }
      }
    },

    async claim(stageId) {
      await purgeExpired();
      const entry = entries.get(stageId);
      if (!entry || entry.claimed || entry.retiring) {
        throw new Error("Staged PDF receipt is unavailable");
      }
      entry.claimed = true;
      scheduleExpiryPurge();
      let settled = false;
      return {
        receipt: entry.receipt,
        consume() {
          if (settled) return;
          settled = true;
          if (consumeEntry(stageId, entry)) {
            scheduleExpiryPurge();
            void collectOrphanedBlobs();
          }
        },
        release() {
          if (settled) return;
          settled = true;
          entry.claimed = false;
          scheduleExpiryPurge();
        },
      };
    },

    async release(stageId) {
      await purgeExpired();
      const entry = entries.get(stageId);
      if (!entry || entry.claimed || entry.retiring) return false;
      await orphanEntry(stageId, entry);
      scheduleExpiryPurge();
      await collectOrphanedBlobs();
      return true;
    },

    async clear() {
      // A claimed receipt can still be inside the durable ingest transaction.
      // Keep its SHA pin until that caller consumes or releases it.
      for (const [stageId, entry] of entries) {
        if (!entry.claimed && !entry.retiring) await orphanEntry(stageId, entry);
      }
      scheduleExpiryPurge();
      await collectOrphanedBlobs();
    },

    recover,
  };
}

let defaultStore: { root: string; store: LibraryPdfStagingStore } | null = null;

function mainStore(): LibraryPdfStagingStore {
  const root = app.getPath("userData");
  if (!defaultStore || defaultStore.root !== root) {
    defaultStore = {
      root,
      store: createLibraryPdfStagingStore(root, {
        removeUnreferencedCanonicalPdfBlob: (userDataRoot, sha) =>
          removeUnreferencedCanonicalPdfBlobAtUserDataRoot(userDataRoot, sha, {
            transaction: withMainDatabaseTransaction,
          }),
      }),
    };
  }
  return defaultStore.store;
}

export function claimLibraryStagedPdf(stageId: string): Promise<StagedPdfClaim> {
  return mainStore().claim(stageId);
}

export async function clearLibraryPdfStaging(): Promise<void> {
  await defaultStore?.store.clear();
}

/** Startup-only: stale SHA journal entries are GC candidates, never receipts. */
export async function recoverLibraryPdfStaging(): Promise<void> {
  await mainStore().recover();
}

export function releaseLibraryStagedPdf(stageId: string): Promise<boolean> {
  return mainStore().release(stageId);
}

export function stageLibraryPdf(bytes: Uint8Array): Promise<LibraryStagePdfCommandResult> {
  return mainStore().stage(bytes);
}

/**
 * Atomically installs bytes at their content-addressed target. Existing bytes
 * are never overwritten: the target must independently verify as the same
 * receipt before it is reused. This prevents a bad pre-existing blob from
 * becoming an attachment merely because its pathname looks canonical.
 */
export async function writeCanonicalPdfBlobAtUserDataRoot(
  userDataRoot: string,
  sha: string,
  bytes: Uint8Array,
): Promise<void> {
  assertPdfBytes(bytes);
  if (!SHA256_PATTERN.test(sha) || sha256Hex(bytes) !== sha) {
    throw new Error("PDF staging receipt does not match its bytes");
  }
  const blobDirectory = join(userDataRoot, "blobs");
  const bucketDirectory = join(blobDirectory, sha.slice(0, 2));
  const target = join(bucketDirectory, `${sha}.pdf`);
  await ensureSafeDirectory(blobDirectory);
  await ensureSafeDirectory(bucketDirectory);

  const temporary = join(bucketDirectory, `.stage-${process.pid}-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(temporary, createExclusiveFlags(), 0o600);
    // `write()` is allowed to report a short write. `writeFile()` loops until
    // the complete immutable IPC buffer reaches the file descriptor or fails.
    await handle.writeFile(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      // Hard linking is atomic and fails if another main operation has already
      // installed this SHA. The files live under one userData root, so this
      // does not duplicate a multi-gigabyte PDF.
      await fs.link(temporary, target);
      await fs.chmod(target, 0o600).catch(() => {});
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      await verifyExistingTarget(userDataRoot, sha, bytes.byteLength);
    }
    // A receipt is issued only after the exact pathname that attachments will
    // later reference has been streamed and re-hashed from an owned inode.
    await verifyStagedPdfAtUserDataRoot(userDataRoot, { byteSize: bytes.byteLength, sha });
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function assertPdfBytes(bytes: Uint8Array): void {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_PDF_BYTE_SIZE
  ) {
    throw new Error("PDF staging bytes are invalid or exceed the 2 GiB limit");
  }
}

function createExclusiveFlags(): number {
  return process.platform === "win32"
    ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
    : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
}

async function ensureSafeDirectory(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Canonical PDF storage directory is unsafe");
  }
}

async function verifyExistingTarget(
  userDataRoot: string,
  sha: string,
  byteSize: number,
): Promise<void> {
  try {
    await verifyStagedPdfAtUserDataRoot(userDataRoot, { byteSize, sha });
  } catch (error) {
    if (error instanceof StagedPdfVerificationError) {
      throw new Error("Canonical PDF target is unsafe or does not match its content receipt", {
        cause: error,
      });
    }
    throw error;
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256")
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest("hex");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
