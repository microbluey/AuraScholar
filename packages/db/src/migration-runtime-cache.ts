import type { Migration } from "./migrations.js";

/** Runtime cache migrations stay separate from Library-owned query changes. */
export const runtimeCacheMigrations: Migration[] = [
  {
    // Graph-cache writes use a database-owned monotonic token for compare-and-
    // swap. Existing rows start at version one; fetched_at remains a separate
    // freshness hint and is intentionally not reused as the concurrency token.
    version: 26,
    name: "graph_cache_cas_version",
    sql: `
      ALTER TABLE graph_cache
        ADD COLUMN cache_version INTEGER NOT NULL DEFAULT 1
        CHECK (
          typeof(cache_version) = 'integer'
          AND cache_version BETWEEN 1 AND 9007199254740991
        );
    `,
  },
  {
    // Preserve the trust boundary when adding provider provenance to the
    // runtime-global graph cache. Existing rows were produced before a
    // provider envelope existed, so they receive an explicit unknown marker;
    // neither the migration nor old INSERT statements may infer OpenAlex.
    // provenance_json is kept as a JSON object and must agree with provider;
    // the main-process boundary performs the stronger envelope validation.
    version: 27,
    name: "graph_cache_provenance",
    sql: `
      ALTER TABLE graph_cache
        ADD COLUMN provider TEXT NOT NULL DEFAULT 'legacy-unknown'
        CHECK (
          provider IN ('legacy-unknown', 'openalex', 'semantic-scholar', 'crossref')
        );

      ALTER TABLE graph_cache
        ADD COLUMN provenance_json TEXT NOT NULL
          DEFAULT '{"provider":"legacy-unknown","schemaVersion":0}'
        CHECK (
          CASE WHEN json_valid(provenance_json)
            THEN COALESCE(
              json_type(provenance_json, '$') = 'object'
              AND json_extract(provenance_json, '$.provider') = provider,
              0
            )
            ELSE 0
          END
        );
    `,
  },
];
