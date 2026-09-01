import type { CitationGraph } from "@aurascholar/core";
import {
  citationGraphCenterDoi,
  citationGraphUtf8ByteLength,
  MAX_CITATION_GRAPH_PROVIDER_VERSION_BYTES,
  MAX_CITATION_GRAPH_PROVENANCE_BYTES,
  normalizeCitationGraphDoi,
} from "./citation-graph-limits";

/**
 * Version of the renderer/main provenance envelope. This is deliberately
 * separate from the graph topology schema and from the cache CAS version.
 */
export const CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION = 1 as const;

/** Providers that may be named by durable citation assertions. */
export const CITATION_GRAPH_PROVIDERS = ["openalex", "semantic-scholar", "crossref"] as const;
export type CitationGraphProvider = (typeof CITATION_GRAPH_PROVIDERS)[number];

/** The only provider currently capable of building a citation graph. */
export const CITATION_GRAPH_PROVIDER = "openalex" as const;

/**
 * Adapter/query contract revision, not the upstream dataset version. Bump it
 * when the graph algorithm, selected fields, or upstream API interpretation
 * changes in a way that makes cached topology incomparable.
 */
export const CITATION_GRAPH_PROVIDER_VERSION = "openalex-citation-graph-v1" as const;

/**
 * Provenance attached to a graph response. `capturedAt` is the main-process
 * wall-clock observed after the provider response has been accepted; it is not
 * a publication date, request start time, or cache freshness timestamp.
 */
export interface CitationGraphProvenance {
  capturedAt: number;
  centerDoi: string | null;
  provider: CitationGraphProvider;
  providerVersion: string;
  requestedDoi: string;
  schemaVersion: typeof CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION;
}

/** A topology plus the source contract that produced it. */
export interface CitationGraphSnapshot {
  graph: CitationGraph;
  /** Null marks display-only topology without a trusted provider envelope. */
  provenance: CitationGraphProvenance | null;
}

/** Constructs the current OpenAlex provenance envelope from canonical DOIs. */
export function createOpenAlexCitationGraphProvenance(input: {
  capturedAt: number;
  centerDoi: string | null;
  requestedDoi: string;
}): CitationGraphProvenance {
  const requestedDoi = normalizeProvenanceDoi(input.requestedDoi);
  if (!requestedDoi) throw new Error("Citation graph requested DOI is invalid");
  const centerDoi = input.centerDoi === null ? null : normalizeProvenanceDoi(input.centerDoi);
  if (input.centerDoi !== null && !centerDoi) {
    throw new Error("Citation graph center DOI is invalid");
  }
  if (centerDoi === null || centerDoi !== requestedDoi) {
    throw new Error("Citation graph provenance binding is invalid");
  }
  if (!Number.isSafeInteger(input.capturedAt) || input.capturedAt < 0) {
    throw new Error("Citation graph provenance timestamp is invalid");
  }
  return {
    capturedAt: input.capturedAt,
    centerDoi,
    provider: CITATION_GRAPH_PROVIDER,
    providerVersion: CITATION_GRAPH_PROVIDER_VERSION,
    requestedDoi,
    schemaVersion: CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION,
  };
}

/**
 * Checks the binding that makes a provenance envelope useful for a requested
 * graph. A graph without a center DOI can be displayed, but is intentionally
 * not trusted as a DOI-keyed cache snapshot.
 */
export function citationGraphProvenanceMatches(
  graph: CitationGraph,
  provenance: CitationGraphProvenance | null | undefined,
  requestedDoi: string,
): boolean {
  if (!citationGraphProvenanceBindsGraph(graph, provenance, requestedDoi)) return false;
  return (
    provenance.provider === CITATION_GRAPH_PROVIDER &&
    provenance.providerVersion === CITATION_GRAPH_PROVIDER_VERSION
  );
}

/**
 * Validates the provider-independent part of a snapshot binding. The cache
 * currently accepts only OpenAlex (see `citationGraphProvenanceMatches`), but
 * Canvas can carry a future provider through an injected adapter without
 * weakening the DOI, timestamp, schema, or shape checks here.
 */
export function citationGraphProvenanceBindsGraph(
  graph: CitationGraph,
  provenance: CitationGraphProvenance | null | undefined,
  requestedDoi: string,
): provenance is CitationGraphProvenance {
  const requested = normalizeCitationGraphDoi(requestedDoi);
  const center = safeCitationGraphCenterDoi(graph);
  if (!requested || !center || !isExactBoundProvenance(provenance)) return false;
  const provenanceRequested = canonicalProvenanceDoi(provenance.requestedDoi);
  const provenanceCenter = canonicalProvenanceDoi(provenance.centerDoi);
  return (
    isCitationGraphProvider(provenance.provider) &&
    isCitationGraphProviderVersion(provenance.providerVersion) &&
    provenance.schemaVersion === CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION &&
    provenanceRequested !== null &&
    provenanceCenter !== null &&
    provenanceRequested === requested &&
    provenanceCenter === center &&
    provenanceRequested === provenanceCenter
  );
}

const PROVENANCE_FIELDS = [
  "capturedAt",
  "centerDoi",
  "provider",
  "providerVersion",
  "requestedDoi",
  "schemaVersion",
] as const;

function isExactBoundProvenance(
  value: CitationGraphProvenance | null | undefined,
): value is CitationGraphProvenance {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (field) => !PROVENANCE_FIELDS.includes(field as (typeof PROVENANCE_FIELDS)[number]),
    ) ||
    PROVENANCE_FIELDS.some((field) => !Object.hasOwn(value, field)) ||
    !Number.isSafeInteger(value.capturedAt) ||
    (value.capturedAt as number) < 0
  ) {
    return false;
  }
  return (
    isCitationGraphProvider(value.provider) &&
    isCitationGraphProviderVersion(value.providerVersion) &&
    value.schemaVersion === CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION &&
    serializedProvenanceByteLength(value) <= MAX_CITATION_GRAPH_PROVENANCE_BYTES
  );
}

function isCitationGraphProvider(value: unknown): value is CitationGraphProvider {
  return CITATION_GRAPH_PROVIDERS.includes(value as CitationGraphProvider);
}

function isCitationGraphProviderVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    !containsControlCharacter(value) &&
    citationGraphUtf8ByteLength(value) <= MAX_CITATION_GRAPH_PROVIDER_VERSION_BYTES
  );
}

function serializedProvenanceByteLength(value: CitationGraphProvenance): number {
  try {
    return citationGraphUtf8ByteLength(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function canonicalProvenanceDoi(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeProvenanceDoi(value);
  // Provenance is persisted as a canonical identity. Do not silently accept
  // presentation forms or mutate them while deciding whether a cache row is
  // trusted; the boundary decoders perform that normalization explicitly.
  return normalized === value ? normalized : null;
}

function normalizeProvenanceDoi(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || containsControlCharacter(trimmed)) return null;
  return normalizeCitationGraphDoi(trimmed);
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function safeCitationGraphCenterDoi(graph: CitationGraph): string | null {
  try {
    if (!isRecord(graph) || !Array.isArray(graph.nodes)) return null;
    return citationGraphCenterDoi(graph);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
