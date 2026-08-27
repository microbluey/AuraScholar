import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { ResearchDownloadContent } from "../shared";
import {
  assertByteSize,
  assertOpaqueText,
  assertSafeFileName,
  assertSafeParentDirectories,
  assertSafeRegularFile,
  assertSameFile,
  isNodeError,
  lstatOrMissing,
  readFlags,
} from "./research-download-store-io";
import {
  assertOwnedResearchDownloadStreamDirectory,
  isResearchDownloadStreamDirectoryName,
  removeEmptyResearchDownloadStreamDirectory,
  resolveResearchDownloadStreamTarget,
  type ResearchDownloadStreamStorage,
} from "./research-download-stream-target";
import {
  defaultResearchDownloadConsumeGate,
  type ResearchDownloadConsumeGate,
} from "./research-download-consume-gate";
import { describeResearchDownloadFile } from "./research-download-file-policy";
import { assertResearchDownloadId } from "./research-download-id";
import * as downloadLimits from "./research-download-limits";

export * from "./research-download-limits";

const DOWNLOAD_ID_BYTES = 32;
const RESEARCH_DOWNLOAD_DIR = "research-downloads";

export interface ResearchDownloadLease {
  downloadId: string;
  /** Routing metadata for the originating research tab; not an IPC auth key. */
  ownerTabId: string;
  fileName: string;
}

export interface ResearchDownloadStore {
  /** Register one completed, main-created file and issue an opaque receipt. */
  register(
    fileName: string,
    ownerTabId: string,
    streamStorage?: ResearchDownloadStreamStorage,
  ): Promise<ResearchDownloadLease>;
  /** Consume one receipt exactly once and remove its file before returning bytes. */
  consume(downloadId: string): Promise<ResearchDownloadContent>;
  /** Best-effort main-owned cleanup for a failed download. */
  discard(fileName: string, streamStorage?: ResearchDownloadStreamStorage): Promise<void>;
  /** Remove unclaimed receipts and their files during window/process teardown. */
  clear(): Promise<void>;
  /** Close the session synchronously before draining outstanding cleanup. */
  shutdown(): Promise<void>;
  /** Reopen a session when a fresh research browser window is created. */
  reopen(): void;
  /** Remove safe leftovers from a previous process; receipts are never revived. */
  recover(): Promise<void>;
}

export interface ResearchDownloadStoreOptions {
  consumeGate?: ResearchDownloadConsumeGate;
  now?(): number;
  id?(): string;
  maxPendingDownloads?: number;
  maxDownloadBytes?: number;
  maxPendingBytes?: number;
}

type Entry = DownloadTarget & {
  readonly byteSize: number;
  readonly expiresAt: number;
  readonly fileName: string;
  readonly contentKind: ResearchDownloadContent["kind"];
  readonly maxByteSize: number;
  readonly ownerTabId: string;
  state: "available" | "claimed";
};
type DownloadTarget =
  | { absolutePath: string; kind: "flat" }
  | { absolutePath: string; cleanupDirectory: string; kind: "stream" };
