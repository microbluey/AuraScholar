import type { AttachmentRow, CollectionRow, WorkWithAuthors } from "@aurascholar/db";
import { citationCountsForWorks, listDeletedWorks, listWorks } from "@aurascholar/db/work-list";
import { getLibraryDb } from "./aura-db";

export interface WorkNotePreview {
  id: string;
  type: string;
  page_index: number;
  content_md: string | null;
  updated_at: number;
}

export interface WorkTableMeta {
  tags: string[];
  references: number;
  citedBy: number;
  annotations: number;
  pdfs: number;
  sentinelTaskCount: number;
  sentinelStatus: string | null;
  sentinelState: string | null;
}

export interface WorkRuntimeMeta {
  pdfCount: number;
  annotationCount: number;
  pdfPreview: AttachmentRow | null;
  notePreviews: WorkNotePreview[];
  sentinelTaskCount: number;
  sentinelStatus: string | null;
  sentinelState: string | null;
}

interface LibraryPageDataInput {
  collectionId?: string;
  limit: number;
  search?: string;
  showTrash: boolean;
}

interface LibraryPageData {
  collections: CollectionRow[];
  trashCount: number;
  works: WorkWithAuthors[];
  workMeta: Record<string, WorkTableMeta>;
}

interface WorkTagRow {
  work_id: string;
  name: string;
}

interface WorkCountRow {
  work_id: string;
  count: number;
}

interface WorkSentinelRow {
  work_id: string;
  status: string;
  current_state: string | null;
  task_count: number;
}

export function emptyWorkMeta(): WorkTableMeta {
  return {
    tags: [],
    references: 0,
    citedBy: 0,
    annotations: 0,
    pdfs: 0,
    sentinelTaskCount: 0,
    sentinelStatus: null,
    sentinelState: null,
  };
}

export async function loadLibraryPageData(input: LibraryPageDataInput): Promise<LibraryPageData> {
  const { db, libraryId } = await getLibraryDb();
  const [collections, trashRows] = await Promise.all([
    db.query<CollectionRow>(
      `SELECT c.id, c.library_id, c.name, c.parent_id, c.sort_order, COUNT(w.id) AS count
       FROM collections c
       LEFT JOIN collection_items ci ON ci.collection_id = c.id
       LEFT JOIN works w
         ON w.id = ci.work_id
        AND w.library_id = c.library_id
        AND w.deleted_at IS NULL
       WHERE c.library_id = ? AND c.deleted_at IS NULL
       GROUP BY c.id, c.library_id, c.name, c.parent_id, c.sort_order
       ORDER BY c.sort_order, c.name, c.id`,
      [libraryId],
    ),
    db.query<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM works
       WHERE library_id = ? AND deleted_at IS NOT NULL`,
      [libraryId],
    ),
  ]);
  const works = input.showTrash
    ? await listDeletedWorks(db, libraryId, {
        limit: input.limit,
        search: input.search,
      })
    : await listWorks(db, libraryId, {
        collectionId: input.collectionId,
        limit: input.limit,
        search: input.search,
      });
  if (works.length === 0) {
    return {
      collections,
      trashCount: trashRows[0]?.n ?? 0,
      works,
      workMeta: {},
    };
  }

  const ids = works.map((work) => work.id);
  const placeholders = ids.map(() => "?").join(",");
  const [tagRows, citationCounts, annotationRows, attachmentRows, sentinelRows] = await Promise.all(
    [
      db.query<WorkTagRow>(
        `SELECT wt.work_id, t.name
         FROM work_tags wt
         JOIN tags t ON t.id = wt.tag_id
         WHERE wt.work_id IN (${placeholders})
           AND t.library_id = ?
           AND t.deleted_at IS NULL
         ORDER BY t.name`,
        [...ids, libraryId],
      ),
      citationCountsForWorks(db, libraryId, ids),
      db.query<WorkCountRow>(
        `SELECT work_id, COUNT(*) AS count
         FROM annotations
         WHERE work_id IN (${placeholders}) AND deleted_at IS NULL
         GROUP BY work_id`,
        ids,
      ),
      db.query<WorkCountRow>(
        `SELECT work_id, COUNT(*) AS count
         FROM attachments
         WHERE work_id IN (${placeholders}) AND deleted_at IS NULL AND kind = 'pdf'
         GROUP BY work_id`,
        ids,
      ),
      db.query<WorkSentinelRow>(
        `SELECT st.work_id, st.status, st.current_state, latest.task_count
         FROM sentinel_tasks st
         JOIN (
           SELECT work_id, MAX(created_at) AS created_at, COUNT(*) AS task_count
           FROM sentinel_tasks
           WHERE work_id IN (${placeholders})
             AND library_id = ?
             AND deleted_at IS NULL
           GROUP BY work_id
         ) latest ON latest.work_id = st.work_id AND latest.created_at = st.created_at
         WHERE st.library_id = ? AND st.deleted_at IS NULL`,
        [...ids, libraryId, libraryId],
      ),
    ],
  );

  const workMeta = Object.fromEntries(works.map((work) => [work.id, emptyWorkMeta()])) as Record<
    string,
    WorkTableMeta
  >;
  for (const row of tagRows) {
    workMeta[row.work_id]?.tags.push(row.name);
  }
  for (const [workId, counts] of citationCounts) {
    const meta = workMeta[workId];
    if (meta) {
      meta.references = counts.references;
      meta.citedBy = counts.citedBy;
    }
  }
  for (const row of annotationRows) {
    const meta = workMeta[row.work_id];
    if (meta) meta.annotations = Number(row.count);
  }
  for (const row of attachmentRows) {
    const meta = workMeta[row.work_id];
    if (meta) meta.pdfs = Number(row.count);
  }
  for (const row of sentinelRows) {
    const meta = workMeta[row.work_id];
    if (meta) {
      meta.sentinelTaskCount = Number(row.task_count);
      meta.sentinelStatus = row.status;
      meta.sentinelState = row.current_state;
    }
  }

  return {
    collections,
    trashCount: trashRows[0]?.n ?? 0,
    works,
    workMeta,
  };
}

export async function loadLibraryWorkRuntimeMeta(
  workId: string,
  annotationCount: number,
): Promise<WorkRuntimeMeta> {
  const { db, libraryId } = await getLibraryDb();
  const [attachments, notes, sentinelTasks] = await Promise.all([
    db.query<AttachmentRow>(
      `SELECT * FROM attachments
       WHERE work_id = ?
         AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM works
           WHERE id = ? AND library_id = ?
         )
       ORDER BY created_at DESC`,
      [workId, workId, libraryId],
    ),
    db.query<WorkNotePreview>(
      `SELECT id, type, page_index, content_md, updated_at
       FROM annotations
       WHERE work_id = ?
         AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM works
           WHERE id = ? AND library_id = ?
         )
       ORDER BY updated_at DESC
       LIMIT 3`,
      [workId, workId, libraryId],
    ),
    db.query<{ status: string; current_state: string | null }>(
      `SELECT status, current_state
       FROM sentinel_tasks
       WHERE work_id = ? AND library_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [workId, libraryId],
    ),
  ]);
  const pdfAttachments = attachments.filter((attachment) => attachment.kind === "pdf");

  return {
    annotationCount,
    notePreviews: notes,
    pdfCount: pdfAttachments.length,
    pdfPreview: pdfAttachments[0] ?? null,
    sentinelState: sentinelTasks[0]?.current_state ?? null,
    sentinelStatus: sentinelTasks[0]?.status ?? null,
    sentinelTaskCount: sentinelTasks.length,
  };
}
