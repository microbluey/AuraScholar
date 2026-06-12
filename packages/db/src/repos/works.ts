import type { Database } from "../database";
import { newId, workFingerprint } from "../ids";

export interface WorkInput {
  doi?: string;
  title: string;
  abstract?: string;
  year?: number;
  publicationDate?: string;
  venueName?: string;
  venueType?: string;
  type?: string;
  arxivId?: string;
  openalexId?: string;
  pmid?: string;
  cslJson?: unknown;
  authors?: Array<{ displayName: string; orcid?: string; position: number }>;
}

export interface WorkRow {
  id: string;
  doi: string | null;
  title: string;
  abstract: string | null;
  year: number | null;
  publication_date: string | null;
  venue_name: string | null;
  type: string;
  arxiv_id: string | null;
  reading_status: string;
  starred: number;
  created_at: number;
  updated_at: number;
}

export interface WorkWithAuthors extends WorkRow {
  authorNames: string[];
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
      await this.db.run(
        `UPDATE works SET
           abstract = COALESCE(abstract, ?),
           openalex_id = COALESCE(openalex_id, ?),
           pmid = COALESCE(pmid, ?),
           arxiv_id = COALESCE(arxiv_id, ?),
           publication_date = COALESCE(publication_date, ?),
           updated_at = ?
         WHERE id = ?`,
        [
          input.abstract ?? null,
          input.openalexId ?? null,
          input.pmid ?? null,
          input.arxivId ?? null,
          input.publicationDate ?? null,
          now,
          id,
        ],
      );
      return { id, deduped: true };
    }

    const id = newId();
    await this.db.run(
      `INSERT INTO works (id, doi, title, abstract, year, publication_date, venue_name, venue_type,
                          type, arxiv_id, openalex_id, pmid, fingerprint, csl_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        doi,
        input.title,
        input.abstract ?? null,
        input.year ?? null,
        input.publicationDate ?? null,
        input.venueName ?? null,
        input.venueType ?? null,
        input.type ?? "article",
        input.arxivId ?? null,
        input.openalexId ?? null,
        input.pmid ?? null,
        fingerprint,
        input.cslJson ? JSON.stringify(input.cslJson) : null,
        now,
        now,
      ],
    );

    for (const author of input.authors ?? []) {
      const authorId = await this.upsertAuthor(author.displayName, author.orcid);
      await this.db.run(
        `INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name) VALUES (?, ?, ?, ?)`,
        [id, authorId, author.position, author.displayName],
      );
    }

    return { id, deduped: false };
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

  async list(opts?: { search?: string; limit?: number }): Promise<WorkWithAuthors[]> {
    const limit = opts?.limit ?? 200;
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
         WHERE works_fts MATCH ? AND w.deleted_at IS NULL
         ORDER BY rank LIMIT ?`,
        [ftsQuery, limit],
      );
    } else {
      rows = await this.db.query<WorkRow>(
        `SELECT * FROM works WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`,
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

  async softDelete(id: string): Promise<void> {
    await this.db.run(`UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      Date.now(),
      Date.now(),
      id,
    ]);
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
