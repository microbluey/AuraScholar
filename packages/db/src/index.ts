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
export { locateWorkPageOffset, queryWorkPage } from "./work-page.js";
export type {
  WorkPageBrowseSummary,
  WorkPageDeletedScope,
  WorkPageFilter,
  WorkPagePdfFilter,
  WorkPageQuery,
  WorkPageResult,
  WorkPageSort,
} from "./work-page.js";
export { KnowledgeJobWorker } from "./knowledge-worker.js";
export type {
  KnowledgeJobExecutor,
  KnowledgeJobQueue,
  KnowledgeJobWorkerOptions,
  KnowledgeJobWorkerResult,
} from "./knowledge-worker.js";
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
export { EvidenceInboxRepo } from "./repos/evidence-inbox.js";
export type {
  EvidenceAvailabilityStatus,
  EvidenceCanonicalStatus,
  EvidenceInboxItemDto,
  EvidenceProjectMembershipDto,
  EvidenceRevisionStatus,
  EvidenceSearchScope,
  SearchEvidenceInput,
  SearchEvidenceResult,
} from "./repos/evidence-inbox.js";
export { EvidenceShelfRepo, EvidenceShelfScopeError } from "./repos/evidence-shelf.js";
export type {
  EvidenceShelfItem,
  EvidenceShelfListInput,
  EvidenceShelfRemoveInput,
  EvidenceShelfResolveForSaveInput,
  EvidenceShelfResolveForSaveResult,
  EvidenceShelfScope,
  EvidenceShelfStageInput,
  EvidenceShelfStageResult,
  EvidenceShelfStatus,
} from "./repos/evidence-shelf.js";
export { promoteEvidenceShelfItem } from "./repos/evidence-shelf-promotion.js";
export type {
  PromoteEvidenceShelfInput,
  PromoteEvidenceShelfResult,
} from "./repos/evidence-shelf-promotion.js";
export {
  assertEvidenceShelfListBudget,
  MAX_EVIDENCE_SHELF_LIST_BYTES,
  MAX_EVIDENCE_SHELF_LIST_ROW_OVERHEAD_BYTES,
  MAX_EVIDENCE_SHELF_LIST_ROWS,
  readEvidenceShelfListBudget,
} from "./repos/evidence-shelf-bounds.js";
export type { EvidenceShelfListBudget } from "./repos/evidence-shelf-bounds.js";
export {
  CONTENT_UNIT_SOURCE_TYPES,
  CONTENT_UNIT_STATES,
  KNOWLEDGE_CHANGE_KINDS,
  KNOWLEDGE_CHANGE_SOURCE_TYPES,
  KNOWLEDGE_JOB_KINDS,
  KNOWLEDGE_JOB_STATUSES,
  ContentUnitSearchRepo,
  ContentUnitsRepo,
  KnowledgeCorpusScopeError,
  KnowledgeCorpusScopeRepo,
  KnowledgeChangesRepo,
  KnowledgeJobsRepo,
  assertKnowledgeJobLease,
  assertKnowledgeJobLeaseForLibrary,
  isKnowledgeJobLeaseLostError,
  KnowledgeJobLeaseLostError,
  appendKnowledgeChangeInTransaction,
  appendContentUnitCanonicalVisibilityClause,
  contentUnitCanonicalVisibilitySql,
  knowledgeJobRetryDelayMs,
  summarizeKnowledgeJobError,
} from "./repos/knowledge.js";
export type {
  AppendKnowledgeChangeInput,
  CancelKnowledgeJobOptions,
  ClaimKnowledgeJobOptions,
  ContentUnit,
  ContentUnitIndexStats,
  ContentUnitRow,
  ContentUnitSearchResult,
  ContentUnitSourceType,
  ContentUnitState,
  EnqueueKnowledgeJobInput,
  FailKnowledgeJobOptions,
  KnowledgeChangeKind,
  KnowledgeChangeRow,
  KnowledgeChangeSourceType,
  KnowledgeJobKind,
  KnowledgeJobLeaseOptions,
  KnowledgeJobRow,
  KnowledgeJobLeaseSnapshot,
  KnowledgeJobStatus,
  ReplaceContentUnitsInput,
  SearchContentUnitsInput,
  ContentUnitVisibilityOptions,
  KnowledgeCorpusScope,
  KnowledgeCorpusScopeResolution,
  KnowledgeCorpusScopeSelection,
} from "./repos/knowledge.js";
export {
  EMBEDDING_DISTANCE_METRICS,
  EMBEDDING_EGRESS_MODES,
  EMBEDDING_NORMALIZATIONS,
  KNOWLEDGE_INDEX_ENTRY_STATUSES,
  KNOWLEDGE_INDEX_MODES,
  KNOWLEDGE_INDEX_STATUSES,
  EmbeddingProfilesRepo,
  KnowledgeIndexesRepo,
} from "./repos/knowledge-indexes.js";
export type {
  BeginKnowledgeIndexInput,
  EmbeddingDistanceMetric,
  EmbeddingEgressMode,
  EmbeddingNormalization,
  EmbeddingProfileInput,
  EmbeddingProfileRow,
  KnowledgeIndexEntryRow,
  KnowledgeIndexEntryStatus,
  KnowledgeIndexMode,
  KnowledgeIndexRow,
  KnowledgeIndexStatus,
  MarkKnowledgeIndexVectorReadyInput,
  PendingKnowledgeIndexEntry,
} from "./repos/knowledge-indexes.js";
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
export {
  MAX_CANVAS_EDGE_RELATION_BYTES,
  MAX_CANVAS_EDGE_STYLE_JSON_BYTES,
  MAX_CANVAS_EDGE_LABEL_BYTES,
  MAX_CANVAS_EDGES,
  MAX_CANVAS_JSON_COLLECTION_ITEMS,
  MAX_CANVAS_JSON_DEPTH,
  MAX_CANVAS_JSON_KEY_BYTES,
  MAX_CANVAS_JSON_TEXT_BYTES,
  MAX_CANVAS_NODE_TAG_BYTES,
  MAX_CANVAS_NODE_TAGS_JSON_BYTES,
  MAX_CANVAS_NODE_TAGS,
  MAX_CANVAS_NODE_TYPE_BYTES,
  MAX_CANVAS_NODES,
  MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
  MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES,
  MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
  MAX_CANVAS_WORKSPACE_LIST_BYTES,
  MAX_CANVAS_WORKSPACE_LIST_ROWS,
  MAX_CANVAS_WORKSPACE_NAME_BYTES,
} from "./repos/canvas-workspace-bounds.js";
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
