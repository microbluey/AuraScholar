import { Buffer } from "node:buffer";
import type { CitationGraph, GraphEdge, GraphNode } from "@aurascholar/core";
import type {
  CitationGraphBuildCommandResult,
  CitationGraphBuildServiceResult,
} from "../scholarly-command-contract";
import {
  CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION,
  CITATION_GRAPH_PROVIDER,
  CITATION_GRAPH_PROVIDER_VERSION,
  createOpenAlexCitationGraphProvenance,
  type CitationGraphProvenance,
} from "../../src/shared/citation-graph-provenance";
import {
  citationGraphCenterDoi,
  normalizeCitationGraphDoi,
  MAX_CITATION_GRAPH_DOI_BYTES,
  MAX_CITATION_GRAPH_EDGES,
  MAX_CITATION_GRAPH_NODE_ID_BYTES,
  MAX_CITATION_GRAPH_NODE_TEXT_BYTES,
  MAX_CITATION_GRAPH_NODES,
  MAX_CITATION_GRAPH_PROVENANCE_BYTES,
} from "../../src/shared/citation-graph-limits";

const MAX_GRAPH_EDGES = MAX_CITATION_GRAPH_EDGES;
const MAX_GRAPH_NODE_ID_BYTES = MAX_CITATION_GRAPH_NODE_ID_BYTES;
const MAX_GRAPH_NODES = MAX_CITATION_GRAPH_NODES;
const MAX_GRAPH_NODE_TEXT_BYTES = MAX_CITATION_GRAPH_NODE_TEXT_BYTES;

/** Sanitizes a graph without allowing malformed topology across IPC. */
export function sanitizeCitationGraph(value: CitationGraph | null): CitationGraph | null {
  if (
    !value ||
    typeof value !== "object" ||
    !Object.hasOwn(value, "centerId") ||
    !Object.hasOwn(value, "nodes") ||
    !Object.hasOwn(value, "edges") ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges)
  ) {
    return null;
  }
  const nodes = value.nodes
    .slice(0, MAX_GRAPH_NODES)
    .map(sanitizeGraphNode)
    .filter((node): node is GraphNode => node !== null);
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length || nodes.length === 0) return null;
  const centerId = safeIdentifier(value.centerId, MAX_GRAPH_NODE_ID_BYTES);
  const centers = nodes.filter((node) => node.relation === "center");
  if (!centerId || centers.length !== 1 || centers[0]?.id !== centerId) return null;

  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const valueEdge of value.edges.slice(0, MAX_GRAPH_EDGES)) {
    const edge = sanitizeGraphEdge(valueEdge, nodeIds);
    if (!edge) continue;
    const key = JSON.stringify([edge.source, edge.target]);
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push(edge);
  }
  return { centerId, edges, nodes, truncated: value.truncated === true };
}

/** Adds the provider contract at the public IPC boundary. */
export function sanitizeCitationGraphBuild(
  value: CitationGraphBuildServiceResult,
  requestedDoi: string,
): CitationGraphBuildCommandResult {
  const explicitSnapshot = isCitationGraphSnapshot(value) ? value : null;
  const rawGraph = explicitSnapshot ? explicitSnapshot.graph : value;
  const graph = sanitizeCitationGraph(rawGraph as CitationGraph | null);
  if (!graph) return { graph: null, provenance: null };

  const normalizedRequestedDoi = normalizeCitationGraphDoi(requestedDoi);
  if (!normalizedRequestedDoi) return { graph: null, provenance: null };
  const centerDoi = citationGraphCenterDoi(graph);
  if (explicitSnapshot) {
    const provenance = sanitizeCitationGraphProvenance(
      explicitSnapshot.provenance,
      normalizedRequestedDoi,
      centerDoi,
    );
    if (!provenance) throw new Error("Citation graph provenance is invalid");
    return { graph, provenance };
  }
  // A graph whose center cannot be bound is useful to an internal view, but
  // the public command must never emit an impossible graph+null envelope.
  if (centerDoi !== normalizedRequestedDoi) return { graph: null, provenance: null };
  return {
    graph,
    provenance: createOpenAlexCitationGraphProvenance({
      capturedAt: Date.now(),
      centerDoi,
      requestedDoi: normalizedRequestedDoi,
    }),
  };
}

function isCitationGraphSnapshot(value: CitationGraphBuildServiceResult): value is {
  graph: CitationGraph;
  provenance: CitationGraphProvenance;
} {
  return isRecord(value) && Object.hasOwn(value, "graph") && Object.hasOwn(value, "provenance");
}

