import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { libraries, works } from "./library-schema.js";
import { researchProjects } from "./research-project-schema.js";
import { documentAssets, documentRevisions } from "./document-evidence-schema.js";

const id = () => text("id").primaryKey();
const createdAt = () => integer("created_at").notNull();
const updatedAt = () => integer("updated_at").notNull();
const deletedAt = () => integer("deleted_at");

/**
 * Project-local retrieval staging. The executable v29 migration owns the
 * expression-based NULL-safe uniqueness index and scope triggers; this is the
 * typed Drizzle view used by schema consumers. The source uniqueness index is
 * intentionally not repeated below: SQLite's Drizzle introspector cannot
 * round-trip expression/partial indexes, and a plain nullable unique index
 * would claim different semantics (and make schema diffs try to replace the
 * executable v29 index).
 */
export const evidenceShelfItems = sqliteTable(
  "evidence_shelf_items",
  {
    id: id(),
    libraryId: text("library_id")
      .notNull()
      .references(() => libraries.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => researchProjects.id, { onDelete: "cascade" }),
    workId: text("work_id").references(() => works.id, { onDelete: "cascade" }),
    assetId: text("asset_id").references(() => documentAssets.id, { onDelete: "cascade" }),
    revisionId: text("revision_id").references(() => documentRevisions.id, {
      onDelete: "cascade",
    }),
    anchorSnapshotJson: text("anchor_snapshot_json", { mode: "json" }).notNull(),
    previewPayloadJson: text("preview_payload_json", { mode: "json" }).notNull(),
    sourceContentHash: text("source_content_hash").notNull(),
    status: text("status", { enum: ["staged", "stale"] })
      .notNull()
      .default("staged"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index("evidence_shelf_project_active_idx").on(
      table.projectId,
      table.deletedAt,
      table.updatedAt,
      table.id,
    ),
    index("evidence_shelf_library_source_idx").on(
      table.libraryId,
      table.workId,
      table.assetId,
      table.revisionId,
    ),
    check(
      "evidence_shelf_anchor_json_check",
      sql`json_valid(${table.anchorSnapshotJson}) AND json_type(${table.anchorSnapshotJson}) = 'object'`,
    ),
    check(
      "evidence_shelf_preview_json_check",
      sql`json_valid(${table.previewPayloadJson}) AND json_type(${table.previewPayloadJson}) = 'object'`,
    ),
    check(
      "evidence_shelf_source_identity_check",
      sql`(${table.workId} IS NOT NULL AND length(trim(${table.workId})) > 0)
        OR (${table.assetId} IS NOT NULL AND length(trim(${table.assetId})) > 0)
        OR (${table.revisionId} IS NOT NULL AND length(trim(${table.revisionId})) > 0)`,
    ),
    check(
      "evidence_shelf_hash_check",
      sql`length(${table.sourceContentHash}) = 64 AND ${table.sourceContentHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check("evidence_shelf_status_check", sql`${table.status} IN ('staged', 'stale')`),
  ],
);
