import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { SentinelRepo } from "@aurascholar/db/repos/sentinel";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { DatabaseCoordinator } from "./database-coordinator";
import {
  MainSentinelRunRegistry,
  MainSentinelRunner,
  type MainSentinelRunnerDependencies,
} from "./sentinel-runner";

let database: Database;
let coordinator: DatabaseCoordinator;
let libraryId: string;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "sentinel-main-runner-device",
    deviceName: "Sentinel main runner",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
});

interface TaskOptions {
  currentState?: string;
  doi?: string | null;
  errorCount?: number;
  hintAuthor?: string | null;
  hintVenue?: string | null;
  status?: string;
  targetFlags?: string | null;
  title?: string;
  updatedAt?: number;
  workId?: string | null;
}

async function insertTask(id: string, options: TaskOptions = {}): Promise<void> {
  await database.run(
    `INSERT INTO sentinel_tasks (
       id, library_id, work_id, doi, title, current_state, target_flags,
       poll_interval_s, next_poll_at, last_polled_at, error_count, last_error,
       status, hint_venue, hint_author, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 86400, 0, NULL, ?, NULL, ?, ?, ?, 1, ?, NULL)`,
    [
      id,
      libraryId,
      options.workId ?? null,
      options.doi === undefined ? "10.4242/sentinel-main-runner" : options.doi,
      options.title ?? id,
      options.currentState ?? "accepted",
      options.targetFlags ?? null,
      options.errorCount ?? 0,
      options.status ?? "active",
      options.hintVenue ?? null,
      options.hintAuthor ?? null,
      options.updatedAt ?? 1,
    ],
  );
}

function runner(overrides: MainSentinelRunnerDependencies = {}): {
  notifier: { notify: ReturnType<typeof vi.fn> };
  runner: MainSentinelRunner;
} {
  const notifier = { notify: vi.fn(async () => undefined) };
  const dependencies: MainSentinelRunnerDependencies = {
    createConnectorContext: (_signal) => ({
      http: {
        request: async () => ({ body: new Uint8Array(), headers: {}, status: 200 }),
      },
      mailto: "test@aurascholar.app",
    }),
    notifier,
    withDatabase: (operation) => coordinator.execute(operation),
    withDatabaseTransaction: (commandName, operation) =>
      coordinator.transaction(commandName, operation),
    ...overrides,
  };
  return { notifier, runner: new MainSentinelRunner(dependencies) };
}

function checkResult(
  highestState: "online" | "in_issue" | "indexed_openalex" = "online",
): Awaited<ReturnType<NonNullable<MainSentinelRunnerDependencies["checkDoi"]>>> {
  return {
    checkedAt: 1,
    highestState,
    newMilestones: [
      {
        evidence: { source: "test" },
        source: "crossref",
        state: highestState,
      },
    ],
  };
}

