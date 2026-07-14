export type { Clue, PdfClueSource, PdfMetadataFields } from "./ingest/clues.js";
export {
  clueFromInput,
  clueFromUrl,
  cluesFromPdfSource,
  cluesFromPdfText,
  titleCandidatesFromPdfSource,
} from "./ingest/clues.js";
export type { ResolvedWork } from "./ingest/resolve.js";
export { resolveClue, findOaPdf, titleSimilarity } from "./ingest/resolve.js";
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
  mergeDiscoveryResults,
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
