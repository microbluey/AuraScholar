import { Badge, Button } from "@aurascholar/ui";
import { FloppyDisk, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useId, useLayoutEffect, useRef } from "react";
import { useModalFocusTrap } from "../../components/useModalFocusTrap";

interface CanvasNoteExitDialogProps {
  draftProtected: boolean;
  errorMessage: string;
  onContinue: () => void;
  onDiscard: () => void;
  onSave: () => void;
  resolutionRequired: boolean;
  saving: boolean;
}

export function CanvasNoteExitDialog({
  draftProtected,
  errorMessage,
  onContinue,
  onDiscard,
  onSave,
  resolutionRequired,
  saving,
}: CanvasNoteExitDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const onContinueRef = useRef(onContinue);
  const savingRef = useRef(saving);
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    onContinueRef.current = onContinue;
    savingRef.current = saving;
  }, [onContinue, saving]);

  const handleEscape = useCallback(() => {
    if (!savingRef.current) onContinueRef.current();
  }, []);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: handleEscape,
  });

  return (
    <div
      className="canvas-note-exit-overlay"
      role="presentation"
      onMouseDown={() => {
        if (!saving) onContinue();
      }}
    >
      <section
        ref={dialogRef}
        aria-busy={saving || undefined}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="canvas-note-exit-dialog"
        data-modal-root="true"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="canvas-note-exit-dialog__heading">
          <span className="canvas-note-exit-dialog__icon" aria-hidden="true">
            <WarningCircle size={22} weight="duotone" />
          </span>
          <div>
            <Badge variant="warning">{resolutionRequired ? "草稿版本冲突" : "未保存草稿"}</Badge>
            <h2 id={titleId}>
              {resolutionRequired ? "请先处理旧版本草稿" : "保存这次研究笔记编辑吗？"}
            </h2>
          </div>
        </div>
        <p id={descriptionId}>
          {resolutionRequired
            ? "另一个版本的本地草稿仍受保护。请继续编辑，并先选择恢复或删除旧草稿。"
            : draftProtected
              ? "内容已经临时保存在这台设备上。保存会写入当前白板；放弃会清除这份本地草稿。"
              : "这台设备目前无法保存本地草稿。请保存到当前白板，或继续编辑并复制重要内容。"}
        </p>
        {errorMessage && (
          <p className="canvas-note-exit-dialog__error" role="alert">
            {errorMessage}
          </p>
        )}
        <div className="canvas-note-exit-dialog__actions">
          <Button
            type="button"
            variant="primary"
            disabled={saving || resolutionRequired}
            onClick={onSave}
          >
            <FloppyDisk size={17} weight="duotone" />
            {saving ? "正在保存…" : "保存并关闭"}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={saving || resolutionRequired}
            onClick={onDiscard}
          >
            放弃草稿
          </Button>
          <Button
            type="button"
            variant="secondary"
            data-autofocus="true"
            disabled={saving}
            onClick={onContinue}
          >
            继续编辑
          </Button>
        </div>
      </section>
    </div>
  );
}
