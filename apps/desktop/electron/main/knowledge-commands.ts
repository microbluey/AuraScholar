import {
  CONTENT_UNIT_SOURCE_TYPES,
  ContentUnitSearchRepo,
  ContentUnitsRepo,
  type ContentUnitIndexStats,
  type ContentUnitSearchResult,
  type ContentUnitSourceType,
} from "@aurascholar/db/repos/knowledge";
import {
  applyRetrievalLanguagePreference,
  parseRetrievalLanguageIntent,
  type FusedRetrievalRank,
  type RetrievalLanguageIntent,
} from "@aurascholar/knowledge";
import type {
  BuildKnowledgeSemanticIndexResult,
  DataCommandOutput,
  DataCommandRequest,
  KnowledgeContentIndexStats,
  KnowledgeContentSearchRetrieval,
  KnowledgeContentSearchResult,
  KnowledgeSemanticIndexStatus,
  KnowledgeSemanticIndexSummary,
} from "../data-command-contract";
import type {
  EnqueueLocalSemanticIndexBuildResult,
  LocalSemanticIndexService,
} from "./local-semantic-index-service";
import type { LocalSemanticSearchService } from "./local-semantic-search-service";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";

const MAX_KNOWLEDGE_SEARCH_LIMIT = 100;
const MAX_KNOWLEDGE_SEARCH_QUERY_LENGTH = 1_024;
const KNOWLEDGE_SEARCH_CANDIDATE_MULTIPLIER = 4;

export type KnowledgeCommandName =
  | "knowledge.buildSemanticIndex"
  | "knowledge.getContentStats"
  | "knowledge.getSemanticIndexStatus"
  | "knowledge.searchContent";

type KnowledgeCommandRequest = Extract<DataCommandRequest, { name: KnowledgeCommandName }>;

export interface KnowledgeCommandCapabilities {
  readonly semanticIndex?: Pick<LocalSemanticIndexService, "enqueueBuild" | "getStatus">;
  readonly semanticSearch?: Pick<LocalSemanticSearchService, "search">;
}

interface ParsedSearchKnowledgeContentInput {
  libraryId: string;
  query: string;
  limit: number;
  sourceTypes: ContentUnitSourceType[] | undefined;
  sourceId: string | undefined;
  workId: string | undefined;
  assetId: string | undefined;
  revisionId: string | undefined;
  includeContextOnly: boolean;
}

interface ParsedKnowledgeContentStatsInput {
  libraryId: string;
}

