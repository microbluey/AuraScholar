import { useEffect, useRef, useState } from "react";
import "./knowledge-search.css";
import type {
  KnowledgeCorpusScope,
  KnowledgeContentSearchRetrieval,
  KnowledgeContentSearchResult,
} from "../../services/knowledge-search";
import {
  DEFAULT_KNOWLEDGE_CONTENT_SEARCH_RETRIEVAL,
  searchKnowledgeContent,
} from "../../services/knowledge-search";
import { describeSafeError } from "../../services/sensitive-text";
import { knowledgeSearchScopeKey, knowledgeSearchScopeLabel } from "./knowledge-search-scope";
import { KnowledgeSearchResultCard, sourceTypeLabel } from "./KnowledgeSearchResultCard";
import { knowledgeResultHasShelfMembership } from "./knowledge-search-membership";
import {
  SOURCE_FILTERS,
  knowledgeSearchRetrievalPresentation,
  sourceTypesForKnowledgeSearchFilter,
  type KnowledgeSearchSourceFilter,
} from "./knowledge-search-presentation";

export {
  knowledgeSearchRetrievalPresentation,
  sourceTypesForKnowledgeSearchFilter,
} from "./knowledge-search-presentation";
export { knowledgeResultHasShelfMembership } from "./knowledge-search-membership";
export type {
  KnowledgeSearchRetrievalPresentation,
  KnowledgeSearchSourceFilter,
} from "./knowledge-search-presentation";

const SEARCH_DEBOUNCE_MS = 220;

type SearchState = "error" | "idle" | "loading" | "ready";

export interface KnowledgeSearchPanelProps {
  /** User-selected corpus scope; the main process resolves its immutable source snapshot. */
  scope?: KnowledgeCorpusScope;
  /** Human-readable scope label kept separate from the command payload. */
  scopeLabel?: string;
  /** Changes when the owning scope membership changes, so stale results are hidden immediately. */
  scopeRevision?: string;
  enabled: boolean;
  onOpenResult: (
    result: KnowledgeContentSearchResult,
    options: KnowledgeSearchOpenOptions,
  ) => void | Promise<void>;
  onAddToShelf?: (
    result: KnowledgeContentSearchResult,
    options: KnowledgeSearchOpenOptions,
  ) => void | Promise<void>;
  /** Durable Shelf ids loaded by the owning Project workspace. */
  shelvedContentUnitIds?: ReadonlySet<string>;
  /** Stable source keys used when a backup regenerated disposable ContentUnit ids. */
  shelvedSourceKeys?: ReadonlySet<string>;
  /** Identity-only keys for previews whose text was explicitly redacted in backup transport. */
  shelvedIdentityFallbackKeys?: ReadonlySet<string>;
}

export interface KnowledgeSearchOpenOptions {
  signal: AbortSignal;
}

