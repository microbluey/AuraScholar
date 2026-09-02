import { SPATIAL_CANVAS_BACKUP_TABLES } from "@aurascholar/sync";

export const USER_BACKUP_TABLES = [
  "libraries",
  "settings",
  "works",
  "research_projects",
  "project_works",
  "authors",
  "work_authors",
  "attachments",
  "document_assets",
  "document_revisions",
  "project_assets",
  "evidence_items",
  "project_evidence",
  "evidence_shelf_items",
  "collections",
  "collection_items",
  "tags",
  "work_tags",
  "annotations",
  "annotation_comments",
  "snippets",
  ...SPATIAL_CANVAS_BACKUP_TABLES,
  "flashcards",
  "flashcard_srs",
  "flashcard_reviews",
  "citations",
  "sentinel_tasks",
  "sentinel_events",
  "discovery_sites",
  "saved_searches",
  "cv_profiles",
  "ai_jobs",
  "derived_artifacts",
] as const;

export type UserBackupTable = (typeof USER_BACKUP_TABLES)[number];

export const USER_BACKUP_TABLE_SET = new Set<string>(USER_BACKUP_TABLES);

export const GENERATED_BACKUP_ID_TABLES = [
  "research_projects",
  "project_works",
  "attachments",
  "document_assets",
  "document_revisions",
  "project_assets",
  "evidence_items",
  "project_evidence",
  "evidence_shelf_items",
  "collections",
  "annotations",
  "annotation_comments",
  "snippets",
  ...SPATIAL_CANVAS_BACKUP_TABLES,
  "flashcards",
  "flashcard_reviews",
  "sentinel_tasks",
  "sentinel_events",
  "discovery_sites",
  "saved_searches",
  "cv_profiles",
  "ai_jobs",
  "derived_artifacts",
] as const satisfies readonly UserBackupTable[];

export type GeneratedBackupIdTable = (typeof GENERATED_BACKUP_ID_TABLES)[number];
export type BackupIdTable = "authors" | "tags" | "works" | GeneratedBackupIdTable;

export const GENERATED_BACKUP_ID_TABLE_SET = new Set<UserBackupTable>(GENERATED_BACKUP_ID_TABLES);

export const SPATIAL_CANVAS_BACKUP_TABLE_SET = new Set<string>(SPATIAL_CANVAS_BACKUP_TABLES);

// These tables are deliberately account/app scoped, not Library owned. They
// are exported once in every whole-Library backup and never owner-remapped.
export const APP_GLOBAL_BACKUP_TABLES = new Set<UserBackupTable>([
  "settings",
  "discovery_sites",
  "cv_profiles",
]);

export const DIRECT_LIBRARY_BACKUP_TABLES = new Set<UserBackupTable>([
  "works",
  "research_projects",
  "authors",
  "document_assets",
  "evidence_items",
  "evidence_shelf_items",
  "collections",
  "tags",
  "canvas_workspaces",
  "sentinel_tasks",
  "saved_searches",
  "ai_jobs",
  "derived_artifacts",
]);

