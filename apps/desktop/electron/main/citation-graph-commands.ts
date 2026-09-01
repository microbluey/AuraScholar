import type { Database } from "@aurascholar/db";
import {
  citationGraphMatchesDoi,
  citationGraphUtf8ByteLength,
  MAX_CITATION_GRAPH_ACTIVE_LIBRARY_DOIS,
  MAX_CITATION_GRAPH_DOI_BYTES,
  MAX_CITATION_GRAPH_LIBRARY_ID_BYTES,
  MAX_CITATION_GRAPH_SCOPE_TOKEN_BYTES,
  normalizeCitationGraphDoi,
} from "../../src/shared/citation-graph-limits";
import type {
  CitationGraphCacheEntry,
  CitationGraphGetActiveLibraryDoisCommandInput,
  CitationGraphGetCachedCommandInput,
  CitationGraphGetCachedCommandResult,
  CitationGraphPutCachedCommandInput,
  DataCommandOutput,
  DataCommandRequest,
} from "../data-command-contract";
import { isRecord, type DataCommandDependencies } from "./data-command-runtime";
import { loadActiveLibraryDois } from "./citation-graph-library-query";
import {
  parseCachedCitationGraphProvenance,
  requireCitationGraphProvenance,
  requireCitationGraphProvenanceInput,
  serializeCitationGraphProvenance,
} from "./citation-graph-provenance";
import {
  parseCachedCitationGraph,
  requireCitationGraph,
  serializeCitationGraph,
} from "./citation-graph-payload";
import { assertActiveLibraryScopeToken } from "./library-scope-token";

const MAX_CITATION_GRAPH_DOI_LENGTH = MAX_CITATION_GRAPH_DOI_BYTES;
const MAX_ACTIVE_LIBRARY_DOIS = MAX_CITATION_GRAPH_ACTIVE_LIBRARY_DOIS;

type CitationGraphReadCommandName = "citationGraph.getActiveLibraryDois";
type CitationGraphCacheCommandName = "citationGraph.getCached" | "citationGraph.putCached";
type CitationGraphCommandName = CitationGraphReadCommandName | CitationGraphCacheCommandName;

export type CitationGraphCommandRequest = Extract<
  DataCommandRequest,
  { name: CitationGraphCommandName }
>;

interface CachedCitationGraphRow {
  cache_version: number;
  fetched_at: number;
  payload_json: string;
  provider: string;
  provenance_json: string;
}

/**
 * Main-process boundary for runtime-global graph-cache state and active-Library
 * DOI membership (the latter resolves Library identity inside the lease).
 */
