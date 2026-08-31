import { Buffer } from "node:buffer";
import type { Database } from "@aurascholar/db";
import type {
  CanvasActiveWork,
  CanvasAnnotationIngressSource,
  CanvasGetAnnotationIngressSourceCommandInput,
  CanvasIngressAnnotation,
  CanvasIngressWork,
} from "../canvas-command-contract";
import {
  MAX_CANVAS_INGRESS_ANNOTATION_ANCHOR_BYTES,
  MAX_CANVAS_INGRESS_ANNOTATION_CONTENT_BYTES,
  MAX_CANVAS_INGRESS_AUTHOR_ROWS,
  MAX_CANVAS_INGRESS_IDENTIFIER_BYTES,
  MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
  MAX_CANVAS_INGRESS_OUTPUT_BYTES,
} from "../../src/shared/canvas-ingress-limits";

export {
  MAX_CANVAS_INGRESS_ANNOTATION_ANCHOR_BYTES,
  MAX_CANVAS_INGRESS_ANNOTATION_CONTENT_BYTES,
  MAX_CANVAS_INGRESS_AUTHOR_ROWS,
  MAX_CANVAS_INGRESS_IDENTIFIER_BYTES,
  MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
  MAX_CANVAS_INGRESS_OUTPUT_BYTES,
} from "../../src/shared/canvas-ingress-limits";

type CanvasIngressWorkRecord = Omit<CanvasIngressWork, "authorNames">;

interface CanvasIngressAuthorRecord {
  display_name: string;
}

/**
 * Loads one active Canvas work through an explicit projection. The source
 * query keeps its runtime shape intentionally small even when the database
 * schema later gains more bibliographic columns.
 */
export async function loadCanvasIngressWork(
  database: Database,
  libraryId: string,
  workId: string,
): Promise<CanvasIngressWork | null> {
  const workRows = await database.query<CanvasIngressWorkRecord>(
    `SELECT
       w.id,
       CASE
         WHEN w.abstract IS NULL THEN NULL
         WHEN length(CAST(w.abstract AS BLOB)) <= ? THEN w.abstract
         ELSE NULL
       END AS abstract,
       CASE
         WHEN w.doi IS NULL THEN NULL
         WHEN length(CAST(w.doi AS BLOB)) <= ? THEN w.doi
         ELSE NULL
       END AS doi,
       CASE
         WHEN length(CAST(w.title AS BLOB)) <= ? THEN w.title
         ELSE 'Untitled work'
       END AS title,
       w.year,
       CASE
         WHEN w.venue_name IS NULL THEN NULL
         WHEN length(CAST(w.venue_name AS BLOB)) <= ? THEN w.venue_name
         ELSE NULL
       END AS venue_name,
       CASE
         WHEN length(CAST(w.reading_status AS BLOB)) <= ? THEN w.reading_status
         ELSE 'unread'
       END AS reading_status,
       w.deleted_at
     FROM works w
     WHERE w.id = ?
       AND w.library_id = ?
       AND w.deleted_at IS NULL
       AND length(CAST(w.id AS BLOB)) <= ?
     LIMIT 1`,
    [
      MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
      MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
      MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
      MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
      MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
      workId,
      libraryId,
      MAX_CANVAS_INGRESS_IDENTIFIER_BYTES,
    ],
  );
  const work = workRows[0];
  if (!work) return null;

  const authorRows = requireBoundedCanvasIngressRows(
    await database.query<CanvasIngressAuthorRecord>(
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
      [
        MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
        libraryId,
        work.id,
        MAX_CANVAS_INGRESS_AUTHOR_ROWS + 1,
      ],
    ),
    MAX_CANVAS_INGRESS_AUTHOR_ROWS,
    "Canvas ingress work authors",
  );
  return { ...work, authorNames: authorRows.map((author) => author.display_name) };
}

/**
 * Loads an active Canvas annotation and its active source work without
 * exposing persistence-only annotation or work columns to the renderer.
 */
export async function loadCanvasAnnotationIngressSource(
  database: Database,
  libraryId: string,
  input: CanvasGetAnnotationIngressSourceCommandInput,
): Promise<CanvasAnnotationIngressSource | null> {
  const annotationRows = await database.query<CanvasIngressAnnotation>(
    `SELECT
       an.id,
       an.attachment_id,
       an.work_id,
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
     JOIN works w
       ON w.id = an.work_id
      AND w.library_id = ?
      AND w.deleted_at IS NULL
     JOIN attachments at
       ON at.id = an.attachment_id
      AND at.work_id = an.work_id
      AND at.deleted_at IS NULL
     WHERE an.id = ?
       AND an.work_id = ?
       AND an.deleted_at IS NULL
       AND length(CAST(an.id AS BLOB)) <= ?
       AND length(CAST(an.attachment_id AS BLOB)) <= ?
       AND length(CAST(an.work_id AS BLOB)) <= ?
     LIMIT 1`,
    [
      MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
      MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
      Number.MAX_SAFE_INTEGER,
      MAX_CANVAS_INGRESS_ANNOTATION_ANCHOR_BYTES,
      MAX_CANVAS_INGRESS_ANNOTATION_CONTENT_BYTES,
      MAX_CANVAS_INGRESS_ANNOTATION_ANCHOR_BYTES,
      libraryId,
      input.annotationId,
      input.workId,
      MAX_CANVAS_INGRESS_IDENTIFIER_BYTES,
      MAX_CANVAS_INGRESS_IDENTIFIER_BYTES,
      MAX_CANVAS_INGRESS_IDENTIFIER_BYTES,
    ],
  );
  const annotation = annotationRows[0];
  if (!annotation) return null;

  const work = await loadCanvasIngressWork(database, libraryId, annotation.work_id);
  return work ? { annotation, work } : null;
}

/** Drops the ingress-only defensive deletion marker from active-work output. */
export function toCanvasActiveWork(work: CanvasIngressWork): CanvasActiveWork {
  return {
    abstract: work.abstract,
    authorNames: work.authorNames,
    doi: work.doi,
    id: work.id,
    reading_status: work.reading_status,
    title: work.title,
    venue_name: work.venue_name,
    year: work.year,
  };
}

function requireBoundedCanvasIngressRows<T>(rows: T[], maximum: number, label: string): T[] {
  if (rows.length > maximum) throw new Error(`${label} are limited to ${maximum}`);
  return rows;
}

/** Final IPC envelope guard; JSON escaping can exceed the SQL field budgets. */
export function requireBoundedCanvasIngressOutput<T>(output: T): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error("Canvas ingress output cannot be serialized");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_CANVAS_INGRESS_OUTPUT_BYTES) {
    throw new Error(`Canvas ingress output is limited to ${MAX_CANVAS_INGRESS_OUTPUT_BYTES} bytes`);
  }
  return output;
}