export const BACKUP_SCOPE_SQL: Partial<Record<UserBackupTable, string>> = {
  works: `SELECT t.* FROM works t WHERE t.library_id = ?`,
  research_projects: `SELECT t.* FROM research_projects t WHERE t.library_id = ?`,
  project_works: `SELECT t.* FROM project_works t
    JOIN research_projects p ON p.id = t.project_id
    JOIN works w ON w.id = t.work_id
    WHERE p.library_id = ? AND w.library_id = ?`,
  authors: `SELECT t.* FROM authors t WHERE t.library_id = ?`,
  work_authors: `SELECT t.* FROM work_authors t
    JOIN works w ON w.id = t.work_id
    JOIN authors a ON a.id = t.author_id
    WHERE w.library_id = ? AND a.library_id = ?`,
  attachments: `SELECT t.* FROM attachments t
    JOIN works w ON w.id = t.work_id
    WHERE w.library_id = ?`,
  document_assets: `SELECT t.* FROM document_assets t WHERE t.library_id = ?`,
  document_revisions: `SELECT t.* FROM document_revisions t
    JOIN document_assets asset ON asset.id = t.asset_id
    WHERE asset.library_id = ?`,
  project_assets: `SELECT t.* FROM project_assets t
    JOIN research_projects project ON project.id = t.project_id
    JOIN document_assets asset ON asset.id = t.asset_id
    WHERE project.library_id = ? AND asset.library_id = ?`,
  evidence_items: `SELECT t.* FROM evidence_items t WHERE t.library_id = ?`,
  project_evidence: `SELECT t.* FROM project_evidence t
    JOIN research_projects project ON project.id = t.project_id
    JOIN evidence_items evidence ON evidence.id = t.evidence_id
    WHERE project.library_id = ? AND evidence.library_id = ?`,
  evidence_shelf_items: `SELECT t.* FROM evidence_shelf_items t
    JOIN research_projects project ON project.id = t.project_id
    WHERE t.library_id = ? AND project.library_id = ?`,
  collections: `SELECT t.* FROM collections t WHERE t.library_id = ?`,
  collection_items: `SELECT t.* FROM collection_items t
    JOIN collections c ON c.id = t.collection_id
    JOIN works w ON w.id = t.work_id
    WHERE c.library_id = ? AND w.library_id = ?`,
  tags: `SELECT t.* FROM tags t WHERE t.library_id = ?`,
  work_tags: `SELECT t.* FROM work_tags t
    JOIN works w ON w.id = t.work_id
    JOIN tags tag ON tag.id = t.tag_id
    WHERE w.library_id = ? AND tag.library_id = ?`,
  annotations: `SELECT t.* FROM annotations t
    JOIN works w ON w.id = t.work_id
    JOIN attachments att ON att.id = t.attachment_id AND att.work_id = w.id
    WHERE w.library_id = ?`,
  annotation_comments: `SELECT t.* FROM annotation_comments t
    JOIN annotations ann ON ann.id = t.annotation_id
    JOIN works w ON w.id = ann.work_id
    WHERE w.library_id = ?`,
  snippets: `SELECT t.* FROM snippets t
    JOIN works w ON w.id = t.work_id
    WHERE w.library_id = ?`,
  canvas_workspaces: `SELECT t.* FROM canvas_workspaces t
    JOIN research_projects p ON p.id = t.project_id
    WHERE t.library_id = ? AND p.library_id = ?`,
  canvas_nodes: `SELECT t.* FROM canvas_nodes t
    JOIN canvas_workspaces cw ON cw.id = t.workspace_id
    WHERE cw.library_id = ?`,
  canvas_edges: `SELECT t.* FROM canvas_edges t
    JOIN canvas_workspaces cw ON cw.id = t.workspace_id
    WHERE cw.library_id = ?`,
  flashcards: `SELECT t.* FROM flashcards t
    JOIN works w ON w.id = t.work_id
    WHERE w.library_id = ?`,
  flashcard_srs: `SELECT t.* FROM flashcard_srs t
    JOIN flashcards f ON f.id = t.flashcard_id
    JOIN works w ON w.id = f.work_id
    WHERE w.library_id = ?`,
  flashcard_reviews: `SELECT t.* FROM flashcard_reviews t
    JOIN flashcards f ON f.id = t.flashcard_id
    JOIN works w ON w.id = f.work_id
    WHERE w.library_id = ?`,
  citations: `SELECT t.* FROM citations t
    JOIN works citing ON citing.id = t.citing_work_id
    JOIN works cited ON cited.id = t.cited_work_id
    WHERE citing.library_id = ? AND cited.library_id = ?`,
  sentinel_tasks: `SELECT t.* FROM sentinel_tasks t WHERE t.library_id = ?`,
  sentinel_events: `SELECT t.* FROM sentinel_events t
    JOIN sentinel_tasks st ON st.id = t.task_id
    WHERE st.library_id = ?`,
  saved_searches: `SELECT t.* FROM saved_searches t WHERE t.library_id = ?`,
  ai_jobs: `SELECT t.* FROM ai_jobs t WHERE t.library_id = ?`,
  derived_artifacts: `SELECT t.* FROM derived_artifacts t WHERE t.library_id = ?`,
};

export const BACKUP_IDENTITY_COLUMNS: Record<UserBackupTable, readonly string[]> = {
  libraries: ["id"],
  settings: ["key"],
  works: ["id"],
  research_projects: ["id"],
  project_works: ["id"],
  authors: ["id"],
  work_authors: ["work_id", "author_id"],
  attachments: ["id"],
  document_assets: ["id"],
  document_revisions: ["id"],
  project_assets: ["id"],
  evidence_items: ["id"],
  project_evidence: ["id"],
  evidence_shelf_items: ["id"],
  collections: ["id"],
  collection_items: ["collection_id", "work_id"],
  tags: ["id"],
  work_tags: ["work_id", "tag_id"],
  annotations: ["id"],
  annotation_comments: ["id"],
  snippets: ["id"],
  canvas_workspaces: ["id"],
  canvas_nodes: ["id"],
  canvas_edges: ["id"],
  flashcards: ["id"],
  flashcard_srs: ["flashcard_id"],
  flashcard_reviews: ["id"],
  citations: ["citing_work_id", "cited_work_id"],
  sentinel_tasks: ["id"],
  sentinel_events: ["id"],
  discovery_sites: ["id"],
  saved_searches: ["id"],
  cv_profiles: ["id"],
  ai_jobs: ["id"],
  derived_artifacts: ["id"],
};

export const SCOPED_DERIVED_SOURCE_TABLES = new Set<UserBackupTable>([
  "libraries",
  "works",
  "research_projects",
  "project_works",
  "authors",
  "attachments",
  "document_assets",
  "document_revisions",
  "project_assets",
  "evidence_items",
  "project_evidence",
  "evidence_shelf_items",
  "collections",
  "tags",
  "annotations",
  "annotation_comments",
  "snippets",
  "canvas_workspaces",
  "canvas_nodes",
  "canvas_edges",
  "flashcards",
  "flashcard_reviews",
  "sentinel_tasks",
  "sentinel_events",
  "saved_searches",
  "ai_jobs",
  "derived_artifacts",
]);
