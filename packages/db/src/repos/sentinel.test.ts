import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { runMigrations } from "../migrations";
import { SentinelRepo } from "./sentinel";

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
});
