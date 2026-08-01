import type { Database } from "../database.js";
import { buildWorksFtsQuery } from "../fts.js";
import { isUniqueConstraint } from "../sqlite-errors.js";
import {
  mergeProjectWorkMemberships,
  purgeProjectWorkMemberships,
} from "./project-work-lifecycle.js";
import { newId, normalizeDoi, workFingerprint } from "../ids.js";
import { withDatabaseWriteLock } from "./write-lock.js";
import {
  mergeWorkKnowledgeRecords,
  purgeWorkKnowledgeRecords,
} from "./work-knowledge-lifecycle.js";

export type AuthorRole = "author" | "editor" | "translator";
export type ReadingStatus = "unread" | "reading" | "read";

export interface WorkAuthorInput {
  displayName: string;
  orcid?: string;
  position: number;
  role?: AuthorRole;
}

/**
 * Rich bibliographic fields (EndNote-style, CSL-aligned). Optional everywhere —
 * a work needs only a title. Column names map 1:1 to works table columns
 * (see RICH_COLUMNS) so insert/update/backfill stay DRY.
 */
export interface RichBibFields {
  abstract?: string | null;
  year?: number | null;
  publicationDate?: string | null;
  venueName?: string | null;
  venueType?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  numberOfVolumes?: string | null;
  edition?: string | null;
  section?: string | null;
  publisher?: string | null;
  placePublished?: string | null;
  seriesTitle?: string | null;
  shortTitle?: string | null;
  originalTitle?: string | null;
  issn?: string | null;
  isbn?: string | null;
  url?: string | null;
  accessedDate?: string | null;
  language?: string | null;
  callNumber?: string | null;
  accessionNumber?: string | null;
  label?: string | null;
  databaseName?: string | null;
  arxivId?: string | null;
  openalexId?: string | null;
  s2Id?: string | null;
  pmid?: string | null;
  keywords?: string[] | null;
}

export interface WorkInput extends RichBibFields {
  doi?: string;
  title: string;
  type?: string;
  cslJson?: unknown;
  authors?: WorkAuthorInput[];
}

/** Patch for the metadata editor: any field plus an optional full author list. */
export interface WorkPatch extends RichBibFields {
  doi?: string | null;
  title?: string;
  type?: string;
  notesMd?: string | null;
  authors?: WorkAuthorInput[];
}

