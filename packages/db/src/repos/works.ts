import type { Database } from "../database.js";
import { buildWorksFtsQuery } from "../fts.js";
import { newId, normalizeDoi, workFingerprint } from "../ids.js";

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

export interface WorkBatchOptions {
  afterEach?: (workId: string, index: number) => void | Promise<void>;
}

const workWriteQueues = new WeakMap<Database, Promise<void>>();

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

function isUniqueConstraint(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown };
  return (
    e.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    String(e.message ?? "").includes("UNIQUE constraint failed")
  );
}

export class WorksRepo {
  constructor(private readonly db: Database) {}

  private assertChanged(changed: number, message: string): void {
    if (changed === 0) throw new Error(message);
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
    const previous = workWriteQueues.get(this.db) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(fn);
    workWriteQueues.set(
      this.db,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
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
    const cols = ["id", "doi", "title", "type", "fingerprint", "csl_json", "keywords_json"];
    const vals: unknown[] = [
      id,
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

    const primary = await this.db.query<{ id: string }>(
      `SELECT id FROM works WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [primaryId],
    );
    if (primary.length === 0) throw new Error("主文献不存在或已删除");

    let merged = 0;
    let movedAttachments = 0;
    const now = Date.now();
    await this.db.exec("BEGIN");
    try {
      for (const duplicateId of duplicates) {
        const exists = await this.db.query<{ id: string }>(
          `SELECT id FROM works WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
          [duplicateId],
        );
        if (exists.length === 0) continue;
        movedAttachments += await this.mergeOneDuplicate(primaryId, duplicateId, now);
        merged++;
      }
      await this.db.exec("COMMIT");
    } catch (e) {
      await this.db.exec("ROLLBACK");
      throw e;
    }

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
       WHERE ${column} = ?
       ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
      [value],
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
    await this.db.run(`UPDATE works SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, [
      ...params,
      now,
      id,
    ]);
  }

  private async mergeOneDuplicate(
    primaryId: string,
    duplicateId: string,
    now: number,
  ): Promise<number> {
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
        await this.db.run(
          `UPDATE annotations SET attachment_id = ?, work_id = ?, updated_at = ?
           WHERE attachment_id = ?`,
          [existing[0].id, primaryId, now, attachment.id],
        );
        await this.db.run(`UPDATE attachments SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
          now,
          now,
          attachment.id,
        ]);
      } else {
        await this.db.run(`UPDATE attachments SET work_id = ?, updated_at = ? WHERE id = ?`, [
          primaryId,
          now,
          attachment.id,
        ]);
        await this.db.run(
          `UPDATE annotations SET work_id = ?, updated_at = ? WHERE attachment_id = ?`,
          [primaryId, now, attachment.id],
        );
        movedAttachments++;
      }
    }

    await this.mergeCollection(primaryId, duplicateId);
    await this.moveTags(primaryId, duplicateId);
    await this.moveCitations(primaryId, duplicateId);
    await this.moveGraphCache(primaryId, duplicateId);

    for (const table of ["annotations", "flashcards", "snippets", "sentinel_tasks", "ai_jobs"]) {
      await this.db.run(`UPDATE ${table} SET work_id = ?, updated_at = ? WHERE work_id = ?`, [
        primaryId,
        now,
        duplicateId,
      ]);
    }
    await this.db.run(
      `UPDATE derived_artifacts SET source_id = ?, updated_at = ?
       WHERE source_table = 'works' AND source_id = ?`,
      [primaryId, now, duplicateId],
    );
    await this.db.run(`UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      now,
      now,
      duplicateId,
    ]);

    return movedAttachments;
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
      (column) => `${column} = COALESCE(${column}, (SELECT ${column} FROM works WHERE id = ?))`,
    );
    await this.db.run(
      `UPDATE works SET ${sets.join(", ")},
         starred = CASE WHEN (SELECT starred FROM works WHERE id = ?) = 1 THEN 1 ELSE starred END,
         updated_at = ?
       WHERE id = ?`,
      [...columns.map(() => duplicateId), duplicateId, now, primaryId],
    );
  }

  private async mergeAuthorsIfPrimaryEmpty(primaryId: string, duplicateId: string): Promise<void> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM work_authors WHERE work_id = ?`,
      [primaryId],
    );
    if ((rows[0]?.n ?? 0) > 0) return;
    await this.db.run(`UPDATE work_authors SET work_id = ? WHERE work_id = ?`, [
      primaryId,
      duplicateId,
    ]);
  }

  private async mergeCollection(primaryId: string, duplicateId: string): Promise<void> {
    const primaryRows = await this.db.query<{ collection_id: string }>(
      `SELECT collection_id FROM collection_items WHERE work_id = ? LIMIT 1`,
      [primaryId],
    );
    if (!primaryRows[0]) {
      await this.db.run(
        `INSERT OR IGNORE INTO collection_items (collection_id, work_id)
         SELECT collection_id, ? FROM collection_items WHERE work_id = ? LIMIT 1`,
        [primaryId, duplicateId],
      );
    }
    await this.db.run(`DELETE FROM collection_items WHERE work_id = ?`, [duplicateId]);
  }

  private async moveTags(primaryId: string, duplicateId: string): Promise<void> {
    await this.db.run(
      `INSERT OR IGNORE INTO work_tags (work_id, tag_id)
       SELECT ?, tag_id FROM work_tags WHERE work_id = ?`,
      [primaryId, duplicateId],
    );
    await this.db.run(`DELETE FROM work_tags WHERE work_id = ?`, [duplicateId]);
  }

  private async moveCitations(primaryId: string, duplicateId: string): Promise<void> {
    const rows = await this.db.query<{
      citing_work_id: string;
      cited_work_id: string;
      source: string;
    }>(
      `SELECT citing_work_id, cited_work_id, source FROM citations
       WHERE citing_work_id = ? OR cited_work_id = ?`,
      [duplicateId, duplicateId],
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
    }
    await this.db.run(`DELETE FROM citations WHERE citing_work_id = ? OR cited_work_id = ?`, [
      duplicateId,
      duplicateId,
    ]);
  }

  private async moveGraphCache(primaryId: string, duplicateId: string): Promise<void> {
    const primaryRows = await this.db.query<{ work_id: string }>(
      `SELECT work_id FROM graph_cache WHERE work_id = ?`,
      [primaryId],
    );
    if (primaryRows[0]) {
      await this.db.run(`DELETE FROM graph_cache WHERE work_id = ?`, [duplicateId]);
    } else {
      await this.db.run(`UPDATE graph_cache SET work_id = ? WHERE work_id = ?`, [
        primaryId,
        duplicateId,
      ]);
    }
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
        `SELECT * FROM works WHERE id = ? AND deleted_at IS NULL`,
        [id],
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
          `UPDATE works SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
          [...params, now, id],
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
         WHERE id = ? AND deleted_at IS NULL AND reading_status = 'unread'`,
        [Date.now(), id],
      );
      return changed > 0;
    });
  }

  private async setReadingStatusUnlocked(id: string, status: ReadingStatus): Promise<void> {
    if (!["unread", "reading", "read"].includes(status)) {
      throw new Error("阅读状态无效");
    }
    const changed = await this.db.run(
      `UPDATE works SET reading_status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [status, Date.now(), id],
    );
    this.assertChanged(changed, `Work ${id} is missing or removed`);
  }

  async setStarred(id: string, starred: boolean): Promise<void> {
    return this.withWriteLock(() => this.setStarredUnlocked(id, starred));
  }

  private async setStarredUnlocked(id: string, starred: boolean): Promise<void> {
    const changed = await this.db.run(
      `UPDATE works SET starred = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [starred ? 1 : 0, Date.now(), id],
    );
    this.assertChanged(changed, `Work ${id} is missing or removed`);
  }

  private async upsertAuthor(displayName: string, orcid?: string): Promise<string> {
    if (orcid) {
      const hit = await this.db.query<{ id: string }>(`SELECT id FROM authors WHERE orcid = ?`, [
        orcid,
      ]);
      if (hit.length > 0) return hit[0]!.id;
      const id = newId();
      const now = Date.now();
      await this.db.run(
        `INSERT OR IGNORE INTO authors (id, display_name, orcid, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [id, displayName, orcid, now, now],
      );
      const rows = await this.db.query<{ id: string }>(`SELECT id FROM authors WHERE orcid = ?`, [
        orcid,
      ]);
      return rows[0]?.id ?? id;
    }
    const id = newId();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO authors (id, display_name, orcid, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [id, displayName, orcid ?? null, now, now],
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
         JOIN collections c ON c.id = ci.collection_id AND c.deleted_at IS NULL`
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
             WHERE works_fts MATCH ? AND w.deleted_at IS NULL
             ORDER BY rank LIMIT ?`,
            [...collectionParams, ftsQuery, limit],
          )
        : [];
    } else {
      rows = await this.db.query<WorkRow>(
        `SELECT w.* FROM works w
         ${collectionJoin}
         WHERE w.deleted_at IS NULL ORDER BY w.created_at DESC LIMIT ?`,
        [...collectionParams, limit],
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
             WHERE works_fts MATCH ? AND w.deleted_at IS NOT NULL
             ORDER BY rank LIMIT ?`,
            [ftsQuery, limit],
          )
        : [];
    } else {
      rows = await this.db.query<WorkRow>(
        `SELECT w.* FROM works w
         WHERE w.deleted_at IS NOT NULL ORDER BY w.deleted_at DESC, w.updated_at DESC LIMIT ?`,
        [limit],
      );
    }
    return this.attachAuthors(rows);
  }

  async get(id: string): Promise<WorkWithAuthors | null> {
    const rows = await this.db.query<WorkRow>(`SELECT * FROM works WHERE id = ?`, [id]);
    if (rows.length === 0) return null;
    const [withAuthors] = await this.attachAuthors(rows);
    return withAuthors ?? null;
  }

  /** Find a non-deleted work by DOI (normalized), for import-time dedup. */
  async findByDoi(doi: string): Promise<WorkRow | null> {
    const normalized = normalizeDoi(doi) ?? doi.trim().toLowerCase();
    if (!normalized) return null;
    const rows = await this.db.query<WorkRow>(
      `SELECT * FROM works WHERE doi = ? AND deleted_at IS NULL LIMIT 1`,
      [normalized],
    );
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    return this.withWriteLock(() => this.softDeleteUnlocked(id));
  }

  async softDeleteMany(ids: string[], options: WorkBatchOptions = {}): Promise<number> {
    return this.withWriteLock(() => this.softDeleteManyUnlocked(ids, options));
  }

  private async softDeleteUnlocked(id: string): Promise<void> {
    const now = Date.now();
    const changed = await this.db.run(
      `UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    this.assertChanged(changed, `Work ${id} is missing or already removed`);
  }

  private async softDeleteManyUnlocked(
    ids: string[],
    options: WorkBatchOptions = {},
  ): Promise<number> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return 0;
    const savepoint = `works_soft_delete_many_${newId().replace(/-/g, "_")}`;
    await this.withSavepoint(savepoint, async () => {
      for (let index = 0; index < uniqueIds.length; index += 1) {
        const id = uniqueIds[index]!;
        await this.softDeleteUnlocked(id);
        await options.afterEach?.(id, index);
      }
    });
    return uniqueIds.length;
  }

  async restore(id: string): Promise<void> {
    return this.withWriteLock(() => this.restoreUnlocked(id));
  }

  async restoreMany(ids: string[], options: WorkBatchOptions = {}): Promise<number> {
    return this.withWriteLock(() => this.restoreManyUnlocked(ids, options));
  }

  private async restoreUnlocked(id: string): Promise<void> {
    const changed = await this.db.run(
      `UPDATE works SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`,
      [Date.now(), id],
    );
    this.assertChanged(changed, `Work ${id} is missing or already active`);
  }

  private async restoreManyUnlocked(
    ids: string[],
    options: WorkBatchOptions = {},
  ): Promise<number> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return 0;
    const savepoint = `works_restore_many_${newId().replace(/-/g, "_")}`;
    await this.withSavepoint(savepoint, async () => {
      for (let index = 0; index < uniqueIds.length; index += 1) {
        const id = uniqueIds[index]!;
        await this.restoreUnlocked(id);
        await options.afterEach?.(id, index);
      }
    });
    return uniqueIds.length;
  }

  /**
   * Permanently removes a work that is already in the recycle bin.
   * Blob files stay on disk because attachments are content-addressed and may
   * be shared; a future blob compactor can remove unreferenced files safely.
   */
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
      `SELECT id FROM works WHERE id IN (${placeholders}) AND deleted_at IS NOT NULL ORDER BY id`,
      uniqueIds,
    );
    if (targets.length === 0) return 0;

    await this.db.exec("BEGIN");
    try {
      for (const { id } of targets) {
        await this.purgeWorkArtifacts(id);
        await this.db.run(`DELETE FROM works WHERE id = ?`, [id]);
      }
      await this.db.exec("COMMIT");
    } catch (e) {
      await this.db.exec("ROLLBACK");
      throw e;
    }
    return targets.length;
  }

  /** Full author list with roles, ordered by position — for the editor. */
  async authorsOf(workId: string): Promise<WorkAuthorDetail[]> {
    return this.db.query<WorkAuthorDetail>(
      `SELECT a.display_name AS displayName, a.orcid AS orcid, wa.position AS position, wa.role AS role
       FROM work_authors wa JOIN authors a ON a.id = wa.author_id
       WHERE wa.work_id = ? ORDER BY wa.position`,
      [workId],
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
       FROM work_authors wa JOIN authors a ON a.id = wa.author_id
       WHERE wa.work_id IN (${placeholders})
       ORDER BY wa.position`,
      ids,
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
        this.db.query<{ id: string }>(`SELECT id FROM sentinel_tasks WHERE work_id = ?`, [workId]),
        this.db.query<{ id: string }>(`SELECT id FROM ai_jobs WHERE work_id = ?`, [workId]),
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
    await this.db.run(`DELETE FROM work_tags WHERE work_id = ?`, [workId]);
    await this.db.run(`DELETE FROM work_authors WHERE work_id = ?`, [workId]);
    await this.db.run(`DELETE FROM annotations WHERE work_id = ?`, [workId]);
    await this.db.run(`DELETE FROM attachments WHERE work_id = ?`, [workId]);
    await this.db.run(`DELETE FROM flashcards WHERE work_id = ?`, [workId]);
    await this.db.run(`DELETE FROM snippets WHERE work_id = ?`, [workId]);
    await this.db.run(`DELETE FROM sentinel_tasks WHERE work_id = ?`, [workId]);
    await this.db.run(`DELETE FROM ai_jobs WHERE work_id = ?`, [workId]);
  }

  private async deleteDerivedArtifacts(sourceTable: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    await this.db.run(
      `DELETE FROM derived_artifacts WHERE source_table = ? AND source_id IN (${placeholders})`,
      [sourceTable, ...ids],
    );
  }

  private async deleteRowClocks(tableName: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    await this.db.run(
      `DELETE FROM sync_row_clocks WHERE table_name = ? AND row_id IN (${placeholders})`,
      [tableName, ...ids],
    );
  }

  private async deleteWhereIn(table: string, column: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    await this.db.run(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`, ids);
  }
}
