import type {
  BuildKnowledgeSemanticIndexResult,
  KnowledgeContentIndexStats,
  KnowledgeContentSearchResult,
  KnowledgeContentSearchRetrieval,
  KnowledgeContentStatsCommandResult,
  KnowledgeSemanticIndexStatus,
  KnowledgeSemanticIndexStatusCommandResult,
  SearchKnowledgeContentCommandResult,
} from "../../electron/knowledge-command-contract";
import type { LibraryScopeToken } from "../../electron/library-read-command-contract";
import {
  MAX_LIBRARY_SCOPE_ID_BYTES,
  MAX_LIBRARY_SCOPE_TOKEN_BYTES,
  libraryScopeUtf8ByteLength,
} from "./library-scope-limits";

const KNOWLEDGE_SOURCE_TYPES = ["pdf", "annotation", "evidence"] as const;
const MAX_KNOWLEDGE_SEARCH_RESULTS = 100;
const MAX_KNOWLEDGE_IDENTIFIER_BYTES = 512;

/**
 * Validates and clones the scope acknowledgement attached to every Knowledge
 * command result. The token is opaque to the renderer, but its shape and
 * binding must still be checked before a result reaches feature code.
 */
export function decodeKnowledgeScopeToken(value: unknown): LibraryScopeToken {
  const scope = requireExactKnowledgeObject(value, "Knowledge Library scope", [
    "libraryId",
    "scopeToken",
  ]);
  return {
    libraryId: requireKnowledgeIdentifier(
      scope.libraryId,
      "Knowledge Library id",
      MAX_LIBRARY_SCOPE_ID_BYTES,
    ),
    scopeToken: requireKnowledgeIdentifier(
      scope.scopeToken,
      "Knowledge Library scope token",
      MAX_LIBRARY_SCOPE_TOKEN_BYTES,
    ),
  };
}

/** Throws when a command acknowledged a different active Library generation. */
export function assertKnowledgeScopeMatches(
  actual: LibraryScopeToken,
  expected: LibraryScopeToken,
): void {
  const decodedActual = decodeKnowledgeScopeToken(actual);
  const decodedExpected = decodeKnowledgeScopeToken(expected);
  if (
    decodedActual.libraryId !== decodedExpected.libraryId ||
    decodedActual.scopeToken !== decodedExpected.scopeToken
  ) {
    throw new Error("Knowledge Library scope does not match the request");
  }
}

export function decodeKnowledgeBuildSemanticIndexResult(
  value: unknown,
  expectedScope: LibraryScopeToken,
): BuildKnowledgeSemanticIndexResult {
  const result = requireExactKnowledgeObject(value, "Knowledge semantic-index build result", [
    "created",
    "index",
    "job",
    "scope",
  ]);
  const scope = decodeAndAssertScope(result.scope, expectedScope);
  if (typeof result.created !== "boolean") {
    throw new Error("Knowledge semantic-index build result is invalid");
  }
  const index = decodeKnowledgeSemanticIndexSummary(
    result.index,
    "Knowledge semantic-index build index",
  );
  const job = decodeKnowledgeSemanticIndexJob(result.job);
  return { created: result.created, index, job, scope };
}

export function decodeKnowledgeGetContentStatsResult(
  value: unknown,
  expectedScope: LibraryScopeToken,
): KnowledgeContentStatsCommandResult {
  const result = requireExactKnowledgeObject(value, "Knowledge content stats result", [
    "stats",
    "scope",
  ]);
  const scope = decodeAndAssertScope(result.scope, expectedScope);
  return { stats: decodeKnowledgeContentIndexStats(result.stats), scope };
}

export function decodeKnowledgeGetSemanticIndexStatusResult(
  value: unknown,
  expectedScope: LibraryScopeToken,
): KnowledgeSemanticIndexStatusCommandResult {
  const result = requireExactKnowledgeObject(value, "Knowledge semantic-index status result", [
    "status",
    "scope",
  ]);
  const scope = decodeAndAssertScope(result.scope, expectedScope);
  return { status: decodeKnowledgeSemanticIndexStatus(result.status), scope };
}

