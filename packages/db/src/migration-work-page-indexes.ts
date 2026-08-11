import type { SqlExecutor } from "./migrations.js";

/**
 * Schema v23: indexes for database-backed Library pagination and its EXISTS
 * facets. These are deliberately additive so existing local Libraries can
 * receive them without rebuilding their canonical Work records.
 */
export async function applyWorkPageIndexesV23(db: SqlExecutor): Promise<void> {
  await db.exec(`
    CREATE INDEX IF NOT EXISTS works_page_created_idx
      ON works(library_id, deleted_at, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS works_page_year_idx
      ON works(library_id, deleted_at, year DESC, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS works_page_deleted_idx
      ON works(library_id, deleted_at DESC, updated_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS annotations_work_active_idx
      ON annotations(work_id, deleted_at);
    CREATE INDEX IF NOT EXISTS attachments_work_kind_active_idx
      ON attachments(work_id, kind, deleted_at);
  `);
}