/** Main-only registry; receipts expire on restart and `recover` cleans safe leftovers. */
export function createResearchDownloadStore(
  userDataRoot: string,
  options: ResearchDownloadStoreOptions = {},
): ResearchDownloadStore {
  const entries = new Map<string, Entry>();
  const reservedPaths = new Set<string>();
  const cleanupPaths = new Set<string>();
  const now = options.now ?? Date.now;
  const newId = options.id ?? (() => randomBytes(DOWNLOAD_ID_BYTES).toString("base64url"));
  const maxPendingDownloads =
    options.maxPendingDownloads ?? downloadLimits.MAX_PENDING_RESEARCH_DOWNLOADS;
  const maxDownloadBytes = options.maxDownloadBytes ?? downloadLimits.MAX_RESEARCH_DOWNLOAD_BYTES;
  const maxPendingBytes =
    options.maxPendingBytes ?? downloadLimits.MAX_PENDING_RESEARCH_DOWNLOAD_BYTES;
  const consumeGate = options.consumeGate ?? defaultResearchDownloadConsumeGate;
  let pendingBytes = 0;
  let reservedRegistrations = 0;
  let reservedBytes = 0;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let acceptingRegistrations = true;

  if (!Number.isSafeInteger(maxPendingDownloads) || maxPendingDownloads <= 0) {
    throw new Error("Research download receipt limit is invalid");
  }
  if (!Number.isSafeInteger(maxDownloadBytes) || maxDownloadBytes <= 0) {
    throw new Error("Research download byte limit is invalid");
  }
  if (!Number.isSafeInteger(maxPendingBytes) || maxPendingBytes <= 0) {
    throw new Error("Pending research download byte limit is invalid");
  }

  function targetFor(
    fileName: string,
    streamStorage?: ResearchDownloadStreamStorage,
  ): DownloadTarget {
    assertSafeFileName(fileName);
    if (streamStorage) {
      const target = resolveResearchDownloadStreamTarget(userDataRoot, streamStorage);
      return {
        absolutePath: target.absolutePath,
        cleanupDirectory: target.directory,
        kind: "stream",
      };
    }
    return { absolutePath: join(userDataRoot, RESEARCH_DOWNLOAD_DIR, fileName), kind: "flat" };
  }

  function assertSafeTargetParentDirectories(target: DownloadTarget): Promise<void> {
    if (target.kind === "stream") {
      return assertOwnedResearchDownloadStreamDirectory(userDataRoot, target.cleanupDirectory);
    }
    return assertSafeParentDirectories(userDataRoot, target.absolutePath);
  }

  function scheduleExpiryPurge(): void {
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = null;
    let earliest: number | null = null;
    for (const entry of entries.values()) {
      if (entry.state === "available" && (earliest === null || entry.expiresAt < earliest)) {
        earliest = entry.expiresAt;
      }
    }
    if (earliest === null) return;
    expiryTimer = setTimeout(
      () => {
        expiryTimer = null;
        void purgeExpired().catch(() => {});
      },
      Math.max(0, earliest - now()),
    );
    expiryTimer.unref?.();
  }

  async function purgeExpired(): Promise<void> {
    const at = now();
    for (const [downloadId, entry] of entries) {
      if (entry.state !== "available" || entry.expiresAt > at) continue;
      if (reservedPaths.has(entry.absolutePath)) continue;
      entries.delete(downloadId);
      pendingBytes -= entry.byteSize;
      await scheduleSafeDiscard(entry);
    }
    scheduleExpiryPurge();
  }

  async function removeEntry(downloadId: string, entry: Entry): Promise<void> {
    if (entries.get(downloadId) !== entry) return;
    entries.delete(downloadId);
    pendingBytes -= entry.byteSize;
    scheduleExpiryPurge();
  }

  async function discardSafePath(target: DownloadTarget, byteLimit: number): Promise<void> {
    try {
      await assertSafeTargetParentDirectories(target);
      const stat = await lstatOrMissing(target.absolutePath);
      if (!stat) return;
      assertSafeRegularFile(stat);
      if (target.kind === "flat") assertByteSize(stat.size, byteLimit);
      await fs.unlink(target.absolutePath);
    } catch {
      // A suspicious path is deliberately left untouched.  The lease is still
      // retired so an untrusted caller cannot retry a dangerous pathname.
    } finally {
      await removeEmptyResearchDownloadStreamDirectory(
        userDataRoot,
        target.kind === "stream" ? target.cleanupDirectory : undefined,
      );
    }
  }

  function scheduleSafeDiscard(target: DownloadTarget): Promise<void> {
    // Tombstone the pathname synchronously before any await. A concurrent
    // registration must not reuse it while this cleanup is in flight.
    cleanupPaths.add(target.absolutePath);
    return discardSafePath(target, maxDownloadBytes).finally(() => {
      cleanupPaths.delete(target.absolutePath);
    });
  }

  async function recoverDirectory(): Promise<void> {
    const directory = join(userDataRoot, RESEARCH_DOWNLOAD_DIR);
    let names: string[];
    try {
      names = await fs.readdir(directory);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      return;
    }
    for (const name of names) {
      try {
        if (isResearchDownloadStreamDirectoryName(name)) {
          const stream = resolveResearchDownloadStreamTarget(userDataRoot, { directoryName: name });
          await scheduleSafeDiscard({
            absolutePath: stream.absolutePath,
            cleanupDirectory: stream.directory,
            kind: "stream",
          });
        } else {
          await scheduleSafeDiscard(targetFor(name));
        }
      } catch {
        // Keep malformed or unsafe entries for manual recovery.
      }
    }
  }

  async function clearStore(): Promise<void> {
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = null;
    // Iterate over a snapshot. A new window may reopen the store while an
    // unlink is awaiting filesystem I/O; newly registered entries must never
    // be swept by this old shutdown pass.
    for (const [downloadId, entry] of [...entries]) {
      if (entry.state === "claimed" || reservedPaths.has(entry.absolutePath)) continue;
      if (entries.get(downloadId) !== entry) continue;
      entries.delete(downloadId);
      pendingBytes -= entry.byteSize;
      await scheduleSafeDiscard(entry);
    }
    scheduleExpiryPurge();
  }

  return {
    async register(fileName, ownerTabId, streamStorage) {
      if (!acceptingRegistrations) throw new Error("Research download store is closed");
      // Reserve a slot before the first await. `will-download` callbacks can
      // complete concurrently, so checking only `entries.size` after purge
      // would let a burst exceed the bounded receipt count.
      assertSafeFileName(fileName);
      assertOpaqueText(ownerTabId, "Research download owner tab id", 256);
      const target = targetFor(fileName, streamStorage);
      const filePolicy = describeResearchDownloadFile(fileName, maxDownloadBytes);
      const entryMaxBytes = filePolicy.maxByteSize;
      const { absolutePath } = target;
      if (entries.size + reservedRegistrations >= maxPendingDownloads) {
        throw new Error("Too many pending research download receipts");
      }
      if (reservedPaths.has(absolutePath) || cleanupPaths.has(absolutePath)) {
        throw new Error("Research download file is already leased");
      }
      for (const entry of entries.values()) {
        if (entry.absolutePath === absolutePath) {
          throw new Error("Research download file is already leased");
        }
      }
      reservedRegistrations += 1;
      reservedPaths.add(absolutePath);
      let registered = false;
      let reservedByteSize = 0;
      try {
        await purgeExpired();
        if (!acceptingRegistrations) throw new Error("Research download store is closed");
        // The slot and pathname were reserved synchronously above. Do not
        // re-count concurrent reservations after this await: doing so would
        // reject the second valid registration in a full-capacity burst.
        for (const entry of entries.values()) {
          if (entry.absolutePath === absolutePath) {
            throw new Error("Research download file is already leased");
          }
        }
        await assertSafeTargetParentDirectories(target);
        const stat = await lstatOrMissing(absolutePath);
        if (!stat) throw new Error("Research download file is unavailable");
        assertSafeRegularFile(stat);
        const byteSize = assertByteSize(stat.size, entryMaxBytes);
        if (!acceptingRegistrations) throw new Error("Research download store is closed");
        if (pendingBytes + reservedBytes + byteSize > maxPendingBytes) {
          throw new Error("Pending research download byte quota exceeded");
        }
        reservedBytes += byteSize;
        reservedByteSize = byteSize;

        let downloadId = "";
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const candidate = newId();
          assertResearchDownloadId(candidate);
          if (!entries.has(candidate)) {
            downloadId = candidate;
            break;
          }
        }
        if (!downloadId) throw new Error("Research download receipt id is already in use");
        if (!acceptingRegistrations) throw new Error("Research download store is closed");

        entries.set(downloadId, {
          ...target,
          byteSize,
          expiresAt: now() + downloadLimits.RESEARCH_DOWNLOAD_TTL_MS,
          fileName,
          contentKind: filePolicy.kind,
          maxByteSize: entryMaxBytes,
          ownerTabId,
          state: "available",
        });
        registered = true;
        pendingBytes += byteSize;
        scheduleExpiryPurge();
        return { downloadId, ownerTabId, fileName };
      } catch (error) {
        const ownedByAnotherEntry = [...entries.values()].some(
          (entry) => entry.absolutePath === absolutePath,
        );
        if (!registered && !ownedByAnotherEntry) {
          await scheduleSafeDiscard(target);
        }
        throw error;
      } finally {
        if (reservedByteSize !== 0) {
          reservedBytes -= reservedByteSize;
        }
        reservedRegistrations -= 1;
        reservedPaths.delete(absolutePath);
      }
    },
    async consume(downloadId) {
      await purgeExpired();
      assertResearchDownloadId(downloadId);
      const entry = entries.get(downloadId);
      if (!entry || entry.state !== "available") {
        throw new Error("Research download receipt is unavailable");
      }
      const admission = consumeGate.admit(entry.byteSize);
      if (!admission) throw new Error("Research download consumer is busy");
      // Claim synchronously before the first await below. Concurrent consumers
      // therefore cannot both open or unlink the same file.
      entry.state = "claimed";
      scheduleExpiryPurge();

      let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
      let unlinked = false;
      try {
        await assertSafeTargetParentDirectories(entry);
        const before = await lstatOrMissing(entry.absolutePath);
        if (!before) throw new Error("Research download file is unavailable");
        assertSafeRegularFile(before);
        assertByteSize(before.size, entry.maxByteSize);

        handle = await fs.open(entry.absolutePath, readFlags());
        const opened = await handle.stat();
        assertSafeRegularFile(opened);
        assertSameFile(before, opened);
        if (opened.size !== before.size) {
          throw new Error("Research download file changed during validation");
        }

        // Remove the directory entry while the validated descriptor is held.
        // This prevents a pathname replacement from being unlinked after the
        // validation/read sequence and makes the receipt genuinely one-time.
        await fs.unlink(entry.absolutePath);
        unlinked = true;
        if (entry.contentKind === "ignored") {
          await removeEntry(downloadId, entry);
          return { kind: "ignored" };
        }
        // Read into the already-validated, fixed-size buffer. `readFile()` would
        // size a new allocation from a concurrently changed inode and could
        // turn a bounded receipt into an unbounded OOM attempt.
        const bytes = Buffer.allocUnsafe(entry.byteSize);
        const { bytesRead } = await handle.read(bytes, 0, entry.byteSize, 0);
        const after = await handle.stat();
        assertSameFile(opened, after);
        if (bytesRead !== entry.byteSize || Number(after.size) !== entry.byteSize) {
          throw new Error("Research download file changed during read");
        }

        await removeEntry(downloadId, entry);
        return {
          kind: entry.contentKind,
          bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytesRead),
        };
      } catch (error) {
        const cleanup = unlinked ? null : scheduleSafeDiscard(entry);
        await removeEntry(downloadId, entry);
        await cleanup;
        throw error;
      } finally {
        try {
          await handle?.close().catch(() => {});
          await removeEmptyResearchDownloadStreamDirectory(
            userDataRoot,
            entry.kind === "stream" ? entry.cleanupDirectory : undefined,
          );
        } finally {
          admission.release();
        }
      }
    },

    async discard(fileName, streamStorage) {
      const target = targetFor(fileName, streamStorage);
      const { absolutePath } = target;
      if (reservedPaths.has(absolutePath) || cleanupPaths.has(absolutePath)) return;
      const cleanup = scheduleSafeDiscard(target);
      for (const [downloadId, entry] of entries) {
        if (entry.absolutePath !== absolutePath || entry.state === "claimed") continue;
        entries.delete(downloadId);
        pendingBytes -= entry.byteSize;
      }
      scheduleExpiryPurge();
      await cleanup;
    },

    clear: clearStore,

    async shutdown() {
      acceptingRegistrations = false;
      await clearStore();
    },

    reopen() {
      acceptingRegistrations = true;
    },

    async recover() {
      await recoverDirectory();
    },
  };
}

