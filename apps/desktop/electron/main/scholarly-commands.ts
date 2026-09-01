import {
  buildCitationGraph,
  resolveClue,
  searchOpenSourcesDetailed,
  type DiscoverySearchReport,
  type ResolvedWork,
} from "@aurascholar/core";
import { s2EnrichByDoi, type ConnectorContext, type S2Enrichment } from "@aurascholar/connectors";
import type { DataCommandOutput, DataCommandRequest } from "../data-command-contract";
import type {
  CitationGraphBuildServiceResult,
  ScholarlyDataCommandName,
  ScholarlyResolvableClue,
  ScholarlySearchDiscoveryCommandInput,
} from "../scholarly-command-contract";
import {
  parseCitationGraphBuildInput,
  parseLibraryResolveClueInput,
  parseScholarEnrichByDoiInput,
  parseScholarlyCancelRunInput,
  parseScholarlySearchDiscoveryInput,
} from "./scholarly-command-input";
import {
  requireBoundedScholarlyOutput,
  sanitizeCitationGraphBuild,
  sanitizeDiscoverySearchReport,
  sanitizeResolvedWork,
  sanitizeScholarEnrichment,
} from "./scholarly-command-output";
import { mainScholarlyHttp } from "./scholarly-http";
import { mainScholarlyRunRegistry, type MainScholarlyRunRegistry } from "./scholarly-run-registry";
import {
  citationGraphCenterDoi,
  normalizeCitationGraphDoi,
} from "../../src/shared/citation-graph-limits";
import { createOpenAlexCitationGraphProvenance } from "../../src/shared/citation-graph-provenance";

const DISCOVERY_COMMAND_TIMEOUT_MS = 5_000;

export type ScholarlyCommandRequest = Extract<
  DataCommandRequest,
  { name: ScholarlyDataCommandName }
>;

export interface ScholarlyCommandDependencies {
  runs?: Pick<MainScholarlyRunRegistry, "begin" | "cancel" | "end">;
  service?: MainScholarlyService;
}

export interface MainScholarlyService {
  buildCitationGraph(doi: string, signal: AbortSignal): Promise<CitationGraphBuildServiceResult>;
  enrichByDoi(doi: string, signal: AbortSignal): Promise<S2Enrichment | null>;
  resolveClue(clue: ScholarlyResolvableClue, signal: AbortSignal): Promise<ResolvedWork | null>;
  searchDiscovery(
    input: Omit<ScholarlySearchDiscoveryCommandInput, "requestId">,
    signal: AbortSignal,
  ): Promise<DiscoverySearchReport>;
}

/**
 * Main-only connector context for public scholarly metadata APIs. The
 * transport restricts every request to a fixed HTTPS origin allowlist, even
 * though the connector package composes its own endpoint URLs.
 */
const mainScholarlyConnectorContext: ConnectorContext = {
  http: mainScholarlyHttp,
  mailto: "contact@aurascholar.app",
};

/**
 * Main-only resolver shared by automated jobs (for example Sentinel). It does
 * not accept URLs: callers must first classify a DOI, arXiv id, or title.
 */
export function resolveScholarlyClue(
  clue: ScholarlyResolvableClue,
  signal?: AbortSignal,
): Promise<ResolvedWork | null> {
  return resolveClue(mainScholarlyConnectorContext, clue, { signal });
}

/** Main-only direct S2 enrichment helper for non-renderer runners. */
export function enrichScholarByDoi(
  doi: string,
  signal?: AbortSignal,
): Promise<S2Enrichment | null> {
  return s2EnrichByDoi(mainScholarlyConnectorContext, doi, { signal });
}

