import { Check, CircleNotch, Plus, Stack, X } from "@phosphor-icons/react";
import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useModalFocusTrap } from "../../components/useModalFocusTrap";
import { isImeComposing } from "../../keyboard";
import type {
  CanvasWorkspaceActionResult,
  CanvasWorkspaceOption,
  CreateCanvasWorkspace,
} from "./workspace-controls";
import "./workspace-controls.css";

export interface CanvasTargetPickerProps {
  activeWorkspaceId: string;
  confirmLabel?: string;
  description?: string;
  onCancel: () => void;
  onConfirm: (workspaceId: string) => CanvasWorkspaceActionResult;
  onCreateWorkspace: CreateCanvasWorkspace;
  open: boolean;
  sourceLabel?: string;
  title?: string;
  workspaces: readonly CanvasWorkspaceOption[];
}

function targetPickerErrorMessage(action: "confirm" | "create"): string {
  return action === "create" ? "新建白板失败，请重试。" : "加入白板失败，请重试。";
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function CanvasTargetPicker({ open, ...props }: CanvasTargetPickerProps) {
  return open ? <CanvasTargetPickerDialog {...props} /> : null;
}

function CanvasTargetPickerDialog({
  activeWorkspaceId,
  confirmLabel = "加入白板",
  description,
  onCancel,
  onConfirm,
  onCreateWorkspace,
  sourceLabel,
  title = "选择目标白板",
  workspaces,
}: Omit<CanvasTargetPickerProps, "open">) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const initialWorkspaceId = workspaces.some(
    (workspace) => workspace.workspaceId === activeWorkspaceId,
  )
    ? activeWorkspaceId
    : (workspaces[0]?.workspaceId ?? "");
  const [selectedId, setSelectedId] = useState(initialWorkspaceId);
  const [creating, setCreating] = useState(() => workspaces.length === 0);
  const [createValue, setCreateValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const requestCancel = useCallback(() => {
    if (!busy) onCancel();
  }, [busy, onCancel]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: initialWorkspaceId
      ? `[data-workspace-id="${CSS.escape(initialWorkspaceId)}"]`
      : "[data-workspace-new-name='true']",
    onEscape: requestCancel,
  });

  const confirm = async (workspaceId = selectedId) => {
    if (!workspaceId || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm(workspaceId);
    } catch {
      setBusy(false);
      setError(targetPickerErrorMessage("confirm"));
    }
  };

  const createAndConfirm = async () => {
    if (busy) return;
    const name = normalizedName(createValue);
    if (!name) {
      setError("请输入白板名称。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await onCreateWorkspace(name);
      setSelectedId(created.workspaceId);
      await onConfirm(created.workspaceId);
    } catch {
      setBusy(false);
      setError(targetPickerErrorMessage("create"));
    }
  };

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(event) || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    const options = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>(
        ".canvas-target-picker__option:not(:disabled)",
      ) ?? [],
    );
    if (options.length === 0) return;
    event.preventDefault();
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;
    if (event.key === "End") nextIndex = options.length - 1;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "ArrowDown")
      nextIndex = (currentIndex + 1 + options.length) % options.length;
    else nextIndex = (currentIndex - 1 + options.length) % options.length;
    const next = options[nextIndex];
    if (next) {
      setSelectedId(next.dataset.workspaceId ?? "");
      next.focus({ preventScroll: true });
    }
  };

  const explanatoryCopy =
    description ??
    (sourceLabel ? `将「${sourceLabel}」加入所选空间白板。` : "选择这项内容要加入的空间白板。");

  return (
    <div className="canvas-target-picker-overlay" role="presentation" onMouseDown={requestCancel}>
      <section
        ref={dialogRef}
        className="canvas-target-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        data-modal-root="true"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="canvas-target-picker__header">
          <span className="canvas-target-picker__icon" aria-hidden="true">
            <Stack size={18} weight="duotone" />
          </span>
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{explanatoryCopy}</p>
          </div>
          <button
            type="button"
            className="canvas-target-picker__close"
            aria-label={`关闭${title}`}
            title="关闭"
            disabled={busy}
            onClick={requestCancel}
          >
            <X size={16} weight="bold" />
          </button>
        </header>

        {workspaces.length > 0 && (
          <div
            className="canvas-target-picker__list"
            role="radiogroup"
            aria-label="目标白板"
            onKeyDown={handleListKeyDown}
          >
            {workspaces.map((workspace) => {
              const selected = workspace.workspaceId === selectedId;
              const active = workspace.workspaceId === activeWorkspaceId;
              return (
                <button
                  key={workspace.workspaceId}
                  type="button"
                  className={`canvas-target-picker__option${selected ? " canvas-target-picker__option--selected" : ""}`}
                  role="radio"
                  aria-checked={selected}
                  data-workspace-id={workspace.workspaceId}
                  disabled={busy}
                  onClick={() => setSelectedId(workspace.workspaceId)}
                  onDoubleClick={() => void confirm(workspace.workspaceId)}
                  onKeyDown={(event) => {
                    if (isImeComposing(event) || event.key !== "Enter") return;
                    event.preventDefault();
                    void confirm(workspace.workspaceId);
                  }}
                >
                  <span className="canvas-target-picker__radio" aria-hidden="true">
                    {selected && <Check size={13} weight="bold" />}
                  </span>
                  <span className="canvas-target-picker__copy">
                    <strong>{workspace.name}</strong>
                    <small>{active ? "当前活跃白板" : (workspace.description ?? "空间白板")}</small>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {creating ? (
          <div className="canvas-target-picker__new">
            <label htmlFor={`${titleId}-new-name`}>新白板名称</label>
            <div>
              <input
                id={`${titleId}-new-name`}
                autoFocus
                data-workspace-new-name="true"
                maxLength={80}
                placeholder="例如：方法论对比"
                value={createValue}
                disabled={busy}
                onChange={(event) => setCreateValue(event.target.value)}
                onKeyDown={(event) => {
                  if (isImeComposing(event)) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createAndConfirm();
                  } else if (event.key === "Escape" && workspaces.length > 0) {
                    event.preventDefault();
                    event.stopPropagation();
                    setCreating(false);
                    setCreateValue("");
                    setError("");
                  }
                }}
              />
              <button
                type="button"
                className="canvas-target-picker__new-confirm"
                disabled={busy || !normalizedName(createValue)}
                onClick={() => void createAndConfirm()}
              >
                {busy ? (
                  <CircleNotch className="workspace-control__spinner" size={15} />
                ) : (
                  <Check size={15} weight="bold" />
                )}
                <span>创建并加入</span>
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="canvas-target-picker__create"
            disabled={busy}
            onClick={() => {
              setCreating(true);
              setError("");
            }}
          >
            <Plus size={15} weight="bold" />
            <span>新建白板</span>
          </button>
        )}

        {error && (
          <p className="workspace-control__error" role="alert">
            {error}
          </p>
        )}

        <footer className="canvas-target-picker__actions">
          <button
            type="button"
            className="canvas-target-picker__cancel"
            disabled={busy}
            onClick={requestCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="canvas-target-picker__confirm"
            disabled={busy || !selectedId || creating}
            onClick={() => void confirm()}
          >
            {busy && !creating && <CircleNotch className="workspace-control__spinner" size={15} />}
            <span>{confirmLabel}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