export function decodeKnowledgeSearchContentResult(
  value: unknown,
  expectedScope: LibraryScopeToken,
): SearchKnowledgeContentCommandResult {
  const result = requireExactKnowledgeObject(value, "Knowledge search result", [
    "results",
    "retrieval",
    "scope",
  ]);
  const scope = decodeAndAssertScope(result.scope, expectedScope);
  return {
    results: decodeKnowledgeSearchResults(result.results),
    retrieval: decodeKnowledgeSearchRetrieval(result.retrieval),
    scope,
  };
}

function decodeAndAssertScope(value: unknown, expected: LibraryScopeToken): LibraryScopeToken {
  const scope = decodeKnowledgeScopeToken(value);
  const expectedScope = decodeKnowledgeScopeToken(expected);
  if (
    scope.libraryId !== expectedScope.libraryId ||
    scope.scopeToken !== expectedScope.scopeToken
  ) {
    throw new Error("Knowledge Library scope does not match the request");
  }
  return scope;
}

function decodeKnowledgeContentIndexStats(value: unknown): KnowledgeContentIndexStats {
  const stats = requireExactKnowledgeObject(value, "Knowledge content stats", [
    "totalContentUnits",
    "readyContentUnits",
    "contextOnlyContentUnits",
    "sourceCounts",
    "languageCoverage",
  ]);
  const sourceCounts = requireExactKnowledgeObject(stats.sourceCounts, "Knowledge source counts", [
    ...KNOWLEDGE_SOURCE_TYPES,
  ]);
  const languageCoverage = requireExactKnowledgeObject(
    stats.languageCoverage,
    "Knowledge language coverage",
    ["zh", "en", "other", "missing"],
  );
  return {
    totalContentUnits: requireKnowledgeCount(stats.totalContentUnits, "Knowledge total count"),
    readyContentUnits: requireKnowledgeCount(stats.readyContentUnits, "Knowledge ready count"),
    contextOnlyContentUnits: requireKnowledgeCount(
      stats.contextOnlyContentUnits,
      "Knowledge context-only count",
    ),
    sourceCounts: {
      annotation: requireKnowledgeCount(
        sourceCounts.annotation,
        "Knowledge annotation source count",
      ),
      evidence: requireKnowledgeCount(sourceCounts.evidence, "Knowledge evidence source count"),
      pdf: requireKnowledgeCount(sourceCounts.pdf, "Knowledge PDF source count"),
    },
    languageCoverage: {
      en: requireKnowledgeCount(languageCoverage.en, "Knowledge English coverage"),
      missing: requireKnowledgeCount(languageCoverage.missing, "Knowledge missing coverage"),
      other: requireKnowledgeCount(languageCoverage.other, "Knowledge other coverage"),
      zh: requireKnowledgeCount(languageCoverage.zh, "Knowledge Chinese coverage"),
    },
  };
}

function decodeKnowledgeSemanticIndexStatus(value: unknown): KnowledgeSemanticIndexStatus {
  const status = requireExactKnowledgeObject(value, "Knowledge semantic-index status", [
    "active",
    "building",
    "failed",
  ]);
  return {
    active: decodeNullableKnowledgeSemanticIndexSummary(status.active, "active"),
    building: decodeNullableKnowledgeSemanticIndexSummary(status.building, "building"),
    failed: decodeNullableKnowledgeSemanticIndexSummary(status.failed, "failed"),
  };
}

function decodeNullableKnowledgeSemanticIndexSummary(
  value: unknown,
  label: string,
): KnowledgeSemanticIndexStatus["active"] {
  return value === null
    ? null
    : decodeKnowledgeSemanticIndexSummary(value, `Knowledge ${label} semantic index`);
}

