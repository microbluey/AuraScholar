import { type CitationGraph, type GraphEdge, type GraphNode } from "@aurascholar/core";
import type { CitationGraphCacheEntry } from "../../electron/data-command-contract";
import { buildScholarlyCitationGraph } from "./scholarly-data";

export const CITATION_GRAPH_CACHE_TTL_MS = 7 * 86_400_000;

const MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES = 2 * 1024 * 1024;
const MAX_CITATION_GRAPH_DOI_LENGTH = 2_048;
const MAX_CITATION_GRAPH_EDGES = 10_000;
const MAX_CITATION_GRAPH_NODE_ID_LENGTH = 512;
const MAX_CITATION_GRAPH_NODE_TEXT_LENGTH = 16_384;
const MAX_CITATION_GRAPH_NODES = 100;

export type CitationGraphBuilder = (
  doi: string,
  signal?: AbortSignal,
) => Promise<CitationGraph | null | undefined>;

export interface LoadCitationGraphOptions {
  buildGraph?: CitationGraphBuilder;
  cacheTtlMs?: number;
  cache?: CitationGraphCacheDataSource;
  forceRefresh?: boolean;
  now?: () => number;
  signal?: AbortSignal;
}

/** Testable cache boundary; main owns the cache key and record mutations. */
export interface CitationGraphCacheDataSource {
  getCached: (rawDoi: string) => Promise<CitationGraphCacheEntry | null>;
  putCached: (doi: string, graph: CitationGraph) => Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  requiredFields: readonly string[],
  optionalFields: readonly string[] = [],
): boolean {
  const allowedFields = [...requiredFields, ...optionalFields];
  return (
    Object.keys(value).every((field) => allowedFields.includes(field)) &&
    requiredFields.every((field) => Object.hasOwn(value, field))
  );
}

function isCitationGraphText(value: unknown, maximum: number, requireNonEmpty = false): boolean {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (!requireNonEmpty || value.trim().length > 0)
  );
}

function isOptionalCitationGraphText(value: unknown, maximum: number): boolean {
  return value === undefined || isCitationGraphText(value, maximum);
}

function isOptionalCitationGraphYear(value: unknown): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10_000)
  );
}

function isGraphNode(value: unknown): value is GraphNode {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(
      value,
      ["id", "title", "citedByCount", "relation"],
      ["year", "doi", "venue", "firstAuthor"],
    )
  ) {
    return false;
  }
  if (value.relation !== "center" && value.relation !== "reference" && value.relation !== "citer") {
    return false;
  }
  return (
    isCitationGraphText(value.id, MAX_CITATION_GRAPH_NODE_ID_LENGTH, true) &&
    isCitationGraphText(value.title, MAX_CITATION_GRAPH_NODE_TEXT_LENGTH) &&
    Number.isSafeInteger(value.citedByCount) &&
    (value.citedByCount as number) >= 0 &&
    isOptionalCitationGraphYear(value.year) &&
    isOptionalCitationGraphText(value.doi, MAX_CITATION_GRAPH_DOI_LENGTH) &&
    isOptionalCitationGraphText(value.venue, MAX_CITATION_GRAPH_NODE_TEXT_LENGTH) &&
    isOptionalCitationGraphText(value.firstAuthor, MAX_CITATION_GRAPH_NODE_TEXT_LENGTH)
  );
}

function isGraphEdge(value: unknown): value is GraphEdge {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["source", "target"]) &&
    isCitationGraphText(value.source, MAX_CITATION_GRAPH_NODE_ID_LENGTH, true) &&
    isCitationGraphText(value.target, MAX_CITATION_GRAPH_NODE_ID_LENGTH, true)
  );
}

export function isCitationGraph(value: unknown): value is CitationGraph {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(value, ["centerId", "nodes", "edges", "truncated"]) ||
    !isCitationGraphText(value.centerId, MAX_CITATION_GRAPH_NODE_ID_LENGTH, true) ||
    typeof value.truncated !== "boolean" ||
    !Array.isArray(value.nodes) ||
    value.nodes.length === 0 ||
    value.nodes.length > MAX_CITATION_GRAPH_NODES ||
    !Array.isArray(value.edges) ||
    value.edges.length > MAX_CITATION_GRAPH_EDGES
  ) {
    return false;
  }
  if (!value.nodes.every(isGraphNode) || !value.edges.every(isGraphEdge)) return false;

  const nodeIds = new Set(value.nodes.map((node) => node.id));
  if (nodeIds.size !== value.nodes.length) return false;
  const centerNodes = value.nodes.filter((node) => node.relation === "center");
  if (centerNodes.length !== 1 || centerNodes[0]?.id !== value.centerId) return false;

  const edgeKeys = new Set<string>();
  for (const edge of value.edges) {
    if (edge.source === edge.target || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return false;
    }
    const key = `${edge.source}\u0000${edge.target}`;
    if (edgeKeys.has(key)) return false;
    edgeKeys.add(key);
  }

  try {
    const serialized = JSON.stringify(value);
    return (
      new TextEncoder().encode(serialized).byteLength <= MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES
    );
  } catch {
    return false;
  }
}

export function parseCachedCitationGraph(payload: string): CitationGraph | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    return isCitationGraph(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeCitationGraphDoi(value: string): string | null {
  let normalized = value.trim();
  normalized = normalized.replace(/^doi\s*:\s*/i, "");
  normalized = normalized.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "");
  normalized = normalized.trim().toLowerCase();
  return normalized || null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Request aborted");
  error.name = "AbortError";
  throw error;
}

async function defaultBuildGraph(doi: string, signal?: AbortSignal): Promise<CitationGraph | null> {
  return (await buildScholarlyCitationGraph({ doi }, signal)).graph;
}

const defaultCacheDataSource: CitationGraphCacheDataSource = {
  async getCached(rawDoi) {
    return (await window.aura.data.command("citationGraph.getCached", { doi: rawDoi })).entry;
  },
  async putCached(doi, graph) {
    return (await window.aura.data.command("citationGraph.putCached", { doi, graph })).stored;
  },
};

export async function loadCitationGraphByDoi(
  rawDoi: string,
  options: LoadCitationGraphOptions = {},
): Promise<CitationGraph | null> {
  const doi = normalizeCitationGraphDoi(rawDoi);
  if (!doi) return null;
  const signal = options.signal;
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? CITATION_GRAPH_CACHE_TTL_MS;
  const cache = options.cache ?? defaultCacheDataSource;
  throwIfAborted(signal);

  if (!options.forceRefresh) {
    // The raw value is intentional: main resolves the normalized key and its
    // historical raw-key variant atomically before returning an entry.
    const entry = await cache.getCached(rawDoi);
    throwIfAborted(signal);
    if (entry && now() - entry.fetchedAt < cacheTtlMs && isCitationGraph(entry.graph)) {
      return entry.graph;
    }
  }

  const overriddenGraph = options.buildGraph ? await options.buildGraph(doi, signal) : undefined;
  const graph =
    overriddenGraph === undefined ? await defaultBuildGraph(doi, signal) : overriddenGraph;
  throwIfAborted(signal);
  if (!isCitationGraph(graph)) return null;
  await cache.putCached(doi, graph);
  throwIfAborted(signal);
  return graph;
}
