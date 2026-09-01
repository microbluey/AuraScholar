import type { Database } from "@aurascholar/db";
import {
  CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION,
  CITATION_GRAPH_PROVIDER,
  CITATION_GRAPH_PROVIDER_VERSION,
  type CitationGraphProvenance,
} from "../../src/shared/citation-graph-provenance";

export const CITATION_GRAPH_PROVENANCE: CitationGraphProvenance = {
  capturedAt: 1_000,
  centerDoi: "10.1000/center",
  provider: CITATION_GRAPH_PROVIDER,
  providerVersion: CITATION_GRAPH_PROVIDER_VERSION,
  requestedDoi: "10.1000/center",
  schemaVersion: CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION,
};

export function citationGraphProvenanceFor(
  doi: string,
  overrides: Partial<CitationGraphProvenance> = {},
): CitationGraphProvenance {
  return {
    ...CITATION_GRAPH_PROVENANCE,
    centerDoi: doi,
    requestedDoi: doi,
    ...overrides,
  };
}

export async function insertCitationGraphCacheRow(
  database: Database,
  workId: string,
  payloadJson: string,
  fetchedAt: number,
  cacheVersion = 1,
  provenance: CitationGraphProvenance = CITATION_GRAPH_PROVENANCE,
): Promise<void> {
  await database.run(
    `INSERT INTO graph_cache
     (work_id, payload_json, fetched_at, cache_version, provider, provenance_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [workId, payloadJson, fetchedAt, cacheVersion, provenance.provider, JSON.stringify(provenance)],
  );
}
