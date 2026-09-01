import type { CitationGraph } from "@aurascholar/core";

/** Shared main-process and renderer bounds for Citation Graph command payloads. */
export const MAX_CITATION_GRAPH_ACTIVE_LIBRARY_DOIS = 500;
export const MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_CITATION_GRAPH_DOI_BYTES = 2_048;
export const MAX_CITATION_GRAPH_EDGES = 10_000;
export const MAX_CITATION_GRAPH_LIBRARY_ID_BYTES = 512;
export const MAX_CITATION_GRAPH_NODE_ID_BYTES = 512;
export const MAX_CITATION_GRAPH_NODE_TEXT_BYTES = 16 * 1024;
export const MAX_CITATION_GRAPH_NODES = 100;

const utf8Encoder = new TextEncoder();

export function citationGraphUtf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}

/**
 * Canonicalizes the DOI forms accepted by the historical graph cache.
 *
 * The cache predates the typed command boundary and therefore intentionally
 * remains permissive here: the command parser owns size/non-empty checks while
 * this helper only removes presentation prefixes and normalizes case.
 */
export function normalizeCitationGraphDoi(value: string): string | null {
  let normalized = value.trim();
  normalized = normalized.replace(/^doi\s*:\s*/i, "");
  normalized = normalized.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "");
  normalized = normalized.trim().toLowerCase();
  return normalized || null;
}

/** Returns the canonical DOI of the graph's single, validated center node. */
export function citationGraphCenterDoi(graph: CitationGraph): string | null {
  const centerNodes = graph.nodes.filter((node) => node.relation === "center");
  if (centerNodes.length !== 1 || centerNodes[0]?.id !== graph.centerId) return null;
  const centerNode = centerNodes[0];
  if (!centerNode || !Object.hasOwn(centerNode, "doi")) return null;
  const centerDoi = centerNode.doi;
  return typeof centerDoi === "string" ? normalizeCitationGraphDoi(centerDoi) : null;
}

/**
 * Binds a graph payload to the DOI request that produced it. A missing center
 * DOI is deliberately unbound and therefore never considered a match.
 */
export function citationGraphMatchesDoi(graph: CitationGraph, requestedDoi: string): boolean {
  const requested = normalizeCitationGraphDoi(requestedDoi);
  return requested !== null && citationGraphCenterDoi(graph) === requested;
}
