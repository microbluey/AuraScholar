import { describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "./database";
import { requireLocalLibraryId } from "./local-first";
import { MIGRATIONS, runMigrations } from "./migrations";

async function migrateThrough(version: number): Promise<Database> {
  const db = await createNodeDatabase(":memory:");
  await db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at INTEGER NOT NULL
     )`,
  );
  for (const migration of MIGRATIONS) {
    if (migration.version > version) break;
    await db.exec("BEGIN");
    try {
      await db.exec(migration.sql);
      await db.run(`INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)`, [
        migration.version,
        migration.name,
        Date.now(),
      ]);
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  }
  return db;
}

async function seedV16Graph(db: Database): Promise<void> {
  const now = 1_700_000_000_000;
  await db.run(
    `INSERT INTO works (id, doi, title, abstract, type, created_at, updated_at)
     VALUES ('work-a', '10.1000/shared', 'Owned knowledge', 'legacy full graph', 'article', ?, ?)`,
    [now, now],
  );
  await db.run(
    `INSERT INTO authors (id, display_name, orcid, created_at, updated_at)
     VALUES ('author-a', 'Ada Author', '0000-0001', ?, ?)`,
    [now, now],
  );
  await db.run(
    `INSERT INTO work_authors (
       work_id, author_id, position, is_corresponding, role
     ) VALUES ('work-a', 'author-a', 0, 1, 'author')`,
  );
  await db.run(
    `INSERT INTO attachments (
       id, work_id, sha256, byte_size, created_at, updated_at
     ) VALUES ('attachment-a', 'work-a', 'sha-a', 42, ?, ?)`,
    [now, now],
  );
  await db.run(
    `INSERT INTO annotations (
       id, attachment_id, work_id, type, page_index, sort_key, created_at, updated_at
     ) VALUES ('annotation-a', 'attachment-a', 'work-a', 'highlight', 0, 1, ?, ?)`,
    [now, now],
  );
  await db.run(
    `INSERT INTO collections (
       id, name, sort_order, created_at, updated_at
     ) VALUES ('collection-a', 'Methods', 0, ?, ?)`,
    [now, now],
  );
  await db.run(
    `INSERT INTO collection_items (collection_id, work_id)
     VALUES ('collection-a', 'work-a')`,
  );
  await db.run(
    `INSERT INTO tags (id, name, created_at, updated_at)
     VALUES ('tag-a', 'causal', ?, ?)`,
    [now, now],
  );
  await db.run(`INSERT INTO work_tags (work_id, tag_id) VALUES ('work-a', 'tag-a')`);
  await db.run(
    `INSERT INTO saved_searches (
       id, query, created_at, updated_at
     ) VALUES ('search-a', 'causal inference', ?, ?)`,
    [now, now],
  );
  await db.run(
    `INSERT INTO canvas_workspaces (
       id, name, viewport_json, created_at, updated_at
     ) VALUES ('canvas-a', 'Synthesis', '{}', ?, ?)`,
    [now, now],
  );
  await db.run(
    `INSERT INTO canvas_nodes (
       id, workspace_id, work_id, type, pos_x, pos_y, width, height,
       data_json, created_at, updated_at
     ) VALUES (
       'node-a', 'canvas-a', 'work-a', 'paper', 0, 0, 320, 180,
       '{}', ?, ?
     )`,
    [now, now],
  );
  await db.run(
    `INSERT INTO sentinel_tasks (
       id, work_id, title, next_poll_at, created_at, updated_at
     ) VALUES ('sentinel-a', 'work-a', 'Owned knowledge', ?, ?, ?)`,
    [now, now, now],
  );
  await db.run(
    `INSERT INTO ai_jobs (
       id, kind, work_id, created_at, updated_at
     ) VALUES ('job-a', 'summary', 'work-a', ?, ?)`,
    [now, now],
  );
  await db.run(
    `INSERT INTO sync_log (
       seq, entity_table, entity_id, op, hlc, device_id
     ) VALUES (41, 'works', 'work-a', 'upsert', '1:0:a', 'device-a')`,
  );
  await db.run(`INSERT INTO sync_state (provider_id) VALUES ('provider-a')`);
  await db.run(
    `INSERT INTO sync_row_clocks (
       table_name, row_id, column_hlcs_json, updated_at
     ) VALUES ('works', 'work-a', '{}', ?)`,
    [now],
  );
  await db.run(
    `INSERT INTO blob_sync_state (
       sha256, provider_id, updated_at
     ) VALUES ('sha-a', 'provider-a', ?)`,
    [now],
  );
  await db.run(
    `INSERT INTO derived_artifacts (
       id, source_table, source_id, kind, payload_json, created_at, updated_at
     ) VALUES ('artifact-a', 'works', 'work-a', 'summary', '{}', ?, ?)`,
    [now, now],
  );
}

async function assertNotNull(db: Database, table: string, column: string): Promise<void> {
  const columns = await db.query<{ name: string; notnull: number }>(`PRAGMA table_info(${table})`);
  expect(columns.find((entry) => entry.name === column)?.notnull).toBe(1);
}

describe("v17 Library ownership", () => {
  it("bootstraps one Library and backfills a complete v16 graph without losing FTS", async () => {
    const db = await migrateThrough(16);
    await seedV16Graph(db);

    await runMigrations(db);

    const libraryId = await requireLocalLibraryId(db);
    const ownedTables = [
      "works",
      "authors",
      "collections",
      "tags",
      "saved_searches",
      "canvas_workspaces",
      "sentinel_tasks",
      "ai_jobs",
      "sync_log",
      "sync_state",
      "sync_row_clocks",
      "blob_sync_state",
      "derived_artifacts",
    ];
    for (const table of ownedTables) {
      await assertNotNull(db, table, "library_id");
      const owners = await db.query<{ library_id: string }>(
        `SELECT DISTINCT library_id FROM ${table}`,
      );
      expect(owners).toEqual([{ library_id: libraryId }]);
    }
    for (const globalTable of [
      "cv_profiles",
      "settings",
      "devices",
      "discovery_sites",
      "translation_cache",
    ]) {
      const columns = await db.query<{ name: string }>(`PRAGMA table_info(${globalTable})`);
      expect(columns.map((column) => column.name)).not.toContain("library_id");
    }

    expect(await db.query(`SELECT * FROM work_authors WHERE work_id = 'work-a'`)).toHaveLength(1);
    expect(await db.query(`SELECT * FROM annotations WHERE id = 'annotation-a'`)).toHaveLength(1);
    expect(await db.query(`SELECT * FROM canvas_nodes WHERE id = 'node-a'`)).toHaveLength(1);

    const search = await db.query<{ id: string }>(
      `SELECT w.id
       FROM works w
       JOIN works_fts f ON f.rowid = w.rowid
       WHERE works_fts MATCH '"Owned"*'`,
    );
    expect(search).toEqual([{ id: "work-a" }]);

    await db.run(`UPDATE works SET title = 'Updated searchable title' WHERE id = 'work-a'`);
    const updatedSearch = await db.query<{ id: string }>(
      `SELECT w.id
       FROM works w
       JOIN works_fts f ON f.rowid = w.rowid
       WHERE works_fts MATCH '"Updated"*'`,
    );
    expect(updatedSearch).toEqual([{ id: "work-a" }]);

    await db.run(
      `INSERT INTO sync_log (
         library_id, entity_table, entity_id, op, hlc, device_id
       ) VALUES (?, 'works', 'work-next', 'upsert', '2:0:a', 'device-a')`,
      [libraryId],
    );
    expect(Number(await db.queryScalar(`SELECT MAX(seq) FROM sync_log`))).toBeGreaterThan(41);
    expect(await db.query(`PRAGMA foreign_key_check`)).toEqual([]);
    expect(Number(await db.queryScalar(`PRAGMA foreign_keys`))).toBe(1);
  });

  it("reuses and restores the Library selected before v17", async () => {
    const db = await migrateThrough(16);
    const now = Date.now();
    await db.run(
      `INSERT INTO libraries (
         id, name, kind, created_at, updated_at, deleted_at
       ) VALUES ('preferred-library', 'Preferred', 'personal', ?, ?, ?)`,
      [now, now, now],
    );
    await db.run(
      `INSERT INTO settings (key, value_json, scope, updated_at)
       VALUES ('local.library_id', ?, 'local', ?)`,
      [JSON.stringify("preferred-library"), now],
    );
    await db.run(
      `INSERT INTO works (id, title, type, created_at, updated_at)
       VALUES ('legacy-work', 'Legacy', 'article', ?, ?)`,
      [now, now],
    );

    await runMigrations(db);

    expect(await requireLocalLibraryId(db)).toBe("preferred-library");
    expect(
      await db.query<{ library_id: string }>(
        `SELECT library_id FROM works WHERE id = 'legacy-work'`,
      ),
    ).toEqual([{ library_id: "preferred-library" }]);
    expect(
      await db.query<{ deleted_at: number | null }>(
        `SELECT deleted_at FROM libraries WHERE id = 'preferred-library'`,
      ),
    ).toEqual([{ deleted_at: null }]);
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM libraries`))).toBe(1);
  });

  it("repairs missing and malformed v16 Library identity deterministically", async () => {
    const missingDb = await migrateThrough(16);
    await missingDb.run(
      `INSERT INTO settings (key, value_json, scope, updated_at)
       VALUES ('local.library_id', ?, 'local', 1)`,
      [JSON.stringify("missing-library")],
    );
    await missingDb.run(
      `INSERT INTO works (id, title, type, created_at, updated_at)
       VALUES ('missing-owner-work', 'Missing owner', 'article', 1, 1)`,
    );

    await runMigrations(missingDb);

    expect(await requireLocalLibraryId(missingDb)).toBe("missing-library");
    expect(
      await missingDb.query<{ library_id: string }>(
        `SELECT library_id FROM works WHERE id = 'missing-owner-work'`,
      ),
    ).toEqual([{ library_id: "missing-library" }]);
    expect(Number(await missingDb.queryScalar(`SELECT COUNT(*) FROM libraries`))).toBe(1);

    const malformedDb = await migrateThrough(16);
    await malformedDb.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES
         ('oldest-active', 'Oldest', 'personal', 10, 10),
         ('newer-active', 'Newer', 'personal', 20, 20)`,
    );
    await malformedDb.run(
      `INSERT INTO settings (key, value_json, scope, updated_at)
       VALUES ('local.library_id', '{malformed', 'local', 1)`,
    );
    await malformedDb.run(
      `INSERT INTO works (id, title, type, created_at, updated_at)
       VALUES ('malformed-owner-work', 'Malformed owner', 'article', 1, 1)`,
    );

    await runMigrations(malformedDb);

    expect(await requireLocalLibraryId(malformedDb)).toBe("oldest-active");
    expect(
      await malformedDb.query<{ library_id: string }>(
        `SELECT library_id FROM works WHERE id = 'malformed-owner-work'`,
      ),
    ).toEqual([{ library_id: "oldest-active" }]);
    expect(Number(await malformedDb.queryScalar(`SELECT COUNT(*) FROM libraries`))).toBe(2);
  });

  it("uses Library-scoped uniqueness and composite sync identities", async () => {
    const db = await migrateThrough(16);
    await seedV16Graph(db);
    await runMigrations(db);
    const first = await requireLocalLibraryId(db);
    const now = Date.now();
    const second = "library-second";
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Second', 'personal', ?, ?)`,
      [second, now, now],
    );

    await db.run(
      `INSERT INTO works (
         id, library_id, doi, title, type, created_at, updated_at
       ) VALUES ('work-b', ?, '10.1000/shared', 'Second copy', 'article', ?, ?)`,
      [second, now, now],
    );
    await expect(
      db.run(
        `INSERT INTO works (
           id, library_id, doi, title, type, created_at, updated_at
         ) VALUES ('work-duplicate', ?, '10.1000/shared', 'Duplicate', 'article', ?, ?)`,
        [first, now, now],
      ),
    ).rejects.toThrow();

    await db.run(
      `INSERT INTO authors (
         id, library_id, display_name, orcid, created_at, updated_at
       ) VALUES ('author-b', ?, 'Ada copy', '0000-0001', ?, ?)`,
      [second, now, now],
    );
    await db.run(
      `INSERT INTO tags (id, library_id, name, created_at, updated_at)
       VALUES ('tag-b', ?, 'causal', ?, ?)`,
      [second, now, now],
    );

    await db.run(
      `INSERT INTO sync_state (library_id, provider_id)
       VALUES (?, 'same-provider'), (?, 'same-provider')`,
      [first, second],
    );
    await db.run(
      `INSERT INTO sync_row_clocks (
         library_id, table_name, row_id, column_hlcs_json, updated_at
       ) VALUES
         (?, 'works', 'same-row', '{}', ?),
         (?, 'works', 'same-row', '{}', ?)`,
      [first, now, second, now],
    );
    await db.run(
      `INSERT INTO blob_sync_state (
         library_id, sha256, provider_id, updated_at
       ) VALUES
         (?, 'same-sha', 'same-provider', ?),
         (?, 'same-sha', 'same-provider', ?)`,
      [first, now, second, now],
    );
  });

  it("re-homes nullable legacy metadata with its canonical graph and guards Work-derived payloads", async () => {
    const db = await migrateThrough(16);
    const now = Date.now();
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES
         ('library-a', 'A', 'personal', ?, ?),
         ('library-b', 'B', 'personal', ?, ?)`,
      [now, now, now, now],
    );
    await db.run(
      `INSERT INTO settings (key, value_json, scope, updated_at)
       VALUES ('local.library_id', ?, 'local', ?)`,
      [JSON.stringify("library-a"), now],
    );
    await db.run(
      `INSERT INTO works (id, title, type, created_at, updated_at)
       VALUES ('legacy-work', 'Legacy', 'article', ?, ?)`,
      [now, now],
    );
    await db.run(
      `INSERT INTO derived_artifacts (
         id, library_id, source_table, source_id, kind, payload_json, created_at, updated_at
       ) VALUES ('legacy-artifact', 'library-b', 'works', 'legacy-work', 'summary', '{}', ?, ?)`,
      [now, now],
    );
    await db.run(
      `INSERT INTO sync_log (
         library_id, entity_table, entity_id, op, hlc, device_id
       ) VALUES ('library-b', 'works', 'legacy-work', 'upsert', '1:0:a', 'device-a')`,
    );
    await db.run(
      `INSERT INTO sync_state (provider_id, library_id)
       VALUES ('provider-a', 'library-b')`,
    );
    await db.run(
      `INSERT INTO sync_row_clocks (
         table_name, row_id, library_id, column_hlcs_json, updated_at
       ) VALUES ('works', 'legacy-work', 'library-b', '{}', ?)`,
      [now],
    );
    await db.run(
      `INSERT INTO blob_sync_state (
         sha256, provider_id, library_id, updated_at
       ) VALUES ('sha-a', 'provider-a', 'library-b', ?)`,
      [now],
    );

    await runMigrations(db);

    for (const table of [
      "derived_artifacts",
      "sync_log",
      "sync_state",
      "sync_row_clocks",
      "blob_sync_state",
    ]) {
      expect(
        await db.query<{ library_id: string }>(`SELECT DISTINCT library_id FROM ${table}`),
      ).toEqual([{ library_id: "library-a" }]);
    }

    await db.run(
      `INSERT INTO works (
         id, library_id, title, type, created_at, updated_at
       ) VALUES ('work-b', 'library-b', 'B', 'article', ?, ?)`,
      [now, now],
    );
    await expect(
      db.run(
        `INSERT INTO derived_artifacts (
           id, library_id, source_table, source_id, kind, payload_json, created_at, updated_at
         ) VALUES ('cross-artifact', 'library-a', 'works', 'work-b', 'summary', '{}', ?, ?)`,
        [now, now],
      ),
    ).rejects.toThrow(/within its library/);
    await expect(
      db.run(
        `UPDATE derived_artifacts SET source_id = 'work-b'
         WHERE id = 'legacy-artifact'`,
      ),
    ).rejects.toThrow(/within its library/);
  });

  it("rejects cross-Library relationships and root ownership changes", async () => {
    const db = await migrateThrough(16);
    await seedV16Graph(db);
    await runMigrations(db);
    const first = await requireLocalLibraryId(db);
    const second = "library-second";
    const now = Date.now();
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Second', 'personal', ?, ?)`,
      [second, now, now],
    );
    await db.run(
      `INSERT INTO works (
         id, library_id, title, type, created_at, updated_at
       ) VALUES ('work-b', ?, 'Second work', 'article', ?, ?)`,
      [second, now, now],
    );
    await db.run(
      `INSERT INTO authors (
         id, library_id, display_name, created_at, updated_at
       ) VALUES ('author-b', ?, 'Second author', ?, ?)`,
      [second, now, now],
    );
    await db.run(
      `INSERT INTO collections (
         id, library_id, name, created_at, updated_at
       ) VALUES ('collection-b', ?, 'Second collection', ?, ?)`,
      [second, now, now],
    );
    await db.run(
      `INSERT INTO tags (
         id, library_id, name, created_at, updated_at
       ) VALUES ('tag-b', ?, 'second-tag', ?, ?)`,
      [second, now, now],
    );
    await db.run(
      `INSERT INTO canvas_workspaces (
         id, library_id, name, viewport_json, created_at, updated_at
       ) VALUES ('canvas-b', ?, 'Second canvas', '{}', ?, ?)`,
      [second, now, now],
    );

    await expect(
      db.run(
        `INSERT INTO work_authors (
           work_id, author_id, position, is_corresponding, role
         ) VALUES ('work-a', 'author-b', 1, 0, 'author')`,
      ),
    ).rejects.toThrow(/one library/);
    await expect(
      db.run(
        `INSERT INTO collection_items (collection_id, work_id)
         VALUES ('collection-b', 'work-a')`,
      ),
    ).rejects.toThrow(/one library/);
    await expect(
      db.run(`INSERT INTO work_tags (work_id, tag_id) VALUES ('work-a', 'tag-b')`),
    ).rejects.toThrow(/one library/);
    await expect(
      db.run(
        `INSERT INTO citations (citing_work_id, cited_work_id)
         VALUES ('work-a', 'work-b')`,
      ),
    ).rejects.toThrow(/one library/);
    await expect(
      db.run(
        `INSERT INTO canvas_nodes (
           id, workspace_id, work_id, type, pos_x, pos_y, width, height,
           data_json, created_at, updated_at
         ) VALUES (
           'node-cross', 'canvas-b', 'work-a', 'paper', 0, 0, 100, 100,
           '{}', ?, ?
         )`,
        [now, now],
      ),
    ).rejects.toThrow(/within its library/);
    await expect(
      db.run(
        `INSERT INTO sentinel_tasks (
           id, library_id, work_id, title, next_poll_at, created_at, updated_at
         ) VALUES ('sentinel-cross', ?, 'work-a', 'Cross', ?, ?, ?)`,
        [second, now, now, now],
      ),
    ).rejects.toThrow(/within its library/);
    await expect(
      db.run(
        `INSERT INTO ai_jobs (
           id, library_id, kind, work_id, created_at, updated_at
         ) VALUES ('job-cross', ?, 'summary', 'work-a', ?, ?)`,
        [second, now, now],
      ),
    ).rejects.toThrow(/within its library/);
    await expect(
      db.run(
        `UPDATE collections SET parent_id = 'collection-b'
         WHERE id = 'collection-a'`,
      ),
    ).rejects.toThrow(/within one library/);

    const immutableRoots = [
      ["works", "work-a"],
      ["authors", "author-a"],
      ["collections", "collection-a"],
      ["tags", "tag-a"],
      ["saved_searches", "search-a"],
      ["canvas_workspaces", "canvas-a"],
      ["sentinel_tasks", "sentinel-a"],
      ["ai_jobs", "job-a"],
      ["derived_artifacts", "artifact-a"],
    ] as const;
    for (const [table, id] of immutableRoots) {
      await expect(
        db.run(`UPDATE ${table} SET library_id = ? WHERE id = ?`, [second, id]),
      ).rejects.toThrow();
    }
    const immutableTriggers = await db.query<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'trigger' AND name LIKE '%_library_immutable'`,
    );
    expect(immutableTriggers).toHaveLength(immutableRoots.length);
    expect(
      await db.query<{ library_id: string }>(`SELECT library_id FROM works WHERE id = 'work-a'`),
    ).toEqual([{ library_id: first }]);
  });

  it("rolls back every schema and identity change when foreign_key_check fails", async () => {
    const db = await migrateThrough(16);
    await db.exec("PRAGMA foreign_keys = OFF");
    await db.run(
      `INSERT INTO attachments (
         id, work_id, sha256, byte_size, created_at, updated_at
       ) VALUES ('orphan', 'missing-work', 'orphan-sha', 1, 1, 1)`,
    );
    await db.exec("PRAGMA foreign_keys = ON");

    await expect(runMigrations(db)).rejects.toThrow(/foreign_key_check/);

    expect(Number(await db.queryScalar(`SELECT MAX(version) FROM _migrations`))).toBe(16);
    const workColumns = await db.query<{ name: string }>(`PRAGMA table_info(works)`);
    expect(workColumns.map((column) => column.name)).not.toContain("library_id");
    expect(
      Number(await db.queryScalar(`SELECT COUNT(*) FROM attachments WHERE id = 'orphan'`)),
    ).toBe(1);
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM libraries`))).toBe(0);
    expect(Number(await db.queryScalar(`PRAGMA foreign_keys`))).toBe(1);
  });
});
