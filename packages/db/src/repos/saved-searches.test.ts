import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { runMigrations } from "../migrations";
import { requireLocalLibraryId } from "../local-first";
import { SavedSearchInactiveError, SavedSearchesRepo } from "./saved-searches";

let db: Database;
let libraryId: string;
let savedSearches: SavedSearchesRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryId = await requireLocalLibraryId(db);
  savedSearches = new SavedSearchesRepo(db, libraryId);
});

describe("SavedSearchesRepo", () => {
  it("stores the last polling error and clears it after a successful run", async () => {
    const id = await savedSearches.create({
      query: "graph neural retrieval",
      sources: ["openalex", "crossref"],
    });

    await savedSearches.recordError(id, "OpenAlex returned 503\nretry later", Date.now() + 1000);
    const failed = (await savedSearches.list()).find((row) => row.id === id);

    expect(failed?.last_error).toBe("OpenAlex returned 503 retry later");
    expect(failed?.seen_ids_json).toBe("[]");

    await savedSearches.recordRun(id, ["doi:10.1000/example"], 1, Date.now() + 2000);
    const recovered = (await savedSearches.list()).find((row) => row.id === id);

    expect(recovered?.last_error).toBeNull();
    expect(JSON.parse(recovered?.seen_ids_json ?? "[]")).toEqual(["doi:10.1000/example"]);
    expect(recovered?.new_count).toBe(1);
  });

  it("redacts secrets before persisting the last polling error", async () => {
    const id = await savedSearches.create({
      query: "private relay discovery",
      sources: ["openalex"],
    });

    await savedSearches.recordError(
      id,
      "OpenAlex failed api_key=sk-proj-abcdefghijklmnop authorization: Bearer relay-secret-123456 https://user:pass@example.test/search",
      Date.now() + 1000,
    );

    const failed = (await savedSearches.list()).find((row) => row.id === id);

    expect(failed?.last_error).toContain("api_key=[redacted]");
    expect(failed?.last_error).toContain("authorization: [redacted]");
    expect(failed?.last_error).toContain("https://example.test/search");
    expect(failed?.last_error).not.toContain("sk-proj-abcdefghijklmnop");
    expect(failed?.last_error).not.toContain("relay-secret-123456");
    expect(failed?.last_error).not.toContain("user:pass");
  });

  it("keeps the first successful conditional run as the baseline after an initial failure", async () => {
    const id = await savedSearches.create({
      query: "failure before first baseline",
      sources: ["openalex"],
    });
    const initial = (await savedSearches.get(id))!;

    const failedCommit = await savedSearches.recordErrorIfCurrent(id, {
      expectedUpdatedAt: initial.updated_at,
      error: "OpenAlex temporarily unavailable",
      nextRunAt: Date.now() + 1000,
    });
    expect(failedCommit.committed).toBe(true);

    const failed = (await savedSearches.get(id))!;
    expect(failed).toMatchObject({
      last_run_at: null,
      last_error: "OpenAlex temporarily unavailable",
      seen_ids_json: "[]",
      new_count: 0,
      updated_at: failedCommit.updatedAt,
    });

    const recoveredCommit = await savedSearches.commitRunIfCurrent(id, {
      expectedUpdatedAt: failed.updated_at,
      observedIds: ["doi:10.1000/first", "doi:10.1000/second", "doi:10.1000/first"],
      nextRunAt: Date.now() + 2000,
    });
    expect(recoveredCommit).toMatchObject({
      committed: true,
      freshCount: 0,
    });

    const recovered = (await savedSearches.get(id))!;
    expect(recovered.last_run_at).not.toBeNull();
    expect(recovered.last_error).toBeNull();
    expect(recovered.new_count).toBe(0);
    expect(JSON.parse(recovered.seen_ids_json)).toEqual([
      "doi:10.1000/first",
      "doi:10.1000/second",
    ]);
    expect(recovered.updated_at).toBe(recoveredCommit.updatedAt);
  });

  it("restores a deleted saved search without resetting polling state", async () => {
    const id = await savedSearches.create({
      query: "human centered retrieval",
      sources: ["openalex"],
    });
    await savedSearches.recordRun(id, ["doi:10.1000/example"], 2, Date.now() + 2000);
    await savedSearches.recordError(id, "OpenAlex returned 429", Date.now() + 4000);

    await savedSearches.softDelete(id);
    expect(await savedSearches.list()).toHaveLength(0);

    await savedSearches.restore(id);
    const [restored] = await savedSearches.list();
    expect(restored?.id).toBe(id);
    expect(restored?.new_count).toBe(2);
    expect(restored?.last_error).toBe("OpenAlex returned 429");
    expect(JSON.parse(restored?.seen_ids_json ?? "[]")).toEqual(["doi:10.1000/example"]);
  });

  it("rejects stale polling and badge writes after a saved search is removed", async () => {
    const id = await savedSearches.create({
      query: "trustworthy discovery",
      sources: ["crossref"],
    });
    await savedSearches.recordRun(id, ["doi:10.1000/original"], 2, Date.now() + 2000);
    await savedSearches.softDelete(id);

    await expect(
      savedSearches.recordRun(
        id,
        ["doi:10.1000/original", "doi:10.1000/stale"],
        3,
        Date.now() + 3000,
      ),
    ).rejects.toThrow(SavedSearchInactiveError);
    await expect(
      savedSearches.recordError(id, "OpenAlex returned 500", Date.now() + 3000),
    ).rejects.toThrow(SavedSearchInactiveError);
    await expect(savedSearches.clearNew(id)).rejects.toThrow(SavedSearchInactiveError);
    await expect(savedSearches.softDelete(id)).rejects.toThrow(
      `Saved search ${id} is missing or already removed`,
    );
    await expect(
      savedSearches.recordRun("missing-search", ["doi:10.1000/missing"], 1, Date.now() + 3000),
    ).rejects.toThrow(SavedSearchInactiveError);
    await expect(savedSearches.restore("missing-search")).rejects.toThrow(
      "Saved search missing-search is missing or already active",
    );

    const deletedRows = await db.query<{
      seen_ids_json: string;
      new_count: number;
      last_error: string | null;
    }>(`SELECT seen_ids_json, new_count, last_error FROM saved_searches WHERE id = ?`, [id]);
    expect(JSON.parse(deletedRows[0]!.seen_ids_json)).toEqual(["doi:10.1000/original"]);
    expect(deletedRows[0]!.new_count).toBe(2);
    expect(deletedRows[0]!.last_error).toBeNull();

    await savedSearches.restore(id);
    await expect(savedSearches.restore(id)).rejects.toThrow(
      `Saved search ${id} is missing or already active`,
    );
    await savedSearches.clearNew(id);
    const [restored] = await savedSearches.list();
    expect(restored?.new_count).toBe(0);
  });

  it("accepts only one observed-result commit for the same revision", async () => {
    const id = await savedSearches.create({
      query: "concurrent saved search",
      sources: ["openalex"],
    });
    await savedSearches.recordRun(id, ["doi:10.1000/baseline"], 0, Date.now() + 1000);
    const snapshot = await savedSearches.get(id);
    expect(snapshot).not.toBeNull();

    const input = {
      expectedUpdatedAt: snapshot!.updated_at,
      observedIds: ["doi:10.1000/baseline", "doi:10.1000/new"],
      nextRunAt: Date.now() + 2000,
    };
    const commits = await Promise.all([
      savedSearches.commitRunIfCurrent(id, input),
      savedSearches.commitRunIfCurrent(id, input),
    ]);

    expect(commits.filter((commit) => commit.committed)).toHaveLength(1);
    expect(commits.filter((commit) => !commit.committed)).toHaveLength(1);
    expect(commits.find((commit) => commit.committed)).toMatchObject({
      freshCount: 1,
    });
    const current = await savedSearches.get(id);
    expect(current?.new_count).toBe(1);
    expect(JSON.parse(current?.seen_ids_json ?? "[]")).toEqual([
      "doi:10.1000/baseline",
      "doi:10.1000/new",
    ]);
    expect(current!.updated_at).toBeGreaterThan(snapshot!.updated_at);
  });

  it("prevents a stale error from overwriting a successful run", async () => {
    const id = await savedSearches.create({
      query: "success wins over stale error",
      sources: ["crossref"],
    });
    await savedSearches.recordRun(id, ["doi:10.1000/baseline"], 0, Date.now() + 1000);
    const snapshot = (await savedSearches.get(id))!;

    const [success, staleError] = await Promise.all([
      savedSearches.commitRunIfCurrent(id, {
        expectedUpdatedAt: snapshot.updated_at,
        observedIds: ["doi:10.1000/baseline", "doi:10.1000/success"],
        nextRunAt: Date.now() + 2000,
      }),
      savedSearches.recordErrorIfCurrent(id, {
        expectedUpdatedAt: snapshot.updated_at,
        error: "stale connector failure",
        nextRunAt: Date.now() + 3000,
      }),
    ]);

    expect(success).toMatchObject({ committed: true, freshCount: 1 });
    expect(staleError).toEqual({ committed: false, updatedAt: null });
    expect(await savedSearches.get(id)).toMatchObject({
      last_error: null,
      new_count: 1,
      updated_at: success.updatedAt,
    });
  });

  it("prevents a stale success from clearing a committed error", async () => {
    const id = await savedSearches.create({
      query: "error wins over stale success",
      sources: ["s2"],
    });
    await savedSearches.recordRun(id, ["doi:10.1000/baseline"], 0, Date.now() + 1000);
    const snapshot = (await savedSearches.get(id))!;

    const [errorCommit, staleSuccess] = await Promise.all([
      savedSearches.recordErrorIfCurrent(id, {
        expectedUpdatedAt: snapshot.updated_at,
        error: "Semantic Scholar returned 503",
        nextRunAt: Date.now() + 2000,
      }),
      savedSearches.commitRunIfCurrent(id, {
        expectedUpdatedAt: snapshot.updated_at,
        observedIds: ["doi:10.1000/baseline", "doi:10.1000/stale-success"],
        nextRunAt: Date.now() + 3000,
      }),
    ]);

    expect(errorCommit.committed).toBe(true);
    expect(staleSuccess).toEqual({
      committed: false,
      freshCount: 0,
      updatedAt: null,
    });
    expect(await savedSearches.get(id)).toMatchObject({
      last_error: "Semantic Scholar returned 503",
      new_count: 0,
      updated_at: errorCommit.updatedAt,
    });
  });

  it("invalidates an in-flight run across a delete and restore cycle", async () => {
    const id = await savedSearches.create({
      query: "delete restore revision guard",
      sources: ["arxiv"],
    });
    await savedSearches.recordRun(id, ["arxiv:baseline"], 2, Date.now() + 1000);
    const snapshot = (await savedSearches.get(id))!;

    await savedSearches.softDelete(id);
    const deleted = (await savedSearches.get(id))!;
    await savedSearches.restore(id);
    const restored = (await savedSearches.get(id))!;

    expect(deleted.updated_at).toBeGreaterThan(snapshot.updated_at);
    expect(restored.updated_at).toBeGreaterThan(deleted.updated_at);
    expect(
      await savedSearches.commitRunIfCurrent(id, {
        expectedUpdatedAt: snapshot.updated_at,
        observedIds: ["arxiv:baseline", "arxiv:stale"],
        nextRunAt: Date.now() + 2000,
      }),
    ).toEqual({ committed: false, freshCount: 0, updatedAt: null });
    expect(await savedSearches.get(id)).toMatchObject({
      new_count: 2,
      seen_ids_json: '["arxiv:baseline"]',
      updated_at: restored.updated_at,
    });
  });

  it("invalidates an in-flight run when the unread badge is cleared", async () => {
    const id = await savedSearches.create({
      query: "badge revision guard",
      sources: ["openalex"],
    });
    await savedSearches.recordRun(id, ["openalex:baseline"], 3, Date.now() + 1000);
    const snapshot = (await savedSearches.get(id))!;

    await savedSearches.clearNew(id);
    const cleared = (await savedSearches.get(id))!;
    expect(cleared.updated_at).toBeGreaterThan(snapshot.updated_at);

    expect(
      await savedSearches.commitRunIfCurrent(id, {
        expectedUpdatedAt: snapshot.updated_at,
        observedIds: ["openalex:baseline", "openalex:stale"],
        nextRunAt: Date.now() + 2000,
      }),
    ).toEqual({ committed: false, freshCount: 0, updatedAt: null });
    expect(await savedSearches.get(id)).toMatchObject({
      new_count: 0,
      seen_ids_json: '["openalex:baseline"]',
      updated_at: cleared.updated_at,
    });
  });

  it("keeps reads and conditional writes inside their Library", async () => {
    const now = Date.now();
    const foreignLibraryId = "foreign-saved-search-library";
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign Library', 'personal', ?, ?)`,
      [foreignLibraryId, now, now],
    );
    const foreignRepo = new SavedSearchesRepo(db, foreignLibraryId);
    const foreignId = await foreignRepo.create({
      query: "foreign saved search",
      sources: ["crossref"],
    });
    await foreignRepo.recordRun(foreignId, ["doi:10.1000/foreign"], 4, now + 1000);
    const foreignSnapshot = (await foreignRepo.get(foreignId))!;

    expect(await savedSearches.get(foreignId)).toBeNull();
    expect(
      await savedSearches.commitRunIfCurrent(foreignId, {
        expectedUpdatedAt: foreignSnapshot.updated_at,
        observedIds: ["doi:10.1000/foreign", "doi:10.1000/cross-library"],
        nextRunAt: now + 2000,
      }),
    ).toEqual({ committed: false, freshCount: 0, updatedAt: null });
    expect(
      await savedSearches.recordErrorIfCurrent(foreignId, {
        expectedUpdatedAt: foreignSnapshot.updated_at,
        error: "cross-library error",
        nextRunAt: now + 3000,
      }),
    ).toEqual({ committed: false, updatedAt: null });
    expect(await foreignRepo.get(foreignId)).toMatchObject({
      last_error: null,
      new_count: 4,
      seen_ids_json: '["doi:10.1000/foreign"]',
      updated_at: foreignSnapshot.updated_at,
    });
  });
});
