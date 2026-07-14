import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Badge, Button } from "@aurascholar/ui";
import { useModalFocusTrap } from "./useModalFocusTrap";

export interface ConfirmDialogOptions {
  cancelLabel?: string;
  confirmationHelp?: ReactNode;
  confirmationPhrase?: string;
  confirmLabel?: string;
  description: ReactNode;
  details?: ReactNode[];
  eyebrow?: string;
  title: string;
  tone?: "danger" | "neutral" | "warning";
}

export type ConfirmFunction = (options: ConfirmDialogOptions) => Promise<boolean>;

interface ConfirmDialogState extends ConfirmDialogOptions {
  id: number;
}

export function useConfirmDialog(): {
  confirm: ConfirmFunction;
  confirmDialog: ReactNode;
} {
  const [state, setState] = useState<ConfirmDialogState | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const resolve = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setState(null);
  }, []);

  const confirm = useCallback<ConfirmFunction>((options) => {
    resolverRef.current?.(false);
    return new Promise<boolean>((resolver) => {
      resolverRef.current = resolver;
      setState({ ...options, id: Date.now() });
    });
  }, []);

  useEffect(() => {
    return () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    };
  }, []);

  return {
    confirm,
    confirmDialog: state ? (
      <ConfirmDialog key={state.id} options={state} onResolve={resolve} />
    ) : null,
  };
}

function ConfirmDialog({
  options,
  onResolve,
}: {
  options: ConfirmDialogState;
  onResolve: (confirmed: boolean) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const [confirmationValue, setConfirmationValue] = useState("");
  const tone = options.tone ?? "warning";
  const details = options.details?.filter(Boolean) ?? [];
  const phrase = options.confirmationPhrase;
  const requiresPhrase = Boolean(phrase);
  const confirmationMatches = !requiresPhrase || confirmationValue.trim() === phrase;

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: () => onResolve(false),
  });

  return (
    <div className="library-modal-overlay" role="presentation" onMouseDown={() => onResolve(false)}>
      <section
        ref={dialogRef}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`library-modal library-confirm-modal library-confirm-modal--${tone}`}
        data-modal-root="true"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="library-modal__head">
          <div>
            <Badge
              variant={tone === "danger" ? "danger" : tone === "warning" ? "warning" : "neutral"}
            >
              {options.eyebrow ?? confirmEyebrow(tone)}
            </Badge>
            <h2 id={titleId}>{options.title}</h2>
          </div>
          <button
            type="button"
            className="library-modal__close"
            onClick={() => onResolve(false)}
            aria-label={`关闭${options.title}`}
            title={`关闭${options.title}`}
          >
            ×
          </button>
        </div>
        <div className="library-confirm-modal__description" id={descriptionId}>
          {options.description}
        </div>
        {details.length > 0 && (
          <ul className="library-confirm-modal__details">
            {details.map((detail, index) => (
              <li key={index}>{detail}</li>
            ))}
          </ul>
        )}
        {requiresPhrase && (
          <label className="library-confirm-modal__phrase">
            <span>{options.confirmationHelp ?? <>输入“{phrase}”以继续。</>}</span>
            <input
              data-autofocus="true"
              type="text"
              value={confirmationValue}
              onChange={(event) => setConfirmationValue(event.target.value)}
              aria-label={`输入 ${phrase} 以确认`}
              autoComplete="off"
            />
          </label>
        )}
        <div className="library-modal-actions">
          <Button
            autoFocus={!requiresPhrase}
            data-autofocus={!requiresPhrase ? "true" : undefined}
            disabled={!confirmationMatches}
            type="button"
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={() => onResolve(true)}
          >
            {options.confirmLabel ?? "确认"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => onResolve(false)}>
            {options.cancelLabel ?? "取消"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function confirmEyebrow(tone: ConfirmDialogOptions["tone"]) {
  if (tone === "danger") return "高风险操作";
  if (tone === "neutral") return "确认操作";
  return "需要确认";
}
