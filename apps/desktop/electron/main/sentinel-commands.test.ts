import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@aurascholar/db";
import { AttachmentsRepo } from "@aurascholar/db/repos/attachments";
import { SentinelRepo } from "@aurascholar/db/repos/sentinel";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand, type DataCommandDependencies } from "./data-commands";

let database: Database;
let libraryId: string;
let dependencies: DataCommandDependencies;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "sentinel-command-device",
    deviceName: "Sentinel commands",
    platform: "test",
  }));
  const coordinator = new DatabaseCoordinator(database);
  dependencies = {
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
});

describe("Sentinel data commands", () => {
  it("rejects malformed inputs before acquiring a database transaction", async () => {
    let transactionCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async transaction() {
        transactionCalls += 1;
        throw new Error("must not run");
      },
    };
    const requests = [
      {
        name: "sentinel.createOrRestore",
        input: { libraryId, title: " " },
      },
      {
        name: "sentinel.createOrRestore",
        input: { libraryId, title: "Valid", doi: { invalid: true } },
      },
      {
        name: "sentinel.createOrRestore",
        input: { libraryId, title: "Valid", targets: ["not-a-milestone"] },
      },
      {
        name: "sentinel.createOrRestore",
        input: { libraryId, title: "Valid", targets: ["online", "online"] },
      },
      {
        name: "sentinel.setStatus",
        input: { libraryId, taskId: "sentinel-task", status: "removed" },
      },
      {
        name: "sentinel.delete",
        input: { libraryId, taskId: "" },
      },
      {
        name: "sentinel.linkWork",
        input: {
          expectedUpdatedAt: -1,
          libraryId,
          taskId: "sentinel-task",
          workId: "sentinel-work",
        },
      },
      {
        name: "sentinel.recordCheck",
        input: {
          libraryId,
          taskId: "sentinel-task",
          update: { errored: false, nextPollS: 60 },
        },
      },
      {
        name: "sentinel.recordCheck",
        input: {
          libraryId,
          taskId: "sentinel-task",
          update: {
            errored: false,
            expectedUpdatedAt: 1,
            newState: "unknown",
            nextPollS: 60,
          },
        },
      },
      {
        name: "sentinel.recordCheck",
        input: {
          libraryId,
          taskId: "sentinel-task",
          update: {
            errored: false,
            events: [
              {
                evidence: { unsupported: 1n },
                fromState: "accepted",
                toState: "online",
              },
            ],
            expectedUpdatedAt: 1,
            nextPollS: 60,
          },
        },
      },
      {
        name: "sentinel.recordCheck",
        input: {
          libraryId,
          taskId: "sentinel-task",
          update: {
            errored: "false",
            expectedUpdatedAt: 1,
            nextPollS: 0,
          },
        },
      },
    ];

    for (const request of requests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(transactionCalls).toBe(0);
  });

  it("creates, deduplicates, and restores a monitor through typed commands", async () => {
    const first = await executeDataCommand(
      {
        name: "sentinel.createOrRestore",
        input: {
          doi: "https://doi.org/10.4242/SENTINEL-COMMAND",
          libraryId,
          targets: ["online", "indexed_openalex"],
          title: "  Sentinel command paper  ",
        },
      },
      dependencies,
    );
    expect(first).toMatchObject({
      status: "created",
      task: {
        doi: "10.4242/sentinel-command",
        library_id: libraryId,
        title: "Sentinel command paper",
      },
    });

    const existing = await executeDataCommand(
      {
        name: "sentinel.createOrRestore",
        input: {
          doi: "doi: 10.4242/sentinel-command",
          libraryId,
          title: "Duplicate title",
        },
      },
      dependencies,
    );
    expect(existing).toMatchObject({ id: (first as { id: string }).id, status: "existing" });

    await expect(
      executeDataCommand(
        {
          name: "sentinel.delete",
          input: { libraryId, taskId: (first as { id: string }).id },
        },
        dependencies,
      ),
    ).resolves.toEqual({ updated: 1 });

    const restored = await executeDataCommand(
      {
        name: "sentinel.createOrRestore",
        input: {
          doi: "10.4242/sentinel-command",
          libraryId,
          title: "Restored title",
        },
      },
      dependencies,
    );
    expect(restored).toMatchObject({
      id: (first as { id: string }).id,
      status: "restored",
      task: { deleted_at: null, status: "active", title: "Restored title" },
    });
    await expect(new SentinelRepo(database, libraryId).list()).resolves.toHaveLength(1);
  });

  it("links a Library work and atomically records a checked revision with evidence", async () => {
    const works = new WorksRepo(database, libraryId);
    const work = await works.upsert({ title: "Sentinel command link target" });
    const created = (await executeDataCommand(
      {
        name: "sentinel.createOrRestore",
        input: { libraryId, title: "Sentinel command check" },
      },
      dependencies,
    )) as { id: string };
    const sentinel = new SentinelRepo(database, libraryId);
    const beforeLink = await sentinel.get(created.id);

    await expect(
      executeDataCommand(
        {
          name: "sentinel.linkWork",
          input: {
            expectedUpdatedAt: beforeLink!.updated_at,
            libraryId,
            taskId: created.id,
            workId: work.id,
          },
        },
        dependencies,
      ),
    ).resolves.toEqual({ committed: true });

    const linked = await sentinel.get(created.id);
    expect(linked?.work_id).toBe(work.id);
    expect(linked!.updated_at).toBeGreaterThan(beforeLink!.updated_at);
    const result = await executeDataCommand(
      {
        name: "sentinel.recordCheck",
        input: {
          libraryId,
          taskId: created.id,
          update: {
            doi: "10.4242/sentinel-record-command",
            errored: false,
            events: [
              {
                evidence: { source: "crossref", title: "Checked result" },
                fromState: "accepted",
                toState: "online",
              },
            ],
            expectedUpdatedAt: linked!.updated_at,
            newState: "online",
            nextPollS: 120,
          },
        },
      },
      dependencies,
    );

    expect(result).toEqual({
      committed: true,
      eventIds: [expect.any(String)],
      updatedAt: expect.any(Number),
    });
    const checked = await sentinel.get(created.id);
    expect(checked).toMatchObject({
      current_state: "online",
      doi: "10.4242/sentinel-record-command",
      error_count: 0,
      poll_interval_s: 120,
    });
    expect((result as { updatedAt: number }).updatedAt).toBe(checked!.updated_at);
    expect(await sentinel.events(created.id)).toEqual([
      expect.objectContaining({
        from_state: "accepted",
        id: (result as { eventIds: string[] }).eventIds[0],
        to_state: "online",
      }),
    ]);
  });

  it("treats inactive tasks and stale checked revisions as non-commits", async () => {
    const created = (await executeDataCommand(
      {
        name: "sentinel.createOrRestore",
        input: { libraryId, title: "Sentinel stale check" },
      },
      dependencies,
    )) as { id: string; task: { updated_at: number } };
    const staleRevision = created.task.updated_at;
    const work = await new WorksRepo(database, libraryId).upsert({
      title: "Stale Sentinel link target",
    });

    for (const status of ["paused", "active"] as const) {
      await executeDataCommand(
        {
          name: "sentinel.setStatus",
          input: { libraryId, status, taskId: created.id },
        },
        dependencies,
      );
    }

    await expect(
      executeDataCommand(
        {
          name: "sentinel.linkWork",
          input: {
            expectedUpdatedAt: staleRevision,
            libraryId,
            taskId: created.id,
            workId: work.id,
          },
        },
        dependencies,
      ),
    ).resolves.toEqual({ committed: false });

    await expect(
      executeDataCommand(
        {
          name: "sentinel.recordCheck",
          input: {
            libraryId,
            taskId: created.id,
            update: {
              errored: false,
              events: [
                {
                  evidence: { should: "roll back" },
                  fromState: "accepted",
                  toState: "online",
                },
              ],
              expectedUpdatedAt: staleRevision,
              newState: "online",
              nextPollS: 60,
            },
          },
        },
        dependencies,
      ),
    ).resolves.toEqual({ committed: false, eventIds: [], updatedAt: null });

    const sentinel = new SentinelRepo(database, libraryId);
    expect(await sentinel.get(created.id)).toMatchObject({
      current_state: "accepted",
      last_polled_at: null,
      status: "active",
      work_id: null,
    });
    await expect(sentinel.events(created.id)).resolves.toEqual([]);

    const current = await sentinel.get(created.id);
    await executeDataCommand(
      {
        name: "sentinel.setStatus",
        input: { libraryId, status: "paused", taskId: created.id },
      },
      dependencies,
    );
    await expect(
      executeDataCommand(
        {
          name: "sentinel.recordCheck",
          input: {
            libraryId,
            taskId: created.id,
            update: {
              errored: false,
              expectedUpdatedAt: current!.updated_at,
              nextPollS: 60,
            },
          },
        },
        dependencies,
      ),
    ).resolves.toEqual({ committed: false, eventIds: [], updatedAt: null });
  });

  it("changes lifecycle state without deleting Library assets or Sentinel evidence", async () => {
    const works = new WorksRepo(database, libraryId);
    const attachments = new AttachmentsRepo(database, libraryId);
    const workTitle = "Durable Sentinel source";
    const work = await works.upsert({ title: workTitle });
    const attachment = await attachments.create({
      byteSize: 42,
      sha256: "sentinel-command-source-pdf",
      workId: work.id,
    });
    const created = (await executeDataCommand(
      {
        name: "sentinel.createOrRestore",
        input: { libraryId, title: workTitle, workId: work.id },
      },
      dependencies,
    )) as { id: string };
    const sentinel = new SentinelRepo(database, libraryId);
    const eventId = await sentinel.addEvent(created.id, "accepted", "online", {
      source: "test",
    });

    await expect(
      executeDataCommand(
        {
          name: "sentinel.setStatus",
          input: { libraryId, status: "paused", taskId: created.id },
        },
        dependencies,
      ),
    ).resolves.toEqual({ updated: 1 });
    await expect(
      executeDataCommand(
        { name: "sentinel.delete", input: { libraryId, taskId: created.id } },
        dependencies,
      ),
    ).resolves.toEqual({ updated: 1 });

    expect(await sentinel.get(created.id)).toMatchObject({
      deleted_at: expect.any(Number),
      status: "paused",
    });
    await expect(works.get(work.id)).resolves.toMatchObject({ deleted_at: null });
    await expect(attachments.forWork(work.id)).resolves.toEqual([
      expect.objectContaining({ id: attachment.id, work_id: work.id }),
    ]);
    expect((await sentinel.events(created.id)).map((event) => event.id)).toEqual([eventId]);

    await expect(
      executeDataCommand(
        { name: "sentinel.restore", input: { libraryId, taskId: created.id } },
        dependencies,
      ),
    ).resolves.toEqual({ updated: 1 });
    expect(await sentinel.get(created.id)).toMatchObject({ deleted_at: null, status: "paused" });
    expect((await sentinel.events(created.id)).map((event) => event.id)).toEqual([eventId]);
  });

  it("rejects stale Library scope, foreign tasks, and foreign work links", async () => {
    const now = Date.now();
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES ('foreign-sentinel-library', 'Foreign Sentinel', 'personal', ?, ?)`,
      [now, now],
    );
    const foreignSentinel = new SentinelRepo(database, "foreign-sentinel-library");
    const foreignTask = await foreignSentinel.createOrRestore({ title: "Foreign monitor" });
    const localSentinel = new SentinelRepo(database, libraryId);
    const localTask = await localSentinel.createOrRestore({ title: "Local unlinked monitor" });
    await database.run(
      `INSERT INTO works
         (id, library_id, title, type, reading_status, starred, created_at, updated_at)
       VALUES ('foreign-sentinel-work', 'foreign-sentinel-library', 'Foreign work',
               'article', 'unread', 0, ?, ?)`,
      [now, now],
    );

    await expect(
      executeDataCommand(
        {
          name: "sentinel.setStatus",
          input: {
            libraryId: "foreign-sentinel-library",
            status: "paused",
            taskId: foreignTask.id,
          },
        },
        dependencies,
      ),
    ).rejects.toThrow("Rejected stale or foreign Library scope");
    await expect(
      executeDataCommand(
        { name: "sentinel.delete", input: { libraryId, taskId: foreignTask.id } },
        dependencies,
      ),
    ).rejects.toThrow(`Sentinel task ${foreignTask.id} is missing or already removed`);
    await expect(
      executeDataCommand(
        {
          name: "sentinel.linkWork",
          input: {
            expectedUpdatedAt: localTask.task.updated_at,
            libraryId,
            taskId: localTask.id,
            workId: "foreign-sentinel-work",
          },
        },
        dependencies,
      ),
    ).rejects.toThrow("Work foreign-sentinel-work is missing or removed");
    await expect(
      executeDataCommand(
        {
          name: "sentinel.recordCheck",
          input: {
            libraryId,
            taskId: foreignTask.id,
            update: {
              errored: false,
              expectedUpdatedAt: foreignTask.task.updated_at,
              nextPollS: 60,
            },
          },
        },
        dependencies,
      ),
    ).resolves.toEqual({ committed: false, eventIds: [], updatedAt: null });

    await expect(foreignSentinel.get(foreignTask.id)).resolves.toMatchObject({
      deleted_at: null,
      status: "active",
    });
    await expect(localSentinel.get(localTask.id)).resolves.toMatchObject({ work_id: null });
    await expect(localSentinel.list()).resolves.toHaveLength(1);
  });
});
