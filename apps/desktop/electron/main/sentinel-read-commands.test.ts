import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import type {
  DataCommandInput,
  DataCommandName,
  DataCommandOutput,
} from "../data-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand } from "./data-commands";
import type { DataCommandDependencies } from "./data-command-runtime";

let database: Database;
let dependencies: DataCommandDependencies;
let libraryId: string;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "sentinel-read-command-device",
    deviceName: "Sentinel read commands",
    platform: "test",
  }));
  const coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
});

function command<K extends DataCommandName>(
  name: K,
  input: DataCommandInput<K>,
): Promise<DataCommandOutput<K>> {
  return executeDataCommand({ input, name }, dependencies) as Promise<DataCommandOutput<K>>;
}

interface TaskOptions {
  createdAt?: number;
  currentState?: string;
  deletedAt?: number | null;
  doi?: string | null;
  errorCount?: number;
  hintAuthor?: string | null;
  hintVenue?: string | null;
  lastError?: string | null;
  libraryId?: string;
  nextPollAt?: number;
  status?: string;
  targetFlags?: string | null;
  title?: string;
  updatedAt?: number;
}

async function insertTask(id: string, options: TaskOptions = {}): Promise<void> {
  const createdAt = options.createdAt ?? 1;
  await database.run(
    `INSERT INTO sentinel_tasks (
       id, library_id, work_id, doi, title, current_state, target_flags,
       poll_interval_s, next_poll_at, last_polled_at, error_count, last_error,
       status, hint_venue, hint_author, created_at, updated_at, deleted_at
     ) VALUES (?, ?, NULL, ?, ?, ?, ?, 86400, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      options.libraryId ?? libraryId,
      options.doi ?? null,
      options.title ?? id,
      options.currentState ?? "accepted",
      options.targetFlags ?? null,
      options.nextPollAt ?? 0,
      options.errorCount ?? 0,
      options.lastError ?? null,
      options.status ?? "active",
      options.hintVenue ?? null,
      options.hintAuthor ?? null,
      createdAt,
      options.updatedAt ?? createdAt,
      options.deletedAt ?? null,
    ],
  );
}

async function insertEvent(
  id: string,
  taskId: string,
  options: {
    detectedAt?: number;
    evidenceJson?: string | null;
    fromState?: string;
    notifiedAt?: number | null;
    toState?: string;
  } = {},
): Promise<void> {
  await database.run(
    `INSERT INTO sentinel_events (
       id, task_id, from_state, to_state, evidence_json, detected_at, notified_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      taskId,
      options.fromState ?? "accepted",
      options.toState ?? "online",
      options.evidenceJson ?? null,
      options.detectedAt ?? 1,
      options.notifiedAt ?? null,
    ],
  );
}