export interface WorkRow {
  id: string;
  library_id: string;
  doi: string | null;
  title: string;
  abstract: string | null;
  year: number | null;
  publication_date: string | null;
  venue_name: string | null;
  venue_type: string | null;
  type: string;
  arxiv_id: string | null;
  openalex_id: string | null;
  s2_id: string | null;
  pmid: string | null;
  fingerprint: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  number_of_volumes: string | null;
  edition: string | null;
  section: string | null;
  publisher: string | null;
  place_published: string | null;
  series_title: string | null;
  short_title: string | null;
  original_title: string | null;
  issn: string | null;
  isbn: string | null;
  url: string | null;
  accessed_date: string | null;
  language: string | null;
  call_number: string | null;
  accession_number: string | null;
  label: string | null;
  database_name: string | null;
  keywords_json: string | null;
  notes_md: string | null;
  reading_status: string;
  starred: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface WorkAuthorDetail {
  displayName: string;
  orcid: string | null;
  position: number;
  role: string;
}

export interface WorkWithAuthors extends WorkRow {
  authorNames: string[];
}

export interface MergeWorksResult {
  primaryId: string;
  merged: number;
  movedAttachments: number;
}

export interface UpsertWorksSummary {
  total: number;
  imported: number;
  deduped: number;
}

// camelCase WorkInput key → works column. Single source of truth for which
// rich fields exist and how they map; used by insert, update, and backfill.
const RICH_COLUMNS: Array<[keyof RichBibFields, string]> = [
  ["abstract", "abstract"],
  ["year", "year"],
  ["publicationDate", "publication_date"],
  ["venueName", "venue_name"],
  ["venueType", "venue_type"],
  ["volume", "volume"],
  ["issue", "issue"],
  ["pages", "pages"],
  ["numberOfVolumes", "number_of_volumes"],
  ["edition", "edition"],
  ["section", "section"],
  ["publisher", "publisher"],
  ["placePublished", "place_published"],
  ["seriesTitle", "series_title"],
  ["shortTitle", "short_title"],
  ["originalTitle", "original_title"],
  ["issn", "issn"],
  ["isbn", "isbn"],
  ["url", "url"],
  ["accessedDate", "accessed_date"],
  ["language", "language"],
  ["callNumber", "call_number"],
  ["accessionNumber", "accession_number"],
  ["label", "label"],
  ["databaseName", "database_name"],
  ["arxivId", "arxiv_id"],
  ["openalexId", "openalex_id"],
  ["s2Id", "s2_id"],
  ["pmid", "pmid"],
];

/** Serializes a rich field value for SQL (keywords → JSON string). */
function richValue(input: RichBibFields, key: keyof RichBibFields): unknown {
  const v = input[key];
  return v === undefined ? null : v;
}

function inputDoi(input: WorkInput | WorkPatch): string | null {
  if (input.doi === undefined || input.doi === null) return null;
  const trimmed = input.doi.trim();
  if (!trimmed) return null;
  return normalizeDoi(trimmed) ?? trimmed.toLowerCase();
}

export class WorksRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    if (!libraryId.trim()) throw new Error("libraryId must be a non-empty string");
  }

  private assertChanged(changed: number, message: string): void {
    if (changed === 0) throw new Error(message);
  }

  private assertChangedExactly(changed: number, expected: number, message: string): void {
    if (changed !== expected) {
      throw new Error(`${message} (expected ${expected}, changed ${changed})`);
    }
  }

  private async countRows(sql: string, params: unknown[] = []): Promise<number> {
    const rows = await this.db.query<{ n: number }>(sql, params);
    return Number(rows[0]?.n ?? 0);
  }

  private async withSavepoint<T>(name: string, fn: () => Promise<T>): Promise<T> {
    await this.db.exec(`SAVEPOINT ${name}`);
    try {
      const result = await fn();
      await this.db.exec(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (e) {
      try {
        await this.db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
      } finally {
        try {
          await this.db.exec(`RELEASE SAVEPOINT ${name}`);
        } catch {
          // Ignore release errors after rollback; preserve the original failure.
        }
      }
      throw e;
    }
  }

  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    return withDatabaseWriteLock(this.db, fn);
  }

  /**
   * Insert or merge a work. Dedup order: DOI → fingerprint. Returns the
   * existing row's id when a duplicate is found (metadata is backfilled
   * for fields the existing row is missing).
   */
  async upsert(input: WorkInput): Promise<{ id: string; deduped: boolean }> {
    return this.withWriteLock(() => this.upsertUnlocked(input));
  }

  async upsertMany(inputs: WorkInput[]): Promise<UpsertWorksSummary> {
    return this.withWriteLock(() => this.upsertManyUnlocked(inputs));
  }

  private async upsertManyUnlocked(inputs: WorkInput[]): Promise<UpsertWorksSummary> {
    let imported = 0;
    let deduped = 0;
    const savepoint = `works_upsert_many_${newId().replace(/-/g, "_")}`;
    await this.withSavepoint(savepoint, async () => {
      for (const input of inputs) {
        const result = await this.upsertUnlocked(input);
        if (result.deduped) deduped++;
        else imported++;
      }
    });
    return { total: inputs.length, imported, deduped };
  }

  private async upsertUnlocked(input: WorkInput): Promise<{ id: string; deduped: boolean }> {
    const now = Date.now();
    const doi = inputDoi(input);
    const firstAuthor = input.authors?.[0]?.displayName?.split(/\s+/).pop() ?? null;
    const fingerprint = workFingerprint(input.title, input.year ?? null, firstAuthor);

    const existing = await this.findExisting(input, doi, fingerprint);

    if (existing.length > 0) {
      const id = existing[0]!.id;
      await this.mergeExisting(id, input, doi, now);
      return { id, deduped: true };
    }

    const id = newId();
    const cols = [
      "id",
      "library_id",
      "doi",
      "title",
      "type",
      "fingerprint",
      "csl_json",
      "keywords_json",
    ];
    const vals: unknown[] = [
      id,
      this.libraryId,
      doi,
      input.title,
      input.type ?? "article",
      fingerprint,
      input.cslJson ? JSON.stringify(input.cslJson) : null,
      input.keywords?.length ? JSON.stringify(input.keywords) : null,
    ];
    for (const [key, col] of RICH_COLUMNS) {
      cols.push(col);
      vals.push(richValue(input, key));
    }
    cols.push("created_at", "updated_at");
    vals.push(now, now);
    const createSavepoint = `works_upsert_create_${id.replace(/-/g, "_")}`;
    try {
      await this.withSavepoint(createSavepoint, async () => {
        await this.db.run(
          `INSERT INTO works (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
          vals,
        );

        for (const author of input.authors ?? []) {
          const authorId = await this.upsertAuthor(author.displayName, author.orcid);
          await this.db.run(
            `INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)`,
            [id, authorId, author.position, author.displayName, author.role ?? "author"],
          );
        }
      });
    } catch (e) {
      // Concurrent capture/import can race between the preflight SELECT and
      // INSERT. If the unique DOI wins elsewhere, merge into the winner.
      if (!isUniqueConstraint(e)) throw e;
      const conflict = await this.findExisting(input, doi, fingerprint);
      if (conflict.length === 0) throw e;
      const existingId = conflict[0]!.id;
      await this.mergeExisting(existingId, input, doi, now);
      return { id: existingId, deduped: true };
    }

    return { id, deduped: false };
  }

  async mergeInto(primaryId: string, duplicateIds: string[]): Promise<MergeWorksResult> {
    return this.withWriteLock(() => this.mergeIntoUnlocked(primaryId, duplicateIds));
  }

  private async mergeIntoUnlocked(
    primaryId: string,
    duplicateIds: string[],
  ): Promise<MergeWorksResult> {
    const duplicates = [...new Set(duplicateIds)].filter((id) => id && id !== primaryId);
    if (duplicates.length === 0) return { primaryId, merged: 0, movedAttachments: 0 };

    let merged = 0;
    let movedAttachments = 0;
    const now = Date.now();
    const savepoint = `works_merge_into_${newId().replace(/-/g, "_")}`;
    await this.withSavepoint(savepoint, async () => {
      const primary = await this.db.query<{ id: string }>(
        `SELECT id
         FROM works
         WHERE id = ? AND library_id = ? AND deleted_at IS NULL
         LIMIT 1`,
        [primaryId, this.libraryId],
      );
      if (primary.length === 0) throw new Error("主文献不存在或已删除");

      for (const duplicateId of duplicates) {
        const exists = await this.db.query<{ id: string }>(
          `SELECT id
           FROM works
           WHERE id = ? AND library_id = ? AND deleted_at IS NULL
           LIMIT 1`,
          [duplicateId, this.libraryId],
        );
        if (exists.length === 0) {
          const owner = await this.db.query<{ library_id: string }>(
            `SELECT library_id FROM works WHERE id = ? LIMIT 1`,
            [duplicateId],
          );
          if (owner[0] && owner[0].library_id !== this.libraryId) {
            throw new Error(`Work ${duplicateId} is outside library ${this.libraryId}`);
          }
          throw new Error(`Duplicate work ${duplicateId} is missing or removed`);
        }
        movedAttachments += await this.mergeOneDuplicate(primaryId, duplicateId, now);
        merged++;
      }
    });

    return { primaryId, merged, movedAttachments };
  }

  private async findExisting(
    input: WorkInput,
    doi: string | null,
    fingerprint: string,
  ): Promise<Array<{ id: string }>> {
    const stableIds: Array<[unknown, string]> = [
      [doi, "doi"],
      [input.arxivId, "arxiv_id"],
      [input.openalexId, "openalex_id"],
      [input.s2Id, "s2_id"],
      [input.pmid, "pmid"],
    ];

    for (const [value, column] of stableIds) {
      if (!value) continue;
      const rows = await this.findExistingByColumn(column, value);
      if (rows.length > 0) return rows;
    }

    return this.findExistingByColumn("fingerprint", fingerprint);
  }

  private async findExistingByColumn(
    column: string,
    value: unknown,
  ): Promise<Array<{ id: string }>> {
    return this.db.query<{ id: string }>(
      `SELECT id FROM works
       WHERE library_id = ? AND ${column} = ?
       ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
      [this.libraryId, value],
    );
  }

  private async mergeExisting(
    id: string,
    input: WorkInput,
    doi: string | null,
    now: number,
  ): Promise<void> {
    // Backfill every rich column the existing row is still missing
    // (COALESCE keeps whatever is already there). Clearing deleted_at makes
    // re-importing a soft-deleted paper behave like restoring it to the library.
    const sets = [
      `deleted_at = NULL`,
      `doi = COALESCE(doi, ?)`,
      `csl_json = COALESCE(csl_json, ?)`,
      ...RICH_COLUMNS.map(([, col]) => `${col} = COALESCE(${col}, ?)`),
    ];
    const params = [
      doi,
      input.cslJson ? JSON.stringify(input.cslJson) : null,
      ...RICH_COLUMNS.map(([key]) => richValue(input, key)),
    ];
    if (input.keywords?.length) {
      sets.push(`keywords_json = COALESCE(keywords_json, ?)`);
      params.push(JSON.stringify(input.keywords));
    }
    const changed = await this.db.run(
      `UPDATE works
       SET ${sets.join(", ")}, updated_at = ?
       WHERE id = ? AND library_id = ?`,
      [...params, now, id, this.libraryId],
    );
    this.assertChanged(changed, `Work ${id} is outside library ${this.libraryId}`);
  }

  private async mergeOneDuplicate(
    primaryId: string,
    duplicateId: string,
    now: number,
  ): Promise<number> {
    await this.transferUniqueDoi(primaryId, duplicateId, now);
    await this.backfillPrimaryWork(primaryId, duplicateId, now);
    await this.mergeAuthorsIfPrimaryEmpty(primaryId, duplicateId);

    const duplicateAttachments = await this.db.query<{
      id: string;
      sha256: string;
      kind: string;
    }>(
      `SELECT id, sha256, kind FROM attachments
       WHERE work_id = ? AND deleted_at IS NULL`,
      [duplicateId],
    );

    let movedAttachments = 0;
    for (const attachment of duplicateAttachments) {
      const existing = await this.db.query<{ id: string }>(
        `SELECT id FROM attachments
         WHERE work_id = ? AND sha256 = ? AND kind = ? AND deleted_at IS NULL
         LIMIT 1`,
        [primaryId, attachment.sha256, attachment.kind],
      );
      if (existing[0]) {
        await this.mergeDuplicateAttachment(existing[0].id, attachment.id, primaryId, now);
      } else {
        const moved = await this.db.run(
          `UPDATE attachments SET work_id = ?, updated_at = ? WHERE id = ?`,
          [primaryId, now, attachment.id],
        );
        this.assertChanged(moved, `Attachment ${attachment.id} could not be merged`);
        const annotationCount = await this.countRows(
          `SELECT COUNT(*) AS n FROM annotations WHERE attachment_id = ?`,
          [attachment.id],
        );
        const movedAnnotations = await this.db.run(
          `UPDATE annotations SET work_id = ?, updated_at = ? WHERE attachment_id = ?`,
          [primaryId, now, attachment.id],
        );
        this.assertChangedExactly(
          movedAnnotations,
          annotationCount,
          `Annotations for attachment ${attachment.id} could not be merged`,
        );
        movedAttachments++;
      }
    }

    await this.mergeCollections(primaryId, duplicateId);
    await this.moveTags(primaryId, duplicateId);
    await this.moveCitations(primaryId, duplicateId);
    await this.moveGraphCache(primaryId, duplicateId);
    await this.moveCanvasReferences(primaryId, duplicateId, now);
    await mergeProjectWorkMemberships(this.db, this.libraryId, primaryId, duplicateId, now);
    await mergeWorkKnowledgeRecords(this.db, this.libraryId, primaryId, duplicateId, now);
    for (const table of ["flashcards", "snippets"]) {
      const expected = await this.countRows(
        `SELECT COUNT(*) AS n FROM ${table} WHERE work_id = ?`,
        [duplicateId],
      );
      const changed = await this.db.run(
        `UPDATE ${table} SET work_id = ?, updated_at = ? WHERE work_id = ?`,
        [primaryId, now, duplicateId],
      );
      this.assertChangedExactly(changed, expected, `${table} could not be merged`);
    }
    for (const table of ["sentinel_tasks", "ai_jobs"]) {
      const expected = await this.countRows(
        `SELECT COUNT(*) AS n FROM ${table} WHERE work_id = ? AND library_id = ?`,
        [duplicateId, this.libraryId],
      );
      const changed = await this.db.run(
        `UPDATE ${table}
         SET work_id = ?, updated_at = ?
         WHERE work_id = ? AND library_id = ?`,
        [primaryId, now, duplicateId, this.libraryId],
      );
      this.assertChangedExactly(changed, expected, `${table} could not be merged`);
    }
    const derivedArtifactCount = await this.countRows(
      `SELECT COUNT(*) AS n
       FROM derived_artifacts
       WHERE library_id = ? AND source_table = 'works' AND source_id = ?`,
      [this.libraryId, duplicateId],
    );
    const movedDerivedArtifacts = await this.db.run(
      `UPDATE derived_artifacts SET source_id = ?, updated_at = ?
       WHERE library_id = ? AND source_table = 'works' AND source_id = ?`,
      [primaryId, now, this.libraryId, duplicateId],
    );
    this.assertChangedExactly(
      movedDerivedArtifacts,
      derivedArtifactCount,
      "Work-derived artifacts could not be merged",
    );
    const changed = await this.db.run(
      `UPDATE works
       SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND library_id = ?`,
      [now, now, duplicateId, this.libraryId],
    );
    this.assertChanged(changed, `Work ${duplicateId} is outside library ${this.libraryId}`);

    return movedAttachments;
  }

  private async transferUniqueDoi(
    primaryId: string,
    duplicateId: string,
    now: number,
  ): Promise<void> {
    const rows = await this.db.query<{ id: string; doi: string | null }>(
      `SELECT id, doi
       FROM works
       WHERE library_id = ? AND id IN (?, ?)`,
      [this.libraryId, primaryId, duplicateId],
    );
    const primaryDoi = rows.find((row) => row.id === primaryId)?.doi ?? null;
    const duplicateDoi = rows.find((row) => row.id === duplicateId)?.doi ?? null;
    if (primaryDoi || !duplicateDoi) return;

    const cleared = await this.db.run(
      `UPDATE works
       SET doi = NULL, updated_at = ?
       WHERE id = ? AND library_id = ? AND doi = ?`,
      [now, duplicateId, this.libraryId, duplicateDoi],
    );
    this.assertChanged(cleared, `DOI could not be released from duplicate work ${duplicateId}`);
    const transferred = await this.db.run(
      `UPDATE works
       SET doi = ?, updated_at = ?
       WHERE id = ? AND library_id = ? AND doi IS NULL`,
      [duplicateDoi, now, primaryId, this.libraryId],
    );
    this.assertChanged(transferred, `DOI could not be transferred to primary work ${primaryId}`);
  }

  private async mergeDuplicateAttachment(
    primaryAttachmentId: string,
    duplicateAttachmentId: string,
    primaryWorkId: string,
    now: number,
  ): Promise<void> {
    const backfilled = await this.db.run(
      `UPDATE attachments
       SET original_filename = COALESCE(original_filename, (
             SELECT original_filename FROM attachments WHERE id = ?
           )),
           source_url = COALESCE(source_url, (
             SELECT source_url FROM attachments WHERE id = ?
           )),
           fetched_via = COALESCE(fetched_via, (
             SELECT fetched_via FROM attachments WHERE id = ?
           )),
           page_count = COALESCE(page_count, (
             SELECT page_count FROM attachments WHERE id = ?
           )),
           updated_at = ?
       WHERE id = ?`,
      [
        duplicateAttachmentId,
        duplicateAttachmentId,
        duplicateAttachmentId,
        duplicateAttachmentId,
        now,
        primaryAttachmentId,
      ],
    );
    this.assertChanged(
      backfilled,
      `Primary attachment ${primaryAttachmentId} could not be updated`,
    );
    const annotationCount = await this.countRows(
      `SELECT COUNT(*) AS n FROM annotations WHERE attachment_id = ?`,
      [duplicateAttachmentId],
    );
    const movedAnnotations = await this.db.run(
      `UPDATE annotations SET attachment_id = ?, work_id = ?, updated_at = ?
       WHERE attachment_id = ?`,
      [primaryAttachmentId, primaryWorkId, now, duplicateAttachmentId],
    );
    this.assertChangedExactly(
      movedAnnotations,
      annotationCount,
      `Annotations for attachment ${duplicateAttachmentId} could not be merged`,
    );
    const canvasExcerptCount = await this.countRows(
      `SELECT COUNT(*) AS n
       FROM canvas_nodes
       WHERE type = 'excerpt'
         AND json_valid(data_json)
         AND json_extract(data_json, '$.attachmentId') = ?
         AND EXISTS (
           SELECT 1
           FROM canvas_workspaces
           WHERE id = canvas_nodes.workspace_id AND library_id = ?
         )`,
      [duplicateAttachmentId, this.libraryId],
    );
    const movedCanvasExcerpts = await this.db.run(
      `UPDATE canvas_nodes
       SET data_json = json_set(data_json, '$.attachmentId', ?), updated_at = ?
       WHERE type = 'excerpt'
         AND json_valid(data_json)
         AND json_extract(data_json, '$.attachmentId') = ?
         AND EXISTS (
           SELECT 1
           FROM canvas_workspaces
           WHERE id = canvas_nodes.workspace_id AND library_id = ?
         )`,
      [primaryAttachmentId, now, duplicateAttachmentId, this.libraryId],
    );
    this.assertChangedExactly(
      movedCanvasExcerpts,
      canvasExcerptCount,
      `Canvas excerpts for attachment ${duplicateAttachmentId} could not be merged`,
    );
    const derivedArtifactCount = await this.countRows(
      `SELECT COUNT(*) AS n
       FROM derived_artifacts
       WHERE library_id = ? AND source_table = 'attachments' AND source_id = ?`,
      [this.libraryId, duplicateAttachmentId],
    );
    const movedDerivedArtifacts = await this.db.run(
      `UPDATE derived_artifacts
       SET source_id = ?, updated_at = ?
       WHERE library_id = ? AND source_table = 'attachments' AND source_id = ?`,
      [primaryAttachmentId, now, this.libraryId, duplicateAttachmentId],
    );
    this.assertChangedExactly(
      movedDerivedArtifacts,
      derivedArtifactCount,
      `Derived artifacts for attachment ${duplicateAttachmentId} could not be merged`,
    );
    const retired = await this.db.run(
      `UPDATE attachments SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      [now, now, duplicateAttachmentId],
    );
    this.assertChanged(retired, `Attachment ${duplicateAttachmentId} could not be merged`);
  }

  private async backfillPrimaryWork(
    primaryId: string,
    duplicateId: string,
    now: number,
  ): Promise<void> {
    const columns = [
      "doi",
      "abstract",
      "year",
      "publication_date",
      "venue_name",
      "venue_type",
      "type",
      "arxiv_id",
      "openalex_id",
      "s2_id",
      "pmid",
      "csl_json",
      "notes_md",
      "volume",
      "issue",
      "pages",
      "number_of_volumes",
      "edition",
      "section",
      "publisher",
      "place_published",
      "series_title",
      "short_title",
      "original_title",
      "issn",
      "isbn",
      "url",
      "accessed_date",
      "language",
      "call_number",
      "accession_number",
      "label",
      "database_name",
      "keywords_json",
    ];
    const sets = columns.map(
      (column) =>
        `${column} = COALESCE(${column}, (
          SELECT ${column} FROM works WHERE id = ? AND library_id = ?
        ))`,
    );
    const changed = await this.db.run(
      `UPDATE works SET ${sets.join(", ")},
         starred = CASE WHEN (
           SELECT starred FROM works WHERE id = ? AND library_id = ?
         ) = 1 THEN 1 ELSE starred END,
         updated_at = ?
       WHERE id = ? AND library_id = ?`,
      [
        ...columns.flatMap(() => [duplicateId, this.libraryId]),
        duplicateId,
        this.libraryId,
        now,
        primaryId,
        this.libraryId,
      ],
    );
    this.assertChanged(changed, `Primary work ${primaryId} could not be updated`);
  }

  private async mergeAuthorsIfPrimaryEmpty(primaryId: string, duplicateId: string): Promise<void> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM work_authors WHERE work_id = ?`,
      [primaryId],
    );
    if ((rows[0]?.n ?? 0) > 0) return;
    const expected = await this.countRows(
      `SELECT COUNT(*) AS n FROM work_authors WHERE work_id = ?`,
      [duplicateId],
    );
    const changed = await this.db.run(`UPDATE work_authors SET work_id = ? WHERE work_id = ?`, [
      primaryId,
      duplicateId,
    ]);
    this.assertChangedExactly(changed, expected, "Work authors could not be merged");
  }

  private async mergeCollections(primaryId: string, duplicateId: string): Promise<void> {
    // Backups and older databases can contain more than one folder membership
    // even though today's Library UI presents a single-folder move. Preserve
    // every valid membership during deduplication instead of silently dropping
    // all but one. A later explicit folder move can normalize the union.
    const memberships = await this.db.query<{ collection_id: string }>(
      `SELECT ci.collection_id
       FROM collection_items ci
       JOIN collections c
         ON c.id = ci.collection_id
        AND c.library_id = ?
        AND c.deleted_at IS NULL
       WHERE ci.work_id = ?`,
      [this.libraryId, duplicateId],
    );
    await this.db.run(
      `INSERT OR IGNORE INTO collection_items (collection_id, work_id)
       SELECT ci.collection_id, ?
       FROM collection_items ci
       JOIN collections c
         ON c.id = ci.collection_id
        AND c.library_id = ?
        AND c.deleted_at IS NULL
       WHERE ci.work_id = ?`,
      [primaryId, this.libraryId, duplicateId],
    );
    if (memberships.length > 0) {
      const placeholders = memberships.map(() => "?").join(",");
      const preserved = await this.countRows(
        `SELECT COUNT(*) AS n
         FROM collection_items
         WHERE work_id = ? AND collection_id IN (${placeholders})`,
        [primaryId, ...memberships.map((row) => row.collection_id)],
      );
      if (preserved !== memberships.length) {
        throw new Error("Collection memberships could not be merged");
      }
    }
    await this.db.run(`DELETE FROM collection_items WHERE work_id = ?`, [duplicateId]);
    const residual = await this.countRows(
      `SELECT COUNT(*) AS n FROM collection_items WHERE work_id = ?`,
      [duplicateId],
    );
    if (residual !== 0) throw new Error("Duplicate collection memberships could not be retired");
  }

  private async moveTags(primaryId: string, duplicateId: string): Promise<void> {
    const tags = await this.db.query<{ tag_id: string }>(
      `SELECT wt.tag_id
       FROM work_tags wt
       JOIN tags t
         ON t.id = wt.tag_id
        AND t.library_id = ?
        AND t.deleted_at IS NULL
       WHERE wt.work_id = ?`,
      [this.libraryId, duplicateId],
    );
    await this.db.run(
      `INSERT OR IGNORE INTO work_tags (work_id, tag_id)
       SELECT ?, wt.tag_id
       FROM work_tags wt
       JOIN tags t
         ON t.id = wt.tag_id
        AND t.library_id = ?
        AND t.deleted_at IS NULL
       WHERE wt.work_id = ?`,
      [primaryId, this.libraryId, duplicateId],
    );
    if (tags.length > 0) {
      const placeholders = tags.map(() => "?").join(",");
      const preserved = await this.countRows(
        `SELECT COUNT(*) AS n
         FROM work_tags
         WHERE work_id = ? AND tag_id IN (${placeholders})`,
        [primaryId, ...tags.map((row) => row.tag_id)],
      );
      if (preserved !== tags.length) throw new Error("Work tags could not be merged");
    }
    await this.db.run(`DELETE FROM work_tags WHERE work_id = ?`, [duplicateId]);
    const residual = await this.countRows(`SELECT COUNT(*) AS n FROM work_tags WHERE work_id = ?`, [
      duplicateId,
    ]);
    if (residual !== 0) throw new Error("Duplicate work tags could not be retired");
  }

  private async moveCitations(primaryId: string, duplicateId: string): Promise<void> {
    const rows = await this.db.query<{
      citing_work_id: string;
      cited_work_id: string;
      source: string;
    }>(
      `SELECT c.citing_work_id, c.cited_work_id, c.source
       FROM citations c
       JOIN works citing
         ON citing.id = c.citing_work_id
        AND citing.library_id = ?
       JOIN works cited
         ON cited.id = c.cited_work_id
        AND cited.library_id = ?
       WHERE c.citing_work_id = ? OR c.cited_work_id = ?`,
      [this.libraryId, this.libraryId, duplicateId, duplicateId],
    );
    for (const row of rows) {
      const citing = row.citing_work_id === duplicateId ? primaryId : row.citing_work_id;
      const cited = row.cited_work_id === duplicateId ? primaryId : row.cited_work_id;
      if (citing === cited) continue;
      await this.db.run(
        `INSERT OR IGNORE INTO citations (citing_work_id, cited_work_id, source)
         VALUES (?, ?, ?)`,
        [citing, cited, row.source],
      );
      const preserved = await this.countRows(
        `SELECT COUNT(*) AS n
         FROM citations
         WHERE citing_work_id = ? AND cited_work_id = ?`,
        [citing, cited],
      );
      if (preserved !== 1) throw new Error("Citation relationships could not be merged");
    }
    await this.db.run(`DELETE FROM citations WHERE citing_work_id = ? OR cited_work_id = ?`, [
      duplicateId,
      duplicateId,
    ]);
    const residual = await this.countRows(
      `SELECT COUNT(*) AS n
       FROM citations
       WHERE citing_work_id = ? OR cited_work_id = ?`,
      [duplicateId, duplicateId],
    );
    if (residual !== 0) throw new Error("Duplicate citations could not be retired");
  }

  private async moveGraphCache(primaryId: string, duplicateId: string): Promise<void> {
    const primaryRows = await this.db.query<{ work_id: string }>(
      `SELECT work_id FROM graph_cache WHERE work_id = ?`,
      [primaryId],
    );
    const duplicateRows = await this.db.query<{ work_id: string }>(
      `SELECT work_id FROM graph_cache WHERE work_id = ?`,
      [duplicateId],
    );
    if (!duplicateRows[0]) return;
    if (primaryRows[0]) {
      const changed = await this.db.run(`DELETE FROM graph_cache WHERE work_id = ?`, [duplicateId]);
      this.assertChangedExactly(changed, 1, "Duplicate graph cache could not be retired");
    } else {
      const changed = await this.db.run(`UPDATE graph_cache SET work_id = ? WHERE work_id = ?`, [
        primaryId,
        duplicateId,
      ]);
      this.assertChangedExactly(changed, 1, "Graph cache could not be merged");
    }
  }

  private async moveCanvasReferences(
    primaryId: string,
    duplicateId: string,
    now: number,
  ): Promise<void> {
    // Keep both representations in lockstep. `work_id` provides referential
    // integrity, while paper/excerpt payloads use data.workId to open Reader.
    // These statements run inside mergeInto's transaction, so a later merge
    // failure rolls the canvas changes back with every other moved reference.
    const workReferenceCount = await this.countRows(
      `SELECT COUNT(*) AS n
       FROM canvas_nodes
       WHERE work_id = ?
         AND EXISTS (
           SELECT 1
           FROM canvas_workspaces
           WHERE id = canvas_nodes.workspace_id AND library_id = ?
         )`,
      [duplicateId, this.libraryId],
    );
    const movedWorkReferences = await this.db.run(
      `UPDATE canvas_nodes
       SET work_id = ?, updated_at = ?
       WHERE work_id = ?
         AND EXISTS (
           SELECT 1
           FROM canvas_workspaces
           WHERE id = canvas_nodes.workspace_id AND library_id = ?
         )`,
      [primaryId, now, duplicateId, this.libraryId],
    );
    this.assertChangedExactly(
      movedWorkReferences,
      workReferenceCount,
      "Canvas work references could not be merged",
    );
    const payloadReferenceCount = await this.countRows(
      `SELECT COUNT(*) AS n
       FROM canvas_nodes
       WHERE type IN ('paper', 'excerpt')
         AND json_valid(data_json)
         AND json_extract(data_json, '$.workId') = ?
         AND EXISTS (
           SELECT 1
           FROM canvas_workspaces
           WHERE id = canvas_nodes.workspace_id AND library_id = ?
         )`,
      [duplicateId, this.libraryId],
    );
    const movedPayloadReferences = await this.db.run(
      `UPDATE canvas_nodes
       SET data_json = json_set(data_json, '$.workId', ?), updated_at = ?
       WHERE type IN ('paper', 'excerpt')
         AND json_valid(data_json)
         AND json_extract(data_json, '$.workId') = ?
         AND EXISTS (
           SELECT 1
           FROM canvas_workspaces
           WHERE id = canvas_nodes.workspace_id AND library_id = ?
         )`,
      [primaryId, now, duplicateId, this.libraryId],
    );
    this.assertChangedExactly(
      movedPayloadReferences,
      payloadReferenceCount,
      "Canvas payload references could not be merged",
    );
  }

  /**
   * Replaces a work's editable metadata (and, when provided, its full author
   * list). Used by the metadata editor. Only keys present on the patch are
   * written, so partial saves don't clobber untouched fields.
   */
  async update(id: string, patch: WorkPatch): Promise<void> {
    return this.withWriteLock(() => this.updateUnlocked(id, patch));
  }

  private async updateUnlocked(id: string, patch: WorkPatch): Promise<void> {
    const now = Date.now();
    const needsFingerprint =
      patch.title !== undefined || patch.year !== undefined || patch.authors !== undefined;
    const sets: string[] = [];
    const params: unknown[] = [];
    const scalar: Array<[keyof WorkPatch, string]> = [
      ["doi", "doi"],
      ["title", "title"],
      ["type", "type"],
      ["notesMd", "notes_md"],
    ];
    for (const [key, col] of scalar) {
      if (patch[key] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(key === "doi" ? inputDoi(patch) : patch[key]);
      }
    }
    for (const [key, col] of RICH_COLUMNS) {
      if (patch[key] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(patch[key]);
      }
    }
    if (patch.keywords !== undefined) {
      sets.push(`keywords_json = ?`);
      params.push(patch.keywords?.length ? JSON.stringify(patch.keywords) : null);
    }
    if (needsFingerprint) {
      const currentRows = await this.db.query<WorkRow>(
        `SELECT *
         FROM works
         WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
        [id, this.libraryId],
      );
      const current = currentRows[0];
      if (!current) throw new Error(`Work ${id} is missing or removed`);
      const nextTitle = patch.title ?? current.title;
      const nextYear = patch.year !== undefined ? (patch.year ?? null) : current.year;
      const currentAuthors =
        patch.authors ??
        (await this.authorsOf(id)).map((author) => ({
          displayName: author.displayName,
          orcid: author.orcid ?? undefined,
          position: author.position,
          role: author.role as AuthorRole,
        }));
      const firstAuthor = currentAuthors[0]?.displayName?.split(/\s+/).pop() ?? null;
      sets.push(`fingerprint = ?`);
      params.push(workFingerprint(nextTitle, nextYear, firstAuthor));
    }

    await this.db.exec("BEGIN");
    try {
      if (sets.length > 0) {
        const changed = await this.db.run(
          `UPDATE works
           SET ${sets.join(", ")}, updated_at = ?
           WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
          [...params, now, id, this.libraryId],
        );
        this.assertChanged(changed, `Work ${id} is missing or removed`);
      }

      if (patch.authors) {
        await this.db.run(`DELETE FROM work_authors WHERE work_id = ?`, [id]);
        for (const author of patch.authors) {
          const authorId = await this.upsertAuthor(author.displayName, author.orcid);
          await this.db.run(
            `INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)`,
            [id, authorId, author.position, author.displayName, author.role ?? "author"],
          );
        }
      }
      await this.db.exec("COMMIT");
    } catch (e) {
      await this.db.exec("ROLLBACK");
      throw e;
    }
  }

  async setReadingStatus(id: string, status: ReadingStatus): Promise<void> {
    return this.withWriteLock(() => this.setReadingStatusUnlocked(id, status));
  }

  async markReadingStarted(id: string): Promise<boolean> {
    return this.withWriteLock(async () => {
      const changed = await this.db.run(
        `UPDATE works
         SET reading_status = 'reading', updated_at = ?
         WHERE id = ? AND library_id = ? AND deleted_at IS NULL AND reading_status = 'unread'`,
        [Date.now(), id, this.libraryId],
      );
      return changed > 0;
    });
  }

  private async setReadingStatusUnlocked(id: string, status: ReadingStatus): Promise<void> {
    if (!["unread", "reading", "read"].includes(status)) {
      throw new Error("阅读状态无效");
    }
    const changed = await this.db.run(
      `UPDATE works
       SET reading_status = ?, updated_at = ?
       WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
      [status, Date.now(), id, this.libraryId],
    );
    this.assertChanged(changed, `Work ${id} is missing or removed`);
  }

  async setStarred(id: string, starred: boolean): Promise<void> {
    return this.withWriteLock(() => this.setStarredUnlocked(id, starred));
  }

  private async setStarredUnlocked(id: string, starred: boolean): Promise<void> {
    const changed = await this.db.run(
      `UPDATE works
       SET starred = ?, updated_at = ?
       WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
      [starred ? 1 : 0, Date.now(), id, this.libraryId],
    );
    this.assertChanged(changed, `Work ${id} is missing or removed`);
  }

  private async upsertAuthor(displayName: string, orcid?: string): Promise<string> {
    if (orcid) {
      const hit = await this.db.query<{ id: string }>(
        `SELECT id FROM authors WHERE library_id = ? AND orcid = ?`,
        [this.libraryId, orcid],
      );
      if (hit.length > 0) return hit[0]!.id;
      const id = newId();
      const now = Date.now();
      await this.db.run(
        `INSERT OR IGNORE INTO authors
           (id, library_id, display_name, orcid, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, this.libraryId, displayName, orcid, now, now],
      );
      const rows = await this.db.query<{ id: string }>(
        `SELECT id FROM authors WHERE library_id = ? AND orcid = ?`,
        [this.libraryId, orcid],
      );
      return rows[0]?.id ?? id;
    }
    const id = newId();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO authors
         (id, library_id, display_name, orcid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, this.libraryId, displayName, orcid ?? null, now, now],
    );
    return id;
  }

  async list(opts?: {
    search?: string;
    limit?: number;
    collectionId?: string;
  }): Promise<WorkWithAuthors[]> {
    const limit = opts?.limit ?? 200;
    const collectionJoin = opts?.collectionId
      ? `JOIN collection_items ci ON ci.work_id = w.id AND ci.collection_id = ?
         JOIN collections c
           ON c.id = ci.collection_id
          AND c.library_id = w.library_id
          AND c.deleted_at IS NULL`
      : "";
    const collectionParams = opts?.collectionId ? [opts.collectionId] : [];
    let rows: WorkRow[];
    if (opts?.search?.trim()) {
      const ftsQuery = buildWorksFtsQuery(opts.search);
      rows = ftsQuery
        ? await this.db.query<WorkRow>(
            `SELECT w.* FROM works w
             JOIN works_fts f ON f.rowid = w.rowid
             ${collectionJoin}
             WHERE works_fts MATCH ? AND w.library_id = ? AND w.deleted_at IS NULL
             ORDER BY rank LIMIT ?`,
            [...collectionParams, ftsQuery, this.libraryId, limit],
          )
        : [];
    } else {
      rows = await this.db.query<WorkRow>(
        `SELECT w.* FROM works w
         ${collectionJoin}
         WHERE w.library_id = ? AND w.deleted_at IS NULL
         ORDER BY w.created_at DESC LIMIT ?`,
        [...collectionParams, this.libraryId, limit],
      );
    }
    return this.attachAuthors(rows);
  }

  async listDeleted(opts?: { search?: string; limit?: number }): Promise<WorkWithAuthors[]> {
    const limit = opts?.limit ?? 200;
    let rows: WorkRow[];
    if (opts?.search?.trim()) {
      const ftsQuery = buildWorksFtsQuery(opts.search);
      rows = ftsQuery
        ? await this.db.query<WorkRow>(
            `SELECT w.* FROM works w
             JOIN works_fts f ON f.rowid = w.rowid
             WHERE works_fts MATCH ? AND w.library_id = ? AND w.deleted_at IS NOT NULL
             ORDER BY rank LIMIT ?`,
            [ftsQuery, this.libraryId, limit],
          )
        : [];
    } else {
      rows = await this.db.query<WorkRow>(
        `SELECT w.* FROM works w
         WHERE w.library_id = ? AND w.deleted_at IS NOT NULL
         ORDER BY w.deleted_at DESC, w.updated_at DESC LIMIT ?`,
        [this.libraryId, limit],
      );
    }
    return this.attachAuthors(rows);
  }

  async get(id: string): Promise<WorkWithAuthors | null> {
    const rows = await this.db.query<WorkRow>(
      `SELECT * FROM works WHERE id = ? AND library_id = ?`,
      [id, this.libraryId],
    );
    if (rows.length === 0) return null;
    const [withAuthors] = await this.attachAuthors(rows);
    return withAuthors ?? null;
  }

  /** Find a non-deleted work by DOI (normalized), for import-time dedup. */
  async findByDoi(doi: string): Promise<WorkRow | null> {
    const normalized = normalizeDoi(doi) ?? doi.trim().toLowerCase();
    if (!normalized) return null;
    const rows = await this.db.query<WorkRow>(
      `SELECT *
       FROM works
       WHERE library_id = ? AND doi = ? AND deleted_at IS NULL
       LIMIT 1`,
      [this.libraryId, normalized],
    );
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    return this.withWriteLock(() => this.softDeleteUnlocked(id));
  }

  async softDeleteMany(ids: string[]): Promise<number> {
    return this.withWriteLock(() => this.softDeleteManyUnlocked(ids));
  }

  private async softDeleteUnlocked(id: string): Promise<void> {
    const now = Date.now();
    const changed = await this.db.run(
      `UPDATE works
       SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
      [now, now, id, this.libraryId],
    );
    this.assertChanged(changed, `Work ${id} is missing or already removed`);
  }

  private async softDeleteManyUnlocked(ids: string[]): Promise<number> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return 0;
    const savepoint = `works_soft_delete_many_${newId().replace(/-/g, "_")}`;
    await this.withSavepoint(savepoint, async () => {
      for (const id of uniqueIds) {
        await this.softDeleteUnlocked(id);
      }
    });
    return uniqueIds.length;
  }

  async restore(id: string): Promise<void> {
    return this.withWriteLock(() => this.restoreUnlocked(id));
  }

  async restoreMany(ids: string[]): Promise<number> {
    return this.withWriteLock(() => this.restoreManyUnlocked(ids));
  }

  private async restoreUnlocked(id: string): Promise<void> {
    const changed = await this.db.run(
      `UPDATE works
       SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND library_id = ? AND deleted_at IS NOT NULL`,
      [Date.now(), id, this.libraryId],
    );
    this.assertChanged(changed, `Work ${id} is missing or already active`);
  }

  private async restoreManyUnlocked(ids: string[]): Promise<number> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return 0;
    const savepoint = `works_restore_many_${newId().replace(/-/g, "_")}`;
    await this.withSavepoint(savepoint, async () => {
      for (const id of uniqueIds) {
        await this.restoreUnlocked(id);
      }
    });
    return uniqueIds.length;
  }

  /** Permanently removes a recycled Work; shared content-addressed blobs remain on disk. */
  async purgeDeleted(id: string): Promise<void> {
    await this.purgeDeletedMany([id]);
  }

  /** Permanently removes multiple recycle-bin works in a single transaction. */
  async purgeDeletedMany(ids: string[]): Promise<number> {
    return this.withWriteLock(() => this.purgeDeletedManyUnlocked(ids));
  }

  private async purgeDeletedManyUnlocked(ids: string[]): Promise<number> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return 0;
    const placeholders = uniqueIds.map(() => "?").join(",");
    const targets = await this.db.query<{ id: string }>(
      `SELECT id
       FROM works
       WHERE library_id = ? AND id IN (${placeholders}) AND deleted_at IS NOT NULL
       ORDER BY id`,
      [this.libraryId, ...uniqueIds],
    );
    if (targets.length === 0) return 0;

    const savepoint = `works_purge_deleted_many_${newId().replace(/-/g, "_")}`;
    await this.withSavepoint(savepoint, async () => {
      for (const { id } of targets) {
        await this.purgeWorkArtifacts(id);
        const changed = await this.db.run(`DELETE FROM works WHERE id = ? AND library_id = ?`, [
          id,
          this.libraryId,
        ]);
        this.assertChanged(changed, `Work ${id} could not be permanently removed`);
      }
    });
    return targets.length;
  }

  /** Full author list with roles, ordered by position — for the editor. */
  async authorsOf(workId: string): Promise<WorkAuthorDetail[]> {
    return this.db.query<WorkAuthorDetail>(
      `SELECT a.display_name AS displayName, a.orcid AS orcid, wa.position AS position, wa.role AS role
       FROM work_authors wa
       JOIN authors a ON a.id = wa.author_id AND a.library_id = ?
       JOIN works w ON w.id = wa.work_id AND w.library_id = a.library_id
       WHERE wa.work_id = ?
       ORDER BY wa.position`,
      [this.libraryId, workId],
    );
  }

  private async attachAuthors(rows: WorkRow[]): Promise<WorkWithAuthors[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const authorRows = await this.db.query<{
      work_id: string;
      display_name: string;
      position: number;
    }>(
      `SELECT wa.work_id, a.display_name, wa.position
       FROM work_authors wa
       JOIN authors a ON a.id = wa.author_id AND a.library_id = ?
       WHERE wa.work_id IN (${placeholders})
       ORDER BY wa.position`,
      [this.libraryId, ...ids],
    );
    const byWork = new Map<string, string[]>();
    for (const ar of authorRows) {
      const list = byWork.get(ar.work_id) ?? [];
      list.push(ar.display_name);
      byWork.set(ar.work_id, list);
    }
    return rows.map((r) => ({ ...r, authorNames: byWork.get(r.id) ?? [] }));
  }

  private async purgeWorkArtifacts(workId: string): Promise<void> {
    const [attachmentRows, annotationRows, flashcardRows, snippetRows, taskRows, aiJobRows] =
      await Promise.all([
        this.db.query<{ id: string }>(`SELECT id FROM attachments WHERE work_id = ?`, [workId]),
        this.db.query<{ id: string }>(`SELECT id FROM annotations WHERE work_id = ?`, [workId]),
        this.db.query<{ id: string }>(`SELECT id FROM flashcards WHERE work_id = ?`, [workId]),
        this.db.query<{ id: string }>(`SELECT id FROM snippets WHERE work_id = ?`, [workId]),
        this.db.query<{ id: string }>(
          `SELECT id FROM sentinel_tasks WHERE work_id = ? AND library_id = ?`,
          [workId, this.libraryId],
        ),
        this.db.query<{ id: string }>(
          `SELECT id FROM ai_jobs WHERE work_id = ? AND library_id = ?`,
          [workId, this.libraryId],
        ),
      ]);

    const attachmentIds = attachmentRows.map((row) => row.id);
    const annotationIds = annotationRows.map((row) => row.id);
    const flashcardIds = flashcardRows.map((row) => row.id);
    const snippetIds = snippetRows.map((row) => row.id);
    const taskIds = taskRows.map((row) => row.id);
    const aiJobIds = aiJobRows.map((row) => row.id);

    await this.deleteWhereIn("annotation_comments", "annotation_id", annotationIds);
    await this.deleteWhereIn("flashcard_reviews", "flashcard_id", flashcardIds);
    await this.deleteWhereIn("flashcard_srs", "flashcard_id", flashcardIds);
    await this.deleteWhereIn("sentinel_events", "task_id", taskIds);

    await this.deleteDerivedArtifacts("attachments", attachmentIds);
    await this.deleteDerivedArtifacts("annotations", annotationIds);
    await this.deleteDerivedArtifacts("flashcards", flashcardIds);
    await this.deleteDerivedArtifacts("snippets", snippetIds);
    await this.deleteDerivedArtifacts("sentinel_tasks", taskIds);
    await this.deleteDerivedArtifacts("ai_jobs", aiJobIds);
    await this.deleteDerivedArtifacts("works", [workId]);

    await this.deleteRowClocks("attachments", attachmentIds);
    await this.deleteRowClocks("annotations", annotationIds);
    await this.deleteRowClocks("flashcards", flashcardIds);
    await this.deleteRowClocks("snippets", snippetIds);
    await this.deleteRowClocks("sentinel_tasks", taskIds);
    await this.deleteRowClocks("ai_jobs", aiJobIds);
    await this.deleteRowClocks("works", [workId]);

    await this.db.run(`DELETE FROM citations WHERE citing_work_id = ? OR cited_work_id = ?`, [
      workId,
      workId,
    ]);
    await this.db.run(`DELETE FROM graph_cache WHERE work_id = ?`, [workId]);
    await this.db.run(`DELETE FROM collection_items WHERE work_id = ?`, [workId]);
    await purgeProjectWorkMemberships(this.db, workId);
    await purgeWorkKnowledgeRecords(this.db, this.libraryId, workId);
    await this.db.run(`DELETE FROM work_tags WHERE work_id = ?`, [workId]);
    await this.db.run(`DELETE FROM work_authors WHERE work_id = ?`, [workId]);
    await this.db.run(`DELETE FROM annotations WHERE work_id = ?`, [workId]);
    await this.db.run(`DELETE FROM attachments WHERE work_id = ?`, [workId]);
    await this.db.run(`DELETE FROM flashcards WHERE work_id = ?`, [workId]);
    await this.db.run(`DELETE FROM snippets WHERE work_id = ?`, [workId]);
    await this.db.run(`DELETE FROM sentinel_tasks WHERE work_id = ? AND library_id = ?`, [
      workId,
      this.libraryId,
    ]);
    await this.db.run(`DELETE FROM ai_jobs WHERE work_id = ? AND library_id = ?`, [
      workId,
      this.libraryId,
    ]);
  }

  private async deleteDerivedArtifacts(sourceTable: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    await this.db.run(
      `DELETE FROM derived_artifacts
       WHERE library_id = ? AND source_table = ? AND source_id IN (${placeholders})`,
      [this.libraryId, sourceTable, ...ids],
    );
  }

  private async deleteRowClocks(tableName: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    await this.db.run(
      `DELETE FROM sync_row_clocks
       WHERE library_id = ? AND table_name = ? AND row_id IN (${placeholders})`,
      [this.libraryId, tableName, ...ids],
    );
  }

  private async deleteWhereIn(table: string, column: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    await this.db.run(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`, ids);
  }
}
