import type {
  KnowledgeContentSearchRetrieval,
  KnowledgeContentSearchResult,
  SearchKnowledgeContentCommandInput,
} from "../../electron/data-command-contract";
import { getLibraryDb } from "./aura-db";

export type {
  KnowledgeContentSearchRetrieval,
  KnowledgeContentSearchResult,
} from "../../electron/data-command-contract";

export const DEFAULT_KNOWLEDGE_CONTENT_SEARCH_RETRIEVAL: KnowledgeContentSearchRetrieval = {
  mode: "fulltext",
  semanticStatus: "not-configured",
};

export interface KnowledgeContentSearchResponse {
  results: KnowledgeContentSearchResult[];
  retrieval: KnowledgeContentSearchRetrieval;
}

export type KnowledgeSearchOptions = Omit<
  SearchKnowledgeContentCommandInput,
  "libraryId" | "query"
> & {
  signal?: AbortSignal;
};

/**
 * Retrieves local grounded passages through the main-process command boundary.
 * The returned anchor is intentionally untouched so feature code can deep-link
 * to its original reader location without reinterpreting FTS output.
 */
export async function searchKnowledgeContent(
  query: string,
  options: KnowledgeSearchOptions = {},
): Promise<KnowledgeContentSearchResponse> {
  const { signal, ...filters } = options;
  throwIfAborted(signal);
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { results: [], retrieval: DEFAULT_KNOWLEDGE_CONTENT_SEARCH_RETRIEVAL };
  }

  const { libraryId } = await getLibraryDb();
  throwIfAborted(signal);
  const response = await window.aura.data.command("knowledge.searchContent", {
    ...filters,
    libraryId,
    query: normalizedQuery,
  });
  throwIfAborted(signal);
  return response;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}
