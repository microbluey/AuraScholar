import { ArrowUpRight, Check, Trash } from "@phosphor-icons/react";
import type { EvidenceShelfItem } from "../../services/evidence-shelf";
import { sourceTypeLabel } from "../library/KnowledgeSearchResultCard";

export function EvidenceShelfItemCard({
  busy,
  item,
  onPromote,
  onOpen,
  onRemove,
}: {
  busy: boolean;
  item: EvidenceShelfItem;
  onPromote: () => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const payload = item.previewPayload;
  const page = readPageIndex(item.anchorSnapshot);
  const stale = item.status === "stale" || item.isStale;
  return (
    <article className={`evidence-shelf-item${stale ? " evidence-shelf-item--stale" : ""}`}>
      <div className="evidence-shelf-item__copy">
        <div className="evidence-shelf-item__meta">
          <span>{sourceTypeLabel(payload.sourceType)}</span>
          {page === null ? <span>原文定位不可用</span> : <span>第 {page + 1} 页</span>}
          {stale ? (
            <b>需要重新核验</b>
          ) : (
            <b>
              <Check size={12} /> 已暂存
            </b>
          )}
        </div>
        {payload.workTitle ? <h3>{payload.workTitle}</h3> : null}
        <p>{payload.excerpt.trim() || payload.text.trim()}</p>
      </div>
      <div className="evidence-shelf-item__actions">
        <button type="button" onClick={onPromote} disabled={busy || stale || page === null}>
          {busy ? "处理中…" : page === null ? "无法定位原文" : "保存为 Evidence"}
        </button>
        <button type="button" onClick={onOpen} disabled={busy || stale || page === null}>
          <ArrowUpRight size={14} /> {busy ? "正在核验…" : "打开上下文"}
        </button>
        <button type="button" onClick={onRemove} disabled={busy} aria-label="移除 Shelf 项目">
          <Trash size={14} />
        </button>
      </div>
    </article>
  );
}

function readPageIndex(anchor: unknown): number | null {
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) return null;
  const value = (anchor as Record<string, unknown>).pageIndex;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
