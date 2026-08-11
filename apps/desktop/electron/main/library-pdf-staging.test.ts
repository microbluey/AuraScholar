import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLibraryPdfStagingStore,
  MAX_PENDING_RECEIPTS,
  STAGED_PDF_TTL_MS,
  writeCanonicalPdfBlobAtUserDataRoot,
} from "./library-pdf-staging";
import {
  libraryPdfStagingJournalPath,
  type LibraryPdfStagingJournal,
} from "./library-pdf-staging-journal";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nmain-owned staging\n%%EOF");
const PDF_SHA = createHash("sha256").update(PDF_BYTES).digest("hex");
const roots: string[] = [];

async function root(): Promise<string> {
  const directory = await fs.mkdtemp(join(tmpdir(), "aurascholar-pdf-stage-"));
  roots.push(directory);
  return directory;
}

function canonicalPath(userDataRoot: string, sha = PDF_SHA): string {
  return join(userDataRoot, "blobs", sha.slice(0, 2), `${sha}.pdf`);
}

interface DeferredWrite {
  reject(reason?: unknown): void;
  resolve(): void;
  readonly promise: Promise<void>;
}

function deferredWrite(): DeferredWrite {
  let reject!: (reason?: unknown) => void;
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function memoryJournal(): LibraryPdfStagingJournal {
  const orphaned = new Set<string>();
  const staged = new Map<string, number>();
  return {
    async clearOrphanCandidate(sha) {
      orphaned.delete(sha);
    },
    async clearRecoveredCandidate(sha) {
      orphaned.delete(sha);
      staged.delete(sha);
    },
    async markCommitted(sha) {
      decrement(sha);
    },
    async markOrphaned(sha) {
      decrement(sha);
      orphaned.add(sha);
    },
    async recordStage(sha) {
      staged.set(sha, (staged.get(sha) ?? 0) + 1);
    },
    async recoveryCandidates() {
      return [...new Set([...staged.keys(), ...orphaned])];
    },
  };

  function decrement(sha: string): void {
    const count = staged.get(sha);
    if (!count) throw new Error("missing staged SHA");
    if (count === 1) staged.delete(sha);
    else staged.set(sha, count - 1);
  }
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe("main-owned library PDF staging", () => {
  it("writes, fsyncs, and records only a verified canonical receipt", async () => {
    const userDataRoot = await root();
    const store = createLibraryPdfStagingStore(userDataRoot);

    const receipt = await store.stage(PDF_BYTES);

    expect(receipt).toEqual({
      byteSize: PDF_BYTES.byteLength,
      sha: PDF_SHA,
      stageId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    await expect(fs.readFile(canonicalPath(userDataRoot))).resolves.toEqual(Buffer.from(PDF_BYTES));
  });

  it("does not begin a canonical write when the durable SHA journal cannot record it", async () => {
    const userDataRoot = await root();
    const writer = vi.fn().mockResolvedValue(undefined);
    const journal: LibraryPdfStagingJournal = {
      ...memoryJournal(),
      recordStage: vi.fn().mockRejectedValue(new Error("journal unavailable")),
    };
    const store = createLibraryPdfStagingStore(userDataRoot, {
      journal,
      writeCanonicalPdfBlob: writer,
    });

    await expect(store.stage(PDF_BYTES)).rejects.toThrow("journal unavailable");
    expect(writer).not.toHaveBeenCalled();
  });

  it("never overwrites a pre-existing canonical pathname with mismatched bytes", async () => {
    const userDataRoot = await root();
    const target = canonicalPath(userDataRoot);
    const corrupt = new TextEncoder().encode("not the expected PDF bytes");
    await fs.mkdir(join(userDataRoot, "blobs", PDF_SHA.slice(0, 2)), { recursive: true });
    await fs.writeFile(target, corrupt);

    await expect(
      writeCanonicalPdfBlobAtUserDataRoot(userDataRoot, PDF_SHA, PDF_BYTES),
    ).rejects.toThrow("Canonical PDF target is unsafe or does not match its content receipt");
    await expect(fs.readFile(target)).resolves.toEqual(Buffer.from(corrupt));
  });

  it("refuses to install bytes under a caller-supplied mismatched hash", async () => {
    const userDataRoot = await root();

    await expect(
      writeCanonicalPdfBlobAtUserDataRoot(userDataRoot, "b".repeat(64), PDF_BYTES),
    ).rejects.toThrow("PDF staging receipt does not match its bytes");
    await expect(fs.access(canonicalPath(userDataRoot, "b".repeat(64)))).rejects.toThrow();
  });

  it("reuses an independently verified canonical target without copying or replacing it", async () => {
    const userDataRoot = await root();
    const target = canonicalPath(userDataRoot);
    await fs.mkdir(join(userDataRoot, "blobs", PDF_SHA.slice(0, 2)), { recursive: true });
    await fs.writeFile(target, PDF_BYTES);
    const before = await fs.stat(target);

    await writeCanonicalPdfBlobAtUserDataRoot(userDataRoot, PDF_SHA, PDF_BYTES);

    const after = await fs.stat(target);
    expect(after.ino).toBe(before.ino);
    await expect(fs.readFile(target)).resolves.toEqual(Buffer.from(PDF_BYTES));
  });

  it("refuses an unsafe pre-existing target instead of following a symlink", async () => {
    const userDataRoot = await root();
    const target = canonicalPath(userDataRoot);
    const external = join(userDataRoot, "outside.pdf");
    await fs.mkdir(join(userDataRoot, "blobs", PDF_SHA.slice(0, 2)), { recursive: true });
    await fs.writeFile(external, PDF_BYTES);
    await fs.symlink(external, target);

    await expect(
      writeCanonicalPdfBlobAtUserDataRoot(userDataRoot, PDF_SHA, PDF_BYTES),
    ).rejects.toThrow("Canonical PDF target is unsafe or does not match its content receipt");
  });

  it("uses a one-time claim, releases after failure, consumes after success, and expires idle receipts", async () => {
    const userDataRoot = await root();
    let now = 1_000;
    let serial = 0;
    const store = createLibraryPdfStagingStore(userDataRoot, {
      now: () => now,
      stageId: () => `${++serial}${"x".repeat(43)}`.slice(0, 43),
    });
    const receipt = await store.stage(PDF_BYTES);

    const failedClaim = await store.claim(receipt.stageId);
    expect(failedClaim.receipt).toEqual(receipt);
    await expect(store.claim(receipt.stageId)).rejects.toThrow("unavailable");
    failedClaim.release();

    const successfulClaim = await store.claim(receipt.stageId);
    successfulClaim.consume();
    await expect(store.claim(receipt.stageId)).rejects.toThrow("unavailable");

    const expiring = await store.stage(PDF_BYTES);
    now += 30 * 60 * 1000;
    await expect(store.claim(expiring.stageId)).rejects.toThrow("unavailable");
    await expect(store.release(expiring.stageId)).resolves.toBe(false);
  });

  it("collects released and expired receipts through the guarded main-only cleanup seam", async () => {
    const userDataRoot = await root();
    let now = 1_000;
    const collected: string[] = [];
    const store = createLibraryPdfStagingStore(userDataRoot, {
      now: () => now,
      async removeUnreferencedCanonicalPdfBlob(rootPath, sha) {
        collected.push(sha);
        await fs.unlink(canonicalPath(rootPath, sha));
        return true;
      },
    });

    const released = await store.stage(PDF_BYTES);
    await expect(store.release(released.stageId)).resolves.toBe(true);
    await expect(fs.access(canonicalPath(userDataRoot))).rejects.toThrow();

    const expiring = await store.stage(PDF_BYTES);
    now += 30 * 60 * 1000;
    await expect(store.claim(expiring.stageId)).rejects.toThrow("unavailable");
    await expect(fs.access(canonicalPath(userDataRoot))).rejects.toThrow();
    expect(collected).toEqual([PDF_SHA, PDF_SHA]);
  });

  it("runs TTL cleanup without waiting for a later staging operation", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000));
      const userDataRoot = await root();
      const cleanup = vi.fn().mockResolvedValue(true);
      const store = createLibraryPdfStagingStore(userDataRoot, {
        journal: memoryJournal(),
        now: () => Date.now(),
        removeUnreferencedCanonicalPdfBlob: cleanup,
        writeCanonicalPdfBlob: async () => {},
      });
      await store.stage(PDF_BYTES);

      await vi.advanceTimersByTimeAsync(STAGED_PDF_TTL_MS);
      expect(cleanup).toHaveBeenCalledWith(userDataRoot, PDF_SHA);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers a crash-stale SHA after rebuilding the store without reviving its receipt", async () => {
    const userDataRoot = await root();
    const beforeCrash = createLibraryPdfStagingStore(userDataRoot);
    const receipt = await beforeCrash.stage(PDF_BYTES);
    await expect(fs.access(libraryPdfStagingJournalPath(userDataRoot))).resolves.toBeUndefined();

    const recovered = createLibraryPdfStagingStore(userDataRoot, {
      async removeUnreferencedCanonicalPdfBlob(rootPath, sha) {
        await fs.unlink(canonicalPath(rootPath, sha));
        return true;
      },
    });
    await recovered.recover();

    await expect(recovered.claim(receipt.stageId)).rejects.toThrow("unavailable");
    await expect(fs.access(canonicalPath(userDataRoot))).rejects.toThrow();
    await expect(fs.access(libraryPdfStagingJournalPath(userDataRoot))).rejects.toThrow();
  });

  it("retains the journal after a failed GC and lets a rebuilt store retry it", async () => {
    const userDataRoot = await root();
    const first = createLibraryPdfStagingStore(userDataRoot, {
      async removeUnreferencedCanonicalPdfBlob() {
        throw new Error("temporary GC failure");
      },
    });
    const receipt = await first.stage(PDF_BYTES);

    await expect(first.release(receipt.stageId)).resolves.toBe(true);
    await expect(fs.access(libraryPdfStagingJournalPath(userDataRoot))).resolves.toBeUndefined();

    const recovered = createLibraryPdfStagingStore(userDataRoot, {
      async removeUnreferencedCanonicalPdfBlob(rootPath, sha) {
        await fs.unlink(canonicalPath(rootPath, sha));
        return true;
      },
    });
    await recovered.recover();

    await expect(fs.access(canonicalPath(userDataRoot))).rejects.toThrow();
    await expect(fs.access(libraryPdfStagingJournalPath(userDataRoot))).rejects.toThrow();
  });

  it("fails safe for a corrupted journal: it neither collects nor writes a new blob", async () => {
    const userDataRoot = await root();
    const journalPath = libraryPdfStagingJournalPath(userDataRoot);
    await fs.mkdir(join(userDataRoot, ".ingest-staging"), { recursive: true });
    await fs.writeFile(journalPath, "{invalid", { mode: 0o600 });
    await fs.mkdir(join(userDataRoot, "blobs", PDF_SHA.slice(0, 2)), { recursive: true });
    await fs.writeFile(canonicalPath(userDataRoot), PDF_BYTES);
    const cleanup = vi.fn().mockResolvedValue(true);
    const writer = vi.fn().mockResolvedValue(undefined);
    const store = createLibraryPdfStagingStore(userDataRoot, {
      removeUnreferencedCanonicalPdfBlob: cleanup,
      writeCanonicalPdfBlob: writer,
    });

    await store.recover();
    expect(cleanup).not.toHaveBeenCalled();
    await expect(store.stage(PDF_BYTES)).rejects.toThrow("journal");
    expect(writer).not.toHaveBeenCalled();
    await expect(fs.readFile(canonicalPath(userDataRoot))).resolves.toEqual(Buffer.from(PDF_BYTES));
  });

  it("does not collect a SHA while another staged receipt can still finalize it", async () => {
    const userDataRoot = await root();
    const collected: string[] = [];
    const store = createLibraryPdfStagingStore(userDataRoot, {
      async removeUnreferencedCanonicalPdfBlob(_rootPath, sha) {
        collected.push(sha);
        return true;
      },
    });
    const first = await store.stage(PDF_BYTES);
    const second = await store.stage(PDF_BYTES);
    const claimed = await store.claim(first.stageId);

    await expect(store.release(second.stageId)).resolves.toBe(true);
    expect(collected).toEqual([]);

    claimed.consume();
    await store.clear();
    expect(collected).toEqual([PDF_SHA]);
  });

  it("settles the durable SHA journal after a successful claim is consumed", async () => {
    const userDataRoot = await root();
    const baseJournal = memoryJournal();
    const markCommitted = vi.fn(baseJournal.markCommitted);
    const store = createLibraryPdfStagingStore(userDataRoot, {
      journal: { ...baseJournal, markCommitted },
    });
    const receipt = await store.stage(PDF_BYTES);
    const claim = await store.claim(receipt.stageId);

    claim.consume();
    await vi.waitFor(() => expect(markCommitted).toHaveBeenCalledWith(PDF_SHA));
  });

  it("enforces a total byte quota and frees it after release", async () => {
    const userDataRoot = await root();
    const store = createLibraryPdfStagingStore(userDataRoot, {
      maxPendingBytes: PDF_BYTES.byteLength,
    });
    const receipt = await store.stage(PDF_BYTES);

    await expect(store.stage(PDF_BYTES)).rejects.toThrow("byte quota");
    await expect(store.release(receipt.stageId)).resolves.toBe(true);
    await expect(store.stage(PDF_BYTES)).resolves.toMatchObject({ sha: PDF_SHA });
  });

  it("reserves byte quota before an asynchronous canonical write settles", async () => {
    const userDataRoot = await root();
    const write = deferredWrite();
    const writeStarted = deferredWrite();
    const store = createLibraryPdfStagingStore(userDataRoot, {
      maxPendingBytes: PDF_BYTES.byteLength,
      async writeCanonicalPdfBlob() {
        writeStarted.resolve();
        await write.promise;
      },
    });
    const pending = store.stage(PDF_BYTES);

    await writeStarted.promise;
    await expect(store.stage(PDF_BYTES)).rejects.toThrow("byte quota");
    write.resolve();
    await expect(pending).resolves.toMatchObject({ sha: PDF_SHA });
  });

  it("reserves pending receipt capacity before concurrent blob writes begin", async () => {
    const userDataRoot = await root();
    const writes: DeferredWrite[] = [];
    const store = createLibraryPdfStagingStore(userDataRoot, {
      journal: memoryJournal(),
      async writeCanonicalPdfBlob() {
        const write = deferredWrite();
        writes.push(write);
        await write.promise;
      },
    });
    const pendingStages = Array.from({ length: MAX_PENDING_RECEIPTS }, () =>
      store.stage(PDF_BYTES),
    );

    await vi.waitFor(() => expect(writes).toHaveLength(MAX_PENDING_RECEIPTS));
    await expect(store.stage(PDF_BYTES)).rejects.toThrow("Too many pending PDF staging receipts");
    expect(writes).toHaveLength(MAX_PENDING_RECEIPTS);

    for (const write of writes) write.resolve();
    await expect(Promise.all(pendingStages)).resolves.toHaveLength(MAX_PENDING_RECEIPTS);
  });

  it("releases a failed write reservation while other stages are still pending", async () => {
    const userDataRoot = await root();
    const writes: DeferredWrite[] = [];
    const store = createLibraryPdfStagingStore(userDataRoot, {
      journal: memoryJournal(),
      async writeCanonicalPdfBlob() {
        const write = deferredWrite();
        writes.push(write);
        await write.promise;
      },
    });
    const pendingStages = Array.from({ length: MAX_PENDING_RECEIPTS }, () =>
      store.stage(PDF_BYTES),
    );

    await vi.waitFor(() => expect(writes).toHaveLength(MAX_PENDING_RECEIPTS));
    const failedWrite = writes[0];
    const failedStage = pendingStages[0];
    if (!failedWrite || !failedStage) throw new Error("first staging write did not start");
    failedWrite.reject(new Error("disk write failed"));
    await expect(failedStage).rejects.toThrow("disk write failed");

    const replacement = store.stage(PDF_BYTES);
    await vi.waitFor(() => expect(writes).toHaveLength(MAX_PENDING_RECEIPTS + 1));

    for (const write of writes.slice(1)) write.resolve();
    await expect(Promise.all([...pendingStages.slice(1), replacement])).resolves.toHaveLength(
      MAX_PENDING_RECEIPTS,
    );
  });
});
