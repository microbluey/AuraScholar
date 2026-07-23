import {
  CaretDown,
  Check,
  CircleNotch,
  DotsThree,
  PencilSimple,
  Plus,
  Stack,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { isImeComposing } from "../../keyboard";
import type {
  CanvasWorkspaceActionResult,
  CanvasWorkspaceOption,
  CreateCanvasWorkspace,
} from "./workspace-controls";
import "./workspace-controls.css";

export interface CanvasWorkspaceSwitcherProps {
  activeWorkspaceId: string;
  className?: string;
  disabled?: boolean;
  onCreateWorkspace: CreateCanvasWorkspace;
  onDeleteWorkspace: (workspaceId: string) => CanvasWorkspaceActionResult;
  onRenameWorkspace: (workspaceId: string, name: string) => CanvasWorkspaceActionResult;
  onSelectWorkspace: (workspaceId: string) => CanvasWorkspaceActionResult;
  workspaces: readonly CanvasWorkspaceOption[];
}

function actionErrorMessage(action: "create" | "delete" | "rename" | "select"): string {
  if (action === "create") return "新建白板失败，请重试。";
  if (action === "delete") return "删除白板失败，内容仍保留，请重试。";
  if (action === "rename") return "重命名失败，请重试。";
  return "切换白板失败，请重试。";
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function CanvasWorkspaceSwitcher({
  activeWorkspaceId,
  className,
  disabled = false,
  onCreateWorkspace,
  onDeleteWorkspace,
  onRenameWorkspace,
  onSelectWorkspace,
  workspaces,
}: CanvasWorkspaceSwitcherProps) {
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [menuWorkspaceId, setMenuWorkspaceId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [createValue, setCreateValue] = useState("");

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.workspaceId === activeWorkspaceId),
    [activeWorkspaceId, workspaces],
  );

  const resetTransientState = useCallback(() => {
    setError("");
    setMenuWorkspaceId(null);
    setRenamingId(null);
    setRenameValue("");
    setCreating(false);
    setCreateValue("");
  }, []);

  const close = useCallback(
    (restoreFocus: boolean) => {
      setOpen(false);
      resetTransientState();
      if (restoreFocus) {
        window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
      }
    },
    [resetTransientState],
  );

  useEffect(() => {
    if (!open) return;

    const focusInitial = window.requestAnimationFrame(() => {
      const active = rootRef.current?.querySelector<HTMLButtonElement>(
        `[data-workspace-id="${CSS.escape(activeWorkspaceId)}"]`,
      );
      const first = rootRef.current?.querySelector<HTMLButtonElement>(
        "[data-workspace-focus-item='true']",
      );
      (active ?? first)?.focus({ preventScroll: true });
    });

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !busyAction?.startsWith("delete:")) {
        close(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isImeComposing(event) || event.key !== "Escape") return;
      if (busyAction?.startsWith("delete:")) return;
      event.preventDefault();
      close(true);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusInitial);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeWorkspaceId, busyAction, close, open]);

  const handlePopoverKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(event) || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    if (event.target instanceof HTMLInputElement) return;
    if ((event.target as HTMLElement).closest('[role="menu"]')) return;
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-workspace-focus-item='true']:not(:disabled)",
      ) ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;
    if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "ArrowDown")
      nextIndex = (currentIndex + 1 + items.length) % items.length;
    else nextIndex = (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus({ preventScroll: true });
  };

  const toggleActionMenu = (workspaceId: string) => {
    const opening = menuWorkspaceId !== workspaceId;
    setError("");
    setMenuWorkspaceId(opening ? workspaceId : null);
    if (opening) {
      window.requestAnimationFrame(() => {
        rootRef.current
          ?.querySelector<HTMLButtonElement>(
            `[data-workspace-action-menu="${CSS.escape(workspaceId)}"] [role="menuitem"]`,
          )
          ?.focus({ preventScroll: true });
      });
    }
  };

  const handleActionMenuKeyDown = (
    workspaceId: string,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (isImeComposing(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMenuWorkspaceId(null);
      rootRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-workspace-menu-trigger="${CSS.escape(workspaceId)}"]`,
        )
        ?.focus({ preventScroll: true });
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
    );
    if (items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "ArrowDown")
      nextIndex = (currentIndex + 1 + items.length) % items.length;
    else nextIndex = (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus({ preventScroll: true });
  };

  const selectWorkspace = async (workspaceId: string) => {
    if (busyAction || workspaceId === activeWorkspaceId) {
      if (workspaceId === activeWorkspaceId) close(true);
      return;
    }
    setBusyAction(`select:${workspaceId}`);
    setError("");
    try {
      await onSelectWorkspace(workspaceId);
      close(false);
    } catch {
      setError(actionErrorMessage("select"));
    } finally {
      setBusyAction(null);
    }
  };

  const beginRename = (workspace: CanvasWorkspaceOption) => {
    setMenuWorkspaceId(null);
    setCreating(false);
    setCreateValue("");
    setError("");
    setRenamingId(workspace.workspaceId);
    setRenameValue(workspace.name);
  };

  const deleteWorkspace = async (workspaceId: string) => {
    if (busyAction || workspaces.length <= 1) return;
    setMenuWorkspaceId(null);
    setBusyAction(`delete:${workspaceId}`);
    setError("");
    try {
      await onDeleteWorkspace(workspaceId);
      close(true);
    } catch {
      setError(actionErrorMessage("delete"));
      window.requestAnimationFrame(() => {
        rootRef.current
          ?.querySelector<HTMLButtonElement>(
            `[data-workspace-menu-trigger="${CSS.escape(workspaceId)}"]`,
          )
          ?.focus({ preventScroll: true });
      });
    } finally {
      setBusyAction(null);
    }
  };

  const submitRename = async () => {
    if (!renamingId || busyAction) return;
    const name = normalizedName(renameValue);
    const workspace = workspaces.find((item) => item.workspaceId === renamingId);
    if (!name) {
      setError("白板名称不能为空。");
      return;
    }
    if (workspace?.name === name) {
      setRenamingId(null);
      setRenameValue("");
      return;
    }
    setBusyAction(`rename:${renamingId}`);
    setError("");
    try {
      await onRenameWorkspace(renamingId, name);
      setRenamingId(null);
      setRenameValue("");
    } catch {
      setError(actionErrorMessage("rename"));
    } finally {
      setBusyAction(null);
    }
  };

  const submitCreate = async () => {
    if (busyAction) return;
    const name = normalizedName(createValue);
    if (!name) {
      setError("请输入白板名称。");
      return;
    }
    setBusyAction("create");
    setError("");
    try {
      const created = await onCreateWorkspace(name);
      await onSelectWorkspace(created.workspaceId);
      close(false);
    } catch {
      setError(actionErrorMessage("create"));
    } finally {
      setBusyAction(null);
    }
  };

  const rootClassName = ["canvas-workspace-switcher", className].filter(Boolean).join(" ");

  return (
    <div className={rootClassName} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="canvas-workspace-switcher__trigger"
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => {
          if (open) close(false);
          else {
            resetTransientState();
            setOpen(true);
          }
        }}
        title="切换白板"
      >
        <Stack size={14} weight="duotone" aria-hidden="true" />
        <span>{activeWorkspace?.name ?? "选择白板"}</span>
        <CaretDown
          className="canvas-workspace-switcher__caret"
          size={12}
          weight="bold"
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={popoverId}
          className="canvas-workspace-switcher__popover"
          role="dialog"
          aria-label="切换空间白板"
          aria-busy={Boolean(busyAction)}
          onKeyDown={handlePopoverKeyDown}
        >
          <div className="canvas-workspace-switcher__heading">
            <strong>空间白板</strong>
            <span>{workspaces.length} 个</span>
          </div>

          <div className="canvas-workspace-switcher__list" role="list">
            {workspaces.map((workspace) => {
              const active = workspace.workspaceId === activeWorkspaceId;
              const renaming = workspace.workspaceId === renamingId;
              const menuOpen = workspace.workspaceId === menuWorkspaceId;
              const rowBusy = busyAction?.endsWith(`:${workspace.workspaceId}`) ?? false;
              return (
                <div
                  className={`canvas-workspace-switcher__row${active ? " canvas-workspace-switcher__row--active" : ""}${menuOpen ? " canvas-workspace-switcher__row--menu-open" : ""}`}
                  key={workspace.workspaceId}
                  role="listitem"
                >
                  {renaming ? (
                    <div className="canvas-workspace-switcher__edit-row">
                      <input
                        autoFocus
                        aria-label={`重命名${workspace.name}`}
                        maxLength={80}
                        value={renameValue}
                        disabled={Boolean(busyAction)}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (isImeComposing(event)) return;
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.stopPropagation();
                            void submitRename();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            setRenamingId(null);
                            setRenameValue("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="canvas-workspace-switcher__icon-action"
                        aria-label="确认重命名"
                        title="确认重命名"
                        disabled={Boolean(busyAction)}
                        onClick={() => void submitRename()}
                      >
                        {rowBusy ? (
                          <CircleNotch className="workspace-control__spinner" size={15} />
                        ) : (
                          <Check size={15} weight="bold" />
                        )}
                      </button>
                      <button
                        type="button"
                        className="canvas-workspace-switcher__icon-action"
                        aria-label="取消重命名"
                        title="取消重命名"
                        disabled={Boolean(busyAction)}
                        onClick={() => {
                          setRenamingId(null);
                          setRenameValue("");
                        }}
                      >
                        <X size={15} weight="bold" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="canvas-workspace-switcher__workspace"
                        aria-current={active ? "page" : undefined}
                        data-workspace-focus-item="true"
                        data-workspace-id={workspace.workspaceId}
                        disabled={Boolean(busyAction)}
                        onClick={() => void selectWorkspace(workspace.workspaceId)}
                      >
                        <span className="canvas-workspace-switcher__workspace-copy">
                          <strong>{workspace.name}</strong>
                          {workspace.description && <small>{workspace.description}</small>}
                        </span>
                        {rowBusy ? (
                          <CircleNotch className="workspace-control__spinner" size={15} />
                        ) : active ? (
                          <Check size={15} weight="bold" aria-label="当前白板" />
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="canvas-workspace-switcher__more"
                        aria-label={`${workspace.name}的更多操作`}
                        aria-expanded={menuOpen}
                        aria-haspopup="menu"
                        data-workspace-focus-item="true"
                        data-workspace-menu-trigger={workspace.workspaceId}
                        title="更多操作"
                        disabled={Boolean(busyAction)}
                        onClick={() => toggleActionMenu(workspace.workspaceId)}
                      >
                        <DotsThree size={18} weight="bold" />
                      </button>
                      {menuOpen && (
                        <div
                          className="canvas-workspace-switcher__action-menu"
                          role="menu"
                          aria-label={`${workspace.name}的白板操作`}
                          data-workspace-action-menu={workspace.workspaceId}
                          onKeyDown={(event) =>
                            handleActionMenuKeyDown(workspace.workspaceId, event)
                          }
                        >
                          <button
                            type="button"
                            role="menuitem"
                            disabled={Boolean(busyAction)}
                            onClick={() => beginRename(workspace)}
                          >
                            <PencilSimple size={14} weight="duotone" />
                            <span>重命名</span>
                          </button>
                          {workspaces.length > 1 && (
                            <button
                              type="button"
                              role="menuitem"
                              className="canvas-workspace-switcher__delete"
                              disabled={Boolean(busyAction)}
                              onClick={() => void deleteWorkspace(workspace.workspaceId)}
                            >
                              <Trash size={14} weight="duotone" />
                              <span>删除白板</span>
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {creating ? (
            <div className="canvas-workspace-switcher__create-row">
              <input
                autoFocus
                aria-label="新白板名称"
                maxLength={80}
                placeholder="例如：因果推断综述"
                value={createValue}
                disabled={Boolean(busyAction)}
                onChange={(event) => setCreateValue(event.target.value)}
                onKeyDown={(event) => {
                  if (isImeComposing(event)) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    void submitCreate();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setCreating(false);
                    setCreateValue("");
                  }
                }}
              />
              <button
                type="button"
                className="canvas-workspace-switcher__icon-action"
                aria-label="创建并打开白板"
                title="创建并打开"
                disabled={Boolean(busyAction)}
                onClick={() => void submitCreate()}
              >
                {busyAction === "create" ? (
                  <CircleNotch className="workspace-control__spinner" size={15} />
                ) : (
                  <Check size={15} weight="bold" />
                )}
              </button>
              <button
                type="button"
                className="canvas-workspace-switcher__icon-action"
                aria-label="取消新建白板"
                title="取消"
                disabled={Boolean(busyAction)}
                onClick={() => {
                  setCreating(false);
                  setCreateValue("");
                }}
              >
                <X size={15} weight="bold" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="canvas-workspace-switcher__create"
              data-workspace-focus-item="true"
              disabled={Boolean(busyAction)}
              onClick={() => {
                setRenamingId(null);
                setRenameValue("");
                setError("");
                setCreating(true);
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
        </div>
      )}
    </div>
  );
}
