import type {
  CitationGraph,
  DiscoveryQuery,
  DiscoverySearchReport,
  DiscoverySort,
  DiscoverySource,
  ResolvedWork,
  SourceCursor,
} from "@aurascholar/core";
import type { S2Enrichment } from "@aurascholar/connectors";

/**
 * Public scholarly operations are semantic, bounded requests. In particular,
 * no renderer command can choose an endpoint, HTTP method, headers, or body.
 */

export interface ScholarlySearchDiscoveryCommandInput {
  cursors?: Partial<Record<DiscoverySource, SourceCursor>>;
  limit?: number;
  page?: number;
  query: DiscoveryQuery;
  requestId: string;
  sources?: DiscoverySource[];
  sort?: DiscoverySort;
}

export interface ScholarlySearchDiscoveryCommandResult {
  report: DiscoverySearchReport;
}

export interface ScholarEnrichByDoiCommandInput {
  doi: string;
  requestId: string;
}

export interface ScholarEnrichByDoiCommandResult {
  enrichment: S2Enrichment | null;
}

export interface CitationGraphBuildCommandInput {
  doi: string;
  requestId: string;
}

export interface CitationGraphBuildCommandResult {
  graph: CitationGraph | null;
}

/** Only identifiers and title queries are resolvable via the public command. */
export type ScholarlyResolvableClue =
  | { kind: "doi"; doi: string }
  | { kind: "arxiv"; arxivId: string }
  | { kind: "title"; title: string };

export interface LibraryResolveClueCommandInput {
  clue: ScholarlyResolvableClue;
  requestId: string;
}

export interface LibraryResolveClueCommandResult {
  resolved: ResolvedWork | null;
}

/** Cancellation is best-effort until an operation has already completed. */
export interface ScholarlyCancelRunCommandInput {
  requestId: string;
}

export interface ScholarlyCancelRunCommandResult {
  cancelled: boolean;
}

export interface ScholarlyDataCommandMap {
  "citationGraph.build": {
    input: CitationGraphBuildCommandInput;
    output: CitationGraphBuildCommandResult;
  };
  "discovery.searchOpenSources": {
    input: ScholarlySearchDiscoveryCommandInput;
    output: ScholarlySearchDiscoveryCommandResult;
  };
  "library.resolveClue": {
    input: LibraryResolveClueCommandInput;
    output: LibraryResolveClueCommandResult;
  };
  "scholar.enrichByDoi": {
    input: ScholarEnrichByDoiCommandInput;
    output: ScholarEnrichByDoiCommandResult;
  };
  "scholarly.cancelRun": {
    input: ScholarlyCancelRunCommandInput;
    output: ScholarlyCancelRunCommandResult;
  };
}

export type ScholarlyDataCommandName = keyof ScholarlyDataCommandMap;
export type ScholarlyDataCommandInput<K extends ScholarlyDataCommandName> =
  ScholarlyDataCommandMap[K]["input"];
export type ScholarlyDataCommandOutput<K extends ScholarlyDataCommandName> =
  ScholarlyDataCommandMap[K]["output"];
