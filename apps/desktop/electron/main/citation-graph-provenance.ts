import { Buffer } from "node:buffer";
import type { CitationGraph } from "@aurascholar/core";
import type { CitationGraphProvenance } from "../../src/shared/citation-graph-provenance";
import {
  citationGraphCenterDoi,
  citationGraphUtf8ByteLength,
  MAX_CITATION_GRAPH_DOI_BYTES,
  MAX_CITATION_GRAPH_PROVIDER_BYTES,
  MAX_CITATION_GRAPH_PROVIDER_VERSION_BYTES,
  MAX_CITATION_GRAPH_PROVENANCE_BYTES,
  normalizeCitationGraphDoi,
} from "../../src/shared/citation-graph-limits";
import {
  CITATION_GRAPH_PROVIDERS,
  CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION,
  CITATION_GRAPH_PROVIDER,
  CITATION_GRAPH_PROVIDER_VERSION,
} from "../../src/shared/citation-graph-provenance";
import { isRecord } from "./data-command-runtime";

/** Parses and normalizes the provider envelope at the main-process boundary. */
export function requireCitationGraphProvenanceInput(value: unknown): CitationGraphProvenance {
  const provenance = requireExactRecord(value, "Citation graph provenance", [
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
  const providerVersion = requireText(
    provenance.providerVersion,
    "Citation graph provenance provider version",
    MAX_CITATION_GRAPH_PROVIDER_VERSION_BYTES,
    true,
  );
  if (providerVersion !== CITATION_GRAPH_PROVIDER_VERSION) {
    throw new Error("Citation graph provenance provider version is invalid");
  }
  const requestedDoi = canonicalDoi(
    requireDoi(provenance.requestedDoi, "Citation graph provenance requested DOI"),
  );
  const centerDoi =
    provenance.centerDoi === null
      ? null
      : canonicalDoi(requireDoi(provenance.centerDoi, "Citation graph provenance center DOI"));
  if (centerDoi === null || requestedDoi !== centerDoi) {
    throw new Error("Citation graph provenance must bind requested and center DOIs");
  }
  if (!isValidTimestamp(provenance.capturedAt)) {
    throw new Error("Citation graph provenance timestamp is invalid");
  }
  const normalized: CitationGraphProvenance = {
    capturedAt: provenance.capturedAt,
    centerDoi,
    provider,
    providerVersion,
    requestedDoi,
    schemaVersion: CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION,
  };
  if (serializedByteLength(normalized) > MAX_CITATION_GRAPH_PROVENANCE_BYTES) {
    throw new Error("Citation graph provenance is too large");
  }
  return normalized;
}

/** Enforces that a cache write's metadata binds to the graph and key. */
export function requireCitationGraphProvenance(
  value: unknown,
  graph: CitationGraph,
  requestedDoi: string,
): CitationGraphProvenance {
  const provenance = requireCitationGraphProvenanceInput(value);
  const centerDoi = citationGraphCenterDoi(graph);
  if (
    centerDoi === null ||
    provenance.requestedDoi !== requestedDoi ||
    provenance.centerDoi !== centerDoi
  ) {
    throw new Error("Citation graph provenance binding is invalid");
  }
  return provenance;
}

export function serializeCitationGraphProvenance(provenance: CitationGraphProvenance): string {
  const serialized = JSON.stringify(provenance);
  if (Buffer.byteLength(serialized, "utf8") > MAX_CITATION_GRAPH_PROVENANCE_BYTES) {
    throw new Error("Citation graph provenance is too large");
  }
  return serialized;
}

/** Returns null for a malformed/legacy row so the caller can retire it. */
export function parseCachedCitationGraphProvenance(
  provenanceJson: unknown,
  graph: CitationGraph | null,
  requestedDoi: string,
): CitationGraphProvenance | null {
  if (
    typeof provenanceJson !== "string" ||
    Buffer.byteLength(provenanceJson, "utf8") > MAX_CITATION_GRAPH_PROVENANCE_BYTES ||
    !graph
  ) {
    return null;
  }
  try {
    const provenance = requireCitationGraphProvenanceInput(JSON.parse(provenanceJson));
    const centerDoi = citationGraphCenterDoi(graph);
    if (
      centerDoi === null ||
      provenance.requestedDoi !== requestedDoi ||
      provenance.centerDoi !== centerDoi
    ) {
      return null;
    }
    return provenance;
  } catch {
    return null;
  }
}

function requireProvider(value: unknown): CitationGraphProvenance["provider"] {
  if (
    typeof value !== "string" ||
    citationGraphUtf8ByteLength(value) > MAX_CITATION_GRAPH_PROVIDER_BYTES ||
    !CITATION_GRAPH_PROVIDERS.includes(value as CitationGraphProvenance["provider"])
  ) {
    throw new Error("Citation graph provenance provider is invalid");
  }
  return value as CitationGraphProvenance["provider"];
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

function canonicalDoi(value: string): string {
  return normalizeCitationGraphDoi(value) ?? value.toLowerCase();
}

function requireText(
  value: unknown,
  label: string,
  maximumBytes: number,
  nonEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    citationGraphUtf8ByteLength(value) > maximumBytes ||
    (nonEmpty && !value.trim())
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireExactRecord(
  value: unknown,
  label: string,
  requiredFields: readonly string[],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !requiredFields.includes(field)) ||
    requiredFields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function serializedByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw new Error("Citation graph provenance is invalid");
  }
}

function isValidTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}