export function executeKnowledgeCommand(
  request: Extract<DataCommandRequest, { name: "knowledge.buildSemanticIndex" }>,
  dependencies: DataCommandDependencies,
  capabilities?: KnowledgeCommandCapabilities,
): Promise<DataCommandOutput<"knowledge.buildSemanticIndex">>;
export function executeKnowledgeCommand(
  request: Extract<DataCommandRequest, { name: "knowledge.getContentStats" }>,
  dependencies: DataCommandDependencies,
  capabilities?: KnowledgeCommandCapabilities,
): Promise<DataCommandOutput<"knowledge.getContentStats">>;
export function executeKnowledgeCommand(
  request: Extract<DataCommandRequest, { name: "knowledge.getSemanticIndexStatus" }>,
  dependencies: DataCommandDependencies,
  capabilities?: KnowledgeCommandCapabilities,
): Promise<DataCommandOutput<"knowledge.getSemanticIndexStatus">>;
export function executeKnowledgeCommand(
  request: Extract<DataCommandRequest, { name: "knowledge.searchContent" }>,
  dependencies: DataCommandDependencies,
  capabilities?: KnowledgeCommandCapabilities,
): Promise<DataCommandOutput<"knowledge.searchContent">>;
export function executeKnowledgeCommand(
  request: KnowledgeCommandRequest,
  dependencies: DataCommandDependencies,
  capabilities?: KnowledgeCommandCapabilities,
): Promise<DataCommandOutput<KnowledgeCommandName>>;
export async function executeKnowledgeCommand(
  request: KnowledgeCommandRequest,
  dependencies: DataCommandDependencies,
  capabilities: KnowledgeCommandCapabilities = {},
): Promise<DataCommandOutput<KnowledgeCommandName>> {
  switch (request.name) {
    case "knowledge.buildSemanticIndex": {
      const input = parseLibraryInput(request.input, "knowledge.buildSemanticIndex");
      await assertActiveScope(dependencies, input.libraryId);
      const semanticIndex = requireSemanticIndexCapability(capabilities);
      return toBuildSemanticIndexResult(await semanticIndex.enqueueBuild(input.libraryId));
    }
    case "knowledge.getContentStats": {
      const input = parseContentStatsInput(request.input);
      if (!dependencies.execute) {
        throw new Error("Main-process database query execution is unavailable");
      }
      return dependencies.execute(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const stats = await new ContentUnitsRepo(database, input.libraryId).getIndexStats();
        return { stats: toKnowledgeContentIndexStats(stats) };
      });
    }
    case "knowledge.getSemanticIndexStatus": {
      const input = parseLibraryInput(request.input, "knowledge.getSemanticIndexStatus");
      await assertActiveScope(dependencies, input.libraryId);
      const semanticIndex = requireSemanticIndexCapability(capabilities);
      return {
        status: toKnowledgeSemanticIndexStatus(await semanticIndex.getStatus(input.libraryId)),
      };
    }
    case "knowledge.searchContent": {
      const input = parseSearchContentInput(request.input);
      // Empty controls in the future UI should not acquire a database lease or
      // accidentally turn into an unbounded corpus listing.
      if (!input.query) {
        return {
          results: [],
          retrieval: { mode: "fulltext", semanticStatus: "not-configured" },
        };
      }
      if (!dependencies.inspect) {
        throw new Error("Main-process database query execution is unavailable");
      }
      return searchKnowledgeContent(input, dependencies, capabilities.semanticSearch);
    }
  }
}

async function searchKnowledgeContent(
  input: ParsedSearchKnowledgeContentInput,
  dependencies: DataCommandDependencies,
  semanticSearch: KnowledgeCommandCapabilities["semanticSearch"],
): Promise<DataCommandOutput<"knowledge.searchContent">> {
  const fullTextLimit = knowledgeSearchCandidateLimit(input.limit);
  const languageIntent = parseRetrievalLanguageIntent(input.query);
  const fullTextResults = async (): Promise<ContentUnitSearchResult[]> => {
    if (!dependencies.inspect) {
      throw new Error("Main-process database query execution is unavailable");
    }
    return dependencies.inspect(async (database) => {
      await assertActiveLocalLibrary(database, input.libraryId);
      return new ContentUnitSearchRepo(database, input.libraryId).search({
        query: input.query,
        limit: fullTextLimit,
        sourceTypes: input.sourceTypes,
        sourceId: input.sourceId,
        workId: input.workId,
        assetId: input.assetId,
        revisionId: input.revisionId,
        includeContextOnly: input.includeContextOnly,
      });
    });
  };

  if (!semanticSearch) {
    const ranked = rerankFullTextResults(await fullTextResults(), languageIntent);
    return {
      results: ranked.rows.slice(0, input.limit).map(toKnowledgeContentSearchResult),
      retrieval: toKnowledgeContentSearchRetrieval(
        { mode: "fulltext", semanticStatus: "not-configured" },
        languagePreferenceForResponse(languageIntent, ranked.applied),
      ),
    };
  }

  // Resolve the vector-store allowlist before the query reaches the optional
  // embedding runtime. Keep this database lease separate from the full-text
  // callback below: HybridRetriever runs FTS and vector lookup concurrently.
  const allowedSourceIds = await listReadySourceIds(input, dependencies);
  if (allowedSourceIds.length === 0) {
    const ranked = rerankFullTextResults(await fullTextResults(), languageIntent);
    return {
      results: ranked.rows.slice(0, input.limit).map(toKnowledgeContentSearchResult),
      retrieval: toKnowledgeContentSearchRetrieval(
        { mode: "fulltext", semanticStatus: "not-configured" },
        languagePreferenceForResponse(languageIntent, ranked.applied),
      ),
    };
  }

  let fullTextPromise: Promise<ContentUnitSearchResult[]> | undefined;
  const retrieveFullText = (): Promise<ContentUnitSearchResult[]> => {
    fullTextPromise ??= fullTextResults();
    return fullTextPromise;
  };
  const hybrid = await semanticSearch.search({
    allowedSourceIds,
    fullText: {
      // Scope and limit are captured from the validated command input. This
      // callback deliberately returns IDs only; presentation rows are loaded
      // after fusion through the same canonical filters.
      search: async () => (await retrieveFullText()).map(({ id }) => ({ contentUnitId: id })),
    },
    libraryId: input.libraryId,
    limit: fullTextLimit,
    query: input.query,
  });
  const fullText = await retrieveFullText();
  const hydrated = await hydrateSemanticCandidates(
    hybrid.candidates.map(({ contentUnitId }) => contentUnitId),
    fullText,
    input,
    dependencies,
  );
  const resultById = new Map<string, ContentUnitSearchResult>();
  for (const row of fullText) resultById.set(row.id, row);
  for (const row of hydrated) resultById.set(row.id, row);

  const languageByContentUnitId = new Map<string, string | null>();
  for (const row of resultById.values()) languageByContentUnitId.set(row.id, row.language);
  const languagePreference = languageIntent
    ? applyRetrievalLanguagePreference(hybrid.candidates, {
        languageByContentUnitId,
        preferredLanguage: languageIntent.language,
      })
    : null;
  const candidates = languagePreference?.candidates ?? hybrid.candidates;

  return {
    results: candidates
      .map(({ contentUnitId }) => resultById.get(contentUnitId))
      .filter((row): row is ContentUnitSearchResult => row !== undefined)
      .slice(0, input.limit)
      .map(toKnowledgeContentSearchResult),
    retrieval: toKnowledgeContentSearchRetrieval(
      hybrid,
      languagePreferenceForResponse(languageIntent, languagePreference?.applied ?? false),
    ),
  };
}

