import { describe, expect, it } from "vitest";
import { KnowledgeJobWorker, type KnowledgeJobQueue, type KnowledgeJobRow } from "./index";

function job(status: KnowledgeJobRow["status"]): KnowledgeJobRow {
  return {
    id: "job:one",
    libraryId: "library:one",
    kind: "extract",
    sourceType: "revision",
    sourceId: "revision:one",
    expectedRevisionId: "revision:one",
    expectedContentHash: "a".repeat(64),
    indexId: null,
    sourceChangeSeq: 1,
    dedupeKey: "change:1",
    status,
    attempts: 1,
    maxAttempts: 3,
    availableAt: 0,
    leaseOwner: status === "queued" ? null : "worker:test",
    leaseExpiresAt: status === "queued" ? null : Date.now() + 60_000,
    progress: null,
    error: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("KnowledgeJobWorker", () => {
  it("materializes changes, leases one job, and completes it with executor progress", async () => {
    const calls: string[] = [];
    const running = job("running");
    const queue: KnowledgeJobQueue = {
      async dispatchPendingChanges() {
        calls.push("dispatch");
        return [];
      },
      async claimNext(owner) {
        calls.push(`claim:${owner}`);
        return job("leased");
      },
      async start(id, owner) {
        calls.push(`start:${id}:${owner}`);
        return running;
      },
      async renewLease() {
        return running;
      },
      async complete(id, owner, options) {
        calls.push(`complete:${id}:${owner}:${JSON.stringify(options?.progress)}`);
        return { ...running, status: "completed", progress: options?.progress ?? null };
      },
      async fail() {
        throw new Error("failure should not be recorded for a successful executor");
      },
    };
    const worker = new KnowledgeJobWorker(
      queue,
      {
        async execute(current) {
          calls.push(`execute:${current.id}`);
          return { progress: { extracted: 3 } };
        },
      },
      { owner: "worker:test", leaseMs: 1_000, heartbeatMs: 500 },
    );

    await expect(worker.runOnce()).resolves.toMatchObject({
      kind: "completed",
      job: { id: "job:one", status: "completed", progress: { extracted: 3 } },
    });
    expect(calls).toEqual([
      "dispatch",
      "claim:worker:test",
      "start:job:one:worker:test",
      "execute:job:one",
      'complete:job:one:worker:test:{"extracted":3}',
    ]);
  });

  it("does not finalise a job after the queue reports a lost lease", async () => {
    const calls: string[] = [];
    const running = job("running");
    const queue: KnowledgeJobQueue = {
      async dispatchPendingChanges() {
        return [];
      },
      async claimNext() {
        return job("leased");
      },
      async start() {
        return running;
      },
      async renewLease() {
        return running;
      },
      async complete() {
        calls.push("complete");
        return null;
      },
      async fail() {
        calls.push("fail");
        return null;
      },
    };
    const worker = new KnowledgeJobWorker(
      queue,
      { async execute() {} },
      { owner: "worker:test", leaseMs: 1_000, heartbeatMs: 500 },
    );

    await expect(worker.runOnce()).resolves.toMatchObject({ kind: "lost-lease" });
    expect(calls).toEqual(["complete"]);
  });
});
