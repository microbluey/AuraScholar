import type { Database } from "../database.js";

export interface RestoreCollectionMembershipResult {
  restoredWorkIds: string[];
  skippedWorkIds: string[];
}

export async function restoreCollectionMemberships(
  db: Database,
  libraryId: string,
  collectionId: string,
  workIds: string[],
): Promise<RestoreCollectionMembershipResult> {
  const restoredWorkIds: string[] = [];
  const skippedWorkIds: string[] = [];
  for (const workId of new Set(workIds)) {
    const workRows = await db.query<{ library_id: string }>(
      `SELECT library_id
       FROM works
       WHERE id = ?
       LIMIT 1`,
      [workId],
    );
    const work = workRows[0];
    if (!work) {
      skippedWorkIds.push(workId);
      continue;
    }
    if (work.library_id !== libraryId) {
      throw new Error(`Work ${workId} belongs to another Library`);
    }
    const newerAssignments = await db.query<{ collection_id: string }>(
      `SELECT ci.collection_id
       FROM collection_items ci
       JOIN collections c
         ON c.id = ci.collection_id
        AND c.library_id = ?
        AND c.deleted_at IS NULL
       WHERE ci.work_id = ? AND ci.collection_id <> ?
       LIMIT 1`,
      [libraryId, workId, collectionId],
    );
    if (newerAssignments[0]) {
      await db.run(`DELETE FROM collection_items WHERE collection_id = ? AND work_id = ?`, [
        collectionId,
        workId,
      ]);
      const staleTarget = await db.query<{ n: number }>(
        `SELECT COUNT(*) AS n
         FROM collection_items
         WHERE collection_id = ? AND work_id = ?`,
        [collectionId, workId],
      );
      if ((staleTarget[0]?.n ?? 0) !== 0) {
        throw new Error(
          `Collection ${collectionId} retained a stale assignment for work ${workId}`,
        );
      }
      skippedWorkIds.push(workId);
      continue;
    }
    await db.run(`INSERT OR IGNORE INTO collection_items (collection_id, work_id) VALUES (?, ?)`, [
      collectionId,
      workId,
    ]);
    const restoredLink = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM collection_items
       WHERE collection_id = ? AND work_id = ?`,
      [collectionId, workId],
    );
    if ((restoredLink[0]?.n ?? 0) !== 1) {
      throw new Error(`Collection ${collectionId} was not restored to work ${workId}`);
    }
    restoredWorkIds.push(workId);
  }
  return { restoredWorkIds, skippedWorkIds };
}
