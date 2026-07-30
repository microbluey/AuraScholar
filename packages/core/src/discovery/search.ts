import {
  ApiError,
  arxivByid,
  arxivSearchByTitle,
  crossrefByDoi,
  crossrefSearchByTitle,
  isAbortError,
  normalizeOpenAlex,
  normalizeS2,
  openalexByDoi,
  openalexSearchByTitle,
  parseArxivId,
  s2ByDoi,
  s2SearchByTitle,
  type ConnectorContext,
  type ConnectorSearchFilters,
  type NormalizedWork,
} from "@aurascholar/connectors";
import { describeSafeError } from "@aurascholar/platform";
import { clueFromInput } from "../ingest/clues.js";
import { stripBoolean } from "./query.js";
import { mergeDiscoveryResults, normalizeDiscoveryTitle } from "./search-merge.js";

export { hasConflictingDiscoveryIdentifiers, sameDiscoveryWorkIdentity } from "./search-merge.js";
export { mergeDiscoveryResults };

export type DiscoverySource = "crossref" | "openalex" | "s2" | "arxiv";

export type DiscoverySort = "relevance" | "year" | "citations";

export interface DiscoveryResult {
  id: string;
  source: DiscoverySource;
  work: NormalizedWork;
  score: number;
}

/** Structured discovery request: free text plus optional precise conditions. */
export interface DiscoveryQuery {
  text: string;
  author?: string;
  yearFrom?: number;
  yearTo?: number;
  venue?: string;
}

/** Per-source pagination state: engine produces it, UI replays it to load more. */
export interface SourceCursor {
  /** Page consumed so far (1-based). Next page = page + 1. */
  page: number;
  /** Whether more results may exist (this page came back full). */
  hasMore: boolean;
}

export interface DiscoverySearchOptions {
  limit?: number;
  sources?: DiscoverySource[];
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Per-source page (1-based). Default 1. Ignored when `cursors` is given. */
  page?: number;
  /** API-level sort intent; also the merge/display ordering key. */
  sort?: DiscoverySort;
  /** "Load more": replay the previous report's cursors to fetch each next page. */
  cursors?: Partial<Record<DiscoverySource, SourceCursor>>;
}

export type DiscoverySourceStatus =
  | "done"
  | "empty"
  | "timeout"
  | "error"
  | "rate_limited"
  | "aborted";

export interface DiscoverySourceReport {
  source: DiscoverySource;
  status: DiscoverySourceStatus;
  count: number;
  error?: string;
}

export interface DiscoverySearchReport {
  results: DiscoveryResult[];
  sources: Record<DiscoverySource, DiscoverySourceReport>;
  /** Per-source pagination cursors; replay via options.cursors to load more. */
  cursors: Record<DiscoverySource, SourceCursor>;
}

export type DiscoveryResultMerger<T extends DiscoveryResult> = (
  fallback: T | undefined,
  preferred: T,
) => T;

const DEFAULT_SOURCES: DiscoverySource[] = ["crossref", "openalex", "s2", "arxiv"];

export async function searchOpenSources(
  ctx: ConnectorContext,
  query: string | DiscoveryQuery,
  options: DiscoverySearchOptions = {},
): Promise<DiscoveryResult[]> {
  return (await searchOpenSourcesDetailed(ctx, query, options)).results;
}

