import type { CitationGraph } from "@aurascholar/core";
import type { CitationGraphProvenance, CitationGraphProvider } from "./citation-graph-provenance";
import {
  CITATION_GRAPH_PROVIDERS,
  CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION,
  CITATION_GRAPH_PROVIDER,
  CITATION_GRAPH_PROVIDER_VERSION,
  citationGraphProvenanceMatches,
} from "./citation-graph-provenance";
import {
  citationGraphCenterDoi,
  citationGraphUtf8ByteLength,
  MAX_CITATION_GRAPH_DOI_BYTES,
  MAX_CITATION_GRAPH_PROVIDER_BYTES,
  MAX_CITATION_GRAPH_PROVENANCE_BYTES,
  normalizeCitationGraphDoi,
} from "./citation-graph-limits";

/** Decodes and binds a provenance envelope received over the renderer IPC. */
export function decodeCitationGraphProvenance(
  value: unknown,
  graph: CitationGraph | null,
  requestedDoi?: string,
): CitationGraphProvenance {
  const provenance = requireExactObject(value, "Citation graph provenance", [
    "capturedAt",
    "centerDoi",
    "provider",
    "providerVersion",
    "requestedDoi",
    "schemaVersion",
  ]);
  if (provenance.schemaVersion !== CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION) {
    throw new Error("Citation graph provenance schema version is invalid");
  }
  const provider = requireProvider(provenance.provider);
  if (provider !== CITATION_GRAPH_PROVIDER) {
    throw new Error("Citation graph provenance provider is unsupported");
  }
  if (provenance.providerVersion !== CITATION_GRAPH_PROVIDER_VERSION) {
    throw new Error("Citation graph provenance provider version is invalid");
  }

  const decodedRequestedDoi = normalizeDoi(
    requireDoi(provenance.requestedDoi, "Citation graph provenance requested DOI"),
  );
  const centerDoi =
    provenance.centerDoi === null
      ? null
      : normalizeDoi(requireDoi(provenance.centerDoi, "Citation graph provenance center DOI"));
  if (centerDoi === null || decodedRequestedDoi !== centerDoi) {
    throw new Error("Citation graph provenance must bind requested and center DOIs");
  }
  const capturedAt = requireTimestamp(provenance.capturedAt, "Citation graph provenance timestamp");
  const decoded: CitationGraphProvenance = {
    capturedAt,
    centerDoi,
    provider,
    providerVersion: provenance.providerVersion,
    requestedDoi: decodedRequestedDoi,
    schemaVersion: CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION,
  };

  if (graph !== null) {
    const graphCenterDoi = citationGraphCenterDoi(graph);
    if (decoded.centerDoi !== graphCenterDoi) {
      throw new Error("Citation graph provenance center DOI does not match the graph");
    }
    if (graphCenterDoi === null) {
      throw new Error("Citation graph provenance requires a bound graph center");
    }
  }
  if (requestedDoi !== undefined) {
    const normalizedRequestedDoi = normalizeDoi(requestedDoi);
    if (!normalizedRequestedDoi || decoded.requestedDoi !== normalizedRequestedDoi) {
      throw new Error("Citation graph provenance requested DOI does not match the request");
    }
  }
  if (
    graph !== null &&
    !citationGraphProvenanceMatches(graph, decoded, requestedDoi ?? decoded.requestedDoi)
  ) {
    throw new Error("Citation graph provenance binding is invalid");
  }
  if (serializedByteLength(decoded) > MAX_CITATION_GRAPH_PROVENANCE_BYTES) {
    throw new Error("Citation graph provenance is too large");
  }
  return decoded;
}

function requireProvider(value: unknown): CitationGraphProvider {
  if (
    typeof value !== "string" ||
    citationGraphUtf8ByteLength(value) > MAX_CITATION_GRAPH_PROVIDER_BYTES ||
    !CITATION_GRAPH_PROVIDERS.includes(value as CitationGraphProvider)
  ) {
    throw new Error("Citation graph provider is invalid");
  }
  return value as CitationGraphProvider;
}

function requireDoi(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const doi = value.trim();
  if (
    !doi ||
    containsControlCharacter(doi) ||
    citationGraphUtf8ByteLength(doi) > MAX_CITATION_GRAPH_DOI_BYTES
  ) {
    throw new Error(`${label} is invalid`);
  }
  return doi;
}

function normalizeDoi(value: string): string {
  const normalized = normalizeCitationGraphDoi(value);
  if (!normalized) throw new Error("Citation graph DOI is required");
  return normalized;
}

function requireTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

function requireExactObject(
  value: unknown,
  label: string,
  requiredFields: readonly string[],
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((field) => !requiredFields.includes(field)) ||
    requiredFields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function serializedByteLength(value: unknown): number {
  try {
    return citationGraphUtf8ByteLength(JSON.stringify(value));
  } catch {
    throw new Error("Citation graph provenance is invalid");
  }
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}
