import type {
  DiscoveryResult,
  DiscoverySearchReport,
  DiscoverySource,
  DiscoverySourceReport,
  ResolvedWork,
  SourceCursor,
} from "@aurascholar/core";
import type {
  LibraryResolveClueCommandResult,
  ScholarEnrichByDoiCommandResult,
  ScholarlyCancelRunCommandResult,
  ScholarlySearchDiscoveryCommandResult,
} from "../../electron/scholarly-command-contract";
import {
  assertOutputSize,
  decodeEnrichment,
  decodeNormalizedWork,
  isDenseArray,
  requireExactObject,
  requireInteger,
  requireText,
} from "./scholarly-command-value-codec";
import {
  MAX_SCHOLARLY_CANDIDATES,
  MAX_SCHOLARLY_COUNT,
  MAX_SCHOLARLY_DISCOVERY_ERROR_BYTES,
  MAX_SCHOLARLY_DISCOVERY_PAGE,
  MAX_SCHOLARLY_DISCOVERY_RESULT_ID_BYTES,
  MAX_SCHOLARLY_DISCOVERY_RESULTS,
} from "./scholarly-command-limits";

const ALL_DISCOVERY_SOURCES: readonly DiscoverySource[] = ["crossref", "openalex", "s2", "arxiv"];

/** Strictly validates and clones scholarly command responses received over IPC. */
export function decodeScholarlySearchDiscoveryResult(
  value: unknown,
  requestedSources?: readonly DiscoverySource[],
): ScholarlySearchDiscoveryCommandResult {
  const result = requireExactObject(value, "Discovery search result", ["report"]);
  const report = decodeDiscoveryReport(result.report, requestedSources);
  assertOutputSize({ report }, "Discovery search result");
  return { report };
}

export function decodeScholarEnrichByDoiResult(value: unknown): ScholarEnrichByDoiCommandResult {
  const result = requireExactObject(value, "Semantic Scholar enrichment result", ["enrichment"]);
  const enrichment = result.enrichment === null ? null : decodeEnrichment(result.enrichment);
  assertOutputSize({ enrichment }, "Semantic Scholar enrichment result");
  return { enrichment };
}

export function decodeLibraryResolveClueResult(value: unknown): LibraryResolveClueCommandResult {
  const result = requireExactObject(value, "Library clue resolution result", ["resolved"]);
  const resolved = result.resolved === null ? null : decodeResolvedWork(result.resolved);
  assertOutputSize({ resolved }, "Library clue resolution result");
  return { resolved };
}

export function decodeScholarlyCancelRunResult(value: unknown): ScholarlyCancelRunCommandResult {
  const result = requireExactObject(value, "Scholarly cancellation result", ["cancelled"]);
  if (typeof result.cancelled !== "boolean") {
    throw new Error("Scholarly cancellation result is invalid");
  }
  return { cancelled: result.cancelled };
}

function decodeDiscoveryReport(
  value: unknown,
  requestedSources: readonly DiscoverySource[] | undefined,
): DiscoverySearchReport {
  const report = requireExactObject(value, "Discovery search report", [
    "results",
    "sources",
    "cursors",
  ]);
  const sources = expectedSources(requestedSources);
  const resultValues = requireArray(
    report.results,
    MAX_SCHOLARLY_DISCOVERY_RESULTS,
    "Discovery results",
  );
  const expected = new Set(sources);
  const resultIds = new Set<string>();
  const results = resultValues.map((entry, index) => {
    const decoded = decodeDiscoveryResult(entry, index, expected);
    if (resultIds.has(decoded.id)) {
      throw new Error("Discovery result ids must be unique");
    }
    resultIds.add(decoded.id);
    return decoded;
  });
  const sourceRecord = requireExactObject(report.sources, "Discovery source reports", sources);
  const cursorRecord = requireExactObject(report.cursors, "Discovery cursors", sources);
  const sourceReports = {} as DiscoverySearchReport["sources"];
  const cursors = {} as DiscoverySearchReport["cursors"];
  for (const source of sources) {
    sourceReports[source] = decodeSourceReport(sourceRecord[source], source);
    cursors[source] = decodeCursor(cursorRecord[source], source);
  }
  return { cursors, results, sources: sourceReports };
}

