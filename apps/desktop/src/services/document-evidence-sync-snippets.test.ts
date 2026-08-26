import { type Database } from "@aurascholar/db";
import { createNodeDatabase } from "@aurascholar/db/node";
import { runMigrations } from "@aurascholar/db/migrations";
import { type ChangeEntry } from "@aurascholar/sync";
import { describe, expect, it, vi } from "vitest";
import { SqliteSyncStorage } from "../shared/sqlite-sync-storage";

const TRANSPORT_LIBRARY_ID = "remote:document-evidence-contract";

async function addLibrary(db: Database, id: string): Promise<void> {
  await db.run(
    `INSERT OR IGNORE INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, ?, 'personal', 1, 1)`,
    [id, id],
  );
}

function requireChange(changes: ChangeEntry[], table: string, rowId: string): ChangeEntry {
  const change = changes.find((item) => item.table === table && item.rowId === rowId);
  if (!change) throw new Error(`Missing sync change ${table}.${rowId}`);
  return change;
}

async function applyChange(storage: SqliteSyncStorage, change: ChangeEntry): Promise<void> {
  if (change.op !== "upsert") throw new Error(`Expected an upsert for ${change.table}`);
  await storage.applyUpsert(change.table, change.rowId, change.values, change.columnHlcs);
}

describe("Document snippet row-level sync", () => {
  it("snapshots and applies snippets across Library-scoped devices, including soft deletes", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const source = await createNodeDatabase(":memory:");
      const target = await createNodeDatabase(":memory:");
      await runMigrations(source);
      await runMigrations(target);

      const sourceLibraryId = "library-snippet-source";
      const targetLibraryId = "library-snippet-target";
      const workId = "work-snippet-portable";
      const snippetId = "snippet-portable";
      await addLibrary(source, sourceLibraryId);
      await addLibrary(target, targetLibraryId);
      await source.run(
        `INSERT INTO works (id, library_id, title, created_at, updated_at)
         VALUES (?, ?, 'Snippet source work', 900, 900)`,
        [workId, sourceLibraryId],
      );
      await source.run(
        `INSERT INTO snippets
           (id, work_id, page_index, quote, note_md, tag, created_at, updated_at, deleted_at)
         VALUES (?, ?, 2, 'Portable quote', 'Initial note', 'method', 900, 900, NULL)`,
        [snippetId, workId],
      );

      const sourceStorage = new SqliteSyncStorage(
        source,
        "device-snippet-source",
        sourceLibraryId,
        "snippet-provider",
        TRANSPORT_LIBRARY_ID,
      );
      const targetStorage = new SqliteSyncStorage(
        target,
        "device-snippet-target",
        targetLibraryId,
        "snippet-provider",
        TRANSPORT_LIBRARY_ID,
      );
      const initial = await sourceStorage.unsyncedChanges(0);
      const work = requireChange(initial, "works", workId);
      const snippet = requireChange(initial, "snippets", snippetId);
      expect(sourceStorage.supportsTable("snippets")).toBe(true);
      await applyChange(targetStorage, work);
      await applyChange(targetStorage, snippet);
      await expect(
        target.query<{
          library_id: string;
          work_id: string;
          quote: string;
          note_md: string | null;
          deleted_at: number | null;
        }>(
          `SELECT w.library_id, s.work_id, s.quote, s.note_md, s.deleted_at
           FROM snippets s JOIN works w ON w.id = s.work_id
           WHERE s.id = ?`,
          [snippetId],
        ),
      ).resolves.toEqual([
        {
          library_id: targetLibraryId,
          work_id: workId,
          quote: "Portable quote",
          note_md: "Initial note",
          deleted_at: null,
        },
      ]);

      await sourceStorage.markPushed(initial.at(-1)!.seq, { complete: true });
      vi.setSystemTime(2_000);
      await source.run(`UPDATE snippets SET note_md = ?, updated_at = ? WHERE id = ?`, [
        "Updated on source",
        2_000,
        snippetId,
      ]);
      vi.setSystemTime(2_001);
      const updated = await sourceStorage.unsyncedChanges(await sourceStorage.lastPushedSeq());
      const updatedSnippet = requireChange(updated, "snippets", snippetId);
      expect(updatedSnippet.values.note_md).toBe("Updated on source");
      await applyChange(targetStorage, updatedSnippet);
      await expect(
        target.query<{ note_md: string }>(`SELECT note_md FROM snippets WHERE id = ?`, [snippetId]),
      ).resolves.toEqual([{ note_md: "Updated on source" }]);

      await sourceStorage.markPushed(updated.at(-1)!.seq, { complete: true });
      vi.setSystemTime(3_000);
      await source.run(`UPDATE snippets SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
        3_000,
        3_000,
        snippetId,
      ]);
      vi.setSystemTime(3_001);
      const deleted = await sourceStorage.unsyncedChanges(await sourceStorage.lastPushedSeq());
      const deletedSnippet = requireChange(deleted, "snippets", snippetId);
      expect(deletedSnippet.values.deleted_at).toBe(3_000);
      await applyChange(targetStorage, deletedSnippet);
      await expect(
        target.query<{ deleted_at: number | null }>(
          `SELECT deleted_at FROM snippets WHERE id = ?`,
          [snippetId],
        ),
      ).resolves.toEqual([{ deleted_at: 3_000 }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
