import { Buffer } from "node:buffer";
import type { CitationGraph, GraphEdge, GraphNode } from "@aurascholar/core";
import {
  citationGraphUtf8ByteLength,
  MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES,
  MAX_CITATION_GRAPH_DOI_BYTES,
  MAX_CITATION_GRAPH_EDGES,
  MAX_CITATION_GRAPH_NODE_ID_BYTES,
  MAX_CITATION_GRAPH_NODE_TEXT_BYTES,
  MAX_CITATION_GRAPH_NODES,
} from "../../src/shared/citation-graph-limits";
import { isRecord } from "./data-command-runtime";

const MAX_DOI_BYTES = MAX_CITATION_GRAPH_DOI_BYTES;
const MAX_NODE_ID_BYTES = MAX_CITATION_GRAPH_NODE_ID_BYTES;
const MAX_NODE_TEXT_BYTES = MAX_CITATION_GRAPH_NODE_TEXT_BYTES;

/** Strictly validates a graph before it enters or leaves the main process. */
export function requireCitationGraph(value: unknown): CitationGraph {
  const graph = requireExactRecord(value, "Citation graph", [
    "centerId",
    "nodes",
    "edges",
    "truncated",
  ]);
  const centerId = requireNodeId(graph.centerId, "Citation graph center id");
  if (typeof graph.truncated !== "boolean") {
    throw new Error("Citation graph truncation state is invalid");
  }
  if (
    !Array.isArray(graph.nodes) ||
    graph.nodes.length === 0 ||
    graph.nodes.length > MAX_CITATION_GRAPH_NODES ||
    !isDenseArray(graph.nodes)
  ) {
    throw new Error(`Citation graph nodes are limited to ${MAX_CITATION_GRAPH_NODES}`);
  }
  if (
    !Array.isArray(graph.edges) ||
    graph.edges.length > MAX_CITATION_GRAPH_EDGES ||
    !isDenseArray(graph.edges)
  ) {
    throw new Error(`Citation graph edges are limited to ${MAX_CITATION_GRAPH_EDGES}`);
  }

  const nodes = graph.nodes.map((node, index) => requireNode(node, index));
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) throw new Error("Citation graph node ids must be unique");
  const centers = nodes.filter((node) => node.relation === "center");
  if (centers.length !== 1 || centers[0]?.id !== centerId) {
    throw new Error("Citation graph must contain exactly one matching center node");
  }

  const edges = graph.edges.map((edge, index) => requireEdge(edge, index, nodeIds));
  const edgeKeys = edges.map((edge) => JSON.stringify([edge.source, edge.target]));
  if (new Set(edgeKeys).size !== edgeKeys.length) {
    throw new Error("Citation graph edges must be unique");
  }
  return { centerId, edges, nodes, truncated: graph.truncated };
}

export function serializeCitationGraph(graph: CitationGraph): string {
  const payload = JSON.stringify(graph);
  if (Buffer.byteLength(payload, "utf8") > MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES) {
    throw new Error("Citation graph cache payload is too large");
  }
  return payload;
}

export function parseCachedCitationGraph(payload: unknown): CitationGraph | null {
  if (
    typeof payload !== "string" ||
    Buffer.byteLength(payload, "utf8") > MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES
  ) {
    return null;
  }
  try {
    return requireCitationGraph(JSON.parse(payload));
  } catch {
    return null;
  }
}

function requireNode(value: unknown, index: number): GraphNode {
  const node = requireExactRecord(
    value,
    `Citation graph node at index ${index}`,
    ["id", "title", "citedByCount", "relation"],
    ["year", "doi", "venue", "firstAuthor"],
  );
  if (node.relation !== "center" && node.relation !== "reference" && node.relation !== "citer") {
    throw new Error(`Citation graph node relation at index ${index} is invalid`);
  }
  if (!Number.isSafeInteger(node.citedByCount) || (node.citedByCount as number) < 0) {
    throw new Error(`Citation graph cited-by count at index ${index} is invalid`);
  }
  const year = optionalYear(readOptionalField(node, "year"), index);
  const doi = optionalText(
    readOptionalField(node, "doi"),
    `Citation graph DOI at index ${index}`,
    MAX_DOI_BYTES,
  );
  const venue = optionalText(
    readOptionalField(node, "venue"),
    `Citation graph venue at index ${index}`,
    MAX_NODE_TEXT_BYTES,
  );
  const firstAuthor = optionalText(
    readOptionalField(node, "firstAuthor"),
    `Citation graph first author at index ${index}`,
    MAX_NODE_TEXT_BYTES,
  );
  return {
    citedByCount: node.citedByCount as number,
    ...(doi === undefined ? {} : { doi }),
    ...(firstAuthor === undefined ? {} : { firstAuthor }),
    id: requireNodeId(node.id, `Citation graph node id at index ${index}`),
    relation: node.relation,
    title: requireText(node.title, `Citation graph title at index ${index}`, MAX_NODE_TEXT_BYTES),
    ...(venue === undefined ? {} : { venue }),
    ...(year === undefined ? {} : { year }),
  };
}

function requireEdge(value: unknown, index: number, nodeIds: ReadonlySet<string>): GraphEdge {
  const edge = requireExactRecord(value, `Citation graph edge at index ${index}`, [
    "source",
    "target",
  ]);
  const source = requireNodeId(edge.source, `Citation graph edge source at index ${index}`);
  const target = requireNodeId(edge.target, `Citation graph edge target at index ${index}`);
  if (source === target) throw new Error("Citation graph edges cannot be self-referential");
  if (!nodeIds.has(source) || !nodeIds.has(target)) {
    throw new Error("Citation graph edges must reference graph nodes");
  }
  return { source, target };
}

function requireExactRecord(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const allowed = [...required, ...optional];
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !allowed.includes(field)) ||
    required.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function isDenseArray(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function requireNodeId(value: unknown, label: string): string {
  return requireText(value, label, MAX_NODE_ID_BYTES, true);
}

function requireText(value: unknown, label: string, maximum: number, nonEmpty = false): string {
  if (
    typeof value !== "string" ||
    citationGraphUtf8ByteLength(value) > maximum ||
    (nonEmpty && !value.trim())
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function optionalText(value: unknown, label: string, maximum: number): string | undefined {
  return value === undefined ? undefined : requireText(value, label, maximum);
}

function readOptionalField(value: Record<string, unknown>, field: string): unknown {
  return Object.hasOwn(value, field) ? value[field] : undefined;
}

function optionalYear(value: unknown, index: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 10_000) {
    throw new Error(`Citation graph year at index ${index} is invalid`);
  }
  return value as number;
}
