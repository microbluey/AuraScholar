import {
  CaretDown,
  Check,
  CircleNotch,
  FolderOpen,
  PencilSimple,
  Plus,
  X,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { isImeComposing } from "../../keyboard";
import {
  activeResearchProjects,
  normalizeResearchProjectName,
  type ResearchProjectBusyAction,
  type ResearchProjectSummary,
} from "./model";

type EditorMode = "create" | "rename" | null;
export type ResearchProjectSwitcherFocusTarget = "current" | "first" | "last";

export function resolveResearchProjectSwitcherTriggerKey(
  key: string,
): ResearchProjectSwitcherFocusTarget | null {
  if (key === "ArrowDown") return "first";
  if (key === "ArrowUp") return "last";
  return null;
}

export function resolveResearchProjectSwitcherFocusIndex(
  target: ResearchProjectSwitcherFocusTarget,
  currentIndex: number,
  itemCount: number,
): number {
  if (itemCount <= 0) return -1;
  if (target === "first") return 0;
  if (target === "last") return itemCount - 1;
  return currentIndex >= 0 && currentIndex < itemCount ? currentIndex : 0;
}

export function resolveResearchProjectSwitcherNavigationIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
): number | null {
  if (itemCount <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (currentIndex < 0) {
    if (key === "ArrowDown") return 0;
    if (key === "ArrowUp") return itemCount - 1;
  }
  if (key === "ArrowDown") return (currentIndex + 1 + itemCount) % itemCount;
  if (key === "ArrowUp") return (currentIndex - 1 + itemCount) % itemCount;
  return null;
}

export interface ResearchProjectSwitcherProps {
  busyAction: ResearchProjectBusyAction | null;
  onCreate(name: string): Promise<boolean>;
  onRename(name: string): Promise<boolean>;
  onSelect(projectId: string): void;
  project: ResearchProjectSummary;
  projects: readonly ResearchProjectSummary[];
}

export function ResearchProjectSwitcher({
  busyAction,
  onCreate,
  onRename,
  onSelect,
  project,
  projects,
}: ResearchProjectSwitcherProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openFocusTargetRef = useRef<ResearchProjectSwitcherFocusTarget>("current");
  const [open, setOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState("");
  const busy = busyAction === "create" || busyAction === "rename";
  const activeProjects = activeResearchProjects(projects);

  const restoreTriggerFocus = useCallback(() => {
    const focus = () => {
      triggerRef.current?.focus({ preventScroll: true });
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focus);
    } else {
      focus();
    }
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setEditorMode(null);
    setValue("");
    setLocalError("");
    restoreTriggerFocus();
  }, [busy, restoreTriggerFocus]);

  const focusProjectOption = useCallback(
    (target: ResearchProjectSwitcherFocusTarget) => {
      const options = Array.from(
        rootRef.current?.querySelectorAll<HTMLButtonElement>(
          "[data-project-option]:not(:disabled)",
        ) ?? [],
      );
      const currentIndex = options.findIndex(
        (option) => option.dataset.projectOption === project.id,
      );
      const nextIndex = resolveResearchProjectSwitcherFocusIndex(
        target,
        currentIndex,
        options.length,
      );
      options[nextIndex]?.focus({ preventScroll: true });
    },
    [project.id],
  );

  const openAndFocus = useCallback(
    (target: ResearchProjectSwitcherFocusTarget) => {
      if (busy) return;
      openFocusTargetRef.current = target;
      if (open) {
        focusProjectOption(target);
        return;
      }
      setOpen(true);
    },
    [busy, focusProjectOption, open],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [close, open]);

  useEffect(() => {
    if (!open || editorMode) return;
    focusProjectOption(openFocusTargetRef.current);
  }, [editorMode, focusProjectOption, open]);

  useEffect(() => {
    if (!editorMode) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editorMode]);

  const startEditor = (mode: Exclude<EditorMode, null>) => {
    setEditorMode(mode);
    setValue(mode === "rename" ? project.name : "");
    setLocalError("");
  };

  const submit = async () => {
    if (!editorMode || busy) return;
    const name = normalizeResearchProjectName(value);
    if (!name) {
      setLocalError("请输入项目名称");
      return;
    }
    const succeeded = await (editorMode === "create" ? onCreate(name) : onRename(name));
    if (succeeded) close();
    else setLocalError(editorMode === "create" ? "新建项目失败，请重试" : "重命名失败，请重试");
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-project-option]:not(:disabled)",
      ) ?? [],
    );
    if (options.length === 0) return;
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = resolveResearchProjectSwitcherNavigationIndex(event.key, current, options.length);
    if (next === null) return;
    event.preventDefault();
    options[next]?.focus({ preventScroll: true });
  };

  return (
    <div className="research-project-switcher" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="research-project-switcher__trigger"
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          if (open) close();
          else openAndFocus("current");
        }}
        onKeyDown={(event) => {
          if (isImeComposing(event)) return;
          const focusTarget = resolveResearchProjectSwitcherTriggerKey(event.key);
          if (!focusTarget) return;
          event.preventDefault();
          openAndFocus(focusTarget);
        }}
      >
        <FolderOpen size={17} weight="duotone" />
        <span>{project.name}</span>
        <CaretDown size={14} weight="bold" />
      </button>

      {open && (
        <div
          id={menuId}
          className="research-project-switcher__menu"
          role="menu"
          aria-label="切换研究项目"
          onKeyDown={handleMenuKeyDown}
        >
          <div className="research-project-switcher__heading">
            <span>研究项目</span>
            <button type="button" aria-label="关闭项目切换器" onClick={close} disabled={busy}>
              <X size={14} weight="bold" />
            </button>
          </div>

          {!editorMode && (
            <>
              <div className="research-project-switcher__list">
                {activeProjects.map((option) => {
                  const selected = option.id === project.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={selected ? "research-project-switcher__option--active" : undefined}
                      data-project-option={option.id}
                      disabled={busy}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => {
                        if (!selected) onSelect(option.id);
                        close();
                      }}
                    >
                      <span>
                        <strong>{option.name}</strong>
                        <small>{option.sourceCount.toLocaleString("zh-CN")} 篇来源</small>
                      </span>
                      {selected && <Check size={14} weight="bold" />}
                    </button>
                  );
                })}
              </div>
              <div className="research-project-switcher__actions">
                <button type="button" onClick={() => startEditor("rename")} disabled={busy}>
                  <PencilSimple size={15} />
                  重命名
                </button>
                <button type="button" onClick={() => startEditor("create")} disabled={busy}>
                  <Plus size={15} />
                  新建项目
                </button>
              </div>
            </>
          )}

          {editorMode && (
            <form
              className="research-project-switcher__editor"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <label htmlFor={`${menuId}-name`}>
                {editorMode === "create" ? "新项目名称" : "项目名称"}
              </label>
              <input
                ref={inputRef}
                id={`${menuId}-name`}
                className="au-input"
                maxLength={80}
                value={value}
                disabled={busy}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (isImeComposing(event)) return;
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setEditorMode(null);
                    setLocalError("");
                  }
                }}
              />
              {localError && <p role="alert">{localError}</p>}
              <div>
                <button
                  type="button"
                  className="research-project-switcher__cancel"
                  disabled={busy}
                  onClick={() => {
                    setEditorMode(null);
                    setLocalError("");
                  }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="research-project-switcher__submit"
                  disabled={busy || !normalizeResearchProjectName(value)}
                >
                  {busy && <CircleNotch className="research-project-spin" size={14} />}
                  {editorMode === "create" ? "创建" : "保存"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
