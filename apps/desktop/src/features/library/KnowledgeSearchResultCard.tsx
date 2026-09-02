import type { KnowledgeContentSearchResult } from "../../services/knowledge-search";
import { knowledgeSearchReaderTarget } from "../../services/knowledge-search-navigation";
import "./knowledge-search.css";

export interface KnowledgeSearchResultCardProps {
  adding?: boolean;
  opening: boolean;
  onAddToShelf?: () => void;
  onOpen: () => void;
  result: KnowledgeContentSearchResult;
  shelved?: boolean;
}

export function KnowledgeSearchResultCard({
  adding = false,
  opening,
  onAddToShelf,
  onOpen,
  result,
  shelved = false,
}: KnowledgeSearchResultCardProps) {
  const target = knowledgeSearchReaderTarget(result);
  const headingPath = result.headingPath?.filter(Boolean).join(" › ");
  const excerpt = result.excerpt.trim() || result.text.trim();
  const workTitle = result.workTitle?.trim();

  return (
    <article className="knowledge-search-result" data-knowledge-search-result={result.id}>
      <header>
        <div>
          <span className="knowledge-search-result__source">
            {sourceTypeLabel(result.sourceType)}
          </span>
          {target ? <span>第 {target.pageIndex + 1} 页</span> : <span>原文定位不可用</span>}
        </div>
        {headingPath ? (
          <span className="knowledge-search-result__heading">{headingPath}</span>
        ) : null}
      </header>
      {workTitle ? <h3 title={workTitle}>{workTitle}</h3> : null}
      <p>{excerpt}</p>
      <footer>
        <div className="knowledge-search-result__actions">
          {target ? (
            <button
              type="button"
              onClick={onOpen}
              disabled={opening || adding}
              aria-busy={opening ? "true" : undefined}
            >
              {opening ? "正在打开…" : `定位到第 ${target.pageIndex + 1} 页`}
            </button>
          ) : (
            <span>此片段没有可用的 PDF 锚点。</span>
          )}
          {onAddToShelf ? (
            <button
              type="button"
              className="knowledge-search-result__shelf-action"
              onClick={onAddToShelf}
              disabled={opening || adding || shelved}
              aria-busy={adding ? "true" : undefined}
            >
              {shelved ? "已加入 Shelf" : adding ? "正在加入…" : "加入 Shelf"}
            </button>
          ) : null}
        </div>
      </footer>
    </article>
  );
}

export function sourceTypeLabel(sourceType: KnowledgeContentSearchResult["sourceType"]): string {
  switch (sourceType) {
    case "pdf":
      return "PDF 正文";
    case "annotation":
      return "批注";
    case "evidence":
      return "Evidence";
  }
}
