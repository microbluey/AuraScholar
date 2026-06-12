// Annotation list panel: page-ordered, click-to-jump, inline comment editing.
import { useState } from "react";
import { clsx } from "clsx";
import type { ReaderAnnotation } from "./annotations";

export interface AnnotationSidebarProps {
  annotations: ReaderAnnotation[];
  activeId?: string | null;
  onJump?: (annotation: ReaderAnnotation) => void;
  onSaveComment?: (id: string, contentMd: string) => void;
  onDelete?: (id: string) => void;
}

export function AnnotationSidebar({
  annotations,
  activeId,
  onJump,
  onSaveComment,
  onDelete,
}: AnnotationSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const sorted = [...annotations].sort(
    (a, b) =>
      a.pageIndex - b.pageIndex ||
      (a.anchor.position?.start ?? 0) - (b.anchor.position?.start ?? 0),
  );

  const startEdit = (ann: ReaderAnnotation) => {
    setEditingId(ann.id);
    setDraft(ann.contentMd ?? "");
  };

  const commitEdit = () => {
    if (editingId !== null) onSaveComment?.(editingId, draft);
    setEditingId(null);
  };

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
      {sorted.map((ann) => (
        <div
          key={ann.id}
          className={clsx(
            "au-annsidebar__item",
            activeId === ann.id && "au-annsidebar__item--active",
            ann.orphaned && "au-annsidebar__item--orphaned",
          )}
          onClick={() => onJump?.(ann)}
        >
          <div className="au-annsidebar__meta">
            <span className="au-annsidebar__swatch" style={{ background: ann.color }} />
            <span className="au-annsidebar__page">第 {ann.pageIndex + 1} 页</span>
            {ann.orphaned && <span className="au-annsidebar__orphan-flag">位置失效</span>}
            <button
              className="au-annsidebar__action"
              title="删除"
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.(ann.id);
              }}
            >
              ×
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
                rows={3}
                placeholder="写下你的想法…(支持 Markdown)"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitEdit();
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
              <div className="au-annsidebar__editor-actions">
                <button className="au-annsidebar__btn" onClick={commitEdit}>
                  保存
                </button>
                <button className="au-annsidebar__btn" onClick={() => setEditingId(null)}>
                  取消
                </button>
              </div>
            </div>
          ) : ann.contentMd ? (
            <p
              className="au-annsidebar__comment"
              onClick={(e) => {
                e.stopPropagation();
                startEdit(ann);
              }}
            >
              {ann.contentMd}
            </p>
          ) : (
            <button
              className="au-annsidebar__add-comment"
              onClick={(e) => {
                e.stopPropagation();
                startEdit(ann);
              }}
            >
              + 添加评论
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
