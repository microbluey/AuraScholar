export * as schema from "./schema.js";
export { MIGRATIONS, runMigrations } from "./migrations.js";
export type { SqlExecutor, Migration } from "./migrations.js";
export {
  documentAssetIdFromAttachment,
  documentRevisionIdFromAttachment,
  newId,
  normalizeDoi,
  projectAssetMembershipId,
  projectEvidenceMembershipId,
  projectWorkMembershipId,
  workFingerprint,
} from "./ids.js";
export {
  ensureLocalFirstState,
  ensureLocalLibraryIdentity,
  requireLocalLibraryId,
  LOCAL_LIBRARY_ID_KEY,
} from "./local-first.js";
export type { LocalFirstState, EnsureLocalFirstOptions } from "./local-first.js";
export type { Database } from "./database.js";
export { WorksRepo } from "./repos/works.js";
export type {
  WorkInput,
  WorkRow,
  WorkWithAuthors,
  WorkPatch,
  WorkAuthorInput,
  WorkAuthorDetail,
  AuthorRole,
  ReadingStatus,
  RichBibFields,
} from "./repos/works.js";
export { AnnotationsRepo } from "./repos/annotations.js";
export type { AnnotationInput, AnnotationRow } from "./repos/annotations.js";
export { AttachmentsRepo } from "./repos/attachments.js";
export type { AttachmentInput, AttachmentRow } from "./repos/attachments.js";
export { DocumentAssetScopeError, DocumentAssetsRepo } from "./repos/document-assets.js";
export type {
  AttachmentRevisionSource,
  CreateDocumentAssetInput,
  CreateDocumentRevisionInput,
  DocumentAssetKind,
  DocumentAssetRow,
  DocumentAvailabilityStatus,
  DocumentExtractionStatus,
  DocumentRevisionRow,
} from "./repos/document-assets.js";
export { EvidenceRepo, EvidenceScopeError } from "./repos/evidence.js";
export type {
  CreateTextEvidenceInput,
  EvidenceKind,
  EvidenceRecord,
  PdfTextEvidenceAnchorInput,
} from "./repos/evidence.js";
export { FlashcardsRepo, Rating } from "./repos/flashcards.js";
export type { FlashcardInput, FlashcardRow, DueCard } from "./repos/flashcards.js";
export { SentinelRepo } from "./repos/sentinel.js";
export type { SentinelTaskRow, SentinelEventRow } from "./repos/sentinel.js";
export { CollectionsRepo } from "./repos/collections.js";
export type { CollectionRow } from "./repos/collections.js";
export { TagsRepo } from "./repos/tags.js";
export type { TagRow } from "./repos/tags.js";
export { SnippetsRepo } from "./repos/snippets.js";
export type { SnippetRow, SnippetInput, SnippetWithWork } from "./repos/snippets.js";
export { SavedSearchesRepo } from "./repos/saved-searches.js";
export type { SavedSearchRow, SavedSearchInput } from "./repos/saved-searches.js";
export {
  LastActiveResearchProjectError,
  ResearchProjectScopeError,
  ResearchProjectsRepo,
} from "./repos/research-projects.js";
export type {
  ResearchProjectInput,
  ResearchProjectRow,
  ResearchProjectStatus,
} from "./repos/research-projects.js";
export {
  DEFAULT_RESEARCH_PROJECT_ID,
  DEFAULT_RESEARCH_PROJECT_NAME,
  scopedDefaultResearchProjectId,
} from "./research-project-defaults.js";
export {
  CanvasRepo,
  DEFAULT_CANVAS_WORKSPACE_ID,
  DEFAULT_CANVAS_WORKSPACE_NAME,
  STORED_CANVAS_EDGE_RELATIONS,
  STORED_CANVAS_NODE_TYPES,
} from "./repos/canvas.js";
export type {
  CanvasWorkspaceSummary,
  StoredCanvasDimensions,
  StoredCanvasEdge,
  StoredCanvasEdgeRelation,
  StoredCanvasEdgeStyle,
  StoredCanvasNode,
  StoredCanvasNodeType,
  StoredCanvasPoint,
  StoredCanvasViewport,
  StoredCanvasWorkspaceDocument,
} from "./repos/canvas.js";