function sanitizeCitationGraphProvenance(
  value: unknown,
  requestedDoi: string,
  centerDoi: string | null,
): CitationGraphProvenance | null {
  if (!isExactProvenanceRecord(value)) return null;
  const requested = canonicalProvenanceDoi(value.requestedDoi);
  const center = canonicalProvenanceDoi(value.centerDoi);
  if (
    value.schemaVersion !== CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION ||
    value.provider !== CITATION_GRAPH_PROVIDER ||
    value.providerVersion !== CITATION_GRAPH_PROVIDER_VERSION ||
    requested !== requestedDoi ||
    center === null ||
    center !== centerDoi ||
    requested !== center ||
    !Number.isSafeInteger(value.capturedAt) ||
    (value.capturedAt as number) < 0
  ) {
    return null;
  }
  const provenance: CitationGraphProvenance = {
    capturedAt: value.capturedAt as number,
    centerDoi: center,
    provider: CITATION_GRAPH_PROVIDER,
    providerVersion: CITATION_GRAPH_PROVIDER_VERSION,
    requestedDoi,
    schemaVersion: CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION,
  };
  try {
    return Buffer.byteLength(JSON.stringify(provenance), "utf8") <=
      MAX_CITATION_GRAPH_PROVENANCE_BYTES
      ? provenance
      : null;
  } catch {
    return null;
  }
}

const PROVENANCE_FIELDS = [
  "capturedAt",
  "centerDoi",
  "provider",
  "providerVersion",
  "requestedDoi",
  "schemaVersion",
] as const;

function isExactProvenanceRecord(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    !Object.keys(value).some(
      (field) => !PROVENANCE_FIELDS.includes(field as (typeof PROVENANCE_FIELDS)[number]),
    ) &&
    PROVENANCE_FIELDS.every((field) => Object.hasOwn(value, field))
  );
}

function canonicalProvenanceDoi(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    !trimmed ||
    containsControlCharacter(trimmed) ||
    Buffer.byteLength(trimmed, "utf8") > MAX_CITATION_GRAPH_DOI_BYTES
  ) {
    return null;
  }
  return normalizeCitationGraphDoi(trimmed);
}

function sanitizeGraphNode(value: unknown): GraphNode | null {
  if (!isRecord(value)) return null;
  if (!hasOwnFields(value, ["id", "title", "citedByCount", "relation"])) return null;
  const id = safeIdentifier(value.id, MAX_GRAPH_NODE_ID_BYTES);
  const title = safeText(value.title, MAX_GRAPH_NODE_TEXT_BYTES);
  if (!id || !title || !isGraphRelation(value.relation)) return null;
  // DOI is an identity, not display text: truncating it could turn an
  // oversized/attacker-controlled identifier into a different trusted one.
  const doi = Object.hasOwn(value, "doi") ? safeDoi(value.doi) : undefined;
  const firstAuthor = Object.hasOwn(value, "firstAuthor")
    ? safeText(value.firstAuthor, MAX_GRAPH_NODE_TEXT_BYTES)
    : undefined;
  const venue = Object.hasOwn(value, "venue")
    ? safeText(value.venue, MAX_GRAPH_NODE_TEXT_BYTES)
    : undefined;
  const year = Object.hasOwn(value, "year") ? safeYear(value.year) : undefined;
  return {
    citedByCount: safeCount(value.citedByCount) ?? 0,
    ...(doi === undefined ? {} : { doi }),
    ...(firstAuthor === undefined ? {} : { firstAuthor }),
    id,
    relation: value.relation,
    title,
    ...(venue === undefined ? {} : { venue }),
    ...(year === undefined ? {} : { year }),
  };
}

function sanitizeGraphEdge(value: unknown, nodeIds: ReadonlySet<string>): GraphEdge | null {
  if (!isRecord(value)) return null;
  if (!hasOwnFields(value, ["source", "target"])) return null;
  const source = safeIdentifier(value.source, MAX_GRAPH_NODE_ID_BYTES);
  const target = safeIdentifier(value.target, MAX_GRAPH_NODE_ID_BYTES);
  if (!source || !target || source === target || !nodeIds.has(source) || !nodeIds.has(target)) {
    return null;
  }
  return { source, target };
}

function isGraphRelation(value: unknown): value is GraphNode["relation"] {
  return value === "center" || value === "reference" || value === "citer";
}

function safeText(value: unknown, maximumBytes: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    // eslint-disable-next-line no-control-regex -- external metadata can contain control bytes.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, " ")
    .trim();
  if (!normalized) return undefined;
  return truncateUtf8(normalized, maximumBytes);
}

function safeDoi(value: unknown): string | undefined {
  return safeIdentifier(value, MAX_CITATION_GRAPH_DOI_BYTES);
}

function safeIdentifier(value: unknown, maximumBytes: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (
    !trimmed ||
    containsControlCharacter(trimmed) ||
    Buffer.byteLength(trimmed, "utf8") > maximumBytes
  ) {
    return undefined;
  }
  return trimmed;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function safeCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 9_007_199_254_740_991
    ? (value as number)
    : undefined;
}

function safeYear(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10_000
    ? (value as number)
    : undefined;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) return value;
  const truncated = Buffer.from(value, "utf8").subarray(0, maximumBytes).toString("utf8");
  return truncated.endsWith("�") ? truncated.slice(0, -1) : truncated;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => Object.hasOwn(value, field));
}
