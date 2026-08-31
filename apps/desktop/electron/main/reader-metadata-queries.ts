import { Buffer } from "node:buffer";
import type { Database } from "@aurascholar/db";
import type {
  ReaderAnnotation,
  ReaderAttachment,
  ReaderGetAttachmentCommandInput,
  ReaderListAnnotationsCommandInput,
  ReaderReadAttachmentPdfCommandInput,
  ReaderWork,
} from "../data-command-contract";

export const MAX_READER_ANNOTATION_ANCHOR_BYTES = 64 * 1024;
export const MAX_READER_ANNOTATION_CONTENT_BYTES = 64 * 1024;
export const MAX_READER_ANNOTATION_ROWS = 1_000;
export const MAX_READER_IDENTIFIER_BYTES = 512;
export const MAX_READER_METADATA_OUTPUT_BYTES = 2 * 1024 * 1024;
export const MAX_READER_METADATA_TEXT_BYTES = 8 * 1024;
export const MAX_READER_PDF_CANDIDATE_ROWS = 100;
export const MAX_READER_WORK_AUTHOR_ROWS = 100;

interface ReaderWorkRecord {
  arxiv_id: string | null;
  deleted_at: number | null;
  doi: string | null;
  id: string;
  title: string;
  year: number | null;
}

interface ReaderAuthorRecord {
  display_name: string;
}

interface ReaderAnnotationPayloadBudget {
  payload_bytes: number;
  row_count: number;
}

/** Internal, main-only PDF lookup row. It is never returned over IPC. */
export interface ReaderPdfAttachment {
  byte_size: number;
  id: string;
  sha256: string;
}

/** Loads bounded Reader session work context through an explicit projection. */
export async function loadReaderWork(
  database: Database,
  libraryId: string,
  workId: string,
): Promise<ReaderWork | null> {
  const workRows = await database.query<ReaderWorkRecord>(
    `SELECT
       w.id,
       CASE
         WHEN length(CAST(w.doi AS BLOB)) <= ? THEN w.doi
         ELSE NULL
       END AS doi,
       CASE
         WHEN length(CAST(w.title AS BLOB)) <= ? THEN w.title
         ELSE 'Untitled work'
       END AS title,
       w.year,
       CASE
         WHEN length(CAST(w.arxiv_id AS BLOB)) <= ? THEN w.arxiv_id
         ELSE NULL
       END AS arxiv_id,
       w.deleted_at
     FROM works w
     WHERE w.id = ?
       AND w.library_id = ?
       AND length(CAST(w.id AS BLOB)) <= ?
     LIMIT 1`,
    [
      MAX_READER_METADATA_TEXT_BYTES,
      MAX_READER_METADATA_TEXT_BYTES,
      MAX_READER_METADATA_TEXT_BYTES,
      workId,
      libraryId,
      MAX_READER_IDENTIFIER_BYTES,
    ],
  );
  const work = workRows[0];
  if (!work) return null;

  const authorRows = requireBoundedReaderRows(
    await database.query<ReaderAuthorRecord>(
      `SELECT
         CASE
           WHEN length(CAST(a.display_name AS BLOB)) <= ? THEN a.display_name
           ELSE 'Unknown author'
         END AS display_name
       FROM work_authors wa
       JOIN authors a ON a.id = wa.author_id AND a.library_id = ?
       WHERE wa.work_id = ?
       ORDER BY wa.position, a.id
       LIMIT ?`,
      [MAX_READER_METADATA_TEXT_BYTES, libraryId, work.id, MAX_READER_WORK_AUTHOR_ROWS + 1],
    ),
    MAX_READER_WORK_AUTHOR_ROWS,
    "Reader work authors",
  );
  return { ...work, authorNames: authorRows.map((author) => author.display_name) };
}

/** Lists only PDF candidates needed by the Reader document opening flow. */
export async function loadReaderPdfAttachments(
  database: Database,
  libraryId: string,
  workId: string,
): Promise<ReaderAttachment[]> {
  const rows = await database.query<ReaderAttachment>(
    `SELECT
       a.id,
       a.work_id,
       'pdf' AS kind,
       a.sha256,
       a.byte_size,
       CASE
         WHEN a.original_filename IS NULL THEN NULL
         WHEN length(CAST(a.original_filename AS BLOB)) <= ? THEN a.original_filename
         ELSE NULL
       END AS original_filename
     FROM attachments a
     JOIN works w
       ON w.id = a.work_id
      AND w.library_id = ?
      AND w.deleted_at IS NULL
     WHERE a.work_id = ?
       AND a.kind = 'pdf'
       AND a.deleted_at IS NULL
       AND length(CAST(a.id AS BLOB)) <= ?
       AND length(CAST(a.work_id AS BLOB)) <= ?
       AND length(CAST(a.sha256 AS BLOB)) <= ?
       AND a.byte_size >= 0
       AND a.byte_size <= ?
     ORDER BY CASE WHEN EXISTS (
       SELECT 1
       FROM document_revisions revision
       JOIN document_assets asset
         ON asset.id = revision.asset_id
        AND asset.current_revision_id = revision.id
        AND asset.library_id = w.library_id
        AND asset.work_id = a.work_id
        AND asset.deleted_at IS NULL
       WHERE revision.attachment_id = a.id
         AND revision.deleted_at IS NULL
     ) THEN 0 ELSE 1 END,
     a.created_at DESC, a.id ASC
     LIMIT ?`,
    [
      MAX_READER_METADATA_TEXT_BYTES,
      libraryId,
      workId,
      MAX_READER_IDENTIFIER_BYTES,
      MAX_READER_IDENTIFIER_BYTES,
      MAX_READER_IDENTIFIER_BYTES,
      Number.MAX_SAFE_INTEGER,
      MAX_READER_PDF_CANDIDATE_ROWS + 1,
    ],
  );
  return requireBoundedReaderRows(rows, MAX_READER_PDF_CANDIDATE_ROWS, "Reader PDF candidates");
}