interface RankedFullTextResults {
  rows: ContentUnitSearchResult[];
  applied: boolean;
}

function rerankFullTextResults(
  rows: ContentUnitSearchResult[],
  languageIntent: RetrievalLanguageIntent | null,
): RankedFullTextResults {
  if (!languageIntent || rows.length === 0) return { applied: false, rows };
  const baseCandidates: FusedRetrievalRank[] = rows.map((row, index) => ({
    contentUnitId: row.id,
    ranks: [{ channelId: "fulltext", rank: index + 1 }],
    // Keep the fallback on the same RRF scale as the hybrid path so the
    // explicit preference has one documented strength in both modes.
    score: 1 / (60 + index + 1),
  }));
  const languageByContentUnitId = new Map(rows.map((row) => [row.id, row.language]));
  const reranked = applyRetrievalLanguagePreference(baseCandidates, {
    languageByContentUnitId,
    preferredLanguage: languageIntent.language,
  });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  return {
    applied: reranked.applied,
    rows: reranked.candidates
      .map(({ contentUnitId }) => rowById.get(contentUnitId))
      .filter((row): row is ContentUnitSearchResult => row !== undefined),
  };
}

function knowledgeSearchCandidateLimit(limit: number): number {
  return Math.min(MAX_KNOWLEDGE_SEARCH_LIMIT, limit * KNOWLEDGE_SEARCH_CANDIDATE_MULTIPLIER);
}

async function listReadySourceIds(
  input: ParsedSearchKnowledgeContentInput,
  dependencies: DataCommandDependencies,
): Promise<string[]> {
  if (!dependencies.inspect)
    throw new Error("Main-process database query execution is unavailable");
  return dependencies.inspect(async (database) => {
    await assertActiveLocalLibrary(database, input.libraryId);
    return new ContentUnitSearchRepo(database, input.libraryId).listReadySourceIds({
      sourceTypes: input.sourceTypes,
      sourceId: input.sourceId,
      workId: input.workId,
      assetId: input.assetId,
      revisionId: input.revisionId,
    });
  });
}