function expectedSources(requested: readonly DiscoverySource[] | undefined): DiscoverySource[] {
  if (requested === undefined) return [...ALL_DISCOVERY_SOURCES];
  if (
    !Array.isArray(requested) ||
    requested.length === 0 ||
    requested.length > ALL_DISCOVERY_SOURCES.length ||
    !isDenseArray(requested)
  ) {
    throw new Error("Discovery requested sources are invalid");
  }
  const sources = requested.map((source) => {
    if (!ALL_DISCOVERY_SOURCES.includes(source)) {
      throw new Error("Discovery requested source is invalid");
    }
    return source;
  });
  if (new Set(sources).size !== sources.length) {
    throw new Error("Discovery requested sources must be unique");
  }
  return sources;
}

function decodeDiscoveryResult(
  value: unknown,
  index: number,
  expected: ReadonlySet<DiscoverySource>,
): DiscoveryResult {
  const result = requireExactObject(value, `Discovery result at index ${index}`, [
    "id",
    "source",
    "work",
    "score",
  ]);
  const source = requireDiscoverySource(result.source, `Discovery result source at index ${index}`);
  if (!expected.has(source))
    throw new Error("Discovery result source is outside the requested set");
  const work = decodeNormalizedWork(result.work, `Discovery result work at index ${index}`);
  if (work.source !== source) {
    throw new Error(`Discovery result work source at index ${index} is invalid`);
  }
  return {
    id: requireText(
      result.id,
      `Discovery result id at index ${index}`,
      MAX_SCHOLARLY_DISCOVERY_RESULT_ID_BYTES,
      true,
    ),
    score: requireScore(result.score, `Discovery result score at index ${index}`),
    source,
    work,
  };
}

function decodeSourceReport(value: unknown, source: DiscoverySource): DiscoverySourceReport {
  const report = requireExactObject(
    value,
    `Discovery source report for ${source}`,
    ["source", "status", "count"],
    ["error"],
  );
  if (report.source !== source || !isDiscoveryStatus(report.status)) {
    throw new Error(`Discovery source report for ${source} is invalid`);
  }
  const error = Object.hasOwn(report, "error")
    ? requireText(
        report.error,
        `Discovery source error for ${source}`,
        MAX_SCHOLARLY_DISCOVERY_ERROR_BYTES,
        true,
      )
    : undefined;
  return {
    count: requireInteger(
      report.count,
      `Discovery source count for ${source}`,
      0,
      MAX_SCHOLARLY_DISCOVERY_RESULTS,
    ),
    ...(error === undefined ? {} : { error }),
    source,
    status: report.status,
  };
}

function decodeCursor(value: unknown, source: DiscoverySource): SourceCursor {
  const cursor = requireExactObject(value, `Discovery cursor for ${source}`, ["hasMore", "page"]);
  if (typeof cursor.hasMore !== "boolean") {
    throw new Error(`Discovery cursor for ${source} is invalid`);
  }
  return {
    hasMore: cursor.hasMore,
    page: requireInteger(
      cursor.page,
      `Discovery cursor page for ${source}`,
      1,
      MAX_SCHOLARLY_DISCOVERY_PAGE,
    ),
  };
}

function decodeResolvedWork(value: unknown): ResolvedWork {
  const resolved = requireExactObject(
    value,
    "Resolved scholarly work",
    ["work", "confidence"],
    ["candidates"],
  );
  const candidates = Object.hasOwn(resolved, "candidates")
    ? requireArray(resolved.candidates, MAX_SCHOLARLY_CANDIDATES, "Resolved work candidates").map(
        (candidate, index) =>
          decodeNormalizedWork(candidate, `Resolved candidate at index ${index}`),
      )
    : undefined;
  if (
    typeof resolved.confidence !== "number" ||
    !Number.isFinite(resolved.confidence) ||
    resolved.confidence < 0 ||
    resolved.confidence > 1
  ) {
    throw new Error("Resolved scholarly work confidence is invalid");
  }
  return {
    ...(candidates === undefined ? {} : { candidates }),
    confidence: resolved.confidence,
    work: decodeNormalizedWork(resolved.work, "Resolved scholarly work metadata"),
  };
}

function requireArray(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum || !isDenseArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireScore(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_SCHOLARLY_COUNT
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireDiscoverySource(value: unknown, label: string): DiscoverySource {
  if (typeof value !== "string" || !ALL_DISCOVERY_SOURCES.includes(value as DiscoverySource)) {
    throw new Error(`${label} is invalid`);
  }
  return value as DiscoverySource;
}

function isDiscoveryStatus(value: unknown): value is DiscoverySourceReport["status"] {
  return (
    value === "done" ||
    value === "empty" ||
    value === "timeout" ||
    value === "error" ||
    value === "rate_limited" ||
    value === "aborted"
  );
}
