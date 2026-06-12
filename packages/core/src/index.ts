export type { Clue } from "./ingest/clues";
export { clueFromInput, clueFromUrl, cluesFromPdfText } from "./ingest/clues";
export type { ResolvedWork } from "./ingest/resolve";
export { resolveClue, findOaPdf, titleSimilarity } from "./ingest/resolve";
export { buildCitationGraph } from "./graph/build";
export type { CitationGraph, GraphNode, GraphEdge, GraphRelation } from "./graph/build";
export { layoutTimeline } from "./graph/layout";
export type { GraphLayout, PositionedNode } from "./graph/layout";
export {
  SENTINEL_STATES,
  STATE_LABEL,
  deriveMilestones,
  isTerminal,
  nextPollInterval,
  stateRank,
} from "./sentinel/states";
export type { SentinelState, MilestoneEvidence, CheckOutcome } from "./sentinel/states";
export { checkDoi } from "./sentinel/check";
export type { SentinelCheckResult } from "./sentinel/check";
export { findDoiByTitle, TITLE_MATCH_THRESHOLD } from "./sentinel/title-match";
export type { TitleMatchHints, TitleMatchResult } from "./sentinel/title-match";
