import type { Database } from "../database";
import { newId, workFingerprint } from "../ids";

export type AuthorRole = "author" | "editor" | "translator";

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
  ["pmid", "pmid"],
];

/** Serializes a rich field value for SQL (keywords → JSON string). */
function richValue(input: RichBibFields, key: keyof RichBibFields): unknown {
  const v = input[key];
  return v === undefined ? null : v;
}

export class WorksRepo {
  constructor(private readonly db: Database) {}

  /**
   * Insert or merge a work. Dedup order: DOI → fingerprint. Returns the
   * existing row's id when a duplicate is found (metadata is backfilled
   * for fields the existing row is missing).
   */
  async upsert(input: WorkInput): Promise<{ id: string; deduped: boolean }> {
    const now = Date.now();
    const doi = input.doi ?? null;
    const firstAuthor = input.authors?.[0]?.displayName?.split(/\s+/).pop() ?? null;
    const fingerprint = workFingerprint(input.title, input.year ?? null, firstAuthor);

    const existing = doi
      ? await this.db.query<{ id: string }>(
          `SELECT id FROM works WHERE doi = ? AND deleted_at IS NULL`,
          [doi],
        )
      : await this.db.query<{ id: string }>(
          `SELECT id FROM works WHERE fingerprint = ? AND deleted_at IS NULL`,
          [fingerprint],
        );

    if (existing.length > 0) {
      const id = existing[0]!.id;
      // Backfill every rich column the existing row is still missing
      // (COALESCE keeps whatever is already there).
      const sets = RICH_COLUMNS.map(([, col]) => `${col} = COALESCE(${col}, ?)`);
      const params = RICH_COLUMNS.map(([key]) => richValue(input, key));
      if (input.keywords?.length) {
        sets.push(`keywords_json = COALESCE(keywords_json, ?)`);
        params.push(JSON.stringify(input.keywords));
      }
      await this.db.run(
        `UPDATE works SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`,
        [...params, now, id],
      );
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

    return { id, deduped: false };
  }

  /**
   * Replaces a work's editable metadata (and, when provided, its full author
   * list). Used by the metadata editor. Only keys present on the patch are
   * written, so partial saves don't clobber untouched fields.
   */
  async update(id: string, patch: WorkPatch): Promise<void> {
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
        params.push(patch[key]);
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
    if (sets.length > 0) {
      await this.db.run(`UPDATE works SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, [
        ...params,
        Date.now(),
        id,
      ]);
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
  }

  private async upsertAuthor(displayName: string, orcid?: string): Promise<string> {
    if (orcid) {
      const hit = await this.db.query<{ id: string }>(`SELECT id FROM authors WHERE orcid = ?`, [
        orcid,
      ]);
      if (hit.length > 0) return hit[0]!.id;
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
      ? `JOIN collection_items ci ON ci.work_id = w.id AND ci.collection_id = ?`
      : "";
    const collectionParams = opts?.collectionId ? [opts.collectionId] : [];
    let rows: WorkRow[];
    if (opts?.search?.trim()) {
      // FTS5 prefix query; quote tokens to avoid syntax errors from user input.
      const ftsQuery = opts.search
        .trim()
        .split(/\s+/)
        .map((t) => `"${t.replace(/"/g, "")}"*`)
        .join(" ");
      rows = await this.db.query<WorkRow>(
        `SELECT w.* FROM works w
         JOIN works_fts f ON f.rowid = w.rowid
         ${collectionJoin}
         WHERE works_fts MATCH ? AND w.deleted_at IS NULL
         ORDER BY rank LIMIT ?`,
        [...collectionParams, ftsQuery, limit],
      );
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

  async get(id: string): Promise<WorkWithAuthors | null> {
    const rows = await this.db.query<WorkRow>(`SELECT * FROM works WHERE id = ?`, [id]);
    if (rows.length === 0) return null;
    const [withAuthors] = await this.attachAuthors(rows);
    return withAuthors ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db.run(`UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      Date.now(),
      Date.now(),
      id,
    ]);
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
}
