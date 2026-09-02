import type { Database } from "@aurascholar/db";
import { createNodeDatabase } from "@aurascholar/db/node";
import { runMigrations } from "@aurascholar/db/migrations";
import { describe, expect, it } from "vitest";
import {
  exportLibraryBackupJsonFromDatabase,
  importParsedLibraryBackupIntoDatabase,
  LIBRARY_BACKUP_VERSION,
  parseLibraryBackupJson,
} from "../shared/library-backup";

async function addLibrary(db: Database, id: string): Promise<void> {
  await db.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, ?, 'personal', 1, 1)`,
    [id, id],
  );
}

async function importBackup(text: string, db: Database, libraryId: string): Promise<void> {
  await db.exec("BEGIN");
  try {
    await importParsedLibraryBackupIntoDatabase(db, parseLibraryBackupJson(text), libraryId);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

describe("saved-search backup criteria", () => {
  it("round-trips structured conditions through the current backup format", async () => {
    const source = await createNodeDatabase(":memory:");
    const target = await createNodeDatabase(":memory:");
    await runMigrations(source);
    await runMigrations(target);
    await addLibrary(source, "source-library");
    await addLibrary(target, "target-library");
    const criteriaJson =
      '{"text":"graph retrieval","author":"Ada","yearFrom":2020,"yearTo":2024,"venue":"NeurIPS"}';
    await source.run(
      `INSERT INTO saved_searches (
         id, library_id, query, criteria_json, sources_json, seen_ids_json,
         new_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, '[]', 0, 10, 10)`,
      ["saved-criteria", "source-library", "graph retrieval", criteriaJson, '["openalex"]'],
    );

    const text = await exportLibraryBackupJsonFromDatabase(source, "source-library");
    expect(JSON.parse(text)).toMatchObject({ version: LIBRARY_BACKUP_VERSION });
    await importBackup(text, target, "target-library");

    await expect(
      target.query<{ criteria_json: string | null; library_id: string; query: string }>(
        `SELECT library_id, query, criteria_json FROM saved_searches WHERE id = 'saved-criteria'`,
      ),
    ).resolves.toEqual([
      {
        library_id: "target-library",
        query: "graph retrieval",
        criteria_json: criteriaJson,
      },
    ]);
  });
});