export async function searchOpenSourcesDetailed(
  ctx: ConnectorContext,
  query: string | DiscoveryQuery,
  options: DiscoverySearchOptions = {},
): Promise<DiscoverySearchReport> {
  const q: DiscoveryQuery = typeof query === "string" ? { text: query } : query;
  const text = q.text.trim();
  const sources = options.sources ?? DEFAULT_SOURCES;
  const sort = options.sort ?? "relevance";
  if (!text) return emptyReport(sources);

  const limit = options.limit ?? 10;
  const timeoutMs = options.timeoutMs ?? 8_000;

  const clue = clueFromInput(text);
  if (clue?.kind === "doi") {
    return searchByDoi(ctx, clue.doi, sources, limit, timeoutMs, options.signal, sort);
  }

  // Per-source page: a replayed cursor's next page wins over an explicit page.
  const pageFor = (source: DiscoverySource): number =>
    options.cursors?.[source] ? options.cursors[source]!.page + 1 : (options.page ?? 1);

  // Structured filters shared across sources (each applies what it supports).
  const filters: ConnectorSearchFilters = {
    author: q.author,
    yearFrom: q.yearFrom,
    yearTo: q.yearTo,
    venue: q.venue,
    sort,
  };
  // Crossref/OpenAlex/S2 treat query as free text — strip booleans to keywords.
  const keywords = stripBoolean(text) || text;

  const tasks: Array<Promise<DiscoverySourceOutcome>> = [];

  if (sources.includes("crossref")) {
    const page = pageFor("crossref");
    tasks.push(
      runSource("crossref", page, limit, timeoutMs, options.signal, async (signal) => {
        const hits = await crossrefSearchByTitle(ctx, keywords, limit, { signal }, filters, page);
        return hits.map((hit, index) => ({
          id: resultId("crossref", hit.work, scored(page, limit, index)),
          source: "crossref" as const,
          work: hit.work,
          score: hit.score,
        }));
      }),
    );
  }

  if (sources.includes("openalex")) {
    const page = pageFor("openalex");
    tasks.push(
      runSource("openalex", page, limit, timeoutMs, options.signal, async (signal) => {
        const works = await openalexSearchByTitle(ctx, keywords, limit, { signal }, filters, page);
        return works.map((raw, index) => {
          const work = normalizeOpenAlex(raw);
          return {
            id: resultId("openalex", work, scored(page, limit, index)),
            source: "openalex" as const,
            work,
            score: Math.max(0, 100 - scored(page, limit, index)),
          };
        });
      }),
    );
  }

  if (sources.includes("s2")) {
    const page = pageFor("s2");
    tasks.push(
      runSource("s2", page, limit, timeoutMs, options.signal, async (signal) => {
        const papers = await s2SearchByTitle(ctx, keywords, limit, { signal }, filters, page);
        return papers.map((paper, index) => {
          const work = normalizeS2(paper);
          return {
            id: resultId("s2", work, scored(page, limit, index)),
            source: "s2" as const,
            work,
            score: Math.max(0, 90 - scored(page, limit, index)),
          };
        });
      }),
    );
  }

  const arxivId = parseArxivId(text);
  if (sources.includes("arxiv")) {
    const page = pageFor("arxiv");
    tasks.push(
      runSource("arxiv", page, limit, timeoutMs, options.signal, async (signal) => {
        // A bare arXiv id is an exact lookup; anything else is a topic search.
        // arXiv supports booleans/fields natively, so pass the raw text.
        if (arxivId && page === 1) {
          const work = await arxivByid(ctx, arxivId, { signal });
          return work
            ? [{ id: resultId("arxiv", work, 0), source: "arxiv" as const, work, score: 100 }]
            : [];
        }
        const works = await arxivSearchByTitle(ctx, text, limit, { signal }, filters, page);
        return works.map((work, index) => ({
          id: resultId("arxiv", work, scored(page, limit, index)),
          source: "arxiv" as const,
          work,
          score: Math.max(0, 88 - scored(page, limit, index)),
        }));
      }),
    );
  }

  return reportFromOutcomes(sources, await Promise.all(tasks), sort);
}

/** Global result index across pages, so page-2 scores don't collapse to 0. */
function scored(page: number, limit: number, index: number): number {
  return (page - 1) * limit + index;
}

async function searchByDoi(
  ctx: ConnectorContext,
  doi: string,
  sources: DiscoverySource[],
  limit: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  sort: DiscoverySort,
): Promise<DiscoverySearchReport> {
  const tasks: Array<Promise<DiscoverySourceOutcome>> = [];

  if (sources.includes("crossref")) {
    tasks.push(
      runSource("crossref", 1, limit, timeoutMs, signal, async (sourceSignal) => {
        const work = await crossrefByDoi(ctx, doi, { signal: sourceSignal });
        return work
          ? [
              {
                id: resultId("crossref", work, 0),
                source: "crossref" as const,
                work,
                score: 100,
              },
            ]
          : [];
      }),
    );
  }

  if (sources.includes("openalex")) {
    tasks.push(
      runSource("openalex", 1, limit, timeoutMs, signal, async (sourceSignal) => {
        const work = await openalexByDoi(ctx, doi, { signal: sourceSignal });
        return work
          ? [
              {
                id: resultId("openalex", normalizeOpenAlex(work), 0),
                source: "openalex" as const,
                work: normalizeOpenAlex(work),
                score: 98,
              },
            ]
          : [];
      }),
    );
  }

  if (sources.includes("s2")) {
    tasks.push(
      runSource("s2", 1, limit, timeoutMs, signal, async (sourceSignal) => {
        const paper = await s2ByDoi(ctx, doi, { signal: sourceSignal });
        return paper
          ? [
              {
                id: resultId("s2", normalizeS2(paper), 0),
                source: "s2" as const,
                work: normalizeS2(paper),
                score: 96,
              },
            ]
          : [];
      }),
    );
  }

  return reportFromOutcomes(sources, await Promise.all(tasks), sort);
}

