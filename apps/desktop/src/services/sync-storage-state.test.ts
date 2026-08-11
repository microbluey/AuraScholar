import { createNodeDatabase } from "@aurascholar/db/node";
import { runMigrations } from "@aurascholar/db/migrations";
import { describe, expect, it } from "vitest";
import { SqliteSyncStorage } from "../shared/sqlite-sync-storage";

async function addLibrary(
  db: Awaited<ReturnType<typeof createNodeDatabase>>,
  id: string,
): Promise<void> {
  await db.run(
    `INSERT OR IGNORE INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, ?, 'personal', 1, 1)`,
    [id, id],
  );
}

describe("Library-scoped sync storage state", () => {
  it("keeps sync cursors and pushed state separate for each Library", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "library-a");
    await addLibrary(db, "library-b");

    const storageA = new SqliteSyncStorage(db, "device", "library-a", "provider");
    const storageB = new SqliteSyncStorage(db, "device", "library-b", "provider");
    await storageA.markPushed(3);
    await storageB.markPushed(7);
    await storageA.setCursor("remote", 11);
    await storageB.setCursor("remote", 13);

    await expect(storageA.lastPushedSeq()).resolves.toBe(3);
    await expect(storageB.lastPushedSeq()).resolves.toBe(7);
    await expect(storageA.getCursor("remote")).resolves.toBe(11);
    await expect(storageB.getCursor("remote")).resolves.toBe(13);
  });
});
