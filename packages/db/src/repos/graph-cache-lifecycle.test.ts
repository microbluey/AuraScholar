import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { requireLocalLibraryId } from "../local-first";
import { runMigrations } from "../migrations";
import { WorksRepo } from "./works";

let db: Database;
let works: WorksRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  works = new WorksRepo(db, await requireLocalLibraryId(db));
});

type GraphCacheRow = {
  fetched_at: number;
  payload_json: string;
  work_id: string;
};

async function graphCacheRows(): Promise<GraphCacheRow[]> {
  return db.query<GraphCacheRow>(
    `SELECT work_id, payload_json, fetched_at
     FROM graph_cache
     ORDER BY work_id`,
  );
}

async function insertGraphCacheRow(row: GraphCacheRow): Promise<void> {
  await db.run(
    `INSERT INTO graph_cache (work_id, payload_json, fetched_at)
     VALUES (?, ?, ?)`,
    [row.work_id, row.payload_json, row.fetched_at],
  );
}

describe("graph-cache Work lifecycle isolation", () => {
  it("does not rewrite cache rows whose keys happen to equal merged Work ids", async () => {
    const primary = await works.upsert({ title: "Graph cache primary" });
    const duplicate = await works.upsert({ title: "Graph cache duplicate" });
    const expectedRows: GraphCacheRow[] = [
      {
        fetched_at: 101,
        payload_json: JSON.stringify({ graph: "primary-cache" }),
        work_id: primary.id,
      },
      {
        fetched_at: 202,
        payload_json: JSON.stringify({ graph: "duplicate-cache" }),
        work_id: duplicate.id,
      },
    ].sort((left, right) => left.work_id.localeCompare(right.work_id));
    for (const row of expectedRows) await insertGraphCacheRow(row);

    await works.mergeInto(primary.id, [duplicate.id]);

    await expect(graphCacheRows()).resolves.toEqual(expectedRows);
  });

  it("does not delete a cache row when its matching Work is purged", async () => {
    const work = await works.upsert({ title: "Graph cache purge target" });
    const expectedRow: GraphCacheRow = {
      fetched_at: 303,
      payload_json: JSON.stringify({ graph: "survive-purge" }),
      work_id: work.id,
    };
    await insertGraphCacheRow(expectedRow);

    await works.softDelete(work.id);
    await works.purgeDeleted(work.id);

    await expect(graphCacheRows()).resolves.toEqual([expectedRow]);
  });
});
