import { Check, CircleNotch, FolderSimplePlus, Plus, X } from "@phosphor-icons/react";
import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useModalFocusTrap } from "../../components/useModalFocusTrap";
import { isImeComposing } from "../../keyboard";
import type { ProjectTargetOption } from "./project-ingress-gateway";
import {
  normalizeNewProjectName,
  projectIngressDescription,
  resolveDefaultProjectTargetId,
} from "./project-ingress-model";
import "./projects.css";

export interface ProjectTargetPickerProps {
  defaultProjectId: string;
  onCancel: () => void;
  onConfirm: (projectId: string) => Promise<unknown>;
  onCreateProject: (name: string) => Promise<ProjectTargetOption>;
  open: boolean;
  projects: readonly ProjectTargetOption[];
  sourceLabel?: string;
  workCount: number;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

export function requestProjectTargetPickerCancel(busy: boolean, onCancel: () => void): boolean {
  if (busy) return false;
  onCancel();
  return true;
}

export function ProjectTargetPicker({ open, ...props }: ProjectTargetPickerProps) {
  return open ? <ProjectTargetPickerDialog {...props} /> : null;
}

function ProjectTargetPickerDialog({
  defaultProjectId,
  onCancel,
  onConfirm,
  onCreateProject,
  projects,
  sourceLabel,
  workCount,
}: Omit<ProjectTargetPickerProps, "open">) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const initialProjectId = resolveDefaultProjectTargetId(projects, defaultProjectId, null);
  const [selectedId, setSelectedId] = useState(initialProjectId);
  const [creating, setCreating] = useState(() => projects.length === 0);
  const [createValue, setCreateValue] = useState("");
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const requestCancel = useCallback(() => {
    requestProjectTargetPickerCancel(busyRef.current, onCancel);
  }, [onCancel]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: initialProjectId
      ? `[data-project-id="${cssEscape(initialProjectId)}"]`
      : "[data-project-new-name='true']",
    onEscape: requestCancel,
  });

  const confirm = async (projectId = selectedId) => {
    if (!projectId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await onConfirm(projectId);
    } catch (cause) {
      if (isAbortError(cause)) return;
      busyRef.current = false;
      setBusy(false);
      setError(errorMessage(cause, "加入研究项目失败，请重试。"));
    }
  };

  const createAndConfirm = async () => {
    if (busyRef.current) return;
    let name: string;
    try {
      name = normalizeNewProjectName(createValue);
    } catch (cause) {
      setError(errorMessage(cause, "请输入研究项目名称。"));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const created = await onCreateProject(name);
      setSelectedId(created.id);
      await onConfirm(created.id);
    } catch (cause) {
      if (isAbortError(cause)) return;
      busyRef.current = false;
      setBusy(false);
      setError(errorMessage(cause, "新建研究项目失败，请重试。"));
    }
  };

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(event) || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    const options = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>(
        ".project-target-picker__option:not(:disabled)",
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
    if (!next) return;
    setSelectedId(next.dataset.projectId ?? "");
    next.focus({ preventScroll: true });
  };

  return (
    <div className="project-target-picker-overlay" role="presentation" onMouseDown={requestCancel}>
      <section
        ref={dialogRef}
        className="project-target-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        data-modal-root="true"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="project-target-picker__header">
          <span className="project-target-picker__icon" aria-hidden="true">
            <FolderSimplePlus size={20} weight="duotone" />
          </span>
          <div>
            <p className="project-target-picker__eyebrow">Research Project</p>
            <h2 id={titleId}>加入研究项目</h2>
            <p id={descriptionId}>{projectIngressDescription(sourceLabel, workCount)}</p>
          </div>
          <button
            type="button"
            className="project-target-picker__close"
            aria-label="关闭研究项目选择器"
            title="关闭"
            disabled={busy}
            onClick={requestCancel}
          >
            <X size={16} weight="bold" />
          </button>
        </header>

        {projects.length > 0 ? (
          <div
            className="project-target-picker__list"
            role="radiogroup"
            aria-label="目标研究项目"
            onKeyDown={handleListKeyDown}
          >
            {projects.map((project) => {
              const selected = project.id === selectedId;
              return (
                <button
                  key={project.id}
                  type="button"
                  className={`project-target-picker__option${selected ? " project-target-picker__option--selected" : ""}`}
                  role="radio"
                  aria-checked={selected}
                  data-project-id={project.id}
                  disabled={busy}
                  onClick={() => setSelectedId(project.id)}
                  onDoubleClick={() => void confirm(project.id)}
                  onKeyDown={(event) => {
                    if (isImeComposing(event) || event.key !== "Enter") return;
                    event.preventDefault();
                    void confirm(project.id);
                  }}
                >
                  <span className="project-target-picker__radio" aria-hidden="true">
                    {selected ? <Check size={13} weight="bold" /> : null}
                  </span>
                  <span className="project-target-picker__copy">
                    <strong>{project.name}</strong>
                    <small>{project.description ?? "研究资料、证据与白板的工作边界"}</small>
                  </span>
                  {project.id === defaultProjectId ? (
                    <span className="project-target-picker__recent">最近使用</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="project-target-picker__empty">
            <FolderSimplePlus size={24} weight="duotone" aria-hidden="true" />
            <strong>先创建一个研究项目</strong>
            <span>项目会把相关文献组织在同一个研究上下文中。</span>
          </div>
        )}

        {creating ? (
          <div className="project-target-picker__new">
            <label htmlFor={`${titleId}-new-name`}>新项目名称</label>
            <div>
              <input
                id={`${titleId}-new-name`}
                autoFocus
                data-project-new-name="true"
                maxLength={80}
                placeholder="例如：因果推断研究"
                value={createValue}
                disabled={busy}
                onChange={(event) => setCreateValue(event.target.value)}
                onKeyDown={(event) => {
                  if (isImeComposing(event)) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createAndConfirm();
                  } else if (!busy && event.key === "Escape" && projects.length > 0) {
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
                className="project-target-picker__new-confirm"
                disabled={busy || !createValue.trim()}
                onClick={() => void createAndConfirm()}
              >
                {busy ? (
                  <CircleNotch className="project-target-picker__spinner" size={15} />
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
            className="project-target-picker__create"
            disabled={busy}
            onClick={() => {
              setCreating(true);
              setError("");
            }}
          >
            <Plus size={15} weight="bold" />
            <span>新建研究项目</span>
          </button>
        )}

        {error ? (
          <p className="project-target-picker__error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="project-target-picker__actions">
          <span>{busy ? "正在写入，完成前不可取消" : "↑↓ 选择 · Enter 确认 · Esc 取消"}</span>
          <div>
            <button
              type="button"
              className="project-target-picker__cancel"
              disabled={busy}
              onClick={requestCancel}
            >
              取消
            </button>
            <button
              type="button"
              className="project-target-picker__confirm"
              disabled={busy || !selectedId || creating}
              onClick={() => void confirm()}
            >
              {busy && !creating ? (
                <CircleNotch className="project-target-picker__spinner" size={15} />
              ) : null}
              <span>加入项目</span>
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
