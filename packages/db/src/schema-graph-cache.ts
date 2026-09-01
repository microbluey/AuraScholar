import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Providers understood by the graph-cache boundary.
 *
 * `legacy-unknown` is intentionally part of the storage type. Rows written
 * before provenance was introduced (and old writers that omit the new
 * columns) must remain visibly untrusted instead of silently becoming
 * OpenAlex rows.
 */
export const GRAPH_CACHE_PROVIDERS = [
  "legacy-unknown",
  "openalex",
  "semantic-scholar",
  "crossref",
] as const;
export type GraphCacheProvider = (typeof GRAPH_CACHE_PROVIDERS)[number];

export const LEGACY_GRAPH_CACHE_PROVIDER = "legacy-unknown" as const;

/**
 * Durable marker assigned to pre-provenance cache rows. It is deliberately
 * not shaped like a valid provider envelope, so consumers cannot mistake a
 * migrated row for a freshly observed OpenAlex response.
 */
export const LEGACY_GRAPH_CACHE_PROVENANCE = {
  provider: LEGACY_GRAPH_CACHE_PROVIDER,
  schemaVersion: 0,
} as const;

/** Runtime-global citation graph payloads use a database-owned CAS version. */
export const graphCache = sqliteTable(
  "graph_cache",
  {
    workId: text("work_id").primaryKey(),
    payloadJson: text("payload_json", { mode: "json" }).notNull(),
    fetchedAt: integer("fetched_at").notNull(),
    cacheVersion: integer("cache_version").notNull().default(1),
    provider: text("provider", { enum: GRAPH_CACHE_PROVIDERS })
      .notNull()
      .default(LEGACY_GRAPH_CACHE_PROVIDER),
    provenanceJson: text("provenance_json", { mode: "json" })
      .notNull()
      .default(LEGACY_GRAPH_CACHE_PROVENANCE),
  },
  (t) => [
    check(
      "graph_cache_cache_version_check",
      sql`typeof(${t.cacheVersion}) = 'integer' AND ${t.cacheVersion} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "graph_cache_provider_check",
      sql`${t.provider} IN ('legacy-unknown', 'openalex', 'semantic-scholar', 'crossref')`,
    ),
    check(
      "graph_cache_provenance_check",
      sql`CASE WHEN json_valid(${t.provenanceJson})
        THEN COALESCE(
          json_type(${t.provenanceJson}, '$') = 'object'
          AND json_extract(${t.provenanceJson}, '$.provider') = ${t.provider},
          0
        )
        ELSE 0 END`,
    ),
  ],
);