export async function executeCitationGraphCommand(
  request: CitationGraphCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<CitationGraphCommandName>> {
  switch (request.name) {
    case "citationGraph.getCached": {
      const input = parseCitationGraphGetCachedInput(request.input);
      const doi = normalizeCitationGraphDoi(input.doi);
      if (!doi) return { entry: null };
      return executeCitationGraphCacheMutation(dependencies, request.name, (database) =>
        loadCachedCitationGraph(database, doi, input.doi),
      );
    }
    case "citationGraph.putCached": {
      const input = parseCitationGraphPutCachedInput(request.input);
      const doi = normalizeCitationGraphDoi(input.doi);
      if (!doi) return { stored: false };
      // Do not place an unbound or differently-centered graph under this DOI;
      // the freshly built graph can still be displayed by the caller.
      if (!citationGraphMatchesDoi(input.graph, doi)) return { stored: false };
      const provenance = requireCitationGraphProvenance(input.provenance, input.graph, doi);
      const payloadJson = serializeCitationGraph(input.graph);
      const provenanceJson = serializeCitationGraphProvenance(provenance);
      return executeCitationGraphCacheMutation(dependencies, request.name, async (database) => {
        const fetchedAt = Date.now();
        if (!isValidCacheTimestamp(fetchedAt)) {
          throw new Error("Citation graph cache clock is invalid");
        }
        if (input.expectedCacheVersion === null) {
          const changed = await database.run(
            `INSERT OR IGNORE INTO graph_cache
             (work_id, payload_json, fetched_at, cache_version, provider, provenance_json)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [doi, payloadJson, fetchedAt, 1, provenance.provider, provenanceJson],
          );
          return { stored: changed === 1 };
        }

        // Keep the CAS version separate from fetched_at: timestamps are
        // freshness data and may repeat, while versions must advance.
        const changed = await database.run(
          `UPDATE graph_cache
           SET payload_json = ?, fetched_at = ?, cache_version = cache_version + 1,
               provider = ?, provenance_json = ?
           WHERE work_id = ? AND cache_version = ? AND cache_version < ?`,
          [
            payloadJson,
            fetchedAt,
            provenance.provider,
            provenanceJson,
            doi,
            input.expectedCacheVersion,
            Number.MAX_SAFE_INTEGER,
          ],
        );
        return { stored: changed === 1 };
      });
    }
    case "citationGraph.getActiveLibraryDois": {
      const input = parseCitationGraphGetActiveLibraryDoisInput(request.input);
      return executeCitationGraphQuery(dependencies, request.name, async (database) => {
        const scope = await assertActiveLibraryScopeToken(database, input.expectedScope);
        return loadActiveLibraryDois(database, scope, input);
      });
    }
  }
}

function executeCitationGraphQuery<K extends CitationGraphReadCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

/**
 * Cache reads may delete malformed rows or migrate a legacy key, so both
 * commands intentionally run in a short main-process transaction.
 */
function executeCitationGraphCacheMutation<K extends CitationGraphCacheCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  return dependencies.transaction(commandName, operation);
}

function parseCitationGraphGetCachedInput(value: unknown): CitationGraphGetCachedCommandInput {
  const input = requireExactCitationGraphInput(value, "citationGraph.getCached", ["doi"]);
  return { doi: requireCitationGraphDoi(input.doi, "DOI") };
}

function parseCitationGraphPutCachedInput(value: unknown): CitationGraphPutCachedCommandInput {
  const input = requireExactCitationGraphInput(
    value,
    "citationGraph.putCached",
    ["doi", "graph", "provenance"],
    ["expectedCacheVersion"],
  );
  return {
    doi: requireCitationGraphDoi(input.doi, "DOI"),
    expectedCacheVersion: Object.hasOwn(input, "expectedCacheVersion")
      ? requireNullableCitationGraphCacheVersion(input.expectedCacheVersion)
      : null,
    graph: requireCitationGraph(input.graph),
    provenance: requireCitationGraphProvenanceInput(input.provenance),
  };
}

function parseCitationGraphGetActiveLibraryDoisInput(
  value: unknown,
): CitationGraphGetActiveLibraryDoisCommandInput {
  const input = requireExactCitationGraphInput(value, "citationGraph.getActiveLibraryDois", [
    "dois",
    "expectedScope",
  ]);
  if (!Array.isArray(input.dois) || input.dois.length > MAX_ACTIVE_LIBRARY_DOIS) {
    throw new Error(`Citation graph DOI lookups are limited to ${MAX_ACTIVE_LIBRARY_DOIS}`);
  }
  if (!isDenseCitationGraphArray(input.dois)) {
    throw new Error("Citation graph DOI lookups must be dense");
  }

  const dois = input.dois.map((doi, index) =>
    canonicalCitationGraphDoi(requireCitationGraphDoi(doi, `DOI at index ${index}`)),
  );
  if (new Set(dois).size !== dois.length) {
    throw new Error("Citation graph DOIs must be unique");
  }
  return { dois, expectedScope: requireCitationGraphScopeToken(input.expectedScope) };
}

function requireCitationGraphScopeToken(value: unknown) {
  const scope = requireExactCitationGraphRecord(value, "Citation graph Library scope", [
    "libraryId",
    "scopeToken",
  ]);
  return {
    libraryId: requireCitationGraphText(
      scope.libraryId,
      "Citation graph Library id",
      MAX_CITATION_GRAPH_LIBRARY_ID_BYTES,
      true,
    ),
    scopeToken: requireCitationGraphText(
      scope.scopeToken,
      "Citation graph Library scope token",
      MAX_CITATION_GRAPH_SCOPE_TOKEN_BYTES,
      true,
    ),
  };
}

function requireExactCitationGraphInput(
  value: unknown,
  commandName: CitationGraphCommandName,
  fields: readonly string[],
  optionalFields: readonly string[] = [],
): Record<string, unknown> {
  const allowedFields = [...fields, ...optionalFields];
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !allowedFields.includes(field)) ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`Invalid ${commandName} input`);
  }
  return value;
}

function requireCitationGraphDoi(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const doi = value.trim();
  if (!doi) throw new Error(`${label} is required`);
  if (citationGraphUtf8ByteLength(doi) > MAX_CITATION_GRAPH_DOI_LENGTH) {
    throw new Error(`${label} is too long`);
  }
  return doi;
}

function canonicalCitationGraphDoi(doi: string): string {
  return normalizeCitationGraphDoi(doi) ?? doi.toLowerCase();
}

function requireExactCitationGraphRecord(
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

function isDenseCitationGraphArray(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function requireCitationGraphText(
  value: unknown,
  label: string,
  maximum: number,
  requireNonEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    citationGraphUtf8ByteLength(value) > maximum ||
    (requireNonEmpty && !value.trim())
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function isValidCacheTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function requireNullableCitationGraphCacheVersion(value: unknown): number | null {
  if (value === null) return null;
  if (!isValidCacheVersion(value)) {
    throw new Error("Citation graph expected cache version is invalid");
  }
  return value;
}

function isValidCacheVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

async function loadCachedCitationGraph(
  database: Database,
  doi: string,
  rawDoi: string,
): Promise<CitationGraphGetCachedCommandResult> {
  const legacyCacheKey = rawDoi.trim();
  const cacheKeys = legacyCacheKey !== doi ? [doi, legacyCacheKey] : [doi];
  for (const cacheKey of cacheKeys) {
    const rows = await database.query<CachedCitationGraphRow>(
      `SELECT payload_json, fetched_at, cache_version, provider, provenance_json
       FROM graph_cache WHERE work_id = ?`,
      [cacheKey],
    );
    const row = rows[0];
    if (!row) continue;

    const graph = parseCachedCitationGraph(row.payload_json);
    const provenance = parseCachedCitationGraphProvenance(row.provenance_json, graph, doi);
    if (
      !graph ||
      !provenance ||
      row.provider !== provenance.provider ||
      !isValidCacheTimestamp(row.fetched_at) ||
      !isValidCacheVersion(row.cache_version) ||
      !citationGraphMatchesDoi(graph, doi)
    ) {
      await database.run(`DELETE FROM graph_cache WHERE work_id = ?`, [cacheKey]);
      continue;
    }

    const entry: CitationGraphCacheEntry = {
      cacheVersion: row.cache_version,
      fetchedAt: row.fetched_at,
      graph,
      provenance,
    };
    if (cacheKey !== doi) {
      await database.run(
        `INSERT OR IGNORE INTO graph_cache
         (work_id, payload_json, fetched_at, cache_version, provider, provenance_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          doi,
          row.payload_json,
          row.fetched_at,
          row.cache_version,
          row.provider,
          row.provenance_json,
        ],
      );
      await database.run(`DELETE FROM graph_cache WHERE work_id = ?`, [cacheKey]);
    } else if (legacyCacheKey !== doi) {
      // A valid canonical row wins over any conflicting legacy spelling.
      // Retire that raw-key row atomically so it cannot linger indefinitely.
      await database.run(`DELETE FROM graph_cache WHERE work_id = ?`, [legacyCacheKey]);
    }
    return { entry };
  }
  return { entry: null };
}
