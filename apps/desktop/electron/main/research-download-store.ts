import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { join, relative, sep } from "node:path";
import { app } from "electron";
import {
  assertByteSize,
  assertOpaqueDownloadId,
  assertOpaqueText,
  assertSafeFileName,
  assertSafeParentDirectories,
  assertSafeRegularFile,
  assertSameFile,
  isNodeError,
  lstatOrMissing,
  readFlags,
} from "./research-download-store-io";

/**
 * A research download is a short-lived main-process capability.  The renderer
 * receives only the opaque id; the pathname never crosses the preload bridge.
 */
export const RESEARCH_DOWNLOAD_TTL_MS = 30 * 60 * 1000;
export const MAX_PENDING_RESEARCH_DOWNLOADS = 128;
export const MAX_PENDING_RESEARCH_DOWNLOAD_BYTES = 4 * 1024 * 1024 * 1024;
// IPC returns the complete file to the renderer, so keep the one-shot memory
// bound below the larger canonical-PDF staging limit.
export const MAX_RESEARCH_DOWNLOAD_BYTES = 512 * 1024 * 1024;
export const MAX_RESEARCH_DOWNLOAD_ID_LENGTH = 128;

const DOWNLOAD_ID_BYTES = 32;
const DOWNLOAD_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const RESEARCH_DOWNLOAD_DIR = "research-downloads";

function assertDownloadId(value: unknown): asserts value is string {
  assertOpaqueDownloadId(value, DOWNLOAD_ID_PATTERN, MAX_RESEARCH_DOWNLOAD_ID_LENGTH);
}

export interface ResearchDownloadLease {
  downloadId: string;
  /** Routing metadata for the originating research tab; not an IPC auth key. */
  ownerTabId: string;
  fileName: string;
}

export interface ResearchDownloadStore {
  /** Register one completed, main-created file and issue an opaque receipt. */
  register(fileName: string, ownerTabId: string): Promise<ResearchDownloadLease>;
  /** Consume one receipt exactly once and remove its file before returning bytes. */
  consume(downloadId: string): Promise<Uint8Array>;
  /** Best-effort main-owned cleanup for a failed download. */
  discard(fileName: string): Promise<void>;
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
  now?(): number;
  id?(): string;
  maxPendingDownloads?: number;
  maxDownloadBytes?: number;
  maxPendingBytes?: number;
}

interface Entry {
  readonly absolutePath: string;
  readonly byteSize: number;
  readonly expiresAt: number;
  readonly fileName: string;
  readonly ownerTabId: string;
  state: "available" | "claimed";
}

/**
 * Main-only registry for temporary research-browser files.  No durable table
 * is needed: a receipt is intentionally invalid after restart, and `recover`
 * cleans safe leftovers without scanning outside the dedicated directory.
 */