async function hydrateSemanticCandidates(
  candidateIds: readonly string[],
  fullText: readonly ContentUnitSearchResult[],
  input: ParsedSearchKnowledgeContentInput,
  dependencies: DataCommandDependencies,
): Promise<ContentUnitSearchResult[]> {
  const fullTextIds = new Set(fullText.map(({ id }) => id));
  const missingIds = [...new Set(candidateIds.filter((id) => !fullTextIds.has(id)))];
  if (missingIds.length === 0) return [];
  if (!dependencies.inspect)
    throw new Error("Main-process database query execution is unavailable");
  return dependencies.inspect(async (database) => {
    await assertActiveLocalLibrary(database, input.libraryId);
    return new ContentUnitSearchRepo(database, input.libraryId).findReadyByIds({
      contentUnitIds: missingIds,
      sourceTypes: input.sourceTypes,
      sourceId: input.sourceId,
      workId: input.workId,
      assetId: input.assetId,
      revisionId: input.revisionId,
    });
  });
}

function toKnowledgeContentSearchRetrieval(
  result: {
    mode: KnowledgeContentSearchRetrieval["mode"];
    semanticStatus: KnowledgeContentSearchRetrieval["semanticStatus"];
  },
  languagePreference?: KnowledgeContentSearchRetrieval["languagePreference"],
): KnowledgeContentSearchRetrieval {
  return {
    mode: result.mode,
    semanticStatus: result.semanticStatus,
    ...(languagePreference ? { languagePreference } : {}),
  };
}

function languagePreferenceForResponse(
  intent: RetrievalLanguageIntent | null,
  applied: boolean,
): KnowledgeContentSearchRetrieval["languagePreference"] {
  return intent ? { applied, requestedLanguage: intent.language } : undefined;
}

async function assertActiveScope(
  dependencies: DataCommandDependencies,
  libraryId: string,
): Promise<void> {
  if (!dependencies.inspect)
    throw new Error("Main-process database query execution is unavailable");
  await dependencies.inspect((database) => assertActiveLocalLibrary(database, libraryId));
}

function requireSemanticIndexCapability(
  capabilities: KnowledgeCommandCapabilities,
): NonNullable<KnowledgeCommandCapabilities["semanticIndex"]> {
  if (!capabilities.semanticIndex) throw new Error("Local semantic indexing is unavailable");
  return capabilities.semanticIndex;
}

function parseContentStatsInput(value: unknown): ParsedKnowledgeContentStatsInput {
  if (!isRecord(value)) throw new Error("Invalid knowledge.getContentStats input");
  return { libraryId: requireRecordId(value.libraryId, "Library id") };
}

function parseLibraryInput(value: unknown, commandName: string): ParsedKnowledgeContentStatsInput {
  if (!isRecord(value)) throw new Error(`Invalid ${commandName} input`);
  return { libraryId: requireRecordId(value.libraryId, "Library id") };
}

function parseSearchContentInput(value: unknown): ParsedSearchKnowledgeContentInput {
  if (!isRecord(value)) throw new Error("Invalid knowledge.searchContent input");
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    query: requireSearchQuery(value.query),
    limit: requireOptionalInteger(
      value.limit,
      "Knowledge search limit",
      1,
      MAX_KNOWLEDGE_SEARCH_LIMIT,
      20,
    ),
    sourceTypes: requireSourceTypes(value.sourceTypes),
    sourceId: requireOptionalRecordId(value.sourceId, "ContentUnit source id"),
    workId: requireOptionalRecordId(value.workId, "Work id"),
    assetId: requireOptionalRecordId(value.assetId, "Document asset id"),
    revisionId: requireOptionalRecordId(value.revisionId, "Document revision id"),
    includeContextOnly: requireOptionalBoolean(value.includeContextOnly, "includeContextOnly"),
  };
}

