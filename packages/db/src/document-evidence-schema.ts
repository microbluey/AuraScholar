import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { libraries, works } from "./library-schema.js";
import { researchProjects } from "./research-project-schema.js";

const id = () => text("id").primaryKey();
const createdAt = () => integer("created_at").notNull();
const updatedAt = () => integer("updated_at").notNull();
const deletedAt = () => integer("deleted_at");

// Legacy PDF compatibility record. DocumentRevision is the canonical version
// identity; attachmentId is only a bridge for the current PDF Reader.
export const attachments = sqliteTable(
  "attachments",
  {
    id: id(),
    workId: text("work_id")
      .notNull()
      .references(() => works.id),
    kind: text("kind").notNull().default("pdf"),
    sha256: text("sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    originalFilename: text("original_filename"),
    sourceUrl: text("source_url"),
    fetchedVia: text("fetched_via"),
    pageCount: integer("page_count"),
    textExtractedAt: integer("text_extracted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index("attachments_work_idx").on(table.workId),
    index("attachments_sha_idx").on(table.sha256),
  ],
);

export const documentAssets = sqliteTable(
  "document_assets",
  {
    id: id(),
    libraryId: text("library_id")
      .notNull()
      .references(() => libraries.id),
    workId: text("work_id").references(() => works.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["pdf", "html", "docx", "markdown", "epub", "notebook", "supplement", "other"],
    }).notNull(),
    title: text("title").notNull(),
    // The SQL migration owns the circular FK to document_revisions plus the
    // stronger same-asset trigger. Keeping this column scalar here avoids a
    // recursive Drizzle initializer while preserving the runtime constraint.
    currentRevisionId: text("current_revision_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index("document_assets_library_active_idx").on(
      table.libraryId,
      table.deletedAt,
      table.updatedAt,
    ),
    index("document_assets_work_active_idx").on(table.workId, table.deletedAt, table.updatedAt),
    check("document_assets_title_check", sql`length(trim(${table.title})) > 0`),
  ],
);

export const documentRevisions = sqliteTable(
  "document_revisions",
  {
    id: id(),
    assetId: text("asset_id")
      .notNull()
      .references(() => documentAssets.id, { onDelete: "cascade" }),
    attachmentId: text("attachment_id")
      .references(() => attachments.id, { onDelete: "set null" })
      .unique(),
    revisionNo: integer("revision_no").notNull(),
    mimeType: text("mime_type").notNull(),
    blobSha256: text("blob_sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    sourceUrl: text("source_url"),
    extractorProfile: text("extractor_profile"),
    extractionStatus: text("extraction_status", {
      enum: ["pending", "running", "ready", "failed", "unsupported"],
    })
      .notNull()
      .default("pending"),
    availabilityStatus: text("availability_status", {
      enum: ["unchecked", "available", "missing", "relink-required"],
    })
      .notNull()
      .default("unchecked"),
    availabilityCheckedAt: integer("availability_checked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index("document_revisions_asset_active_idx").on(
      table.assetId,
      table.deletedAt,
      table.revisionNo,
      table.createdAt,
      table.id,
    ),
    index("document_revisions_blob_idx").on(table.blobSha256),
    check("document_revisions_revision_no_check", sql`${table.revisionNo} > 0`),
    check("document_revisions_byte_size_check", sql`${table.byteSize} >= 0`),
  ],
);

export const projectAssets = sqliteTable(
  "project_assets",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => researchProjects.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => documentAssets.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("source"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex("project_assets_project_asset_uq").on(table.projectId, table.assetId),
    index("project_assets_project_active_idx").on(
      table.projectId,
      table.deletedAt,
      table.updatedAt,
    ),
    index("project_assets_asset_active_idx").on(table.assetId, table.deletedAt),
  ],
);

export const evidenceItems = sqliteTable(
  "evidence_items",
  {
    id: id(),
    libraryId: text("library_id")
      .notNull()
      .references(() => libraries.id),
    workId: text("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => documentAssets.id, { onDelete: "cascade" }),
    revisionId: text("revision_id")
      .notNull()
      .references(() => documentRevisions.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind", { enum: ["document", "annotation"] }).notNull(),
    evidenceKind: text("evidence_kind", {
      enum: ["method", "data", "limitation", "definition", "context"],
    }).notNull(),
    anchorJson: text("anchor_json", { mode: "json" }).notNull(),
    payloadKind: text("payload_kind", { enum: ["text"] }).notNull(),
    payloadJson: text("payload_json", { mode: "json" }).notNull(),
    title: text("title"),
    noteMd: text("note_md"),
    tagsJson: text("tags_json", { mode: "json" }).notNull().default([]),
    sourceContentHash: text("source_content_hash").notNull(),
    provenanceJson: text("provenance_json", { mode: "json" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index("evidence_items_library_active_idx").on(
      table.libraryId,
      table.deletedAt,
      table.updatedAt,
    ),
    index("evidence_items_work_active_idx").on(table.workId, table.deletedAt, table.updatedAt),
    index("evidence_items_revision_idx").on(table.revisionId, table.deletedAt),
  ],
);

export const projectEvidence = sqliteTable(
  "project_evidence",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => researchProjects.id, { onDelete: "cascade" }),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => evidenceItems.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("evidence"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex("project_evidence_project_evidence_uq").on(table.projectId, table.evidenceId),
    index("project_evidence_project_active_idx").on(
      table.projectId,
      table.deletedAt,
      table.updatedAt,
    ),
    index("project_evidence_evidence_active_idx").on(table.evidenceId, table.deletedAt),
  ],
);
