import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { requireLocalLibraryId } from "../local-first";
import { MIGRATIONS, runMigrations } from "../migrations";
import { withDatabaseSavepoint } from "../savepoint";
import { AnnotationsRepo } from "./annotations";
import { AttachmentsRepo } from "./attachments";
import { DocumentAssetsRepo } from "./document-assets";
import { EvidenceRepo } from "./evidence";
import {
  appendKnowledgeChangeInTransaction,
  type ContentUnit,
  ContentUnitsRepo,
  KnowledgeChangesRepo,
  KnowledgeJobsRepo,
} from "./knowledge";
import { WorksRepo } from "./works";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

let db: Database;
let libraryId: string;
let changes: KnowledgeChangesRepo;
let jobs: KnowledgeJobsRepo;
let units: ContentUnitsRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryId = await requireLocalLibraryId(db);
  changes = new KnowledgeChangesRepo(db, libraryId);
  jobs = new KnowledgeJobsRepo(db, libraryId);
  units = new ContentUnitsRepo(db, libraryId);
});

async function migrateThrough(version: number): Promise<Database> {
  const legacy = await createNodeDatabase(":memory:");
  await legacy.exec(
    `CREATE TABLE _migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at INTEGER NOT NULL
     )`,
  );
  for (const migration of MIGRATIONS) {
    if (migration.version > version) break;
    if (migration.disableForeignKeys) await legacy.exec("PRAGMA foreign_keys = OFF");
    await legacy.exec("BEGIN");
    try {
      if (migration.apply) await migration.apply(legacy);
      else await legacy.exec(migration.sql);
      await legacy.run(`INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)`, [
        migration.version,
        migration.name,
        Date.now(),
      ]);
      await legacy.exec("COMMIT");
    } catch (error) {
      await legacy.exec("ROLLBACK");
      throw error;
    } finally {
      if (migration.disableForeignKeys) await legacy.exec("PRAGMA foreign_keys = ON");
    }
  }
  return legacy;
}

function contentUnit(id: string, ordinal: number, text = `Excerpt ${ordinal}`): ContentUnit {
  return {
    id,
    libraryId,
    sourceType: "evidence",
    sourceId: "evidence:one",
    workId: null,
    assetId: null,
    revisionId: null,
    parentUnitId: null,
    ordinal,
    headingPath: null,
    anchor: { version: 1, kind: "web", url: "https://example.test/record" },
    text,
    language: "en",
    tokenCount: 2,
    contentHash: ordinal === 0 ? HASH_A : HASH_B,
    extractorProfile: "test-extractor-v1",
    chunkProfile: "test-chunk-v1",
    state: "ready",
  };
}