async function insertForeignLibrary(id = "library:sentinel-read-foreign"): Promise<string> {
  await database.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, 'Foreign Sentinel reads', 'personal', 1, 1)`,
    [id],
  );
  return id;
}

describe("Sentinel read data commands", () => {
  it("rejects malformed and scope-injected read input before obtaining a database lease", async () => {
    let executeCalls = 0;
    let transactionCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async execute() {
        executeCalls += 1;
        throw new Error("execute reached");
      },
      async transaction() {
        transactionCalls += 1;
        throw new Error("transaction reached");
      },
    };
    const invalidRequests = [
      { name: "sentinel.getPageSnapshot", input: { libraryId } },
      { name: "sentinel.getDuePollSnapshot", input: { now: 0 } },
      { name: "sentinel.getDuePollSnapshot", input: { taskId: "sentinel-task" } },
      { name: "sentinel.getEventEvidence", input: {} },
      { name: "sentinel.getEventEvidence", input: { eventId: " " } },
      {
        name: "sentinel.getEventEvidence",
        input: { eventId: "event:sentinel", libraryId },
      },
      { name: "sentinel.getTaskPollSnapshot", input: {} },
      { name: "sentinel.getTaskPollSnapshot", input: { taskId: " " } },
      {
        name: "sentinel.getTaskPollSnapshot",
        input: { libraryId, taskId: "sentinel-task" },
      },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("loads one bounded flat page snapshot, redacts persisted errors, and excludes foreign or deleted rows", async () => {
    const foreignLibraryId = await insertForeignLibrary();
    await insertTask("sentinel:page-old", {
      createdAt: 10,
      updatedAt: 101,
    });
    await insertTask("sentinel:page-new", {
      createdAt: 20,
      lastError: "Authorization: Bearer secret-token",
      status: "paused",
      updatedAt: 209,
    });
    await insertTask("sentinel:page-deleted", { createdAt: 30, deletedAt: 31 });
    await insertTask("sentinel:page-foreign", {
      createdAt: 40,
      libraryId: foreignLibraryId,
    });
    await insertEvent("event:page-old", "sentinel:page-old", { detectedAt: 10 });
    await insertEvent("event:page-new", "sentinel:page-new", {
      detectedAt: 20,
      evidenceJson: '{"source":"new"}',
    });
    await insertEvent("event:page-deleted", "sentinel:page-deleted", { detectedAt: 30 });
    await insertEvent("event:page-foreign", "sentinel:page-foreign", { detectedAt: 40 });

    const snapshot = await command("sentinel.getPageSnapshot", {});

    expect(snapshot.tasks).toEqual([
      expect.objectContaining({
        id: "sentinel:page-new",
        last_error: "Authorization: [redacted]",
        status: "paused",
        updated_at: 209,
      }),
      expect.objectContaining({ id: "sentinel:page-old", last_error: null, updated_at: 101 }),
    ]);
    expect(snapshot.events).toEqual([
      {
        detected_at: 20,
        evidenceStatus: "available",
        from_state: "accepted",
        id: "event:page-new",
        task_id: "sentinel:page-new",
        to_state: "online",
      },
      {
        detected_at: 10,
        evidenceStatus: "none",
        from_state: "accepted",
        id: "event:page-old",
        task_id: "sentinel:page-old",
        to_state: "online",
      },
    ]);
  });

  it("keeps raw evidence out of page snapshots and reads only scoped, bounded evidence on demand", async () => {
    const foreignLibraryId = await insertForeignLibrary();
    const evidenceJson = '{"source":"same-library"}';
    const oversizedEvidence = "x".repeat(8 * 1024 * 1024);
    await insertTask("sentinel:evidence-local");
    await insertTask("sentinel:evidence-empty");
    await insertTask("sentinel:evidence-oversized");
    await insertTask("sentinel:evidence-deleted", { deletedAt: 2 });
    await insertTask("sentinel:evidence-foreign", { libraryId: foreignLibraryId });
    await insertEvent("event:evidence-local", "sentinel:evidence-local", { evidenceJson });
    await insertEvent("event:evidence-empty", "sentinel:evidence-empty", { evidenceJson: "" });
    await insertEvent("event:evidence-oversized", "sentinel:evidence-oversized", {
      evidenceJson: oversizedEvidence,
    });
    await insertEvent("event:evidence-deleted", "sentinel:evidence-deleted", { evidenceJson });
    await insertEvent("event:evidence-foreign", "sentinel:evidence-foreign", { evidenceJson });

    const snapshot = await command("sentinel.getPageSnapshot", {});
    expect(snapshot.events).toEqual([
      {
        detected_at: 1,
        evidenceStatus: "none",
        from_state: "accepted",
        id: "event:evidence-empty",
        task_id: "sentinel:evidence-empty",
        to_state: "online",
      },
      {
        detected_at: 1,
        evidenceStatus: "available",
        from_state: "accepted",
        id: "event:evidence-local",
        task_id: "sentinel:evidence-local",
        to_state: "online",
      },
      {
        detected_at: 1,
        evidenceStatus: "too_large",
        from_state: "accepted",
        id: "event:evidence-oversized",
        task_id: "sentinel:evidence-oversized",
        to_state: "online",
      },
    ]);

    await expect(
      command("sentinel.getEventEvidence", { eventId: "event:evidence-local" }),
    ).resolves.toEqual({ evidenceJson, status: "available" });
    for (const eventId of [
      "event:evidence-empty",
      "event:evidence-oversized",
      "event:evidence-deleted",
      "event:evidence-foreign",
      "event:evidence-missing",
    ]) {
      await expect(command("sentinel.getEventEvidence", { eventId })).resolves.toEqual({
        evidenceJson: null,
        status: eventId === "event:evidence-oversized" ? "too_large" : "none",
      });
    }
  });

  it("derives due polling tasks from main-process time and returns canonical reached states", async () => {
    const foreignLibraryId = await insertForeignLibrary();
    const future = Date.now() + 60_000;
    await insertTask("sentinel:due", {
      currentState: "online",
      doi: "10.4242/due",
      errorCount: 2,
      hintAuthor: "Ada",
      hintVenue: "Boundary Journal",
      targetFlags: '["in_issue"]',
      title: "Due Sentinel",
      updatedAt: 909,
    });
    await insertTask("sentinel:future", { nextPollAt: future });
    await insertTask("sentinel:paused", { status: "paused" });
    await insertTask("sentinel:done", { status: "done" });
    await insertTask("sentinel:deleted", { deletedAt: 2 });
    await insertTask("sentinel:foreign", { libraryId: foreignLibraryId });
    await insertEvent("event:due-online", "sentinel:due", { toState: "online" });
    await insertEvent("event:due-registered", "sentinel:due", { toState: "registered" });
    await insertEvent("event:due-duplicate", "sentinel:due", { toState: "online" });
    await insertEvent("event:due-invalid", "sentinel:due", { toState: "not-a-sentinel-state" });
    await insertEvent("event:paused", "sentinel:paused", { toState: "in_issue" });

    await expect(command("sentinel.getDuePollSnapshot", {})).resolves.toEqual({
      libraryId,
      tasks: [
        {
          reachedStates: ["registered", "online"],
          task: {
            current_state: "online",
            doi: "10.4242/due",
            error_count: 2,
            hint_author: "Ada",
            hint_venue: "Boundary Journal",
            id: "sentinel:due",
            status: "active",
            target_flags: '["in_issue"]',
            title: "Due Sentinel",
            updated_at: 909,
            work_id: null,
          },
        },
      ],
    });
  });

  it("returns an active task's reached states but observes paused and done tasks without polling state", async () => {
    const foreignLibraryId = await insertForeignLibrary();
    await insertTask("sentinel:task-active", { updatedAt: 400 });
    await insertTask("sentinel:task-paused", { status: "paused", updatedAt: 401 });
    await insertTask("sentinel:task-done", { status: "done", updatedAt: 402 });
    await insertTask("sentinel:task-deleted", { deletedAt: 403 });
    await insertTask("sentinel:task-foreign", { libraryId: foreignLibraryId });
    await insertEvent("event:task-active", "sentinel:task-active", { toState: "online" });
    await insertEvent("event:task-paused", "sentinel:task-paused", { toState: "in_issue" });
    await insertEvent("event:task-done", "sentinel:task-done", { toState: "indexed_openalex" });

    await expect(
      command("sentinel.getTaskPollSnapshot", { taskId: "sentinel:task-active" }),
    ).resolves.toEqual({
      libraryId,
      reachedStates: ["online"],
      task: expect.objectContaining({
        id: "sentinel:task-active",
        status: "active",
        updated_at: 400,
      }),
    });
    for (const [taskId, status, updatedAt] of [
      ["sentinel:task-paused", "paused", 401],
      ["sentinel:task-done", "done", 402],
    ] as const) {
      await expect(command("sentinel.getTaskPollSnapshot", { taskId })).resolves.toEqual({
        libraryId,
        reachedStates: [],
        task: expect.objectContaining({ id: taskId, status, updated_at: updatedAt }),
      });
    }
    for (const taskId of ["sentinel:task-deleted", "sentinel:task-foreign", "sentinel:missing"]) {
      await expect(command("sentinel.getTaskPollSnapshot", { taskId })).resolves.toEqual({
        libraryId,
        reachedStates: [],
        task: null,
      });
    }
  });

  it("rejects Sentinel page and due responses that exceed their row limits", async () => {
    await database.run(
      `WITH RECURSIVE rows(n) AS (
         SELECT 1
         UNION ALL
         SELECT n + 1 FROM rows WHERE n < 1001
       )
       INSERT INTO sentinel_tasks (id, library_id, title, next_poll_at, created_at, updated_at)
       SELECT 'sentinel:limit:' || n, ?, 'Bounded Sentinel', 0, n, n
       FROM rows`,
      [libraryId],
    );

    await expect(command("sentinel.getPageSnapshot", {})).rejects.toThrow(
      "Sentinel page tasks are limited to 1000",
    );
    await expect(command("sentinel.getDuePollSnapshot", {})).rejects.toThrow(
      "Due Sentinel tasks are limited to 1000",
    );
  });

  it("rejects oversized Sentinel output before IPC serialization", async () => {
    await insertTask("sentinel:oversized", {
      title: "x".repeat(8 * 1024 * 1024),
    });

    await expect(command("sentinel.getPageSnapshot", {})).rejects.toThrow(
      "Sentinel output is limited to 8388608 bytes",
    );
  });

  it("fails closed when the active local Library has been deleted", async () => {
    await database.run(`UPDATE libraries SET deleted_at = 10_000 WHERE id = ?`, [libraryId]);

    await expect(command("sentinel.getPageSnapshot", {})).rejects.toThrow(
      "Local Library identity is not active",
    );
  });
});