/** Finds one active Reader attachment through a bounded explicit projection. */
export async function findActiveReaderAttachmentForWork(
  database: Database,
  libraryId: string,
  input: ReaderGetAttachmentCommandInput | ReaderListAnnotationsCommandInput,
): Promise<ReaderAttachment | null> {
  const rows = await database.query<ReaderAttachment>(
    `SELECT
       a.id,
       a.work_id,
       CASE
         WHEN length(CAST(a.kind AS BLOB)) <= ? THEN a.kind
         ELSE 'unknown'
       END AS kind,
       a.sha256,
       a.byte_size,
       CASE
         WHEN a.original_filename IS NULL THEN NULL
         WHEN length(CAST(a.original_filename AS BLOB)) <= ? THEN a.original_filename
         ELSE NULL
       END AS original_filename
     FROM attachments a
     JOIN works w
       ON w.id = a.work_id
      AND w.library_id = ?
      AND w.deleted_at IS NULL
     WHERE a.id = ?
       AND a.work_id = ?
       AND a.deleted_at IS NULL
       AND length(CAST(a.id AS BLOB)) <= ?
       AND length(CAST(a.work_id AS BLOB)) <= ?
       AND length(CAST(a.sha256 AS BLOB)) <= ?
       AND a.byte_size >= 0
       AND a.byte_size <= ?
     LIMIT 1`,
    [
      MAX_READER_METADATA_TEXT_BYTES,
      MAX_READER_METADATA_TEXT_BYTES,
      libraryId,
      input.attachmentId,
      input.workId,
      MAX_READER_IDENTIFIER_BYTES,
      MAX_READER_IDENTIFIER_BYTES,
      MAX_READER_IDENTIFIER_BYTES,
      Number.MAX_SAFE_INTEGER,
    ],
  );
  return rows[0] ?? null;
}

/** Main-only single-row PDF lookup; keeps unrelated attachments unmaterialized. */
export async function findActiveReaderPdfAttachmentForWork(
  database: Database,
  libraryId: string,
  input: ReaderReadAttachmentPdfCommandInput,
): Promise<ReaderPdfAttachment | null> {
  const rows = await database.query<ReaderPdfAttachment>(
    `SELECT a.id, a.sha256, a.byte_size
     FROM attachments a
     JOIN works w
       ON w.id = a.work_id
      AND w.library_id = ?
      AND w.deleted_at IS NULL
     WHERE a.id = ?
       AND a.work_id = ?
       AND a.kind = 'pdf'
       AND a.deleted_at IS NULL
       AND length(CAST(a.id AS BLOB)) <= ?
       AND length(CAST(a.sha256 AS BLOB)) <= ?
     LIMIT 1`,
    [
      libraryId,
      input.attachmentId,
      input.workId,
      MAX_READER_IDENTIFIER_BYTES,
      MAX_READER_IDENTIFIER_BYTES,
    ],
  );
  return rows[0] ?? null;
}

