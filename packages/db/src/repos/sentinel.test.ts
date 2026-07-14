import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { runMigrations } from "../migrations";
import { SentinelRepo, SentinelTaskInactiveError } from "./sentinel";

let db: Database;
let sentinel: SentinelRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  sentinel = new SentinelRepo(db);
});

describe("SentinelRepo", () => {
  it("returns an existing DOI monitor instead of creating a duplicate", async () => {
    const first = await sentinel.createOrRestore({
      doi: "https://doi.org/10.1000/XYZ",
      title: "First Sentinel Paper",
    });
    const second = await sentinel.createOrRestore({
      doi: "doi: 10.1000/xyz",
      title: "Duplicate Sentinel Paper",
    });

    expect(first.status).toBe("created");
    expect(second.status).toBe("existing");
    expect(second.id).toBe(first.id);
    expect(await sentinel.list()).toHaveLength(1);
  });

  it("restores a soft-deleted DOI monitor when the same DOI is added again", async () => {
    const first = await sentinel.createOrRestore({
      doi: "10.4242/aurascholar.sentinel.restore",
      title: "Restorable Sentinel Paper",
    });
    await sentinel.softDelete(first.id);

    const restored = await sentinel.createOrRestore({
      doi: "https://doi.org/10.4242/aurascholar.sentinel.restore",
      title: "Restored Sentinel Paper",
    });
    const rows = await db.query<{ deleted_at: number | null; status: string; title: string }>(
      "SELECT deleted_at, status, title FROM sentinel_tasks WHERE id = ?",
      [first.id],
    );

    expect(restored.status).toBe("restored");
    expect(restored.id).toBe(first.id);
    expect(rows[0]).toMatchObject({
      deleted_at: null,
      status: "active",
      title: "Restored Sentinel Paper",
    });
    expect(await sentinel.list()).toHaveLength(1);
  });

  it("deduplicates title monitors with normalized spacing and casing", async () => {
    const first = await sentinel.createOrRestore({
      title: "  Neural   Retrieval for Scholars  ",
      hintVenue: "Smoke Journal",
    });
    const second = await sentinel.createOrRestore({
      title: "neural retrieval for scholars",
      hintAuthor: "Lovelace",
    });

    expect(second.status).toBe("existing");
    expect(second.id).toBe(first.id);
    expect(await sentinel.list()).toHaveLength(1);
  });

  it("links an existing DOI monitor to a work when the monitor has no work yet", async () => {
    const now = Date.now();
    await db.run(
      "INSERT INTO works (id, doi, title, type, created_at, updated_at) VALUES (?, ?, ?, 'article', ?, ?)",
      [
        "work-sentinel-link",
        "10.4242/aurascholar.sentinel-link",
        "Sentinel Link Paper",
        now,
        now,
      ],
    );
    const first = await sentinel.createOrRestore({
      doi: "10.4242/aurascholar.sentinel-link",
      title: "Sentinel Link Paper",
    });

    const linked = await sentinel.createOrRestore({
      doi: "https://doi.org/10.4242/aurascholar.sentinel-link",
      title: "Sentinel Link Paper",
      workId: "work-sentinel-link",
    });
    const rows = await db.query<{ work_id: string | null }>(
      "SELECT work_id FROM sentinel_tasks WHERE id = ?",
      [first.id],
    );

    expect(linked.status).toBe("existing");
    expect(linked.id).toBe(first.id);
    expect(rows[0]?.work_id).toBe("work-sentinel-link");
    expect(await sentinel.list()).toHaveLength(1);
  });

  it("rejects missing or removed works when creating, restoring, or linking monitors", async () => {
    const now = Date.now();
    await db.run(
      "INSERT INTO works (id, doi, title, type, created_at, updated_at) VALUES (?, ?, ?, 'article', ?, ?)",
      [
        "active-sentinel-work",
        "10.4242/aurascholar.sentinel-active-work",
        "Active Sentinel Work",
        now,
        now,
      ],
    );
    await db.run(
      "INSERT INTO works (id, doi, title, type, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 'article', ?, ?, ?)",
      [
        "removed-sentinel-work",
        "10.4242/aurascholar.sentinel-removed-work",
        "Removed Sentinel Work",
        now,
        now,
        now,
      ],
    );
    const created = await sentinel.createOrRestore({
      doi: "10.4242/aurascholar.sentinel-link-guard",
      title: "Sentinel Link Guard",
    });
    const deletedMonitor = await sentinel.createOrRestore({
      doi: "10.4242/aurascholar.sentinel-restore-link-guard",
      title: "Sentinel Restore Link Guard",
    });
    await sentinel.softDelete(deletedMonitor.id);

    await expect(
      sentinel.create({
        title: "Missing Work Sentinel",
        workId: "missing-sentinel-work",
      }),
    ).rejects.toThrow("Work missing-sentinel-work is missing or removed");
    await expect(
      sentinel.createOrRestore({
        doi: "10.4242/aurascholar.sentinel-removed-create",
        title: "Removed Work Sentinel",
        workId: "removed-sentinel-work",
      }),
    ).rejects.toThrow("Work removed-sentinel-work is missing or removed");
    await expect(
      sentinel.createOrRestore({
        doi: "10.4242/aurascholar.sentinel-link-guard",
        title: "Sentinel Link Guard",
        workId: "removed-sentinel-work",
      }),
    ).rejects.toThrow("Work removed-sentinel-work is missing or removed");
    await expect(
      sentinel.createOrRestore({
        doi: "10.4242/aurascholar.sentinel-restore-link-guard",
        title: "Sentinel Restore Link Guard",
        workId: "removed-sentinel-work",
      }),
    ).rejects.toThrow("Work removed-sentinel-work is missing or removed");
    await expect(sentinel.linkWork(created.id, "removed-sentinel-work")).rejects.toThrow(
      "Work removed-sentinel-work is missing or removed",
    );
    await expect(sentinel.linkWork(created.id, "missing-sentinel-work")).rejects.toThrow(
      "Work missing-sentinel-work is missing or removed",
    );

    const existing = await sentinel.get(created.id);
    const stillDeleted = await sentinel.get(deletedMonitor.id);
    expect(existing?.work_id).toBeNull();
    expect(stillDeleted?.deleted_at).not.toBeNull();

    await sentinel.linkWork(created.id, "active-sentinel-work");
    expect((await sentinel.get(created.id))?.work_id).toBe("active-sentinel-work");
  });

  it("restores a deleted monitor without resetting status or evidence", async () => {
    const created = await sentinel.createOrRestore({
      doi: "10.4242/aurascholar.sentinel.undo",
      title: "Undoable Sentinel Paper",
    });
    await sentinel.recordCheck(created.id, {
      nextPollS: 120,
      errored: true,
      error: "Crossref returned 429",
    });
    await sentinel.setStatus(created.id, "paused");
    const eventId = await sentinel.addEvent(created.id, "accepted", "indexed", { source: "smoke" });

    await sentinel.softDelete(created.id);
    expect(await sentinel.list()).toHaveLength(0);

    await sentinel.restore(created.id);
    const [restored] = await sentinel.list();
    const events = await sentinel.events(created.id);
    expect(restored?.id).toBe(created.id);
    expect(restored?.status).toBe("paused");
    expect(restored?.error_count).toBe(1);
    expect(restored?.last_error).toBe("Crossref returned 429");
    expect(events.map((event) => event.id)).toEqual([eventId]);
  });

  it("stores the last polling error and clears it after a successful check", async () => {
    const created = await sentinel.createOrRestore({
      doi: "10.4242/aurascholar.sentinel-error",
      title: "Sentinel Error Paper",
    });

    await sentinel.recordCheck(created.id, {
      nextPollS: 60,
      errored: true,
      error: "Crossref returned 429\nretry later",
    });
    const failed = await sentinel.get(created.id);

    expect(failed?.error_count).toBe(1);
    expect(failed?.last_error).toBe("Crossref returned 429 retry later");

    await sentinel.recordCheck(created.id, {
      nextPollS: 60,
      errored: false,
    });
    const recovered = await sentinel.get(created.id);

    expect(recovered?.error_count).toBe(0);
    expect(recovered?.last_error).toBeNull();
  });

  it("redacts secrets before persisting the last check error", async () => {
    const created = await sentinel.createOrRestore({
      doi: "10.4242/aurascholar.sentinel-secret-error",
      title: "Sentinel Secret Error Paper",
    });

    await sentinel.recordCheck(created.id, {
      nextPollS: 60,
      errored: true,
      error:
        "Crossref failed password=hunter2 authorization: Bearer sentinel-secret-123456 https://user:pass@example.test/api",
    });
    const failed = await sentinel.get(created.id);

    expect(failed?.last_error).toContain("password=[redacted]");
    expect(failed?.last_error).toContain("authorization: [redacted]");
    expect(failed?.last_error).toContain("https://example.test/api");
    expect(failed?.last_error).not.toContain("hunter2");
    expect(failed?.last_error).not.toContain("sentinel-secret-123456");
    expect(failed?.last_error).not.toContain("user:pass");
  });

  it("records check milestones and task state in one atomic write", async () => {
    const created = await sentinel.createOrRestore({
      title: "Atomic Sentinel Paper",
    });

    await sentinel.recordCheckWithEvents(created.id, {
      doi: "10.4242/aurascholar.sentinel-atomic",
      events: [
        {
          fromState: "accepted",
          toState: "registered",
          evidence: { source: "crossref" },
        },
      ],
      newState: "registered",
      nextPollS: 120,
      errored: false,
    });

    const task = await sentinel.get(created.id);
    const events = await sentinel.events(created.id);
    expect(task).toMatchObject({
      doi: "10.4242/aurascholar.sentinel-atomic",
      current_state: "registered",
      error_count: 0,
      last_error: null,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      from_state: "accepted",
      to_state: "registered",
    });
  });

  it("rolls back milestone events and DOI when the task update fails", async () => {
    const created = await sentinel.createOrRestore({
      title: "Rollback Sentinel Paper",
    });
    await db.exec(`
      CREATE TEMP TRIGGER fail_sentinel_task_update
      BEFORE UPDATE OF current_state ON sentinel_tasks
      WHEN OLD.id = '${created.id}' AND NEW.current_state = 'registered'
      BEGIN
        SELECT RAISE(FAIL, 'forced sentinel state failure');
      END;
    `);

    try {
      await expect(
        sentinel.recordCheckWithEvents(created.id, {
          doi: "10.4242/aurascholar.sentinel-rollback",
          events: [
            {
              fromState: "accepted",
              toState: "registered",
              evidence: { source: "crossref" },
            },
          ],
          newState: "registered",
          nextPollS: 120,
          errored: false,
        }),
      ).rejects.toThrow("forced sentinel state failure");
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_sentinel_task_update");
    }

    const task = await sentinel.get(created.id);
    const events = await sentinel.events(created.id);
    expect(task).toMatchObject({
      doi: null,
      current_state: "accepted",
    });
    expect(events).toHaveLength(0);
  });

  it("rejects in-flight check writes after a task is paused and rolls back events", async () => {
    const created = await sentinel.createOrRestore({
      title: "Paused Sentinel Paper",
    });
    await sentinel.setStatus(created.id, "paused");

    await expect(
      sentinel.recordCheckWithEvents(created.id, {
        doi: "10.4242/aurascholar.sentinel-paused",
        events: [
          {
            fromState: "accepted",
            toState: "registered",
            evidence: { source: "crossref" },
          },
        ],
        newState: "registered",
        nextPollS: 120,
        errored: false,
      }),
    ).rejects.toThrow(SentinelTaskInactiveError);

    const task = await sentinel.get(created.id);
    const events = await sentinel.events(created.id);
    expect(task).toMatchObject({
      doi: null,
      current_state: "accepted",
      status: "paused",
    });
    expect(events).toHaveLength(0);
  });

  it("guards removed tasks and hides their unnotified events", async () => {
    const created = await sentinel.createOrRestore({
      title: "Removed Sentinel Paper",
    });
    const eventId = await sentinel.addEvent(created.id, "accepted", "registered", {
      source: "crossref",
    });
    expect((await sentinel.unnotifiedEvents()).map((event) => event.id)).toEqual([eventId]);

    await sentinel.softDelete(created.id);

    await expect(sentinel.setStatus(created.id, "paused")).rejects.toThrow(
      `Sentinel task ${created.id} is missing or removed`,
    );
    await expect(sentinel.softDelete(created.id)).rejects.toThrow(
      `Sentinel task ${created.id} is missing or already removed`,
    );
    await expect(
      sentinel.recordCheckWithEvents(created.id, {
        events: [
          {
            fromState: "registered",
            toState: "published_online",
            evidence: { source: "publisher" },
          },
        ],
        newState: "published_online",
        nextPollS: 120,
        errored: false,
      }),
    ).rejects.toThrow(SentinelTaskInactiveError);
    expect(await sentinel.unnotifiedEvents()).toHaveLength(0);
    expect(await sentinel.events(created.id)).toHaveLength(1);

    await sentinel.restore(created.id);
    await expect(sentinel.restore(created.id)).rejects.toThrow(
      `Sentinel task ${created.id} is missing or already active`,
    );
    await sentinel.markNotified(eventId);
    await expect(sentinel.markNotified(eventId)).rejects.toThrow(
      `Sentinel event ${eventId} is missing or already notified`,
    );
  });
});
