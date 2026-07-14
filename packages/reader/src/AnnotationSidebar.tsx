// Annotation list panel: page-ordered, click-to-jump, inline comment editing.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import type { ReaderAnnotation } from "./annotations.js";

function isImeComposing(event: {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
}): boolean {
  return Boolean(event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229);
}

export interface AnnotationSidebarProps {
  annotations: ReaderAnnotation[];
  activeId?: string | null;
  onJump?: (annotation: ReaderAnnotation) => void;
  onDiscardCommentDraft?: (annotation: ReaderAnnotation) => boolean | Promise<boolean>;
  onDraftDirtyChange?: (dirty: boolean) => void;
  onSaveComment?: (id: string, contentMd: string) => boolean | void | Promise<boolean | void>;
  onDelete?: (id: string) => void | Promise<void>;
  deletingId?: string | null;
}

const MIN_COMMENT_SAVE_BUSY_MS = 250;

async function waitForMinimumElapsed(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

export function AnnotationSidebar({
  annotations,
  activeId,
  onJump,
  onDiscardCommentDraft,
  onDraftDirtyChange,
  onSaveComment,
  onDelete,
  deletingId = null,
}: AnnotationSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const sorted = useMemo(
    () =>
      [...annotations].sort(
        (a, b) =>
          a.pageIndex - b.pageIndex ||
          (a.anchor.position?.start ?? 0) - (b.anchor.position?.start ?? 0),
      ),
    [annotations],
  );

  const editingAnnotation = useMemo(
    () => (editingId ? (annotations.find((ann) => ann.id === editingId) ?? null) : null),
    [annotations, editingId],
  );
  const savedDraft = editingAnnotation?.contentMd ?? "";
  const draftDirty = Boolean(editingAnnotation && draft !== savedDraft);
  const draftPending = draftDirty || saving;

  useEffect(() => {
    onDraftDirtyChange?.(draftPending);
  }, [draftPending, onDraftDirtyChange]);

  useEffect(() => {
    return () => onDraftDirtyChange?.(false);
  }, [onDraftDirtyChange]);

  const confirmDiscardDraft = useCallback(async () => {
    if (!editingAnnotation || !draftDirty) return true;
    return (await onDiscardCommentDraft?.(editingAnnotation)) ?? true;
  }, [draftDirty, editingAnnotation, onDiscardCommentDraft]);

  const closeEditor = useCallback(async () => {
    if (!(await confirmDiscardDraft())) return false;
    setEditingId(null);
    setDraft("");
    return true;
  }, [confirmDiscardDraft]);

  const startEdit = useCallback(
    async (ann: ReaderAnnotation) => {
      if (saving || deletingId) return;
      if (editingId && editingId !== ann.id && !(await closeEditor())) return;
      setEditingId(ann.id);
      setDraft(ann.contentMd ?? "");
    },
    [closeEditor, deletingId, editingId, saving],
  );

  const commitEdit = useCallback(async () => {
    if (editingId === null || savingRef.current) return;
    const startedAt = Date.now();
    savingRef.current = true;
    setSaving(true);
    let saved = false;
    try {
      const result = await onSaveComment?.(editingId, draft);
      saved = result !== false;
    } catch {
      // Keep the draft open so callers can surface their own save error.
    } finally {
      await waitForMinimumElapsed(startedAt, MIN_COMMENT_SAVE_BUSY_MS);
      savingRef.current = false;
      setSaving(false);
    }
    if (saved) {
      setEditingId(null);
      setDraft("");
    }
  }, [draft, editingId, onSaveComment]);

  if (sorted.length === 0) {
    return (
      <div className="au-annsidebar au-annsidebar--empty">
        <p>还没有批注</p>
        <p className="au-annsidebar__hint">在正文中选中文字即可高亮或添加批注</p>
      </div>
    );
  }

  return (
    <div className="au-annsidebar">
      {sorted.map((ann) => {
        const deleting = deletingId === ann.id;
        const controlsDisabled = saving || Boolean(deletingId);
        const pageLabel = `第 ${ann.pageIndex + 1} 页`;
        const quotePreview = ann.anchor.quote?.exact?.trim();
        const shortQuote =
          quotePreview && quotePreview.length > 42 ? `${quotePreview.slice(0, 42)}…` : quotePreview;
        const annotationLabel = shortQuote ? `${pageLabel}批注，${shortQuote}` : `${pageLabel}批注`;
        return (
          <div
            key={ann.id}
            className={clsx(
              "au-annsidebar__item",
              activeId === ann.id && "au-annsidebar__item--active",
              ann.orphaned && "au-annsidebar__item--orphaned",
              deleting && "au-annsidebar__item--busy",
            )}
            aria-busy={deleting}
            onClick={() => {
              if (controlsDisabled) return;
              onJump?.(ann);
            }}
          >
            <div className="au-annsidebar__meta">
              <span
                className="au-annsidebar__swatch"
                style={{ background: ann.color }}
                aria-hidden="true"
              />
              <span className="au-annsidebar__page">{pageLabel}</span>
              {ann.orphaned && <span className="au-annsidebar__orphan-flag">位置失效</span>}
              <button
                type="button"
                className="au-annsidebar__jump"
                disabled={controlsDisabled}
                aria-label={`定位到${annotationLabel}`}
                title={`定位到${pageLabel}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (controlsDisabled) return;
                  onJump?.(ann);
                }}
              >
                定位
              </button>
              <button
                type="button"
                className="au-annsidebar__action"
                aria-busy={deleting}
                aria-label={deleting ? `正在删除${annotationLabel}` : `删除${annotationLabel}`}
                disabled={controlsDisabled}
                title={deleting ? "正在删除批注" : `删除${pageLabel}批注`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (controlsDisabled) return;
                  onDelete?.(ann.id);
                }}
              >
                {deleting ? "…" : "×"}
              </button>
            </div>
            {ann.anchor.quote?.exact && (
              <blockquote className="au-annsidebar__quote">{ann.anchor.quote.exact}</blockquote>
            )}
            {editingId === ann.id ? (
              <div onClick={(e) => e.stopPropagation()}>
                <textarea
                  className="au-annsidebar__editor"
                  value={draft}
                  autoFocus
                  disabled={saving || deleting}
                  rows={3}
                  aria-label={`编辑${annotationLabel}评论`}
                  placeholder="写下你的想法…(支持 Markdown)"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (isImeComposing(e)) return;
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void commitEdit();
                    if (e.key === "Escape") void closeEditor();
                  }}
                />
                <div className="au-annsidebar__editor-actions">
                  <span className="au-annsidebar__editor-status">
                    {saving ? "保存中" : draftDirty ? "未保存" : "已保存"}
                  </span>
                  <button
                    type="button"
                    className="au-annsidebar__btn"
                    disabled={saving}
                    aria-busy={saving}
                    aria-label={
                      saving ? `正在保存${annotationLabel}评论` : `保存${annotationLabel}评论`
                    }
                    onClick={() => void commitEdit()}
                  >
                    {saving ? "保存中…" : "保存"}
                  </button>
                  <button
                    type="button"
                    className="au-annsidebar__btn"
                    disabled={saving}
                    aria-label={`取消编辑${annotationLabel}评论`}
                    onClick={() => void closeEditor()}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : ann.contentMd ? (
              <button
                type="button"
                className="au-annsidebar__comment"
                aria-label={`编辑${annotationLabel}评论`}
                title={`编辑${pageLabel}批注评论`}
                disabled={controlsDisabled}
                onClick={(e) => {
                  e.stopPropagation();
                  if (controlsDisabled) return;
                  void startEdit(ann);
                }}
              >
                {ann.contentMd}
              </button>
            ) : (
              <button
                type="button"
                className="au-annsidebar__add-comment"
                disabled={controlsDisabled}
                aria-label={`添加${annotationLabel}评论`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (controlsDisabled) return;
                  void startEdit(ann);
                }}
              >
                + 添加评论
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
