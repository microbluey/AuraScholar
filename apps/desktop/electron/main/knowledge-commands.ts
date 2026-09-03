import {
  ContentUnitSearchRepo,
  ContentUnitsRepo,
  type ContentUnitSearchResult,
} from "@aurascholar/db/repos/knowledge";
import {
  applyRetrievalLanguagePreference,
  parseRetrievalLanguageIntent,
  type FusedRetrievalRank,
  type RetrievalLanguageIntent,
} from "@aurascholar/knowledge";
import type {
  DataCommandOutput,
  DataCommandRequest,
  KnowledgeContentSearchRetrieval,
} from "../data-command-contract";
import type { LibraryScopeToken } from "../library-read-command-contract";
import type { LocalSemanticIndexService } from "./local-semantic-index-service";
import type { LocalSemanticSearchService } from "./local-semantic-search-service";
import {
  resolveKnowledgeCorpusAndFullText,
  resolveKnowledgeCorpusScope,
} from "./knowledge-corpus-scope";
import {
  MAX_KNOWLEDGE_SEARCH_LIMIT,
  parseContentStatsInput,
  parseLibraryInput,
  parseSearchContentInput,
  type ParsedSearchKnowledgeContentInput,
} from "./knowledge-command-input";
import { type DataCommandDependencies } from "./data-command-runtime";
import { assertActiveLibraryScopeToken } from "./library-scope-token";
import {
  toBuildSemanticIndexResult,
  toKnowledgeContentIndexStats,
  toKnowledgeContentSearchResult,
  toKnowledgeSemanticIndexStatus,
} from "./knowledge-command-projection";

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
      await assertActiveScope(dependencies, input.expectedScope);
      const semanticIndex = requireSemanticIndexCapability(capabilities);
      const result = await semanticIndex.enqueueBuild(input.libraryId, input.expectedScope);
      const scope = await assertActiveScope(dependencies, input.expectedScope);
      return toBuildSemanticIndexResult(result, scope);
    }
    case "knowledge.getContentStats": {
      const input = parseContentStatsInput(request.input);
      if (!dependencies.execute) {
        throw new Error("Main-process database query execution is unavailable");
      }
      return dependencies.execute(request.name, async (database) => {
        const scope = await assertActiveLibraryScopeToken(database, input.expectedScope);
        const stats = await new ContentUnitsRepo(database, input.libraryId).getIndexStats();
        return { scope, stats: toKnowledgeContentIndexStats(stats) };
      });
    }
    case "knowledge.getSemanticIndexStatus": {
      const input = parseLibraryInput(request.input, "knowledge.getSemanticIndexStatus");
      await assertActiveScope(dependencies, input.expectedScope);
      const semanticIndex = requireSemanticIndexCapability(capabilities);
      const status = await semanticIndex.getStatus(input.libraryId, input.expectedScope);
      const scope = await assertActiveScope(dependencies, input.expectedScope);
      return {
        scope,
        status: toKnowledgeSemanticIndexStatus(status),
      };
    }
    case "knowledge.searchContent": {
      const input = parseSearchContentInput(request.input);
      const scope = await assertActiveScope(dependencies, input.expectedScope);
      // Empty controls should validate the Library generation, but never
      // acquire a corpus/search lease or turn into an unbounded listing.
      if (!input.query) {
        return {
          results: [],
          retrieval: { mode: "fulltext", semanticStatus: "not-configured" },
          scope,
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

  if (!semanticSearch || input.includeContextOnly) {
    // Resolve and query under one read lease for the common FTS-only path.
    // The scope and rows therefore share the same database view while keeping
    // the immutable allowlist available for later diagnostic consumers.
    // Context-only units are intentionally absent from hybrid generations, so
    // an explicit context request must remain live full-text rather than mix a
    // pinned ready corpus with unpinned diagnostic rows.
    const { rows: fullText } = await resolveKnowledgeCorpusAndFullText(
      input,
      dependencies,
      fullTextLimit,
    );
    const ranked = rerankFullTextResults(fullText, languageIntent);
    const scope = await assertActiveScope(dependencies, input.expectedScope);
    return {
      results: ranked.rows.slice(0, input.limit).map(toKnowledgeContentSearchResult),
      retrieval: toKnowledgeContentSearchRetrieval(
        { mode: "fulltext", semanticStatus: "not-configured" },
        languagePreferenceForResponse(languageIntent, ranked.applied),
      ),
      scope,
    };
  }

  const corpusScope = await resolveKnowledgeCorpusScope(input, dependencies);
  const fullTextResults = async (indexId: string | null): Promise<ContentUnitSearchResult[]> => {
    if (!dependencies.inspect) {
      throw new Error("Main-process database query execution is unavailable");
    }
    return dependencies.inspect(async (database) => {
      await assertActiveLibraryScopeToken(database, input.expectedScope);
      return new ContentUnitSearchRepo(database, input.libraryId).search({
        query: input.query,
        limit: fullTextLimit,
        allowedSourceIds: corpusScope.allowedSourceIds,
        ...(indexId ? { indexId } : {}),
        sourceTypes: input.sourceTypes,
        sourceId: input.sourceId,
        workId: input.workId,
        assetId: input.assetId,
        revisionId: input.revisionId,
        includeContextOnly: input.includeContextOnly,
      });
    });
  };

  // Resolve the vector-store allowlist before the query reaches the optional
  // embedding runtime. Keep this database lease separate from the full-text
  // callback below: HybridRetriever runs FTS and vector lookup concurrently.
  const readySourceIds = await listReadySourceIds(
    input,
    dependencies,
    corpusScope.allowedSourceIds,
  );
  if (readySourceIds.length === 0) {
    const ranked = rerankFullTextResults(await fullTextResults(null), languageIntent);
    const scope = await assertActiveScope(dependencies, input.expectedScope);
    return {
      results: ranked.rows.slice(0, input.limit).map(toKnowledgeContentSearchResult),
      retrieval: toKnowledgeContentSearchRetrieval(
        { mode: "fulltext", semanticStatus: "not-configured" },
        languagePreferenceForResponse(languageIntent, ranked.applied),
      ),
      scope,
    };
  }

  let fullTextIndexId: string | null | undefined;
  let fullTextPromise: Promise<ContentUnitSearchResult[]> | undefined;
  const retrieveFullText = (indexId: string | null): Promise<ContentUnitSearchResult[]> => {
    if (fullTextIndexId !== undefined && fullTextIndexId !== indexId) {
      throw new Error("Knowledge retrieval channels selected different index generations");
    }
    fullTextIndexId = indexId;
    fullTextPromise ??= fullTextResults(indexId);
    return fullTextPromise;
  };
  const hybrid = await semanticSearch.search({
    allowedSourceIds: readySourceIds,
    corpusScope,
    fullText: {
      // Scope and limit are captured from the validated command input. This
      // callback deliberately returns IDs only; presentation rows are loaded
      // after fusion through the same canonical filters.
      search: async ({ indexId }) =>
        (await retrieveFullText(normalizePinnedIndexId(indexId ?? null))).map(({ id }) => ({
          contentUnitId: id,
        })),
    },
    libraryId: input.libraryId,
    limit: fullTextLimit,
    query: input.query,
  });
  const pinnedIndexId = normalizePinnedIndexId(hybrid.pinnedIndexId);
  if (hybrid.mode === "hybrid" && pinnedIndexId === null) {
    throw new Error("Hybrid retrieval did not identify its pinned index generation");
  }
  const fullText = await retrieveFullText(pinnedIndexId);
  if (pinnedIndexId === null) {
    const fullTextIds = new Set(fullText.map(({ id }) => id));
    if (hybrid.candidates.some(({ contentUnitId }) => !fullTextIds.has(contentUnitId))) {
      throw new Error("Unpinned retrieval produced candidates outside full-text results");
    }
  }
  const hydrated = await hydrateSemanticCandidates(
    hybrid.candidates.map(({ contentUnitId }) => contentUnitId),
    fullText,
    input,
    dependencies,
    corpusScope.allowedSourceIds,
    pinnedIndexId,
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
  const scope = await assertActiveScope(dependencies, input.expectedScope);

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
    scope,
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

function normalizePinnedIndexId(indexId: string | null): string | null {
  if (indexId === null) return null;
  const normalized = indexId.trim();
  if (!normalized || normalized.length > 512 || containsControlCharacter(normalized)) {
    throw new Error("Knowledge retrieval index generation is invalid");
  }
  return normalized;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

async function listReadySourceIds(
  input: ParsedSearchKnowledgeContentInput,
  dependencies: DataCommandDependencies,
  allowedSourceIds: readonly string[],
): Promise<string[]> {
  if (!dependencies.inspect)
    throw new Error("Main-process database query execution is unavailable");
  return dependencies.inspect(async (database) => {
    await assertActiveLibraryScopeToken(database, input.expectedScope);
    return new ContentUnitSearchRepo(database, input.libraryId).listReadySourceIds({
      allowedSourceIds,
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
  allowedSourceIds: readonly string[],
  indexId: string | null,
): Promise<ContentUnitSearchResult[]> {
  const fullTextIds = new Set(fullText.map(({ id }) => id));
  const missingIds = [...new Set(candidateIds.filter((id) => !fullTextIds.has(id)))];
  if (missingIds.length === 0) return [];
  if (!dependencies.inspect)
    throw new Error("Main-process database query execution is unavailable");
  return dependencies.inspect(async (database) => {
    await assertActiveLibraryScopeToken(database, input.expectedScope);
    return new ContentUnitSearchRepo(database, input.libraryId).findReadyByIds({
      contentUnitIds: missingIds,
      allowedSourceIds,
      ...(indexId ? { indexId } : {}),
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
  expectedScope: LibraryScopeToken,
): Promise<LibraryScopeToken> {
  if (!dependencies.inspect)
    throw new Error("Main-process database query execution is unavailable");
  return dependencies.inspect((database) => assertActiveLibraryScopeToken(database, expectedScope));
}

function requireSemanticIndexCapability(
  capabilities: KnowledgeCommandCapabilities,
): NonNullable<KnowledgeCommandCapabilities["semanticIndex"]> {
  if (!capabilities.semanticIndex) throw new Error("Local semantic indexing is unavailable");
  return capabilities.semanticIndex;
}
