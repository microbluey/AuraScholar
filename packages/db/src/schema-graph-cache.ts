import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Runtime-global citation graph payloads use a database-owned CAS version. */
export const graphCache = sqliteTable(
  "graph_cache",
  {
    workId: text("work_id").primaryKey(),
    payloadJson: text("payload_json", { mode: "json" }).notNull(),
    fetchedAt: integer("fetched_at").notNull(),
    cacheVersion: integer("cache_version").notNull().default(1),
  },
  (t) => [
    check(
      "graph_cache_cache_version_check",
      sql`typeof(${t.cacheVersion}) = 'integer' AND ${t.cacheVersion} BETWEEN 1 AND 9007199254740991`,
    ),
  ],
);