export function createResearchDownloadStore(
  userDataRoot: string,
  options: ResearchDownloadStoreOptions = {},
): ResearchDownloadStore {
  const entries = new Map<string, Entry>();
  const reservedPaths = new Set<string>();
  const cleanupPaths = new Set<string>();
  const now = options.now ?? Date.now;
  const newId = options.id ?? (() => randomBytes(DOWNLOAD_ID_BYTES).toString("base64url"));
  const maxPendingDownloads = options.maxPendingDownloads ?? MAX_PENDING_RESEARCH_DOWNLOADS;
  const maxDownloadBytes = options.maxDownloadBytes ?? MAX_RESEARCH_DOWNLOAD_BYTES;
  const maxPendingBytes = options.maxPendingBytes ?? MAX_PENDING_RESEARCH_DOWNLOAD_BYTES;
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

  function pathFor(fileName: string): string {
    assertSafeFileName(fileName);
    const directory = join(userDataRoot, RESEARCH_DOWNLOAD_DIR);
    const absolutePath = join(directory, fileName);
    const rel = relative(directory, absolutePath);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || rel.includes(sep)) {
      throw new Error("Research download path is invalid");
    }
    return absolutePath;
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
      await scheduleSafeDiscard(entry.absolutePath);
    }
    scheduleExpiryPurge();
  }

  async function removeEntry(downloadId: string, entry: Entry): Promise<void> {
    if (entries.get(downloadId) !== entry) return;
    entries.delete(downloadId);
    pendingBytes -= entry.byteSize;
    scheduleExpiryPurge();
  }

  async function discardSafePath(absolutePath: string, byteLimit: number): Promise<void> {
    try {
      await assertSafeParentDirectories(userDataRoot, absolutePath);
      const stat = await lstatOrMissing(absolutePath);
      if (!stat) return;
      assertSafeRegularFile(stat);
      assertByteSize(stat.size, byteLimit);
      await fs.unlink(absolutePath);
    } catch {
      // A suspicious path is deliberately left untouched.  The lease is still
      // retired so an untrusted caller cannot retry a dangerous pathname.
    }
  }

  function scheduleSafeDiscard(absolutePath: string): Promise<void> {
    // Tombstone the pathname synchronously before any await. A concurrent
    // registration must not reuse it while this cleanup is in flight.
    cleanupPaths.add(absolutePath);
    return discardSafePath(absolutePath, maxDownloadBytes).finally(() => {
      cleanupPaths.delete(absolutePath);
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
        const path = pathFor(name);
        await scheduleSafeDiscard(path);
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
      await scheduleSafeDiscard(entry.absolutePath);
    }
    scheduleExpiryPurge();
  }

  return {
    async register(fileName, ownerTabId) {
      if (!acceptingRegistrations) throw new Error("Research download store is closed");
      // Reserve a slot before the first await. `will-download` callbacks can
      // complete concurrently, so checking only `entries.size` after purge
      // would let a burst exceed the bounded receipt count.
      assertSafeFileName(fileName);
      assertOpaqueText(ownerTabId, "Research download owner tab id", 256);
      const absolutePath = pathFor(fileName);
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

        await assertSafeParentDirectories(userDataRoot, absolutePath);
        const stat = await lstatOrMissing(absolutePath);
        if (!stat) throw new Error("Research download file is unavailable");
        assertSafeRegularFile(stat);
        const byteSize = assertByteSize(stat.size, maxDownloadBytes);
        if (!acceptingRegistrations) throw new Error("Research download store is closed");
        if (pendingBytes + reservedBytes + byteSize > maxPendingBytes) {
          throw new Error("Pending research download byte quota exceeded");
        }
        reservedBytes += byteSize;
        reservedByteSize = byteSize;

        let downloadId = "";
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const candidate = newId();
          assertDownloadId(candidate);
          if (!entries.has(candidate)) {
            downloadId = candidate;
            break;
          }
        }
        if (!downloadId) throw new Error("Research download receipt id is already in use");
        if (!acceptingRegistrations) throw new Error("Research download store is closed");

        entries.set(downloadId, {
          absolutePath,
          byteSize,
          expiresAt: now() + RESEARCH_DOWNLOAD_TTL_MS,
          fileName,
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
          await scheduleSafeDiscard(absolutePath);
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
      assertDownloadId(downloadId);
      const entry = entries.get(downloadId);
      if (!entry || entry.state !== "available") {
        throw new Error("Research download receipt is unavailable");
      }
      // Claim synchronously before the first await below. Concurrent consumers
      // therefore cannot both open or unlink the same file.
      entry.state = "claimed";
      scheduleExpiryPurge();

      let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
      let unlinked = false;
      try {
        await assertSafeParentDirectories(userDataRoot, entry.absolutePath);
        const before = await lstatOrMissing(entry.absolutePath);
        if (!before) throw new Error("Research download file is unavailable");
        assertSafeRegularFile(before);
        assertByteSize(before.size, maxDownloadBytes);

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
        return new Uint8Array(bytes.buffer, bytes.byteOffset, bytesRead);
      } catch (error) {
        const cleanup = unlinked ? null : scheduleSafeDiscard(entry.absolutePath);
        await removeEntry(downloadId, entry);
        await cleanup;
        throw error;
      } finally {
        await handle?.close().catch(() => {});
      }
    },

    async discard(fileName) {
      const absolutePath = pathFor(fileName);
      if (reservedPaths.has(absolutePath) || cleanupPaths.has(absolutePath)) return;
      const cleanup = scheduleSafeDiscard(absolutePath);
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
): Promise<ResearchDownloadLease> {
  return mainStore().register(fileName, ownerTabId);
}

export function consumeResearchDownload(downloadId: string): Promise<Uint8Array> {
  return mainStore().consume(downloadId);
}

export function discardResearchDownload(fileName: string): Promise<void> {
  return mainStore().discard(fileName);
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

export function assertResearchDownloadConsumeInput(value: unknown): { downloadId: string } {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "downloadId")) {
    throw new Error("Invalid research.consumeDownload input");
  }
  const downloadId = value.downloadId;
  assertDownloadId(downloadId);
  return { downloadId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
