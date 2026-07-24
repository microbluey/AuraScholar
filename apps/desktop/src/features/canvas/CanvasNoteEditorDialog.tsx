import {
  Code,
  Eye,
  FloppyDisk,
  LinkSimple,
  ListBullets,
  MathOperations,
  Quotes,
  TextB,
  TextHTwo,
  TextItalic,
  X,
} from "@phosphor-icons/react";
import {
  useDeferredValue,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useModalFocusTrap } from "../../components/useModalFocusTrap";
import { isImeComposing } from "../../keyboard";
import { CanvasMarkdown } from "./CanvasMarkdown";
import { applyMarkdownFormat, type MarkdownFormatAction } from "./markdown-edit";

export interface CanvasNoteEditorValue {
  contentMarkdown: string;
  title: string;
}

interface CanvasNoteEditorDialogProps {
  initialValue: CanvasNoteEditorValue;
  onCancel: () => void;
  onSave: (value: CanvasNoteEditorValue) => void;
}

type EditorMode = "source" | "split" | "preview";

function FormatButton({
  action,
  children,
  icon,
  onFormat,
}: {
  action: MarkdownFormatAction;
  children: ReactNode;
  icon: ReactNode;
  onFormat: (action: MarkdownFormatAction) => void;
}) {
  return (
    <button
      type="button"
      className="canvas-note-editor__format-button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onFormat(action)}
      title={String(children)}
      aria-label={String(children)}
    >
      {icon}
    </button>
  );
}

export function CanvasNoteEditorDialog({
  initialValue,
  onCancel,
  onSave,
}: CanvasNoteEditorDialogProps) {
  const [title, setTitle] = useState(initialValue.title);
  const [contentMarkdown, setContentMarkdown] = useState(initialValue.contentMarkdown);
  const [mode, setMode] = useState<EditorMode>("split");
  const deferredMarkdown = useDeferredValue(contentMarkdown);
  const dialogRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const dirty = title !== initialValue.title || contentMarkdown !== initialValue.contentMarkdown;
  const lineCount = contentMarkdown ? contentMarkdown.split("\n").length : 0;

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: onCancel,
  });

  const save = () => {
    onSave({ title, contentMarkdown });
  };

  const formatSelection = (action: MarkdownFormatAction) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const result = applyMarkdownFormat(
      contentMarkdown,
      textarea.selectionStart,
      textarea.selectionEnd,
      action,
    );
    setContentMarkdown(result.value);
    window.requestAnimationFrame(() => {
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  const handleEditorShortcut = (event: KeyboardEvent<HTMLElement>) => {
    if (isImeComposing(event)) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      event.stopPropagation();
      save();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      save();
    }
  };

  return createPortal(
    <div className="canvas-note-editor-overlay" role="presentation" onMouseDown={onCancel}>
      <section
        ref={dialogRef}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`canvas-note-editor canvas-note-editor--${mode}`}
        data-modal-root="true"
        onKeyDown={handleEditorShortcut}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <header className="canvas-note-editor__header">
          <div className="canvas-note-editor__identity">
            <span>研究笔记</span>
            <strong id={titleId}>Markdown 专注编辑器</strong>
          </div>
          <div className="canvas-note-editor__view-switch" aria-label="编辑器视图">
            <button
              type="button"
              aria-pressed={mode === "source"}
              onClick={() => setMode("source")}
            >
              编辑
            </button>
            <button type="button" aria-pressed={mode === "split"} onClick={() => setMode("split")}>
              分屏
            </button>
            <button
              type="button"
              aria-pressed={mode === "preview"}
              onClick={() => setMode("preview")}
            >
              <Eye size={15} weight="duotone" />
              预览
            </button>
          </div>
          <button
            type="button"
            className="canvas-note-editor__close"
            onClick={onCancel}
            aria-label="关闭 Markdown 编辑器"
            title="取消并关闭"
          >
            <X size={18} weight="bold" />
          </button>
        </header>

        <div className="canvas-note-editor__title-field">
          <label htmlFor={`${titleId}-input`}>标题</label>
          <input
            id={`${titleId}-input`}
            value={title}
            maxLength={180}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="给这条研究想法一个清晰标题"
          />
        </div>

        <p className="sr-only" id={descriptionId}>
          支持 GitHub Flavored Markdown、任务列表、表格和 LaTeX 数学公式。
        </p>

        {mode !== "preview" && (
          <div className="canvas-note-editor__toolbar" role="toolbar" aria-label="Markdown 格式">
            <FormatButton
              action="heading"
              icon={<TextHTwo size={17} weight="bold" />}
              onFormat={formatSelection}
            >
              二级标题
            </FormatButton>
            <FormatButton
              action="bold"
              icon={<TextB size={17} weight="bold" />}
              onFormat={formatSelection}
            >
              粗体
            </FormatButton>
            <FormatButton
              action="italic"
              icon={<TextItalic size={17} weight="bold" />}
              onFormat={formatSelection}
            >
              斜体
            </FormatButton>
            <FormatButton
              action="inline-code"
              icon={<Code size={17} weight="bold" />}
              onFormat={formatSelection}
            >
              行内代码
            </FormatButton>
            <FormatButton
              action="link"
              icon={<LinkSimple size={17} weight="bold" />}
              onFormat={formatSelection}
            >
              链接
            </FormatButton>
            <FormatButton
              action="bullet-list"
              icon={<ListBullets size={17} weight="bold" />}
              onFormat={formatSelection}
            >
              项目列表
            </FormatButton>
            <FormatButton
              action="quote"
              icon={<Quotes size={17} weight="bold" />}
              onFormat={formatSelection}
            >
              引用
            </FormatButton>
            <FormatButton
              action="formula"
              icon={<MathOperations size={17} weight="bold" />}
              onFormat={formatSelection}
            >
              数学公式
            </FormatButton>
            <span className="canvas-note-editor__toolbar-hint">支持 Markdown、GFM 与 LaTeX</span>
          </div>
        )}

        <div className="canvas-note-editor__workspace">
          {mode !== "preview" && (
            <section className="canvas-note-editor__source" aria-label="Markdown 源码">
              <textarea
                ref={textareaRef}
                aria-label="Markdown 正文"
                data-autofocus="true"
                data-canvas-native-history="true"
                value={contentMarkdown}
                onChange={(event) => setContentMarkdown(event.target.value)}
                placeholder="写下假设、证据、推理过程或下一步实验……"
                spellCheck
              />
            </section>
          )}
          {mode !== "source" && (
            <aside className="canvas-note-editor__preview" aria-label="Markdown 实时预览">
              <div className="canvas-note-editor__preview-label">
                <Eye size={15} weight="duotone" />
                实时预览
              </div>
              <CanvasMarkdown
                className="canvas-note-editor__rendered"
                markdown={deferredMarkdown}
                emptyLabel="预览会随着内容输入实时更新。"
              />
            </aside>
          )}
        </div>

        <footer className="canvas-note-editor__footer">
          <div>
            <span>{dirty ? "尚未保存" : "没有未保存改动"}</span>
            <span>{contentMarkdown.length.toLocaleString()} 字符</span>
            <span>{lineCount.toLocaleString()} 行</span>
          </div>
          <div className="canvas-note-editor__actions">
            <button type="button" onClick={onCancel}>
              取消
            </button>
            <button type="button" className="canvas-note-editor__save" onClick={save}>
              <FloppyDisk size={17} weight="duotone" />
              保存
              <kbd>⌘/Ctrl S</kbd>
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export default CanvasNoteEditorDialog;