export function KnowledgeSearchPanel({
  enabled,
  onAddToShelf,
  onOpenResult,
  scope,
  scopeLabel,
  scopeRevision = "",
  shelvedContentUnitIds,
  shelvedIdentityFallbackKeys,
  shelvedSourceKeys,
}: KnowledgeSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<KnowledgeSearchSourceFilter>("all");
  const [results, setResults] = useState<KnowledgeContentSearchResult[]>([]);
  const [retrieval, setRetrieval] = useState<KnowledgeContentSearchRetrieval>(
    DEFAULT_KNOWLEDGE_CONTENT_SEARCH_RETRIEVAL,
  );
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<{
    contextKey: string;
    controller: AbortController;
    id: string;
  } | null>(null);
  const [adding, setAdding] = useState<{
    contextKey: string;
    controller: AbortController;
    id: string;
  } | null>(null);
  const [optimisticShelf, setOptimisticShelf] = useState<{
    ids: Set<string>;
    membershipKey: string;
  }>(() => ({ ids: new Set(), membershipKey: "" }));
  const [renderedContextKey, setRenderedContextKey] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const openingControllerRef = useRef<AbortController | null>(null);
  const addingControllerRef = useRef<AbortController | null>(null);
  const normalizedQuery = query.trim();
  const scopeKey = knowledgeSearchScopeKey(scope);
  const shelvedMembershipKey = JSON.stringify({
    contentUnitIds: shelvedContentUnitIds ? [...shelvedContentUnitIds].sort() : [],
    identityFallbackKeys: shelvedIdentityFallbackKeys
      ? [...shelvedIdentityFallbackKeys].sort()
      : [],
    sourceKeys: shelvedSourceKeys ? [...shelvedSourceKeys].sort() : [],
  });
  const contextKey = JSON.stringify([
    scopeKey,
    scopeRevision,
    sourceFilter,
    normalizedQuery,
    enabled,
  ]);
  const currentContext = renderedContextKey === contextKey;
  const visibleResults = currentContext ? results : [];
  const visibleRetrieval = currentContext ? retrieval : DEFAULT_KNOWLEDGE_CONTENT_SEARCH_RETRIEVAL;
  const visibleSearchState = currentContext ? searchState : "idle";
  const visibleError = currentContext ? error : null;
  const corpusLabel = knowledgeSearchScopeLabel(scope, scopeLabel);
  const canAddToShelf = scope?.kind === "project" && onAddToShelf !== undefined;

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    controllerRef.current?.abort();
    controllerRef.current = null;
    addingControllerRef.current?.abort();

    if (!enabled || !normalizedQuery) return;

    const controller = new AbortController();
    const sourceTypes = sourceTypesForKnowledgeSearchFilter(sourceFilter);
    controllerRef.current = controller;
    const timeoutId = window.setTimeout(() => {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      setResults([]);
      setRetrieval(DEFAULT_KNOWLEDGE_CONTENT_SEARCH_RETRIEVAL);
      setError(null);
      setSearchState("loading");
      setRenderedContextKey(contextKey);
      void searchKnowledgeContent(normalizedQuery, {
        limit: 20,
        signal: controller.signal,
        ...(scope ? { scope } : {}),
        ...(sourceTypes ? { sourceTypes } : {}),
      })
        .then((response) => {
          if (controller.signal.aborted || requestId !== requestIdRef.current) return;
          setResults(response.results);
          setRetrieval(response.retrieval);
          setSearchState("ready");
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted || requestId !== requestIdRef.current) return;
          setResults([]);
          setError(`内容检索失败:${describeSafeError(cause)}`);
          setSearchState("error");
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
      openingControllerRef.current?.abort();
      addingControllerRef.current?.abort();
    };
  }, [contextKey, enabled, normalizedQuery, scope, sourceFilter]);

  const openResult = async (result: KnowledgeContentSearchResult) => {
    const requestId = requestIdRef.current;
    const controller = new AbortController();
    openingControllerRef.current?.abort();
    openingControllerRef.current = controller;
    setOpening({ contextKey, controller, id: result.id });
    try {
      await onOpenResult(result, { signal: controller.signal });
      controller.signal.throwIfAborted();
    } catch (cause) {
      if (!controller.signal.aborted && requestId === requestIdRef.current) {
        setError(`打开检索来源失败:${describeSafeError(cause)}`);
        setSearchState("error");
      }
    } finally {
      if (openingControllerRef.current === controller) openingControllerRef.current = null;
      if (!controller.signal.aborted && requestId === requestIdRef.current) {
        setOpening((current) =>
          current?.contextKey === contextKey &&
          current.id === result.id &&
          current.controller === controller
            ? null
            : current,
        );
      }
    }
  };

  const addResultToShelf = async (result: KnowledgeContentSearchResult) => {
    if (!canAddToShelf || !onAddToShelf) return;
    const requestId = requestIdRef.current;
    const controller = new AbortController();
    addingControllerRef.current?.abort();
    addingControllerRef.current = controller;
    setAdding({ contextKey, controller, id: result.id });
    try {
      await onAddToShelf(result, { signal: controller.signal });
      controller.signal.throwIfAborted();
      if (requestId === requestIdRef.current) {
        setOptimisticShelf((current) => {
          const ids =
            current.membershipKey === shelvedMembershipKey
              ? new Set(current.ids)
              : new Set<string>();
          ids.add(result.id);
          return { ids, membershipKey: shelvedMembershipKey };
        });
        setError(null);
      }
    } catch (cause) {
      if (!controller.signal.aborted && requestId === requestIdRef.current) {
        setError(`加入 Evidence Shelf 失败:${describeSafeError(cause)}`);
        setSearchState("error");
      }
    } finally {
      if (addingControllerRef.current === controller) addingControllerRef.current = null;
      if (!controller.signal.aborted && requestId === requestIdRef.current) {
        setAdding((current) =>
          current?.contextKey === contextKey &&
          current.id === result.id &&
          current.controller === controller
            ? null
            : current,
        );
      }
    }
  };

  const retrievalPresentation = knowledgeSearchRetrievalPresentation(visibleRetrieval);

  return (
    <section
      className={`knowledge-search${enabled ? "" : " knowledge-search--unavailable"}`}
      aria-labelledby="knowledge-search-title"
    >
      <div className="knowledge-search__heading">
        <div>
          <p>Grounded search</p>
          <h2 id="knowledge-search-title">内容检索</h2>
          <span>{retrievalPresentation.detail}</span>
        </div>
        <div className="knowledge-search__badges">
          <span
            className="knowledge-search__corpus-scope"
            aria-label={`当前检索范围：${corpusLabel}`}
            title={corpusLabel}
          >
            {corpusLabel}
          </span>
          <span
            className="knowledge-search__scope"
            aria-label={`当前检索模式：${retrievalPresentation.label}`}
          >
            {retrievalPresentation.label}
          </span>
        </div>
      </div>

      {enabled ? (
        <>
          <div className="knowledge-search__controls">
            <div className="knowledge-search__query">
              <label className="sr-only" htmlFor="knowledge-search-input">
                搜索已索引内容
              </label>
              <input
                className="au-input"
                id="knowledge-search-input"
                placeholder="搜索已索引内容，例如研究方法或关键结论"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query) {
                    event.preventDefault();
                    setQuery("");
                  }
                }}
              />
              {query ? (
                <button
                  type="button"
                  className="knowledge-search__clear"
                  aria-label="清除内容检索"
                  title="清除搜索"
                  onClick={() => setQuery("")}
                >
                  ×
                </button>
              ) : null}
            </div>
            <label className="knowledge-search__filter">
              <span>来源</span>
              <select
                aria-label="按来源筛选已索引内容"
                value={sourceFilter}
                onChange={(event) => {
                  const nextFilter = event.target.value;
                  if (isKnowledgeSearchSourceFilter(nextFilter)) setSourceFilter(nextFilter);
                }}
              >
                {SOURCE_FILTERS.map((filter) => (
                  <option key={filter} value={filter}>
                    {filter === "all" ? "全部来源" : sourceTypeLabel(filter)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="knowledge-search__feedback" aria-live="polite">
            {visibleSearchState === "loading" ? <span role="status">正在检索本地索引…</span> : null}
            {visibleSearchState === "error" && visibleError ? (
              <span role="alert">{visibleError}</span>
            ) : null}
            {visibleSearchState === "ready" && normalizedQuery ? (
              <span>
                {visibleResults.length > 0
                  ? `找到 ${visibleResults.length} 条来源片段`
                  : "没有找到已索引内容"}
              </span>
            ) : null}
          </div>

          {visibleSearchState === "ready" && normalizedQuery && visibleResults.length === 0 ? (
            <p className="knowledge-search__empty">
              可尝试更短的关键词；新导入的 PDF 会在完成本地索引后出现在这里。
            </p>
          ) : null}

          {normalizedQuery && visibleResults.length > 0 ? (
            <div className="knowledge-search__results" aria-label="内容检索结果">
              {visibleResults.map((result) => (
                <KnowledgeSearchResultCard
                  key={result.id}
                  opening={
                    opening?.contextKey === contextKey &&
                    opening.id === result.id &&
                    !opening.controller.signal.aborted
                  }
                  adding={
                    adding?.contextKey === contextKey &&
                    adding.id === result.id &&
                    !adding.controller.signal.aborted
                  }
                  result={result}
                  shelved={
                    (optimisticShelf.membershipKey === shelvedMembershipKey &&
                      optimisticShelf.ids.has(result.id)) ||
                    knowledgeResultHasShelfMembership(
                      result,
                      shelvedContentUnitIds,
                      shelvedSourceKeys,
                      shelvedIdentityFallbackKeys,
                    )
                  }
                  onAddToShelf={canAddToShelf ? () => void addResultToShelf(result) : undefined}
                  onOpen={() => void openResult(result)}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="knowledge-search__unavailable-message">
          内容检索使用设备上的持久化索引；请在 AuraScholar 桌面应用中打开资料库后使用。
        </p>
      )}
    </section>
  );
}

export { KnowledgeSearchResultCard } from "./KnowledgeSearchResultCard";
function isKnowledgeSearchSourceFilter(value: string): value is KnowledgeSearchSourceFilter {
  return SOURCE_FILTERS.includes(value as KnowledgeSearchSourceFilter);
}