/** Lists bounded Reader annotations without persistence-only columns. */
export async function loadReaderAnnotations(
  database: Database,
  libraryId: string,
  input: ReaderListAnnotationsCommandInput,
): Promise<ReaderAnnotation[]> {
  await assertReaderAnnotationPayloadWithinBudget(database, libraryId, input);
  const rows = await database.query<ReaderAnnotation>(
    `SELECT
       an.id,
       CASE
         WHEN length(CAST(an.type AS BLOB)) <= ? THEN an.type
         ELSE 'note'
       END AS type,
       CASE
         WHEN an.color IS NULL THEN NULL
         WHEN length(CAST(an.color AS BLOB)) <= ? THEN an.color
         ELSE NULL
       END AS color,
       CASE
         WHEN an.page_index >= 0 AND an.page_index <= ? THEN an.page_index
         ELSE 0
       END AS page_index,
       CASE
         WHEN an.anchor_json IS NULL THEN NULL
         WHEN length(CAST(an.anchor_json AS BLOB)) <= ? THEN an.anchor_json
         ELSE NULL
       END AS anchor_json,
       CASE
         WHEN an.content_md IS NULL THEN NULL
         WHEN length(CAST(an.content_md AS BLOB)) <= ? THEN an.content_md
         ELSE NULL
       END AS content_md,
       CASE
         WHEN an.orphaned <> 0
           OR (an.anchor_json IS NOT NULL AND length(CAST(an.anchor_json AS BLOB)) > ?)
           THEN 1
         ELSE 0
       END AS orphaned
     FROM annotations an
     JOIN attachments a
       ON a.id = an.attachment_id
      AND a.deleted_at IS NULL
     JOIN works w
       ON w.id = an.work_id
      AND w.id = a.work_id
      AND w.library_id = ?
      AND w.deleted_at IS NULL
     WHERE an.attachment_id = ?
       AND an.work_id = ?
       AND an.deleted_at IS NULL
       AND length(CAST(an.id AS BLOB)) <= ?
     ORDER BY an.sort_key, an.id
     LIMIT ?`,
    [
      MAX_READER_METADATA_TEXT_BYTES,
      MAX_READER_METADATA_TEXT_BYTES,
      Number.MAX_SAFE_INTEGER,
      MAX_READER_ANNOTATION_ANCHOR_BYTES,
      MAX_READER_ANNOTATION_CONTENT_BYTES,
      MAX_READER_ANNOTATION_ANCHOR_BYTES,
      libraryId,
      input.attachmentId,
      input.workId,
      MAX_READER_IDENTIFIER_BYTES,
      MAX_READER_ANNOTATION_ROWS + 1,
    ],
  );
  return requireBoundedReaderRows(rows, MAX_READER_ANNOTATION_ROWS, "Reader annotations");
}

/**
 * Measure the projected annotation fields before SQLite materializes them in
 * JavaScript. The final serialized-output guard remains authoritative because
 * JSON escaping can enlarge a value beyond its raw UTF-8 byte length.
 */
async function assertReaderAnnotationPayloadWithinBudget(
  database: Database,
  libraryId: string,
  input: ReaderListAnnotationsCommandInput,
): Promise<void> {
  const rows = await database.query<ReaderAnnotationPayloadBudget>(
    `WITH bounded_annotations AS (
       SELECT an.id, an.type, an.color, an.anchor_json, an.content_md
       FROM annotations an
       JOIN attachments a
         ON a.id = an.attachment_id
        AND a.deleted_at IS NULL
       JOIN works w
         ON w.id = an.work_id
        AND w.id = a.work_id
        AND w.library_id = ?
        AND w.deleted_at IS NULL
       WHERE an.attachment_id = ?
         AND an.work_id = ?
         AND an.deleted_at IS NULL
         AND length(CAST(an.id AS BLOB)) <= ?
       ORDER BY an.sort_key, an.id
       LIMIT ?
     )
     SELECT
       COUNT(*) AS row_count,
       COALESCE(SUM(
         length(CAST(id AS BLOB))
         + CASE
             WHEN length(CAST(type AS BLOB)) <= ? THEN length(CAST(type AS BLOB))
             ELSE length('note')
           END
         + CASE
             WHEN color IS NULL THEN 0
             WHEN length(CAST(color AS BLOB)) <= ? THEN length(CAST(color AS BLOB))
             ELSE 0
           END
         + CASE
             WHEN anchor_json IS NULL THEN 0
             WHEN length(CAST(anchor_json AS BLOB)) <= ? THEN length(CAST(anchor_json AS BLOB))
             ELSE 0
           END
         + CASE
             WHEN content_md IS NULL THEN 0
             WHEN length(CAST(content_md AS BLOB)) <= ? THEN length(CAST(content_md AS BLOB))
             ELSE 0
           END
         + 256
       ), 0) AS payload_bytes
     FROM bounded_annotations`,
    [
      libraryId,
      input.attachmentId,
      input.workId,
      MAX_READER_IDENTIFIER_BYTES,
      MAX_READER_ANNOTATION_ROWS + 1,
      MAX_READER_METADATA_TEXT_BYTES,
      MAX_READER_METADATA_TEXT_BYTES,
      MAX_READER_ANNOTATION_ANCHOR_BYTES,
      MAX_READER_ANNOTATION_CONTENT_BYTES,
    ],
  );
  const budget = rows[0];
  if (Number(budget?.row_count ?? 0) > MAX_READER_ANNOTATION_ROWS) {
    throw new Error(`Reader annotations are limited to ${MAX_READER_ANNOTATION_ROWS}`);
  }
  if (Number(budget?.payload_bytes ?? 0) > MAX_READER_METADATA_OUTPUT_BYTES) {
    throw readerMetadataOutputLimitError();
  }
}

export function requireBoundedReaderRows<T>(rows: T[], maximum: number, label: string): T[] {
  if (rows.length > maximum) throw new Error(`${label} are limited to ${maximum}`);
  return rows;
}

export function requireBoundedReaderMetadataOutput<T>(output: T): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error("Reader metadata output cannot be serialized");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_READER_METADATA_OUTPUT_BYTES) {
    throw readerMetadataOutputLimitError();
  }
  return output;
}

function readerMetadataOutputLimitError(): Error {
  return new Error(`Reader metadata output is limited to ${MAX_READER_METADATA_OUTPUT_BYTES} bytes`);
}