function decodeKnowledgeSemanticIndexSummary(
  value: unknown,
  label: string,
): NonNullable<KnowledgeSemanticIndexStatus["active"]> {
  const summary = requireExactKnowledgeObject(value, label, [
    "expectedCount",
    "id",
    "indexedCount",
    "stale",
    "status",
  ]);
  if (summary.status !== "active" && summary.status !== "building" && summary.status !== "failed") {
    throw new Error(`${label} is invalid`);
  }
  if (typeof summary.stale !== "boolean") throw new Error(`${label} is invalid`);
  return {
    expectedCount: requireKnowledgeCount(summary.expectedCount, `${label} expected count`),
    id: requireKnowledgeIdentifier(summary.id, `${label} id`, MAX_KNOWLEDGE_IDENTIFIER_BYTES),
    indexedCount: requireKnowledgeCount(summary.indexedCount, `${label} indexed count`),
    stale: summary.stale,
    status: summary.status,
  };
}

function decodeKnowledgeSemanticIndexJob(value: unknown): BuildKnowledgeSemanticIndexResult["job"] {
  const job = requireExactKnowledgeObject(value, "Knowledge semantic-index job", ["id", "status"]);
  if (
    job.status !== "queued" &&
    job.status !== "leased" &&
    job.status !== "running" &&
    job.status !== "retry-wait"
  ) {
    throw new Error("Knowledge semantic-index job is invalid");
  }
  return {
    id: requireKnowledgeIdentifier(
      job.id,
      "Knowledge semantic-index job id",
      MAX_KNOWLEDGE_IDENTIFIER_BYTES,
    ),
    status: job.status,
  };
}

function decodeKnowledgeSearchResults(value: unknown): KnowledgeContentSearchResult[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_KNOWLEDGE_SEARCH_RESULTS ||
    !isDenseArray(value)
  ) {
    throw new Error(`Knowledge search results are limited to ${MAX_KNOWLEDGE_SEARCH_RESULTS}`);
  }
  return value.map((entry, index) => decodeKnowledgeSearchResult(entry, index));
}

function decodeKnowledgeSearchResult(value: unknown, index: number): KnowledgeContentSearchResult {
  const result = requireExactKnowledgeObject(value, `Knowledge search result at index ${index}`, [
    "id",
    "sourceType",
    "sourceId",
    "workId",
    "workTitle",
    "assetId",
    "revisionId",
    "parentUnitId",
    "ordinal",
    "headingPath",
    "anchor",
    "text",
    "language",
    "tokenCount",
    "state",
    "score",
    "excerpt",
  ]);
  const sourceType = result.sourceType;
  if (!KNOWLEDGE_SOURCE_TYPES.includes(sourceType as (typeof KNOWLEDGE_SOURCE_TYPES)[number])) {
    throw new Error(`Knowledge search result at index ${index} is invalid`);
  }
  const decodedSourceType = sourceType as (typeof KNOWLEDGE_SOURCE_TYPES)[number];
  if (result.state !== "ready" && result.state !== "context-only") {
    throw new Error(`Knowledge search result at index ${index} is invalid`);
  }
  if (typeof result.score !== "number" || !Number.isFinite(result.score)) {
    throw new Error(`Knowledge search result at index ${index} is invalid`);
  }
  const headingPath = decodeKnowledgeHeadingPath(result.headingPath, index);
  return {
    id: requireKnowledgeIdentifier(
      result.id,
      `Knowledge result ${index} id`,
      MAX_KNOWLEDGE_IDENTIFIER_BYTES,
    ),
    sourceType: decodedSourceType,
    sourceId: requireKnowledgeIdentifier(
      result.sourceId,
      `Knowledge result ${index} source id`,
      MAX_KNOWLEDGE_IDENTIFIER_BYTES,
    ),
    workId: requireNullableKnowledgeIdentifier(result.workId, `Knowledge result ${index} work id`),
    workTitle: requireNullableKnowledgeText(
      result.workTitle,
      `Knowledge result ${index} work title`,
    ),
    assetId: requireNullableKnowledgeIdentifier(
      result.assetId,
      `Knowledge result ${index} asset id`,
    ),
    revisionId: requireNullableKnowledgeIdentifier(
      result.revisionId,
      `Knowledge result ${index} revision id`,
    ),
    parentUnitId: requireNullableKnowledgeIdentifier(
      result.parentUnitId,
      `Knowledge result ${index} parent id`,
    ),
    ordinal: requireKnowledgeCount(result.ordinal, `Knowledge result ${index} ordinal`),
    headingPath,
    anchor: result.anchor,
    text: requireKnowledgeText(result.text, `Knowledge result ${index} text`),
    language: requireNullableKnowledgeText(result.language, `Knowledge result ${index} language`),
    tokenCount:
      result.tokenCount === null
        ? null
        : requireKnowledgeCount(result.tokenCount, `Knowledge result ${index} token count`),
    state: result.state,
    score: result.score,
    excerpt: requireKnowledgeText(result.excerpt, `Knowledge result ${index} excerpt`),
  };
}

