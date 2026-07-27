import {
  buildCitationGraph,
  type CitationGraph,
  type GraphEdge,
  type GraphNode,
} from "@aurascholar/core";
import type { Database } from "@aurascholar/db";
import type { ConnectorContext } from "@aurascholar/connectors";
import { getDb } from "./aura-db";
import { auraHttp } from "./aura-platform";

const connectorContext: ConnectorContext = {
  http: auraHttp,
  mailto: "contact@aurascholar.app",
};

export const CITATION_GRAPH_CACHE_TTL_MS = 7 * 86_400_000;

export type CitationGraphBuilder = (
  doi: string,
  signal?: AbortSignal,
) => Promise<CitationGraph | null | undefined>;

export interface LoadCitationGraphOptions {
  buildGraph?: CitationGraphBuilder;
  cacheTtlMs?: number;
  db?: Database;
  forceRefresh?: boolean;
  now?: () => number;
  signal?: AbortSignal;
}

interface CachedCitationGraphRow {
  fetched_at: number;
  payload_json: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isGraphNode(value: unknown): value is GraphNode {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.title !== "string") return false;
  if (value.relation !== "center" && value.relation !== "reference" && value.relation !== "citer") {
    return false;
  }
  return (
    isOptionalFiniteNumber(value.year) &&
    isFiniteNumber(value.citedByCount) &&
    isOptionalString(value.doi) &&
    isOptionalString(value.venue) &&
    isOptionalString(value.firstAuthor)
  );
}

function isGraphEdge(value: unknown): value is GraphEdge {
  return isRecord(value) && typeof value.source === "string" && typeof value.target === "string";
}

export function isCitationGraph(value: unknown): value is CitationGraph {
  if (!isRecord(value)) return false;
  if (
    typeof value.centerId !== "string" ||
    typeof value.truncated !== "boolean" ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges)
  ) {
    return false;
  }
  return (
    value.nodes.every(isGraphNode) &&
    value.nodes.some((node) => node.id === value.centerId) &&
    value.edges.every(isGraphEdge)
  );
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
  return buildCitationGraph(connectorContext, { doi }, { signal });
}

export async function loadCitationGraphByDoi(
  rawDoi: string,
  options: LoadCitationGraphOptions = {},
): Promise<CitationGraph | null> {
  const doi = normalizeCitationGraphDoi(rawDoi);
  if (!doi) return null;
  const legacyCacheKey = rawDoi.trim();
  const signal = options.signal;
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? CITATION_GRAPH_CACHE_TTL_MS;
  const db = options.db ?? (await getDb());
  throwIfAborted(signal);

  if (!options.forceRefresh) {
    const cacheKeys = legacyCacheKey && legacyCacheKey !== doi ? [doi, legacyCacheKey] : [doi];
    for (const cacheKey of cacheKeys) {
      const cached = await db.query<CachedCitationGraphRow>(
        `SELECT payload_json, fetched_at FROM graph_cache WHERE work_id = ?`,
        [cacheKey],
      );
      throwIfAborted(signal);
      const row = cached[0];
      if (!row) continue;
      const graph =
        now() - row.fetched_at < cacheTtlMs ? parseCachedCitationGraph(row.payload_json) : null;
      if (graph) {
        if (cacheKey !== doi) {
          await db.run(
            `INSERT OR IGNORE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
            [doi, row.payload_json, row.fetched_at],
          );
          throwIfAborted(signal);
          await db.run(`DELETE FROM graph_cache WHERE work_id = ?`, [cacheKey]);
          throwIfAborted(signal);
        }
        return graph;
      }
      await db.run(`DELETE FROM graph_cache WHERE work_id = ?`, [cacheKey]);
      throwIfAborted(signal);
    }
  }

  const overriddenGraph = options.buildGraph ? await options.buildGraph(doi, signal) : undefined;
  const graph =
    overriddenGraph === undefined ? await defaultBuildGraph(doi, signal) : overriddenGraph;
  throwIfAborted(signal);
  if (!isCitationGraph(graph)) return null;
  await db.run(
    `INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
    [doi, JSON.stringify(graph), now()],
  );
  throwIfAborted(signal);
  return graph;
}
