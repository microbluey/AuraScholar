import { ensureLocalFirstState } from "../local-first";
import { createNodeDatabase, type Database } from "../database";
import { runMigrations } from "../migrations";
import { beforeEach, describe, expect, it } from "vitest";
import { KnowledgeJobsRepo } from "./knowledge-jobs-repo";
import {
  assertKnowledgeJobLease,
  isKnowledgeJobLeaseLostError,
  KnowledgeJobLeaseLostError,
} from "./knowledge-job-lease";

let database: Database;
let libraryId: string;
let jobs: KnowledgeJobsRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "knowledge-job-lease-test",
    deviceName: "Knowledge job lease test",
    platform: "test",
  }));
  jobs = new KnowledgeJobsRepo(database, libraryId);
});

describe("assertKnowledgeJobLease", () => {
  it("rejects an old claim after it is reclaimed, even when the owner is reused", async () => {
    const queued = await jobs.enqueue({
      availableAt: 1_000,
      kind: "reindex",
      sourceId: libraryId,
      sourceType: "library",
    });
    const first = await jobs.claimNext("worker-a", { now: 1_000, leaseMs: 1_000 });
    if (!first) throw new Error("first lease was not created");
    const firstRunning = await jobs.start(queued.job.id, "worker-a", {
      now: 1_001,
      leaseMs: 1_000,
    });
    if (!firstRunning) throw new Error("first lease did not start");

    expect(await jobs.recoverExpiredLeases(2_001)).toBe(1);
    const second = await jobs.claimNext("worker-a", { now: 2_001, leaseMs: 1_000 });
    if (!second) throw new Error("reclaimed lease was not created");
    const secondRunning = await jobs.start(queued.job.id, "worker-a", {
      now: 2_002,
      leaseMs: 1_000,
    });
    if (!secondRunning) throw new Error("reclaimed lease did not start");

    await expect(assertKnowledgeJobLease(database, firstRunning, 2_002)).rejects.toBeInstanceOf(
      KnowledgeJobLeaseLostError,
    );
    await expect(assertKnowledgeJobLease(database, secondRunning, 2_002)).resolves.toBeUndefined();
  });

  it("rejects a claim at its expiry and after cooperative cancellation", async () => {
    const queued = await jobs.enqueue({
      availableAt: 2_000,
      kind: "reindex",
      sourceId: libraryId,
      sourceType: "library",
    });
    const leased = await jobs.claimNext("worker-b", { now: 2_000, leaseMs: 1_000 });
    if (!leased) throw new Error("lease was not created");
    const running = await jobs.start(queued.job.id, "worker-b", { now: 2_001, leaseMs: 1_000 });
    if (!running) throw new Error("lease did not start");

    await expect(assertKnowledgeJobLease(database, running, 3_001)).rejects.toThrow(
      "Knowledge job lease is no longer owned",
    );
    expect(await jobs.cancel(queued.job.id, { owner: "worker-b", now: 2_002 })).not.toBeNull();
    await expect(assertKnowledgeJobLease(database, running, 2_003)).rejects.toBeInstanceOf(Error);
  });

  it("fails closed when a worker supplies no lease snapshot", async () => {
    await expect(
      assertKnowledgeJobLease(database, {
        attempts: 1,
        id: "job:missing",
        leaseExpiresAt: null,
        leaseOwner: null,
        libraryId,
      }),
    ).rejects.toBeInstanceOf(KnowledgeJobLeaseLostError);
  });

  it("recognizes lease-loss errors across a serialized boundary", () => {
    expect(isKnowledgeJobLeaseLostError({ code: "KNOWLEDGE_JOB_LEASE_LOST" })).toBe(true);
    expect(isKnowledgeJobLeaseLostError(new Error("other failure"))).toBe(false);
  });
});
