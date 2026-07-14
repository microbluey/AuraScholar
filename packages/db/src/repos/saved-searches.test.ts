import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { runMigrations } from "../migrations";
import { SavedSearchInactiveError, SavedSearchesRepo } from "./saved-searches";

let db: Database;
let savedSearches: SavedSearchesRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  savedSearches = new SavedSearchesRepo(db);
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
      savedSearches.recordRun(id, ["doi:10.1000/original", "doi:10.1000/stale"], 3, Date.now() + 3000),
    ).rejects.toThrow(SavedSearchInactiveError);
    await expect(savedSearches.recordError(id, "OpenAlex returned 500", Date.now() + 3000)).rejects.toThrow(
      SavedSearchInactiveError,
    );
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
});
