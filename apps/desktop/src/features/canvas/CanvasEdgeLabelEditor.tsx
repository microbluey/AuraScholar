import { useCallback, useEffect, useId, useRef, useState } from "react";
import { isImeComposing } from "../../keyboard";
import { registerExitBarrier } from "../../services/exit-barriers";

interface CanvasEdgeLabelEditorProps {
  initialValue: string;
  onCancel: () => void;
  onCommit: (value: string) => void;
  position: { x: number; y: number };
}

export function resolveCanvasEdgeLabelDraft(
  inputValue: string | undefined,
  fallbackValue: string,
): string {
  return (inputValue ?? fallbackValue).trim();
}

export function CanvasEdgeLabelEditor({
  initialValue,
  onCancel,
  onCommit,
  position,
}: CanvasEdgeLabelEditorProps) {
  const [value, setValue] = useState(initialValue);
  const instructionsId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);
  const composingRef = useRef(false);
  const commitAfterCompositionRef = useRef(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const settle = useCallback(
    (action: "cancel" | "commit") => {
      if (settledRef.current) return;
      if (action === "commit" && composingRef.current) {
        commitAfterCompositionRef.current = true;
        return;
      }
      settledRef.current = true;
      if (action === "cancel") {
        onCancel();
        return;
      }
      onCommit(resolveCanvasEdgeLabelDraft(inputRef.current?.value, value));
    },
    [onCancel, onCommit, value],
  );

  useEffect(
    () =>
      registerExitBarrier(
        () => {
          if (composingRef.current) return "cancel";
          settle("commit");
          return "ready";
        },
        { priority: 0 },
      ),
    [settle],
  );

  return (
    <form
      className="canvas-edge-label-editor nodrag nopan nowheel"
      data-canvas-interactive
      style={{ left: position.x, top: position.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        if (composingRef.current) return;
        settle("commit");
      }}
    >
      <label>
        <span className="sr-only">连线文字</span>
        <input
          ref={inputRef}
          value={value}
          maxLength={80}
          placeholder="输入连线文字（可选）"
          aria-label="连线文字"
          aria-describedby={instructionsId}
          onBlur={() => {
            if (composingRef.current) {
              commitAfterCompositionRef.current = true;
              return;
            }
            settle("commit");
          }}
          onChange={(event) => setValue(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            if (!commitAfterCompositionRef.current) return;
            commitAfterCompositionRef.current = false;
            window.requestAnimationFrame(() => settle("commit"));
          }}
          onKeyDown={(event) => {
            if (isImeComposing(event)) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              settle("cancel");
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              settle("commit");
            }
          }}
        />
      </label>
      <small id={instructionsId}>
        <kbd>Enter</kbd> 保存 · <kbd>Esc</kbd> 取消
      </small>
    </form>
  );
}
