// Hand-rolled migration runner: an ordered list of SQL scripts applied inside
// a transaction, tracked in _migrations. Works identically on native SQLite
// (desktop) and sqlite-wasm (web) because it only needs `exec`.
//
// FTS5 tables and triggers live here rather than in the Drizzle schema —
// Drizzle has no FTS5 support, and virtual tables must not be ORM-managed.

export interface SqlExecutor {
  exec(sql: string): void | Promise<void>;
  queryScalar(sql: string): unknown | Promise<unknown>;
}

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

import { DDL_V1 } from "./ddl.js";

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "schema_v1",
    sql: DDL_V1,
  },
  {
    version: 2,
    name: "fts5_works_search",
    sql: `
      CREATE VIRTUAL TABLE IF NOT EXISTS works_fts USING fts5(
        title, abstract, notes_md,
        content='works', content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS works_fts_ai AFTER INSERT ON works BEGIN
        INSERT INTO works_fts(rowid, title, abstract, notes_md)
        VALUES (new.rowid, new.title, new.abstract, new.notes_md);
      END;
      CREATE TRIGGER IF NOT EXISTS works_fts_ad AFTER DELETE ON works BEGIN
        INSERT INTO works_fts(works_fts, rowid, title, abstract, notes_md)
        VALUES ('delete', old.rowid, old.title, old.abstract, old.notes_md);
      END;
      CREATE TRIGGER IF NOT EXISTS works_fts_au AFTER UPDATE ON works BEGIN
        INSERT INTO works_fts(works_fts, rowid, title, abstract, notes_md)
        VALUES ('delete', old.rowid, old.title, old.abstract, old.notes_md);
        INSERT INTO works_fts(rowid, title, abstract, notes_md)
        VALUES (new.rowid, new.title, new.abstract, new.notes_md);
      END;
    `,
  },
  {
    version: 3,
    name: "sentinel_title_monitoring",
    sql: `
      ALTER TABLE sentinel_tasks ADD COLUMN hint_venue TEXT;
      ALTER TABLE sentinel_tasks ADD COLUMN hint_author TEXT;
    `,
  },
  {
    version: 4,
    name: "writing_snippets",
    sql: `
      CREATE TABLE IF NOT EXISTS snippets (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL REFERENCES works(id),
        page_index INTEGER,
        quote TEXT NOT NULL,
        note_md TEXT,
        tag TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS snippets_work_idx ON snippets(work_id, created_at);
    `,
  },
  {
    version: 5,
    name: "translation_cache",
    sql: `
      CREATE TABLE IF NOT EXISTS translation_cache (
        cache_key TEXT PRIMARY KEY,
        engine TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `,
  },
  {
    // Rich bibliographic metadata, modeled on EndNote's reference fields and
    // aligned to CSL-JSON variable names. These were previously only inside
    // csl_json (unqueryable, and absent for manual/BibTeX entries); promoting
    // them to columns makes them editable, searchable, and citation-ready.
    version: 6,
    name: "rich_bibliographic_fields",
    sql: `
      ALTER TABLE works ADD COLUMN volume TEXT;
      ALTER TABLE works ADD COLUMN issue TEXT;
      ALTER TABLE works ADD COLUMN pages TEXT;
      ALTER TABLE works ADD COLUMN number_of_volumes TEXT;
      ALTER TABLE works ADD COLUMN edition TEXT;
      ALTER TABLE works ADD COLUMN section TEXT;
      ALTER TABLE works ADD COLUMN publisher TEXT;
      ALTER TABLE works ADD COLUMN place_published TEXT;
      ALTER TABLE works ADD COLUMN series_title TEXT;
      ALTER TABLE works ADD COLUMN short_title TEXT;
      ALTER TABLE works ADD COLUMN original_title TEXT;
      ALTER TABLE works ADD COLUMN issn TEXT;
      ALTER TABLE works ADD COLUMN isbn TEXT;
      ALTER TABLE works ADD COLUMN url TEXT;
      ALTER TABLE works ADD COLUMN accessed_date TEXT;
      ALTER TABLE works ADD COLUMN language TEXT;
      ALTER TABLE works ADD COLUMN call_number TEXT;
      ALTER TABLE works ADD COLUMN accession_number TEXT;
      ALTER TABLE works ADD COLUMN label TEXT;
      ALTER TABLE works ADD COLUMN database_name TEXT;
      ALTER TABLE works ADD COLUMN keywords_json TEXT;
      ALTER TABLE work_authors ADD COLUMN role TEXT NOT NULL DEFAULT 'author';
    `,
  },
  {
    // Research discovery sites: the academic websites shown as cards on the
    // discovery page and opened in the embedded browser. Built-in sites are
    // seeded here (and protected from deletion — users hide rather than remove
    // them); users can also add their own custom sites. Login/session state is
    // NOT stored here — it lives in each site's webview dataDirectory.
    version: 7,
    name: "discovery_sites",
    sql: `
      CREATE TABLE IF NOT EXISTS discovery_sites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        home_url TEXT NOT NULL,
        search_url TEXT,
        builtin INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO discovery_sites (id, name, home_url, search_url, builtin, sort_order, created_at, updated_at) VALUES
        ('builtin:google-scholar', 'Google Scholar', 'https://scholar.google.com/', 'https://scholar.google.com/scholar?q=', 1, 10, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
        ('builtin:web-of-science', 'Web of Science', 'https://www.webofscience.com/', NULL, 1, 20, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
        ('builtin:scopus', 'Scopus', 'https://www.scopus.com/', NULL, 1, 30, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
        ('builtin:pubmed', 'PubMed', 'https://pubmed.ncbi.nlm.nih.gov/', 'https://pubmed.ncbi.nlm.nih.gov/?term=', 1, 40, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
        ('builtin:cnki', 'CNKI', 'https://www.cnki.net/', NULL, 1, 50, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
    `,
  },
  {
    // More common academic sites/databases for the discovery card grid. Kept in
    // a separate migration so machines that already ran v7 still receive them.
    // Search URLs are the site's own query-string entrypoint where known, so a
    // typed query opens straight to results; the rest open their homepage.
    version: 8,
    name: "discovery_sites_more",
    sql: `
      INSERT OR IGNORE INTO discovery_sites (id, name, home_url, search_url, builtin, sort_order, created_at, updated_at) VALUES
        ('builtin:ieee-xplore', 'IEEE Xplore', 'https://ieeexplore.ieee.org/', 'https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=', 1, 60, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
        ('builtin:sciencedirect', 'ScienceDirect', 'https://www.sciencedirect.com/', 'https://www.sciencedirect.com/search?qs=', 1, 70, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
        ('builtin:springerlink', 'SpringerLink', 'https://link.springer.com/', 'https://link.springer.com/search?query=', 1, 80, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
        ('builtin:wiley', 'Wiley Online Library', 'https://onlinelibrary.wiley.com/', 'https://onlinelibrary.wiley.com/action/doSearch?AllField=', 1, 90, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
        ('builtin:acm-dl', 'ACM Digital Library', 'https://dl.acm.org/', 'https://dl.acm.org/action/doSearch?AllField=', 1, 100, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
        ('builtin:jstor', 'JSTOR', 'https://www.jstor.org/', 'https://www.jstor.org/action/doBasicSearch?Query=', 1, 110, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
        ('builtin:researchgate', 'ResearchGate', 'https://www.researchgate.net/', 'https://www.researchgate.net/search?q=', 1, 120, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
        ('builtin:biorxiv', 'bioRxiv', 'https://www.biorxiv.org/', 'https://www.biorxiv.org/search/', 1, 130, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
        ('builtin:dblp', 'DBLP', 'https://dblp.org/', 'https://dblp.org/search?q=', 1, 140, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
        ('builtin:baidu-xueshu', '百度学术', 'https://xueshu.baidu.com/', 'https://xueshu.baidu.com/s?wd=', 1, 150, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
        ('builtin:wanfang', '万方数据', 'https://www.wanfangdata.com.cn/', 'https://s.wanfangdata.com.cn/paper?q=', 1, 160, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
        ('builtin:cqvip', '维普', 'https://www.cqvip.com/', NULL, 1, 170, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
    `,
  },
  {
    // Per-site proxy opt-in. When use_proxy = 1, the site's embedded browser
    // session routes through the user's configured proxy (a global address in
    // the settings table, key 'research.proxy'); otherwise it uses the system
    // network directly. This lets a campus VPN (system-level) and a separate
    // proxy (e.g. Clash at 127.0.0.1:7890) coexist without fighting over routes:
    // CNKI/百度 go direct via the VPN, Google Scholar goes through the proxy.
    version: 9,
    name: "discovery_site_proxy",
    sql: `
      ALTER TABLE discovery_sites ADD COLUMN use_proxy INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    // Local-first foundation for the commercial/cloud path:
    // - a stable logical library/vault id, independent of user accounts
    // - sync log entries that can carry full row values (not only clocks)
    // - per-row clocks for field-level LWW merges
    // - blob sync state for content-addressed PDFs and supplements
    // - derived artifacts for AI/indexing/cache outputs that can be regenerated
    version: 10,
    name: "local_first_foundation",
    sql: `
      CREATE TABLE IF NOT EXISTS libraries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'personal',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );

      ALTER TABLE settings ADD COLUMN scope TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE settings ADD COLUMN updated_at INTEGER;

      ALTER TABLE sync_state ADD COLUMN library_id TEXT;

      ALTER TABLE sync_log ADD COLUMN library_id TEXT;
      ALTER TABLE sync_log ADD COLUMN values_json TEXT;
      ALTER TABLE sync_log ADD COLUMN created_at INTEGER;
      CREATE INDEX IF NOT EXISTS sync_log_library_seq_idx ON sync_log(library_id, seq);

      CREATE TABLE IF NOT EXISTS sync_row_clocks (
        table_name TEXT NOT NULL,
        row_id TEXT NOT NULL,
        library_id TEXT,
        column_hlcs_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (table_name, row_id)
      );
      CREATE INDEX IF NOT EXISTS sync_row_clocks_library_idx ON sync_row_clocks(library_id, table_name);

      CREATE TABLE IF NOT EXISTS blob_sync_state (
        sha256 TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        library_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        remote_path TEXT,
        uploaded_at INTEGER,
        downloaded_at INTEGER,
        error TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (sha256, provider_id)
      );
      CREATE INDEX IF NOT EXISTS blob_sync_state_library_idx ON blob_sync_state(library_id, status);

      CREATE TABLE IF NOT EXISTS derived_artifacts (
        id TEXT PRIMARY KEY,
        library_id TEXT,
        source_table TEXT NOT NULL,
        source_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        model TEXT,
        prompt_hash TEXT,
        input_hash TEXT,
        payload_json TEXT NOT NULL,
        local_only INTEGER NOT NULL DEFAULT 0,
        syncable INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER,
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS derived_artifacts_source_idx ON derived_artifacts(source_table, source_id, kind);
      CREATE INDEX IF NOT EXISTS derived_artifacts_library_idx ON derived_artifacts(library_id, kind);
    `,
  },
  {
    // Saved searches ("检索订阅"): a stored open-source aggregate query that the
    // app re-runs on a schedule to surface newly-published matches — the
    // discovery analogue of the sentinel. seen_ids_json holds the stable
    // identifiers (doi/arxiv/openalex/s2/fingerprint) observed on the last run;
    // anything outside that set on the next run counts as "new". new_count is a
    // cached badge value the UI reads without re-running the query.
    version: 11,
    name: "saved_searches",
    sql: `
      CREATE TABLE IF NOT EXISTS saved_searches (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        sources_json TEXT,
        seen_ids_json TEXT NOT NULL DEFAULT '[]',
        new_count INTEGER NOT NULL DEFAULT 0,
        last_run_at INTEGER,
        next_run_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS saved_searches_due_idx ON saved_searches(next_run_at);
    `,
  },
  {
    // Stable academic identifiers are used for library status checks and
    // duplicate detection beyond DOI. Index them so large libraries do not
    // degrade into table scans when importing from discovery/browser flows.
    version: 12,
    name: "works_stable_id_indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS works_arxiv_idx ON works(arxiv_id) WHERE arxiv_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS works_openalex_idx ON works(openalex_id) WHERE openalex_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS works_s2_idx ON works(s2_id) WHERE s2_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS works_pmid_idx ON works(pmid) WHERE pmid IS NOT NULL;
    `,
  },
  {
    // Keep the latest sentinel polling failure visible to users. error_count
    // alone shows that something is wrong but not whether it is a network,
    // DOI, rate-limit, or connector problem.
    version: 13,
    name: "sentinel_last_error",
    sql: `
      ALTER TABLE sentinel_tasks ADD COLUMN last_error TEXT;
    `,
  },
  {
    // Saved-search polling has the same long-running background failure mode:
    // a network/API failure should not look like "no new results".
    version: 14,
    name: "saved_searches_last_error",
    sql: `
      ALTER TABLE saved_searches ADD COLUMN last_error TEXT;
    `,
  },
  {
    // v2 introduced the FTS table and triggers, but users upgrading from a v1
    // database may already have works rows. Rebuild once so legacy rows become
    // searchable without requiring users to edit or reimport them.
    version: 15,
    name: "works_fts_rebuild_existing_rows",
    sql: `
      INSERT INTO works_fts(works_fts) VALUES('rebuild');
    `,
  },
  {
    // Spatial Canvas persistence is additive. Legacy flashcard/FSRS tables are
    // intentionally retained so disabling that UI never destroys user data.
    // A canvas node is a workspace-owned placement with its own id; work_id is
    // only a nullable parent reference and uses ON DELETE SET NULL.
    version: 16,
    name: "spatial_canvas",
    sql: `
      CREATE TABLE IF NOT EXISTS canvas_workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
        viewport_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS canvas_nodes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES canvas_workspaces(id) ON DELETE CASCADE,
        work_id TEXT REFERENCES works(id) ON DELETE SET NULL,
        type TEXT NOT NULL CHECK (type IN ('paper', 'excerpt', 'ai-synth', 'idea-note', 'group')),
        pos_x REAL NOT NULL,
        pos_y REAL NOT NULL,
        width REAL NOT NULL CHECK (width > 0),
        height REAL NOT NULL CHECK (height > 0),
        group_id TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        tags_json TEXT NOT NULL DEFAULT '[]',
        data_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS canvas_nodes_workspace_idx ON canvas_nodes(workspace_id);
      CREATE INDEX IF NOT EXISTS canvas_nodes_work_idx ON canvas_nodes(work_id);
      CREATE INDEX IF NOT EXISTS canvas_nodes_group_idx ON canvas_nodes(workspace_id, group_id);

      CREATE TABLE IF NOT EXISTS canvas_edges (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES canvas_workspaces(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES canvas_nodes(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES canvas_nodes(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL CHECK (relation_type IN ('cites', 'supports', 'contradicts', 'extends', 'derived-from', 'custom')),
        label TEXT,
        style_json TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS canvas_edges_workspace_idx ON canvas_edges(workspace_id);
      CREATE INDEX IF NOT EXISTS canvas_edges_source_idx ON canvas_edges(source_id);
      CREATE INDEX IF NOT EXISTS canvas_edges_target_idx ON canvas_edges(target_id);
    `,
  },
];

export async function runMigrations(db: SqlExecutor): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`,
  );
  const current = Number(
    (await db.queryScalar(`SELECT COALESCE(MAX(version), 0) FROM _migrations`)) ?? 0,
  );
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.exec("BEGIN");
    try {
      await db.exec(m.sql);
      await db.exec(
        `INSERT INTO _migrations (version, name, applied_at) VALUES (${m.version}, '${m.name}', ${Date.now()})`,
      );
      await db.exec("COMMIT");
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    }
  }
}
