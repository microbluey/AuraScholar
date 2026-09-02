import {
  ArrowUpRight,
  Check,
  CircleNotch,
  Trash,
  Tray,
  WarningCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import "./evidence-shelf.css";
import type { KnowledgeContentSearchResult } from "../../services/knowledge-search";
import {
  evidenceShelfService,
  knowledgeResultFromEvidenceShelfItem,
  type EvidenceShelfItem,
  type EvidenceShelfService,
} from "../../services/evidence-shelf";
import type { KnowledgeSearchOpenOptions } from "../library/KnowledgeSearchPanel";
import { sourceTypeLabel } from "../library/KnowledgeSearchResultCard";

type ShelfPhase = "error" | "loading" | "ready";

export interface EvidenceShelfPanelProps {
  enabled: boolean;
  onItemsChange?: (items: readonly EvidenceShelfItem[]) => void;
  onOpenResult: (
    result: KnowledgeContentSearchResult,
    options: KnowledgeSearchOpenOptions,
  ) => void | Promise<void>;
  projectId: string;
  projectName: string;
  refreshToken?: string | number;
  service?: EvidenceShelfService;
}

/** Project-local persisted staging. It never treats the preview payload as source authority. */
export function EvidenceShelfPanel({
  enabled,
  onItemsChange,
  onOpenResult,
  projectId,
  projectName,
  refreshToken = "",
  service = evidenceShelfService,
}: EvidenceShelfPanelProps) {
  const [items, setItems] = useState<EvidenceShelfItem[]>([]);
  const [phase, setPhase] = useState<ShelfPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const itemsRef = useRef<EvidenceShelfItem[]>([]);
  const listControllerRef = useRef<AbortController | null>(null);
  const actionControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const clearing = busyId === "clear";
  const updateItems = useCallback(
    (nextItems: EvidenceShelfItem[]) => {
      itemsRef.current = nextItems;
      setItems(nextItems);
      onItemsChange?.(nextItems);
    },
    [onItemsChange],
  );

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    listControllerRef.current?.abort();
    abortController(actionControllerRef);
    const controller = new AbortController();
    listControllerRef.current = controller;
    if (!enabled || service.mode !== "desktop") {
      itemsRef.current = [];
      onItemsChange?.([]);
      return () => controller.abort();
    }
    void service
      .list(projectId, { signal: controller.signal })
      .then((nextItems) => {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        updateItems(nextItems);
        setError(null);
        setPhase("ready");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        setItems([]);
        setError(describeShelfError(cause));
        setPhase("error");
      });
    return () => {
      controller.abort();
      if (listControllerRef.current === controller) listControllerRef.current = null;
      if (requestId === requestIdRef.current) abortController(actionControllerRef);
    };
  }, [enabled, onItemsChange, projectId, refreshToken, service, updateItems]);

  const removeItem = async (item: EvidenceShelfItem) => {
    if (!enabled || service.mode !== "desktop") return;
    const controller = beginAction(setBusyId, item.id, actionControllerRef);
    try {
      const removed = await service.remove(projectId, item.id, item.updatedAt, {
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (removed) {
        updateItems(itemsRef.current.filter((candidate) => candidate.id !== item.id));
      } else throw new Error("Shelf 项目已发生变化，请刷新后重试");
    } catch (cause) {
      if (!controller.signal.aborted) setError(describeShelfError(cause));
    } finally {
      finishAction(controller, setBusyId, actionControllerRef);
    }
  };

  const clearShelf = async () => {
    if (!enabled || service.mode !== "desktop" || clearing) return;
    const controller = beginAction(setBusyId, "clear", actionControllerRef);
    try {
      await service.clear(projectId, { signal: controller.signal });
      controller.signal.throwIfAborted();
      updateItems([]);
      setError(null);
      setPhase("ready");
    } catch (cause) {
      if (!controller.signal.aborted) setError(describeShelfError(cause));
    } finally {
      finishAction(controller, setBusyId, actionControllerRef);
    }
  };

  const openItem = async (item: EvidenceShelfItem) => {
    if (!enabled || service.mode !== "desktop") return;
    const controller = beginAction(setBusyId, item.id, actionControllerRef);
    try {
      const resolved = await service.resolveForSave(projectId, item, { signal: controller.signal });
      controller.signal.throwIfAborted();
      if (resolved.stale || !resolved.item) {
        updateItems(
          itemsRef.current.map((candidate) =>
            candidate.id === item.id ? { ...candidate, status: "stale" } : candidate,
          ),
        );
        throw new Error("来源修订或内容已变化，请重新检索并加入 Shelf");
      }
      const result = knowledgeResultFromEvidenceShelfItem(resolved.item);
      if (!result) throw new Error("Shelf 项目的原文定位不可用");
      await onOpenResult(result, { signal: controller.signal });
      controller.signal.throwIfAborted();
    } catch (cause) {
      if (!controller.signal.aborted) setError(describeShelfError(cause));
    } finally {
      finishAction(controller, setBusyId, actionControllerRef);
    }
  };

  return (
    <section
      className={`evidence-shelf${enabled && service.mode === "desktop" ? "" : " evidence-shelf--unavailable"}`}
      aria-labelledby="evidence-shelf-title"
    >
      <header className="evidence-shelf__header">
        <div>
          <p>Evidence Shelf</p>
          <h2 id="evidence-shelf-title">待核验证据</h2>
          <span>项目 · {projectName} · 暂存检索结果，确认来源后再保存为 Evidence。</span>
        </div>
        {enabled &&
        service.mode === "desktop" &&
        phase !== "loading" &&
        (items.length > 0 || phase === "error") ? (
          <button
            type="button"
            className="evidence-shelf__clear"
            onClick={() => void clearShelf()}
            disabled={clearing || busyId !== null}
            aria-label={phase === "error" ? "清空全部 Evidence Shelf 暂存结果" : undefined}
          >
            {clearing ? "正在清空…" : phase === "error" ? "清空全部暂存结果" : "清空 Shelf"}
          </button>
        ) : null}
      </header>

      {!enabled || service.mode !== "desktop" ? (
        <p className="evidence-shelf__message">浏览器预览不会写入或读取持久化 Evidence Shelf。</p>
      ) : phase === "loading" ? (
        <p className="evidence-shelf__message" role="status">
          <CircleNotch className="evidence-shelf__spin" size={15} /> 正在载入 Shelf…
        </p>
      ) : phase === "error" ? (
        <p className="evidence-shelf__message evidence-shelf__message--error" role="alert">
          <WarningCircle size={15} /> {error}
        </p>
      ) : items.length === 0 ? (
        <p className="evidence-shelf__message">
          <Tray size={15} /> 暂无暂存结果。在项目检索结果中点击“加入 Shelf”。
        </p>
      ) : (
        <div className="evidence-shelf__items" aria-label="项目 Evidence Shelf">
          {items.map((item) => (
            <ShelfItemCard
              key={item.id}
              busy={busyId === item.id}
              item={item}
              onOpen={() => void openItem(item)}
              onRemove={() => void removeItem(item)}
            />
          ))}
        </div>
      )}
      {error && phase !== "error" ? (
        <p className="evidence-shelf__inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function ShelfItemCard({
  busy,
  item,
  onOpen,
  onRemove,
}: {
  busy: boolean;
  item: EvidenceShelfItem;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const payload = item.previewPayload;
  const page = readPageIndex(item.anchorSnapshot);
  const stale = item.status === "stale";
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

function beginAction(
  setBusyId: (id: string | null) => void,
  id: string,
  ref: { current: AbortController | null },
): AbortController {
  ref.current?.abort();
  const controller = new AbortController();
  ref.current = controller;
  setBusyId(id);
  return controller;
}

function abortController(ref: { current: AbortController | null }): void {
  ref.current?.abort();
  ref.current = null;
}

function finishAction(
  controller: AbortController,
  setBusyId: (id: string | null) => void,
  ref: { current: AbortController | null },
): void {
  if (ref.current !== controller) return;
  ref.current = null;
  setBusyId(null);
}

function readPageIndex(anchor: unknown): number | null {
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) return null;
  const value = (anchor as Record<string, unknown>).pageIndex;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function describeShelfError(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Evidence Shelf 操作失败，请重试";
}