describe("Main Sentinel runner", () => {
  it("keeps network outside the transaction, records a CAS-guarded event, then notifies", async () => {
    await insertTask("sentinel:online", { title: "Network-before-transaction" });
    let transactionDepth = 0;
    const { notifier, runner: subject } = runner({
      checkDoi: vi.fn(async () => {
        expect(transactionDepth).toBe(0);
        return checkResult("online");
      }),
      withDatabaseTransaction: async (commandName, operation) => {
        transactionDepth += 1;
        try {
          return await coordinator.transaction(commandName, operation);
        } finally {
          transactionDepth -= 1;
        }
      },
    });

    await expect(subject.runDuePolls("sentinel-run:online")).resolves.toEqual({
      changes: 1,
      checked: 1,
      failed: 0,
      failures: [],
    });

    const repo = new SentinelRepo(database, libraryId);
    await expect(repo.get("sentinel:online")).resolves.toMatchObject({
      current_state: "online",
      error_count: 0,
      last_error: null,
      status: "active",
    });
    await expect(repo.events("sentinel:online")).resolves.toEqual([
      expect.objectContaining({ from_state: "accepted", to_state: "online" }),
    ]);
    expect(notifier.notify).toHaveBeenCalledWith({
      body: "Network-before-transaction",
      tag: "sentinel:sentinel:online",
      title: "📡 在线发表",
    });
  });

  it("keeps CAS semantics: a stale snapshot produces no event, link, or notification", async () => {
    await insertTask("sentinel:stale", { updatedAt: 7 });
    const { notifier, runner: subject } = runner({
      checkDoi: vi.fn(async () => {
        await database.run(
          `UPDATE sentinel_tasks SET updated_at = updated_at + 1 WHERE id = ? AND library_id = ?`,
          ["sentinel:stale", libraryId],
        );
        return checkResult("online");
      }),
    });

    await expect(subject.runDuePolls("sentinel-run:stale")).resolves.toEqual({
      changes: 0,
      checked: 1,
      failed: 0,
      failures: [],
    });
    const repo = new SentinelRepo(database, libraryId);
    await expect(repo.events("sentinel:stale")).resolves.toEqual([]);
    await expect(repo.get("sentinel:stale")).resolves.toMatchObject({
      current_state: "accepted",
      work_id: null,
    });
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it("retains title discovery, state evidence, automatic metadata ingest, CAS link, and notifications", async () => {
    await insertTask("sentinel:title", {
      doi: null,
      hintAuthor: "Ada",
      hintVenue: "Boundary Journal",
      title: "Title-only Sentinel",
    });
    let transactionDepth = 0;
    const findDoiByTitle = vi.fn(async (_context, title, hints) => {
      expect(transactionDepth).toBe(0);
      expect(title).toBe("Title-only Sentinel");
      expect(hints).toEqual({ author: "Ada", venue: "Boundary Journal" });
      return {
        confidence: 0.99,
        doi: "10.4242/title-discovered",
        evidence: { title },
        matchedTitle: title,
        source: "crossref" as const,
      };
    });
    const resolveAutoIngest = vi.fn(async (_doi, signal) => {
      expect(transactionDepth).toBe(0);
      expect(signal.aborted).toBe(false);
      return {
        confidence: 1,
        work: {
          authors: [{ displayName: "Ada Lovelace", position: 0 }],
          doi: "10.4242/title-discovered",
          source: "crossref" as const,
          title: "Auto imported Sentinel work",
          type: "article",
          year: 2026,
        },
      };
    });
    const { notifier, runner: subject } = runner({
      checkDoi: vi.fn(async () => {
        expect(transactionDepth).toBe(0);
        return checkResult("in_issue");
      }),
      findDoiByTitle,
      resolveAutoIngest,
      withDatabaseTransaction: async (commandName, operation) => {
        transactionDepth += 1;
        try {
          return await coordinator.transaction(commandName, operation);
        } finally {
          transactionDepth -= 1;
        }
      },
    });

    await expect(subject.runDuePolls("sentinel-run:title")).resolves.toEqual({
      changes: 2,
      checked: 1,
      failed: 0,
      failures: [],
    });

    const task = await new SentinelRepo(database, libraryId).get("sentinel:title");
    expect(task).toMatchObject({
      current_state: "in_issue",
      doi: "10.4242/title-discovered",
      work_id: expect.any(String),
    });
    const work = await new WorksRepo(database, libraryId).get(task!.work_id!);
    expect(work).toMatchObject({
      doi: "10.4242/title-discovered",
      title: "Auto imported Sentinel work",
    });
    await expect(new SentinelRepo(database, libraryId).events("sentinel:title")).resolves.toEqual([
      expect.objectContaining({ to_state: "registered" }),
      expect.objectContaining({ to_state: "in_issue" }),
    ]);
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "📡 已找到论文 DOI" }),
    );
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "📡 正式出版(卷期页)" }),
    );
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "📚 已自动导入文献库" }),
    );
  });

  it("cancels a main-owned in-flight connector request and leaves no check mutation", async () => {
    await insertTask("sentinel:cancel");
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const { notifier, runner: subject } = runner({
      checkDoi: async (context) => {
        await context.http.request({ url: "https://api.crossref.org/works/10.4242/cancel" });
        return checkResult("online");
      },
      createConnectorContext: (signal) => ({
        http: {
          request: async () => {
            requestStarted();
            return new Promise((resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => {
                  const error = new Error("aborted");
                  error.name = "AbortError";
                  reject(error);
                },
                { once: true },
              );
            });
          },
        },
        mailto: "test@aurascholar.app",
      }),
    });

    const run = subject.runDuePolls("sentinel-run:cancel");
    await started;
    expect(subject.cancel("sentinel-run:cancel")).toBe(true);
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(subject.cancel("sentinel-run:cancel")).toBe(false);
    await expect(new SentinelRepo(database, libraryId).events("sentinel:cancel")).resolves.toEqual(
      [],
    );
    await expect(
      new SentinelRepo(database, libraryId).get("sentinel:cancel"),
    ).resolves.toMatchObject({
      last_polled_at: null,
    });
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it("caps failure detail output while retaining the total failure count", async () => {
    for (let index = 0; index < 33; index += 1) {
      await insertTask(`sentinel:failure:${index}`, { title: `Failure ${index}` });
    }
    const { runner: subject } = runner({
      checkDoi: vi.fn(async () => {
        throw new Error("Authorization: Bearer sentinel-secret");
      }),
    });

    const summary = await subject.runDuePolls("sentinel-run:bounded-failures");

    expect(summary).toMatchObject({ changes: 0, checked: 33, failed: 33 });
    expect(summary.failures).toHaveLength(32);
    expect(summary.failures[0]).toMatchObject({ error: "Authorization: [redacted]" });
    expect(JSON.stringify(summary).length).toBeLessThan(64 * 1024);
  });

  it("rejects missing and inactive task-now requests before network work", async () => {
    await insertTask("sentinel:paused", { status: "paused" });
    const checkDoi = vi.fn();
    const { runner: subject } = runner({ checkDoi });

    await expect(subject.runTaskNow("missing", "sentinel-run:missing")).rejects.toThrow(
      "监控任务不存在或已删除",
    );
    await expect(subject.runTaskNow("sentinel:paused", "sentinel-run:paused")).rejects.toThrow(
      "只能检查监控中的任务",
    );
    expect(checkDoi).not.toHaveBeenCalled();
  });
});

describe("Main Sentinel run registry", () => {
  it("rejects duplicate ids and bounds live runs", () => {
    const registry = new MainSentinelRunRegistry();
    registry.begin("run-0");
    expect(() => registry.begin("run-0")).toThrow("already active");
    registry.begin("run-1");
    registry.begin("run-2");
    registry.begin("run-3");
    expect(() => registry.begin("run-4")).toThrow("At most 4");
    expect(registry.cancel("run-2")).toBe(true);
    registry.end("run-0");
    expect(() => registry.begin("run-4")).not.toThrow();
  });
});
