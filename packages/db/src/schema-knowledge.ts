import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { documentAssets, documentRevisions } from "./document-evidence-schema.js";
import { libraries, works } from "./library-schema.js";

const id = () => text("id").primaryKey();
const createdAt = () => integer("created_at").notNull();
const updatedAt = () => integer("updated_at").notNull();
const deletedAt = () => integer("deleted_at");

// ---------------------------------------------------------------------------
// Knowledge Layer — disposable ContentUnits and durable extraction work.
// The executable v20/v21 DDL owns the partial active-job uniqueness index and
// ContentUnit FTS virtual table/triggers; these definitions are the typed view
// used by future Drizzle consumers.
// ---------------------------------------------------------------------------

export const contentUnits = sqliteTable(
  "content_units",
  {
    id: id(),
    libraryId: text("library_id")
      .notNull()
      .references(() => libraries.id),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    workId: text("work_id").references(() => works.id),
    assetId: text("asset_id").references(() => documentAssets.id),
    revisionId: text("revision_id").references(() => documentRevisions.id),
    parentUnitId: text("parent_unit_id").references((): AnySQLiteColumn => contentUnits.id),
    ordinal: integer("ordinal").notNull(),
    headingPathJson: text("heading_path_json", { mode: "json" }),
    anchorJson: text("anchor_json", { mode: "json" }).notNull(),
    text: text("text").notNull(),
    language: text("language"),
    tokenCount: integer("token_count"),
    contentHash: text("content_hash").notNull(),
    extractorProfile: text("extractor_profile").notNull(),
    chunkProfile: text("chunk_profile").notNull(),
    state: text("state").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index("content_units_source_idx").on(
      table.libraryId,
      table.sourceType,
      table.sourceId,
      table.revisionId,
      table.ordinal,
    ),
    index("content_units_revision_idx").on(
      table.libraryId,
      table.revisionId,
      table.deletedAt,
      table.ordinal,
    ),
    index("content_units_hash_idx").on(table.libraryId, table.contentHash),
    check("content_units_ordinal_check", sql`${table.ordinal} >= 0`),
    check(
      "content_units_token_count_check",
      sql`${table.tokenCount} IS NULL OR ${table.tokenCount} >= 0`,
    ),
  ],
);

// Generation metadata is platform-neutral. sqlite-vec physical tables are
// intentionally excluded from Drizzle and core migrations because they exist
// only when the trusted desktop process has loaded the optional native module.
export const embeddingProfiles = sqliteTable(
  "embedding_profiles",
  {
    id: id(),
    providerKind: text("provider_kind").notNull(),
    egressMode: text("egress_mode").notNull(),
    modelId: text("model_id").notNull(),
    modelRevision: text("model_revision"),
    dimension: integer("dimension").notNull(),
    distanceMetric: text("distance_metric").notNull(),
    normalization: text("normalization").notNull(),
    chunkProfileVersion: text("chunk_profile_version").notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("embedding_profiles_fingerprint_uq").on(table.fingerprint)],
);

export const knowledgeIndexes = sqliteTable(
  "knowledge_indexes",
  {
    id: id(),
    libraryId: text("library_id")
      .notNull()
      .references(() => libraries.id),
    mode: text("mode").notNull(),
    embeddingProfileId: text("embedding_profile_id").references(() => embeddingProfiles.id),
    generation: integer("generation").notNull(),
    status: text("status").notNull(),
    sourceChangeSeq: integer("source_change_seq").notNull(),
    expectedCount: integer("expected_count").notNull(),
    indexedCount: integer("indexed_count").notNull(),
    createdAt: createdAt(),
    activatedAt: integer("activated_at"),
    retiredAt: integer("retired_at"),
    error: text("error"),
  },
  (table) => [
    uniqueIndex("knowledge_indexes_library_generation_uq").on(table.libraryId, table.generation),
    index("knowledge_indexes_library_status_idx").on(
      table.libraryId,
      table.status,
      table.generation,
    ),
    check("knowledge_indexes_generation_check", sql`${table.generation} >= 1`),
    check("knowledge_indexes_expected_count_check", sql`${table.expectedCount} >= 0`),
    check(
      "knowledge_indexes_indexed_count_check",
      sql`${table.indexedCount} >= 0 AND ${table.indexedCount} <= ${table.expectedCount}`,
    ),
  ],
);

export const knowledgeIndexEntries = sqliteTable(
  "knowledge_index_entries",
  {
    indexId: text("index_id")
      .notNull()
      .references(() => knowledgeIndexes.id),
    contentUnitId: text("content_unit_id")
      .notNull()
      .references(() => contentUnits.id),
    contentHash: text("content_hash").notNull(),
    vectorRef: text("vector_ref"),
    status: text("status").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.indexId, table.contentUnitId] }),
    index("knowledge_index_entries_index_status_idx").on(
      table.indexId,
      table.status,
      table.contentUnitId,
    ),
    index("knowledge_index_entries_content_unit_idx").on(table.contentUnitId, table.status),
  ],
);

export const knowledgeChanges = sqliteTable(
  "knowledge_changes",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    libraryId: text("library_id")
      .notNull()
      .references(() => libraries.id),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    changeKind: text("change_kind").notNull(),
    expectedRevisionId: text("expected_revision_id"),
    expectedContentHash: text("expected_content_hash"),
    createdAt: createdAt(),
  },
  (table) => [
    index("knowledge_changes_library_seq_idx").on(table.libraryId, table.seq),
    index("knowledge_changes_source_idx").on(
      table.libraryId,
      table.sourceType,
      table.sourceId,
      table.seq,
    ),
  ],
);

export const knowledgeJobs = sqliteTable(
  "knowledge_jobs",
  {
    id: id(),
    libraryId: text("library_id")
      .notNull()
      .references(() => libraries.id),
    kind: text("kind").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    expectedRevisionId: text("expected_revision_id"),
    expectedContentHash: text("expected_content_hash"),
    indexId: text("index_id"),
    sourceChangeSeq: integer("source_change_seq").references(() => knowledgeChanges.seq),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    availableAt: integer("available_at").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: integer("lease_expires_at"),
    progressJson: text("progress_json", { mode: "json" }),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("knowledge_jobs_claim_idx").on(
      table.libraryId,
      table.status,
      table.availableAt,
      table.createdAt,
      table.id,
    ),
    index("knowledge_jobs_source_idx").on(
      table.libraryId,
      table.sourceType,
      table.sourceId,
      table.updatedAt,
    ),
    check("knowledge_jobs_attempts_check", sql`${table.attempts} >= 0`),
    check("knowledge_jobs_max_attempts_check", sql`${table.maxAttempts} > 0`),
  ],
);
