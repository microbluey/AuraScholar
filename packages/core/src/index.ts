export type { Clue, PdfClueSource, PdfMetadataFields } from "./ingest/clues.js";
export {
  clueFromInput,
  clueFromUrl,
  cluesFromPdfSource,
  cluesFromPdfText,
  titleCandidatesFromPdfSource,
} from "./ingest/clues.js";
export type { OaPdfCandidate, OaPdfSource, ResolvedWork } from "./ingest/resolve.js";
export { resolveClue, findOaPdf, findOaPdfCandidates, titleSimilarity } from "./ingest/resolve.js";
export { buildCitationGraph } from "./graph/build.js";
export type { CitationGraph, GraphNode, GraphEdge, GraphRelation } from "./graph/build.js";
export { layoutTimeline } from "./graph/layout.js";
export type { GraphLayout, PositionedNode } from "./graph/layout.js";
export {
  SENTINEL_STATES,
  STATE_LABEL,
  deriveMilestones,
  isTerminal,
  nextPollInterval,
  stateRank,
} from "./sentinel/states.js";
export type { SentinelState, MilestoneEvidence, CheckOutcome } from "./sentinel/states.js";
export { checkDoi } from "./sentinel/check.js";
export type { SentinelCheckResult } from "./sentinel/check.js";
export { findDoiByTitle, TITLE_MATCH_THRESHOLD } from "./sentinel/title-match.js";
export type { TitleMatchHints, TitleMatchResult } from "./sentinel/title-match.js";
export {
  hasConflictingDiscoveryIdentifiers,
  mergeDiscoveryResults,
  sameDiscoveryWorkIdentity,
  searchOpenSources,
  searchOpenSourcesDetailed,
} from "./discovery/search.js";
export type {
  DiscoveryQuery,
  DiscoveryResult,
  DiscoverySearchOptions,
  DiscoverySearchReport,
  DiscoverySort,
  DiscoverySource,
  DiscoverySourceReport,
  DiscoverySourceStatus,
  SourceCursor,
} from "./discovery/search.js";
export { CANVAS_SCHEMA_VERSION } from "./canvas/types.js";
export {
  applyCanvasLayout,
  CANVAS_COMPACT_GRID_HORIZONTAL_GAP,
  CANVAS_COMPACT_GRID_VERTICAL_GAP,
  CANVAS_GROUP_LAYOUT_PADDING,
  CANVAS_TIMELINE_HORIZONTAL_GAP,
  CANVAS_TREE_HORIZONTAL_GAP,
  CANVAS_TREE_VERTICAL_GAP,
  planCanvasLayout,
} from "./canvas/layout.js";
export { RESEARCH_PROJECT_STATUSES, isActiveResearchProject } from "./project/types.js";
export type {
  ProjectWorkMembership,
  ResearchProject,
  ResearchProjectStatus,
} from "./project/types.js";
export {
  DOCUMENT_ASSET_KINDS,
  DOCUMENT_AVAILABILITY_STATUSES,
  DOCUMENT_EXTRACTION_STATUSES,
} from "./document/types.js";
export type {
  DocumentAsset,
  DocumentAssetKind,
  DocumentAvailabilityStatus,
  DocumentExtractionStatus,
  DocumentRevision,
  DocumentRevisionPosition,
  ResolvedDocumentRevision,
} from "./document/types.js";
export { EVIDENCE_KINDS, EVIDENCE_PAYLOAD_KINDS } from "./evidence/types.js";
export type {
  EvidenceItem,
  EvidenceKind,
  EvidencePayload,
  EvidencePayloadKind,
  EvidenceProvenance,
  EvidenceRevisionState,
  EvidenceSourceKind,
  EvidenceTextPayload,
} from "./evidence/types.js";
export { parseSourceAnchor } from "./evidence/source-anchor.js";
export type {
  CanvasSourceAnchor,
  EpubSourceAnchor,
  ManuscriptSourceAnchor,
  PdfQuadRect,
  PdfQuadSelector,
  PdfSourceAnchor,
  SourceAnchor,
  StructuralTextSourceAnchor,
  TextPositionSelector,
  TextQuoteSelector,
} from "./evidence/source-anchor.js";
export type {
  AISynthesisType,
  AISynthNode,
  AISynthNodeData,
  AnyCanvasNode,
  CanvasDimensions,
  CanvasEdge,
  CanvasEdgeRelation,
  CanvasEdgeStyle,
  CanvasJsonValue,
  CanvasNode,
  CanvasNodeBase,
  CanvasNodeDataByType,
  CanvasNodeType,
  CanvasPoint,
  CanvasSchemaVersion,
  CanvasViewport,
  CanvasWorkspaceDocument,
  ExcerptHighlightColor,
  ExcerptNode,
  ExcerptNodeData,
  GroupContainerNode,
  GroupNode,
  GroupNodeData,
  IdeaNoteNode,
  IdeaNoteNodeData,
  PaperNode,
  PaperNodeData,
} from "./canvas/types.js";
export type {
  CanvasCitationRelation,
  CanvasLayoutErrorPlan,
  CanvasLayoutFailure,
  CanvasLayoutGroupResize,
  CanvasLayoutMode,
  CanvasLayoutNodePosition,
  CanvasLayoutPlan,
  CanvasLayoutSuccessPlan,
} from "./canvas/layout.js";
