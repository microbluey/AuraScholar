import { useCallback, useId, useRef } from "react";
import { Badge, Button } from "@aurascholar/ui";
import { useModalFocusTrap } from "./useModalFocusTrap";

export interface ReferenceImportPreviewDialogProps {
  count: number;
  fileName?: string;
  importing: boolean;
  previewOnly: boolean;
  onClose(): void;
  onConfirm(): void;
}

export function ReferenceImportPreviewDialog({
  count,
  fileName,
  importing,
  previewOnly,
  onClose,
  onConfirm,
}: ReferenceImportPreviewDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const requestClose = useCallback(() => {
    if (!importing) onClose();
  }, [importing, onClose]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: requestClose,
  });

  return (
    <div className="library-modal-overlay" role="presentation" onMouseDown={requestClose}>
      <section
        ref={dialogRef}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        aria-busy={importing || undefined}
        className="library-modal reference-import-preview"
        data-modal-root="true"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="library-modal__head">
          <div>
            <Badge variant="accent">待确认</Badge>
            <h2 id={titleId}>确认导入引用文件</h2>
          </div>
          <button
            type="button"
            className="library-modal__close"
            onClick={requestClose}
            aria-label="关闭确认导入引用文件"
            title="关闭确认导入引用文件"
            disabled={importing}
          >
            ×
          </button>
        </div>
        <p className="au-text-muted" id={descriptionId} style={{ fontSize: 13 }}>
          已解析出 <strong>{count}</strong> 条文献。
          {previewOnly
            ? "当前是浏览器预览，确认后只会模拟导入结果，不写入真实文献库。"
            : "确认后才会写入文献库，导入时会按 DOI 与标题自动去重。"}
        </p>
        {fileName && (
          <div className="reference-import-preview__file">
            <span>文件</span>
            <strong>{fileName}</strong>
          </div>
        )}
        {importing && (
          <p className="reference-import-preview__status" role="status" aria-live="polite">
            正在导入引用文件...
          </p>
        )}
        <div className="library-modal-actions reference-import-preview__actions">
          <Button
            data-autofocus="true"
            onClick={onConfirm}
            disabled={importing}
            aria-busy={importing || undefined}
          >
            {importing ? "导入中..." : previewOnly ? `模拟导入 ${count} 条` : `导入 ${count} 条`}
          </Button>
          <Button variant="secondary" onClick={requestClose} disabled={importing}>
            取消
          </Button>
        </div>
      </section>
    </div>
  );
}
