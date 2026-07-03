import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { runMigrations } from "../migrations";
import { SavedSearchesRepo } from "./saved-searches";

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
});