function decodeKnowledgeHeadingPath(value: unknown, index: number): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || !isDenseArray(value)) {
    throw new Error(`Knowledge result ${index} heading path is invalid`);
  }
  return value.map((part, partIndex) =>
    requireKnowledgeText(part, `Knowledge result ${index} heading ${partIndex}`),
  );
}

function decodeKnowledgeSearchRetrieval(value: unknown): KnowledgeContentSearchRetrieval {
  const retrieval = requireExactKnowledgeObject(
    value,
    "Knowledge search retrieval",
    ["mode", "semanticStatus"],
    ["languagePreference"],
  );
  if (retrieval.mode !== "fulltext" && retrieval.mode !== "hybrid") {
    throw new Error("Knowledge search retrieval is invalid");
  }
  if (
    retrieval.semanticStatus !== "not-configured" &&
    retrieval.semanticStatus !== "unavailable" &&
    retrieval.semanticStatus !== "used"
  ) {
    throw new Error("Knowledge search retrieval is invalid");
  }
  const languagePreference = Object.hasOwn(retrieval, "languagePreference")
    ? decodeKnowledgeLanguagePreference(retrieval.languagePreference)
    : undefined;
  return {
    mode: retrieval.mode,
    semanticStatus: retrieval.semanticStatus,
    ...(languagePreference ? { languagePreference } : {}),
  };
}

function decodeKnowledgeLanguagePreference(
  value: unknown,
): NonNullable<KnowledgeContentSearchRetrieval["languagePreference"]> {
  const preference = requireExactKnowledgeObject(value, "Knowledge search language preference", [
    "requestedLanguage",
    "applied",
  ]);
  if (preference.requestedLanguage !== "zh" && preference.requestedLanguage !== "en") {
    throw new Error("Knowledge search language preference is invalid");
  }
  if (typeof preference.applied !== "boolean") {
    throw new Error("Knowledge search language preference is invalid");
  }
  return { requestedLanguage: preference.requestedLanguage, applied: preference.applied };
}

function requireKnowledgeCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} is invalid`);
  return value as number;
}

function requireKnowledgeIdentifier(value: unknown, label: string, maximumBytes: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    libraryScopeUtf8ByteLength(value) > maximumBytes
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireNullableKnowledgeIdentifier(value: unknown, label: string): string | null {
  return value === null
    ? null
    : requireKnowledgeIdentifier(value, label, MAX_KNOWLEDGE_IDENTIFIER_BYTES);
}

function requireKnowledgeText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  return value;
}

function requireNullableKnowledgeText(value: unknown, label: string): string | null {
  return value === null ? null : requireKnowledgeText(value, label);
}

function requireExactKnowledgeObject(
  value: unknown,
  label: string,
  requiredFields: readonly string[],
  optionalFields: readonly string[] = [],
): Record<string, unknown> {
  const allowedFields = [...requiredFields, ...optionalFields];
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !allowedFields.includes(field)) ||
    requiredFields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDenseArray(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}
