import type { Database } from "../database.js";
import { projectWorkMembershipId } from "../ids.js";

interface MembershipRow {
  id: string;
  project_id: string;
  role: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Unions Project membership while retiring a duplicate Work. */
export async function mergeProjectWorkMemberships(
  db: Database,
  libraryId: string,
  primaryWorkId: string,
  duplicateWorkId: string,
  now: number,
): Promise<void> {
  const duplicates = await db.query<MembershipRow>(
    `SELECT membership.id, membership.project_id, membership.role,
            membership.created_at, membership.updated_at, membership.deleted_at
     FROM project_works membership
     JOIN research_projects project
       ON project.id = membership.project_id
      AND project.library_id = ?
     WHERE membership.work_id = ?
     ORDER BY membership.project_id`,
    [libraryId, duplicateWorkId],
  );

  for (const duplicate of duplicates) {
    const existingRows = await db.query<MembershipRow>(
      `SELECT id, project_id, role, created_at, updated_at, deleted_at
       FROM project_works
       WHERE project_id = ? AND work_id = ?
       LIMIT 1`,
      [duplicate.project_id, primaryWorkId],
    );
    const existing = existingRows[0];
    if (existing) {
      await db.run(
        `UPDATE project_works
         SET role = ?,
             created_at = MIN(created_at, ?),
             updated_at = MAX(updated_at + 1, ?),
             deleted_at = ?
         WHERE id = ?`,
        [
          existing.deleted_at === null ? existing.role : duplicate.role,
          duplicate.created_at,
          now,
          existing.deleted_at === null || duplicate.deleted_at === null ? null : now,
          existing.id,
        ],
      );
    } else {
      await db.run(
        `INSERT INTO project_works
           (id, project_id, work_id, role, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          projectWorkMembershipId(duplicate.project_id, primaryWorkId),
          duplicate.project_id,
          primaryWorkId,
          duplicate.role,
          duplicate.created_at,
          Math.max(now, duplicate.updated_at + 1),
          duplicate.deleted_at === null ? null : now,
        ],
      );
    }
    await db.run(
      `UPDATE project_works
       SET deleted_at = COALESCE(deleted_at, ?), updated_at = MAX(updated_at + 1, ?)
       WHERE id = ?`,
      [now, now, duplicate.id],
    );
  }
}

export async function purgeProjectWorkMemberships(db: Database, workId: string): Promise<void> {
  await db.run(`DELETE FROM project_works WHERE work_id = ?`, [workId]);
}
