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
];
