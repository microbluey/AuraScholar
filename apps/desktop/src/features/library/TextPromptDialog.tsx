import { useCallback, useId, useRef, useState, type FormEvent } from "react";
import { Button, Input } from "@aurascholar/ui";
import { useModalFocusTrap } from "../../components/useModalFocusTrap";
import { describeSafeError } from "../../services/sensitive-text";

export interface TextPromptConfig {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel: string;
  pendingLabel?: string;
  description?: string;
  allowEmpty?: boolean;
  inputKind?: "text" | "color";
  onSubmit: (value: string) => Promise<void>;
}

const TAG_COLOR_OPTIONS = [
  { label: "紫罗兰", value: "#7566f0" },
  { label: "薄荷绿", value: "#25bfae" },
  { label: "湖水蓝", value: "#42a5d5" },
  { label: "珊瑚橙", value: "#ff8a5b" },
  { label: "莓果红", value: "#df5d83" },
  { label: "琥珀黄", value: "#d89b38" },
] as const;

export function TextPromptDialog({
  config,
  onClose,
}: {
  config: TextPromptConfig;
  onClose: () => void;
}) {
  const [value, setValue] = useState(config.initialValue ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const titleId = useId();
  const trimmed = value.trim();
  const canSubmit = config.allowEmpty || Boolean(trimmed);
  const isColorPicker = config.inputKind === "color";
  const nativeColorValue = /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : TAG_COLOR_OPTIONS[0].value;

  const requestClose = useCallback(() => {
    if (!submitting) onClose();
  }, [onClose, submitting]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: requestClose,
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      setError("请输入内容");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await config.onSubmit(trimmed);
      onClose();
    } catch (submitError) {
      setError(describeSafeError(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="library-modal-overlay" role="presentation" onMouseDown={requestClose}>
      <form
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-busy={submitting}
        aria-modal="true"
        className="library-modal library-prompt-modal"
        data-modal-root="true"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="library-modal__head">
          <h2 id={titleId}>{config.title}</h2>
          <button
            type="button"
            className="library-modal__close"
            onClick={requestClose}
            aria-label={`关闭${config.title}`}
            title={`关闭${config.title}`}
            disabled={submitting}
          >
            ×
          </button>
        </div>
        {config.description && (
          <p className="library-prompt-modal__description">{config.description}</p>
        )}
        {submitting && (
          <p className="library-prompt-modal__status" role="status" aria-live="polite">
            {config.pendingLabel ?? "处理中..."}
          </p>
        )}
        {isColorPicker ? (
          <fieldset className="library-color-picker" disabled={submitting}>
            <legend>{config.label}</legend>
            <div
              className="library-color-picker__swatches"
              role="radiogroup"
              aria-label={config.label}
            >
              {TAG_COLOR_OPTIONS.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  className={
                    trimmed.toLowerCase() === option.value
                      ? "library-color-picker__swatch--active"
                      : ""
                  }
                  data-autofocus={index === 0 ? "true" : undefined}
                  aria-label={option.label}
                  aria-pressed={trimmed.toLowerCase() === option.value}
                  title={option.label}
                  style={{ background: option.value }}
                  onClick={() => {
                    setValue(option.value);
                    setError(null);
                  }}
                />
              ))}
            </div>
            <div className="library-color-picker__custom">
              <label>
                <span>自定义颜色</span>
                <input
                  type="color"
                  value={nativeColorValue}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setError(null);
                  }}
                />
              </label>
              <button
                type="button"
                className={!trimmed ? "library-color-picker__auto--active" : ""}
                aria-pressed={!trimmed}
                onClick={() => {
                  setValue("");
                  setError(null);
                }}
              >
                使用自动配色
              </button>
            </div>
          </fieldset>
        ) : (
          <label className="library-prompt-field">
            <span>{config.label}</span>
            <Input
              autoFocus
              data-autofocus="true"
              placeholder={config.placeholder}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              disabled={submitting}
            />
          </label>
        )}
        {error && <p className="library-prompt-modal__error">{error}</p>}
        <div className="library-modal-actions">
          <Button type="submit" disabled={submitting || !canSubmit} aria-busy={submitting}>
            {submitting ? (config.pendingLabel ?? "处理中...") : config.confirmLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={requestClose} disabled={submitting}>
            取消
          </Button>
        </div>
      </form>
    </div>
  );
}