describe("Knowledge Layer durable state", () => {
  it("creates the v20 durable tables and partial active-job index", async () => {
    const tables = await db.query<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN ('content_units', 'knowledge_changes', 'knowledge_jobs')
       ORDER BY name`,
    );
    expect(tables.map((row) => row.name)).toEqual([
      "content_units",
      "knowledge_changes",
      "knowledge_jobs",
    ]);
    const indexes = await db.query<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'index' AND name IN ('knowledge_jobs_active_dedupe_uq', 'knowledge_jobs_change_uq')
       ORDER BY name`,
    );
    expect(indexes.map((row) => row.name)).toEqual([
      "knowledge_jobs_active_dedupe_uq",
      "knowledge_jobs_change_uq",
    ]);
  });

  it("queues one initial Library rebuild when upgrading nonempty v19 data", async () => {
    const legacy = await migrateThrough(19);
    const legacyLibraryId = await requireLocalLibraryId(legacy);
    const now = Date.now();
    await legacy.run(
      `INSERT INTO works (id, library_id, title, type, created_at, updated_at)
       VALUES (?, ?, ?, 'article', ?, ?)`,
      ["work:before-v20", legacyLibraryId, "Existing Knowledge", now, now],
    );

    await runMigrations(legacy);
    expect(
      await legacy.query<{
        library_id: string;
        source_type: string;
        source_id: string;
        change_kind: string;
      }>(
        `SELECT library_id, source_type, source_id, change_kind
         FROM knowledge_changes ORDER BY seq`,
      ),
    ).toEqual([
      {
        library_id: legacyLibraryId,
        source_type: "library",
        source_id: legacyLibraryId,
        change_kind: "reindex",
      },
    ]);

    await runMigrations(legacy);
    expect(Number(await legacy.queryScalar(`SELECT COUNT(*) FROM knowledge_changes`))).toBe(1);
  });

  it("commits source mutation invalidation atomically and dispatches each outbox row once", async () => {
    await expect(
      withDatabaseSavepoint(db, "knowledge_outbox_test", async () => {
        await appendKnowledgeChangeInTransaction(db, {
          libraryId,
          sourceType: "revision",
          sourceId: "revision:rolled-back",
          changeKind: "upsert",
          expectedRevisionId: "revision:rolled-back",
          expectedContentHash: HASH_A,
          createdAt: 100,
        });
        throw new Error("rollback the source mutation");
      }),
    ).rejects.toThrow("rollback the source mutation");
    expect(await changes.list()).toEqual([]);

    const change = await changes.append({
      sourceType: "revision",
      sourceId: "revision:one",
      changeKind: "upsert",
      expectedRevisionId: "revision:one",
      expectedContentHash: HASH_A,
      createdAt: 1_000,
    });
    const firstDispatch = await jobs.dispatchPendingChanges();
    const secondDispatch = await jobs.dispatchPendingChanges();

    expect(secondDispatch).toEqual([]);
    expect(firstDispatch).toHaveLength(1);
    expect(firstDispatch[0]).toMatchObject({
      kind: "extract",
      sourceChangeSeq: change.seq,
      sourceType: "revision",
      sourceId: "revision:one",
      status: "queued",
      availableAt: 1_000,
    });
    expect(await jobs.list()).toHaveLength(1);
  });

  it("enforces the lease lifecycle and terminal retry budget", async () => {
    const queued = await jobs.enqueue({
      kind: "extract",
      sourceType: "revision",
      sourceId: "revision:lease",
      expectedRevisionId: "revision:lease",
      expectedContentHash: HASH_A,
      maxAttempts: 2,
      availableAt: 5_000,
    });
    const leased = await jobs.claimNext("worker-a", { now: 5_000, leaseMs: 1_000 });
    expect(leased).toMatchObject({
      id: queued.job.id,
      status: "leased",
      attempts: 1,
      leaseOwner: "worker-a",
      leaseExpiresAt: 6_000,
    });
    const running = await jobs.start(queued.job.id, "worker-a", { now: 5_001, leaseMs: 1_000 });
    expect(running?.status).toBe("running");

    const firstFailure = await jobs.fail(
      queued.job.id,
      "worker-a",
      new Error("temporary source error"),
      {
        now: 5_002,
        retryDelayMs: 10,
      },
    );
    expect(firstFailure).toMatchObject({
      status: "retry-wait",
      attempts: 1,
      availableAt: 5_012,
      error: "temporary source error",
    });
    expect(await jobs.claimNext("worker-a", { now: 5_011, leaseMs: 1_000 })).toBeNull();

    const secondLease = await jobs.claimNext("worker-a", { now: 5_012, leaseMs: 1_000 });
    expect(secondLease).toMatchObject({ status: "leased", attempts: 2 });
    await jobs.start(queued.job.id, "worker-a", { now: 5_013, leaseMs: 1_000 });
    const terminal = await jobs.fail(queued.job.id, "worker-a", "source remained unavailable", {
      now: 5_014,
    });
    expect(terminal).toMatchObject({
      status: "terminal-failed",
      attempts: 2,
      error: "source remained unavailable",
    });
  });

  it("recovers an expired lease and rejects stale worker ownership", async () => {
    const queued = await jobs.enqueue({
      kind: "reindex",
      sourceType: "library",
      sourceId: libraryId,
      availableAt: 10_000,
      maxAttempts: 2,
    });
    await jobs.claimNext("worker-a", { now: 10_000, leaseMs: 1_000 });
    expect(await jobs.recoverExpiredLeases(11_000)).toBe(1);
    expect(await jobs.get(queued.job.id)).toMatchObject({ status: "retry-wait", attempts: 1 });

    const reclaimed = await jobs.claimNext("worker-b", { now: 11_000, leaseMs: 1_000 });
    expect(reclaimed).toMatchObject({ status: "leased", attempts: 2, leaseOwner: "worker-b" });
    await jobs.start(queued.job.id, "worker-b", { now: 11_001, leaseMs: 1_000 });
    expect(await jobs.renewLease(queued.job.id, "worker-a", { now: 11_002 })).toBeNull();
    expect(await jobs.complete(queued.job.id, "worker-a", { now: 11_002 })).toBeNull();
    expect(await jobs.cancel(queued.job.id, { owner: "worker-a", now: 11_002 })).toBeNull();
    expect(await jobs.complete(queued.job.id, "worker-b", { now: 11_002 })).toMatchObject({
      status: "completed",
    });
  });

  it("fences a reused owner with the monotonic claim epoch", async () => {
    const queued = await jobs.enqueue({
      kind: "reindex",
      sourceType: "library",
      sourceId: libraryId,
      availableAt: 12_000,
      maxAttempts: 3,
    });
    const first = await jobs.claimNext("worker-a", { now: 12_000, leaseMs: 1_000 });
    expect(first).toMatchObject({ attempts: 1, leaseOwner: "worker-a" });

    expect(await jobs.recoverExpiredLeases(13_000)).toBe(1);
    const second = await jobs.claimNext("worker-a", { now: 13_000, leaseMs: 1_000 });
    expect(second).toMatchObject({ attempts: 2, leaseOwner: "worker-a" });

    expect(
      await jobs.start(queued.job.id, "worker-a", {
        now: 13_001,
        leaseMs: 1_000,
        expectedAttempts: first?.attempts,
      }),
    ).toBeNull();
    const running = await jobs.start(queued.job.id, "worker-a", {
      now: 13_001,
      leaseMs: 1_000,
      expectedAttempts: second?.attempts,
    });
    expect(running).toMatchObject({ status: "running", attempts: 2 });

    expect(
      await jobs.renewLease(queued.job.id, "worker-a", {
        now: 13_002,
        expectedAttempts: first?.attempts,
      }),
    ).toBeNull();
    expect(
      await jobs.complete(queued.job.id, "worker-a", {
        now: 13_002,
        expectedAttempts: first?.attempts,
      }),
    ).toBeNull();
    expect(
      await jobs.fail(queued.job.id, "worker-a", new Error("stale failure"), {
        now: 13_002,
        expectedAttempts: first?.attempts,
      }),
    ).toBeNull();
    expect(
      await jobs.cancel(queued.job.id, {
        owner: "worker-a",
        now: 13_002,
        expectedAttempts: first?.attempts,
      }),
    ).toBeNull();

    expect(
      await jobs.complete(queued.job.id, "worker-a", {
        now: 13_003,
        expectedAttempts: second?.attempts,
      }),
    ).toMatchObject({ status: "completed", attempts: 2 });
  });

  it("accepts a matching claim epoch for renewal, failure, and cancellation", async () => {
    const failedJob = await jobs.enqueue({
      kind: "extract",
      sourceType: "revision",
      sourceId: "revision:epoch-fail",
      availableAt: 14_000,
    });
    const failedClaim = await jobs.claimNext("worker-a", { now: 14_000, leaseMs: 1_000 });
    if (!failedClaim) throw new Error("expected failure job claim");
    const failedRunning = await jobs.start(failedJob.job.id, "worker-a", {
      now: 14_001,
      leaseMs: 1_000,
      expectedAttempts: failedClaim.attempts,
    });
    expect(failedRunning).toMatchObject({ attempts: failedClaim.attempts });
    expect(
      await jobs.renewLease(failedJob.job.id, "worker-a", {
        now: 14_002,
        leaseMs: 1_000,
        expectedAttempts: failedClaim.attempts,
      }),
    ).toMatchObject({ attempts: failedClaim.attempts, leaseExpiresAt: 15_002 });
    expect(
      await jobs.fail(failedJob.job.id, "worker-a", "expected failure", {
        now: 14_003,
        retryDelayMs: 1,
        expectedAttempts: failedClaim.attempts,
      }),
    ).toMatchObject({ status: "retry-wait", attempts: failedClaim.attempts });

    const cancelledJob = await jobs.enqueue({
      kind: "reindex",
      sourceType: "library",
      sourceId: libraryId,
      dedupeKey: "epoch-cancel",
      availableAt: 14_000,
    });
    const cancelledClaim = await jobs.claimNext("worker-b", { now: 14_004, leaseMs: 1_000 });
    if (!cancelledClaim) throw new Error("expected cancellation job claim");
    expect(
      await jobs.cancel(cancelledJob.job.id, {
        owner: "worker-b",
        now: 14_005,
        expectedAttempts: cancelledClaim.attempts,
      }),
    ).toMatchObject({ status: "cancelled", attempts: cancelledClaim.attempts });
  });

  it("rejects malformed claim epochs and ownerless epoch cancellation", async () => {
    const queued = await jobs.enqueue({
      kind: "reindex",
      sourceType: "library",
      sourceId: libraryId,
      dedupeKey: "epoch-validation",
      availableAt: 15_000,
    });
    await expect(
      jobs.start(queued.job.id, "worker-a", { now: 15_000, expectedAttempts: 0 }),
    ).rejects.toThrow("expectedAttempts must be a positive integer");
    await expect(jobs.cancel(queued.job.id, { now: 15_000, expectedAttempts: 1 })).rejects.toThrow(
      "expectedAttempts requires an owner",
    );
  });

  it("dedupes only active jobs and keeps ContentUnit writes immutable", async () => {
    const first = await jobs.enqueue({
      kind: "reindex",
      sourceType: "library",
      sourceId: libraryId,
      dedupeKey: "library-reindex",
      availableAt: 20_000,
    });
    const duplicate = await jobs.enqueue({
      kind: "reindex",
      sourceType: "library",
      sourceId: libraryId,
      dedupeKey: "library-reindex",
      availableAt: 20_000,
    });
    expect(duplicate).toMatchObject({ created: false, job: { id: first.job.id } });
    await jobs.cancel(first.job.id, { now: 20_000 });
    expect(
      await jobs.enqueue({
        kind: "reindex",
        sourceType: "library",
        sourceId: libraryId,
        dedupeKey: "library-reindex",
        availableAt: 20_000,
      }),
    ).toMatchObject({ created: true });

    const firstUnit = contentUnit("content-unit:one", 0);
    const secondUnit = contentUnit("content-unit:two", 1);
    await units.replaceForSource({
      sourceType: "evidence",
      sourceId: "evidence:one",
      units: [firstUnit, secondUnit],
    });
    await units.replaceForSource({
      sourceType: "evidence",
      sourceId: "evidence:one",
      units: [firstUnit],
    });
    expect(await units.get(secondUnit.id, { includeDeleted: true })).toMatchObject({
      deletedAt: expect.any(Number),
    });
    await expect(units.upsertMany([{ ...firstUnit, text: "different text" }])).rejects.toThrow(
      "different immutable content",
    );
  });

  it("records attachment, revision, annotation, and Evidence invalidations in their source savepoints", async () => {
    const works = new WorksRepo(db, libraryId);
    const attachments = new AttachmentsRepo(db, libraryId);
    const documents = new DocumentAssetsRepo(db, libraryId);
    const annotations = new AnnotationsRepo(db, libraryId);
    const evidence = new EvidenceRepo(db, libraryId);
    const work = await works.upsert({ title: "Durable knowledge outbox" });

    const standaloneAsset = await documents.create({
      workId: work.id,
      kind: "pdf",
      title: "standalone.pdf",
    });
    const standaloneRevision = await documents.createRevision(standaloneAsset.id, {
      mimeType: "application/pdf",
      blobSha256: HASH_B,
      byteSize: 42,
    });
    const attachment = await attachments.create({
      workId: work.id,
      sha256: HASH_A,
      byteSize: 42,
      pageCount: 1,
    });
    const annotationId = await annotations.create({
      workId: work.id,
      attachmentId: attachment.id,
      type: "highlight",
      pageIndex: 0,
      anchor: {
        version: 1,
        kind: "pdf",
        pageIndex: 0,
        quote: { exact: "durable selection" },
      },
      contentMd: "durable selection",
    });
    const createdEvidence = await evidence.createText({
      workId: work.id,
      attachmentId: attachment.id,
      expectedBlobSha256: HASH_A,
      anchor: {
        version: 1,
        kind: "pdf",
        pageIndex: 0,
        quote: { exact: "durable evidence" },
      },
      text: "durable evidence",
      evidenceKind: "context",
    });

    const recorded = await changes.list();
    expect(recorded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "revision",
          sourceId: standaloneRevision.id,
          changeKind: "upsert",
          expectedContentHash: HASH_B,
        }),
        expect.objectContaining({ sourceType: "revision", changeKind: "upsert" }),
        expect.objectContaining({
          sourceType: "annotation",
          sourceId: annotationId,
          changeKind: "upsert",
        }),
        expect.objectContaining({
          sourceType: "evidence",
          sourceId: createdEvidence.evidence.id,
          changeKind: "upsert",
        }),
      ]),
    );
  });
});