function requireSearchQuery(value: unknown): string {
  if (typeof value !== "string") throw new Error("Knowledge search query must be a string");
  const query = value.trim();
  if (query.length > MAX_KNOWLEDGE_SEARCH_QUERY_LENGTH) {
    throw new Error(
      `Knowledge search query is limited to ${MAX_KNOWLEDGE_SEARCH_QUERY_LENGTH} characters`,
    );
  }
  return query;
}

function requireOptionalInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} is invalid`);
  }
  const integer = value as number;
  if (integer < minimum || integer > maximum) throw new Error(`${label} is invalid`);
  return integer;
}

function requireSourceTypes(value: unknown): ContentUnitSourceType[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > CONTENT_UNIT_SOURCE_TYPES.length) {
    throw new Error("Knowledge search sourceTypes are invalid");
  }
  if (value.length === 0) return undefined;
  const sourceTypes = value.map((sourceType) => {
    if (!CONTENT_UNIT_SOURCE_TYPES.includes(sourceType as ContentUnitSourceType)) {
      throw new Error(`Unsupported ContentUnit source type: ${String(sourceType)}`);
    }
    return sourceType as ContentUnitSourceType;
  });
  if (new Set(sourceTypes).size !== sourceTypes.length) {
    throw new Error("Knowledge search sourceTypes must be unique");
  }
  return sourceTypes;
}

function requireOptionalRecordId(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requireRecordId(value, label);
}

function requireOptionalBoolean(value: unknown, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function toKnowledgeContentSearchResult(
  row: ContentUnitSearchResult,
): KnowledgeContentSearchResult {
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    workId: row.workId,
    workTitle: row.workTitle,
    assetId: row.assetId,
    revisionId: row.revisionId,
    parentUnitId: row.parentUnitId,
    ordinal: row.ordinal,
    headingPath: row.headingPath,
    anchor: row.anchor,
    text: row.text,
    language: row.language,
    tokenCount: row.tokenCount,
    state: row.state,
    score: row.score,
    excerpt: row.excerpt,
  };
}

function toKnowledgeContentIndexStats(stats: ContentUnitIndexStats): KnowledgeContentIndexStats {
  return {
    totalContentUnits: stats.total,
    readyContentUnits: stats.ready,
    contextOnlyContentUnits: stats.contextOnly,
    sourceCounts: stats.sourceCounts,
    languageCoverage: stats.languageCoverage,
  };
}

function toBuildSemanticIndexResult(
  result: EnqueueLocalSemanticIndexBuildResult,
): BuildKnowledgeSemanticIndexResult {
  const status = result.job.status;
  if (
    status !== "queued" &&
    status !== "leased" &&
    status !== "running" &&
    status !== "retry-wait"
  ) {
    throw new Error("Semantic index job cannot be presented safely");
  }
  const indexStatus = requirePresentableSemanticIndexStatus(result.index.status);
  return {
    created: result.created,
    index: toKnowledgeSemanticIndexSummary({
      ...result.index,
      // A newly captured generation uses the current change high-water mark.
      stale: false,
      status: indexStatus,
    }),
    job: { id: result.job.id, status },
  };
}

function requirePresentableSemanticIndexStatus(
  status: string,
): KnowledgeSemanticIndexSummary["status"] {
  if (status === "active" || status === "building" || status === "failed") return status;
  throw new Error("Semantic index is not in a presentable state");
}

function toKnowledgeSemanticIndexStatus(
  status: Awaited<
    ReturnType<NonNullable<KnowledgeCommandCapabilities["semanticIndex"]>["getStatus"]>
  >,
): KnowledgeSemanticIndexStatus {
  return {
    active: status.active ? toKnowledgeSemanticIndexSummary(status.active) : null,
    building: status.building ? toKnowledgeSemanticIndexSummary(status.building) : null,
    failed: status.failed ? toKnowledgeSemanticIndexSummary(status.failed) : null,
  };
}

function toKnowledgeSemanticIndexSummary(summary: {
  expectedCount: number;
  id: string;
  indexedCount: number;
  stale: boolean;
  status: "active" | "building" | "failed";
}): KnowledgeSemanticIndexSummary {
  return { ...summary };
}