let defaultStore: { root: string; store: ResearchDownloadStore } | null = null;

function mainStore(): ResearchDownloadStore {
  const root = app.getPath("userData");
  if (!defaultStore || defaultStore.root !== root) {
    defaultStore = { root, store: createResearchDownloadStore(root) };
  }
  return defaultStore.store;
}

export function registerResearchDownload(
  fileName: string,
  ownerTabId: string,
  streamStorage?: ResearchDownloadStreamStorage,
): Promise<ResearchDownloadLease> {
  return mainStore().register(fileName, ownerTabId, streamStorage);
}

export function consumeResearchDownload(downloadId: string): Promise<ResearchDownloadContent> {
  return mainStore().consume(downloadId);
}

export function discardResearchDownload(
  fileName: string,
  streamStorage?: ResearchDownloadStreamStorage,
): Promise<void> {
  return mainStore().discard(fileName, streamStorage);
}

export function clearResearchDownloads(): Promise<void> {
  return defaultStore?.store.shutdown() ?? Promise.resolve();
}

export function recoverResearchDownloads(): Promise<void> {
  const store = mainStore();
  store.reopen();
  return store.recover();
}

export function openResearchDownloads(): void {
  mainStore().reopen();
}

/** Main-only path used by the browser writer; this never crosses IPC. */
export function researchDownloadPath(userDataRoot: string, fileName: string): string {
  assertSafeFileName(fileName);
  return join(userDataRoot, RESEARCH_DOWNLOAD_DIR, fileName);
}

export { ensureSafeResearchDownloadDirectory } from "./research-download-store-io";

export { assertResearchDownloadConsumeInput } from "./research-download-id";
