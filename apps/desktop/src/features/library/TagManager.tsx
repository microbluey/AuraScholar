import { useCallback, useId, useRef } from "react";
import { Button } from "@aurascholar/ui";
import { useModalFocusTrap } from "../../components/useModalFocusTrap";
import { TextPromptDialog } from "./TextPromptDialog";
import { useTagManager } from "./useTagManager";

export function TagManager({
  initialCreate,
  onClose,
  onChanged,
}: {
  initialCreate?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const controller = useTagManager({ initialCreate, onChanged });
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const requestClose = useCallback(() => {
    if (!controller.tagBusy) onClose();
  }, [controller.tagBusy, onClose]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: requestClose,
  });

  return (
    <>
      <div className="library-modal-overlay" role="presentation" onMouseDown={requestClose}>
        <section
          ref={dialogRef}
          aria-labelledby={titleId}
          aria-busy={controller.tagBusy}
          aria-modal="true"
          className="library-modal"
          data-modal-root="true"
          onMouseDown={(event) => event.stopPropagation()}
          role="dialog"
          tabIndex={-1}
        >
          <div className="library-modal__head">
            <h2 id={titleId}>管理标签</h2>
            <div className="library-modal__head-actions">
              <Button
                variant="secondary"
                onClick={controller.create}
                disabled={controller.tagBusy}
                aria-busy={controller.tagAction?.kind === "create" ? "true" : undefined}
              >
                {controller.tagAction?.kind === "create" ? "创建中..." : "新建标签"}
              </Button>
              <button
                type="button"
                className="library-modal__close"
                data-autofocus={
                  controller.loading || controller.tags.length === 0 ? "true" : undefined
                }
                onClick={requestClose}
                aria-label="关闭管理标签"
                title="关闭管理标签"
                disabled={controller.tagBusy}
              >
                ×
              </button>
            </div>
          </div>
          {controller.status && (
            <p className="library-tag-manager__status" role="status" aria-live="polite">
              <span>{controller.status}</span>
              {controller.tagDeleteUndo &&
              (controller.status === controller.tagDeleteUndo.message ||
                controller.tagAction?.kind === "restore") ? (
                <button
                  type="button"
                  className="library-tag-manager__status-action"
                  onClick={() => void controller.undoDelete()}
                  disabled={controller.tagBusy}
                  aria-busy={controller.tagAction?.kind === "restore" ? "true" : undefined}
                  aria-label="撤销删除标签"
                >
                  {controller.tagAction?.kind === "restore" ? "撤销中..." : "撤销"}
                </button>
              ) : null}
            </p>
          )}
          {controller.error && (
            <p className="library-tag-manager__error" role="alert">
              {controller.error}
            </p>
          )}
          {controller.loading ? (
            <p className="au-text-muted">读取中…</p>
          ) : controller.tags.length === 0 ? (
            <p className="au-text-muted">还没有标签。点击“新建标签”建立第一套整理规则。</p>
          ) : (
            <ul className="library-tag-manager">
              {controller.tags.map((tag, index) => {
                const activeAction =
                  controller.tagAction?.id === tag.id ? controller.tagAction.kind : null;
                return (
                  <li
                    key={tag.id}
                    className="library-tag-manager__row"
                    aria-busy={activeAction ? "true" : undefined}
                  >
                    <span
                      className="library-tag-manager__dot"
                      aria-hidden="true"
                      style={tag.color ? { background: tag.color } : undefined}
                    />
                    <span className="library-tag-manager__name" title={tag.name}>
                      {tag.name}
                    </span>
                    <small
                      className="library-tag-manager__count"
                      aria-label={`${tag.count.toLocaleString("zh-CN")} 篇文献`}
                    >
                      {tag.count}
                    </small>
                    <button
                      type="button"
                      data-autofocus={index === 0 ? "true" : undefined}
                      onClick={() => controller.rename(tag)}
                      disabled={controller.tagBusy}
                      aria-busy={activeAction === "rename" ? "true" : undefined}
                      aria-label={`重命名标签 ${tag.name}`}
                      title={`重命名 ${tag.name}`}
                    >
                      {activeAction === "rename" ? "保存中..." : "重命名"}
                    </button>
                    <button
                      type="button"
                      onClick={() => controller.recolor(tag)}
                      disabled={controller.tagBusy}
                      aria-busy={activeAction === "color" ? "true" : undefined}
                      aria-label={`设置标签 ${tag.name} 的颜色`}
                      title={`设置 ${tag.name} 的颜色`}
                    >
                      {activeAction === "color" ? "保存中..." : "颜色"}
                    </button>
                    <button
                      type="button"
                      className="library-tag-manager__delete"
                      onClick={() => void controller.remove(tag)}
                      disabled={controller.tagBusy}
                      aria-busy={activeAction === "delete" ? "true" : undefined}
                      aria-label={`删除标签 ${tag.name}`}
                      title={`删除 ${tag.name}`}
                    >
                      {activeAction === "delete" ? "删除中..." : "删除"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {controller.tagPrompt && (
            <TextPromptDialog config={controller.tagPrompt} onClose={controller.closePrompt} />
          )}
        </section>
      </div>
      {controller.confirmDialog}
    </>
  );
}
