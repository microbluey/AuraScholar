import type {
  KnowledgeContentSearchRetrieval,
  KnowledgeContentSearchResult,
  SearchKnowledgeContentCommandInput,
} from "../../electron/data-command-contract";
import { decodeKnowledgeSearchContentResult } from "../shared/knowledge-command-result-codec";
import { getActiveLibraryCommandScopeToken } from "./library-command-scope";

export type {
  KnowledgeCorpusScope,
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
  "expectedScope" | "query"
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

  const expectedScope = await getActiveLibraryCommandScopeToken();
  throwIfAborted(signal);
  const response = await window.aura.data.command("knowledge.searchContent", {
    ...filters,
    expectedScope,
    query: normalizedQuery,
  });
  throwIfAborted(signal);
  const decoded = decodeKnowledgeSearchContentResult(response, expectedScope);
  return { results: decoded.results, retrieval: decoded.retrieval };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}