interface DiscoverySourceOutcome {
  source: DiscoverySource;
  results: DiscoveryResult[];
  report: DiscoverySourceReport;
  cursor: SourceCursor;
}

async function runSource(
  source: DiscoverySource,
  page: number,
  limit: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  load: (signal: AbortSignal) => Promise<DiscoveryResult[]>,
): Promise<DiscoverySourceOutcome> {
  if (signal?.aborted) return sourceOutcome(source, page, limit, [], "aborted");

  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  signal?.addEventListener("abort", abortFromParent, { once: true });

  let timeout = false;
  const timer = setTimeout(() => {
    timeout = true;
    controller.abort();
  }, timeoutMs);

  const aborted = new Promise<DiscoverySourceOutcome>((resolve) => {
    controller.signal.addEventListener(
      "abort",
      () =>
        resolve(sourceOutcome(source, page, limit, [], signal?.aborted ? "aborted" : "timeout")),
      { once: true },
    );
  });

  try {
    return await Promise.race([
      load(controller.signal)
        .then((results) =>
          sourceOutcome(source, page, limit, results, results.length > 0 ? "done" : "empty"),
        )
        .catch((error) => {
          if (timeout || signal?.aborted || isAbortError(error)) {
            return sourceOutcome(source, page, limit, [], signal?.aborted ? "aborted" : "timeout");
          }
          return sourceOutcome(source, page, limit, [], classifyError(error), errorMessage(error));
        }),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

function sourceOutcome(
  source: DiscoverySource,
  page: number,
  limit: number,
  results: DiscoveryResult[],
  status: DiscoverySourceStatus,
  error?: string,
): DiscoverySourceOutcome {
  return {
    source,
    results,
    report: { source, status, count: results.length, error },
    // A full page implies more may exist; a short/empty page ends pagination.
    cursor: { page, hasMore: status === "done" && results.length >= limit },
  };
}

function classifyError(error: unknown): DiscoverySourceStatus {
  if (error instanceof ApiError && error.status === 429) return "rate_limited";
  return "error";
}

function errorMessage(error: unknown): string {
  return describeSafeError(error);
}

function reportFromOutcomes(
  sources: DiscoverySource[],
  outcomes: DiscoverySourceOutcome[],
  sort: DiscoverySort,
): DiscoverySearchReport {
  const reports = Object.fromEntries(
    sources.map((source) => [
      source,
      outcomes.find((o) => o.source === source)?.report ?? {
        source,
        status: "empty" as const,
        count: 0,
      },
    ]),
  ) as Record<DiscoverySource, DiscoverySourceReport>;
  const cursors = Object.fromEntries(
    sources.map((source) => [
      source,
      outcomes.find((o) => o.source === source)?.cursor ?? { page: 1, hasMore: false },
    ]),
  ) as Record<DiscoverySource, SourceCursor>;
  return {
    // No slice: paginated "load more" accumulates results client-side.
    results: mergeDiscoveryResults(
      outcomes.flatMap((outcome) => outcome.results),
      undefined,
      sort,
    ),
    sources: reports,
    cursors,
  };
}

function emptyReport(sources: DiscoverySource[]): DiscoverySearchReport {
  return reportFromOutcomes(sources, [], "relevance");
}

function resultId(source: DiscoverySource, work: NormalizedWork, index: number): string {
  return `${source}:${work.doi ?? work.arxivId ?? work.openalexId ?? work.s2Id ?? normalizeDiscoveryTitle(work.title)}:${index}`;
}