const defaultScholarlyService: MainScholarlyService = {
  async buildCitationGraph(doi, signal) {
    const graph = await buildCitationGraph(mainScholarlyConnectorContext, { doi }, { signal });
    if (!graph) return null;
    const centerDoi = citationGraphCenterDoi(graph);
    if (centerDoi === null || centerDoi !== normalizeCitationGraphDoi(doi)) return graph;
    // The provider response is considered captured only after the main process
    // has received it. Cache freshness uses a separate commit timestamp.
    return {
      graph,
      provenance: createOpenAlexCitationGraphProvenance({
        capturedAt: Date.now(),
        centerDoi,
        requestedDoi: doi,
      }),
    };
  },
  enrichByDoi: enrichScholarByDoi,
  resolveClue: resolveScholarlyClue,
  searchDiscovery(input, signal) {
    return searchOpenSourcesDetailed(mainScholarlyConnectorContext, input.query, {
      cursors: input.cursors,
      limit: input.limit ?? 20,
      page: input.page,
      signal,
      sort: input.sort,
      sources: input.sources,
      timeoutMs: DISCOVERY_COMMAND_TIMEOUT_MS,
    });
  },
};

/**
 * Semantic public-API command dispatcher. Each operation receives an opaque
 * request id exclusively for cancellation; URLs, headers, methods, and bodies
 * remain inside core/connectors plus the main-only scholarly transport.
 */
export async function executeScholarlyCommand(
  request: ScholarlyCommandRequest,
  dependencies: ScholarlyCommandDependencies = {},
): Promise<DataCommandOutput<ScholarlyDataCommandName>> {
  switch (request.name) {
    case "citationGraph.build": {
      const input = parseCitationGraphBuildInput(request.input);
      return runScholarlyCommand(input.requestId, dependencies, async (signal) => {
        const graph = await scholarlyService(dependencies).buildCitationGraph(input.doi, signal);
        throwIfAborted(signal);
        return requireBoundedScholarlyOutput(
          sanitizeCitationGraphBuild(graph, input.doi),
          "Citation graph output",
        );
      });
    }
    case "discovery.searchOpenSources": {
      const input = parseScholarlySearchDiscoveryInput(request.input);
      return runScholarlyCommand(input.requestId, dependencies, async (signal) => {
        const report = await scholarlyService(dependencies).searchDiscovery(input, signal);
        throwIfAborted(signal);
        return requireBoundedScholarlyOutput(
          { report: sanitizeDiscoverySearchReport(report, input.sources) },
          "Discovery search output",
        );
      });
    }
    case "library.resolveClue": {
      const input = parseLibraryResolveClueInput(request.input);
      return runScholarlyCommand(input.requestId, dependencies, async (signal) => {
        const resolved = await scholarlyService(dependencies).resolveClue(input.clue, signal);
        throwIfAborted(signal);
        return requireBoundedScholarlyOutput(
          { resolved: sanitizeResolvedWork(resolved) },
          "Library clue resolution output",
        );
      });
    }
    case "scholar.enrichByDoi": {
      const input = parseScholarEnrichByDoiInput(request.input);
      return runScholarlyCommand(input.requestId, dependencies, async (signal) => {
        const enrichment = await scholarlyService(dependencies).enrichByDoi(input.doi, signal);
        throwIfAborted(signal);
        return requireBoundedScholarlyOutput(
          { enrichment: sanitizeScholarEnrichment(enrichment) },
          "Semantic Scholar enrichment output",
        );
      });
    }
    case "scholarly.cancelRun": {
      const input = parseScholarlyCancelRunInput(request.input);
      return { cancelled: scholarlyRuns(dependencies).cancel(input.requestId) };
    }
  }
}

function scholarlyRuns(
  dependencies: ScholarlyCommandDependencies,
): Pick<MainScholarlyRunRegistry, "begin" | "cancel" | "end"> {
  return dependencies.runs ?? mainScholarlyRunRegistry;
}

function scholarlyService(dependencies: ScholarlyCommandDependencies): MainScholarlyService {
  return dependencies.service ?? defaultScholarlyService;
}

async function runScholarlyCommand<T>(
  requestId: string,
  dependencies: ScholarlyCommandDependencies,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const runs = scholarlyRuns(dependencies);
  const signal = runs.begin(requestId);
  try {
    throwIfAborted(signal);
    const result = await operation(signal);
    throwIfAborted(signal);
    return result;
  } finally {
    runs.end(requestId);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("Scholarly request cancelled");
  error.name = "AbortError";
  throw error;
}
