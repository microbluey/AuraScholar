import {
  ArrowCounterClockwise,
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
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useModalFocusTrap } from "../../components/useModalFocusTrap";
import { isImeComposing } from "../../keyboard";
import { CanvasMarkdown } from "./CanvasMarkdown";
import {
  planCanvasEditorPreparation,
  registerCanvasEditorPreparer,
  type CanvasEditorPreparationDecision,
} from "./canvas-route-preparation";
import {
  canvasNoteDraftSourceToken,
  getCanvasNoteDraftOwnerId,
  readCanvasNoteDraftOwned,
  resolveCanvasNoteDraftOwned,
  writeCanvasNoteDraftOwned,
  type CanvasNoteDraftRecord,
  type CanvasNoteDraftToken,
  type CanvasNoteDraftValue,
} from "./canvas-note-draft";
import { CanvasNoteExitDialog } from "./CanvasNoteExitDialog";
import { applyMarkdownFormat, type MarkdownFormatAction } from "./markdown-edit";

export interface CanvasNoteEditorValue {
  contentMarkdown: string;
  title: string;
}

export type CanvasNoteEditorCommitResult = "rejected" | "saved" | "unchanged";

interface CanvasNoteEditorDialogProps {
  baseValue: CanvasNoteEditorValue;
  initialValue: CanvasNoteEditorValue;
  nodeId: string;
  onClose: () => void;
  onCommit: (
    value: CanvasNoteEditorValue,
  ) => CanvasNoteEditorCommitResult | Promise<CanvasNoteEditorCommitResult>;
  workspaceId: string;
}

type EditorMode = "source" | "split" | "preview";
type DraftStatus = "idle" | "pending" | "saved" | "unavailable";
type DraftNotice =
  | { kind: "conflict"; draft: CanvasNoteDraftRecord }
  | { kind: "restored"; savedAt: number };

function FormatButton({
  action,
  children,
  disabled = false,
  icon,
  onFormat,
}: {
  action: MarkdownFormatAction;
  children: ReactNode;
  disabled?: boolean;
  icon: ReactNode;
  onFormat: (action: MarkdownFormatAction) => void;
}) {
  return (
    <button
      type="button"
      className="canvas-note-editor__format-button"
      disabled={disabled}
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
  baseValue,
  initialValue,
  nodeId,
  onClose,
  onCommit,
  workspaceId,
}: CanvasNoteEditorDialogProps) {
  const [persistedBaseValue, setPersistedBaseValue] = useState<CanvasNoteEditorValue>(() => ({
    ...baseValue,
  }));
  const [draftOwnerId] = useState(getCanvasNoteDraftOwnerId);
  const initialEditorDirty = !sameEditorValue(persistedBaseValue, initialValue);
  const [initialDraftRead] = useState(() =>
    readCanvasNoteDraftOwned({
      workspaceId,
      nodeId,
      baseValue: persistedBaseValue,
    }),
  );
  const recoveredValue =
    !initialEditorDirty && initialDraftRead.status === "recoverable"
      ? draftValueToEditorValue(initialDraftRead.draft.value)
      : initialValue;
  const [title, setTitle] = useState(recoveredValue.title);
  const [contentMarkdown, setContentMarkdown] = useState(recoveredValue.contentMarkdown);
  const [mode, setMode] = useState<EditorMode>("split");
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [commitError, setCommitError] = useState("");
  const [exitError, setExitError] = useState("");
  const [draftStatus, setDraftStatus] = useState<DraftStatus>(() => {
    if (initialDraftRead.status === "unavailable") return "unavailable";
    if (initialEditorDirty && initialDraftRead.status !== "conflict") return "pending";
    if (initialDraftRead.status === "recoverable" || initialDraftRead.status === "conflict") {
      return "saved";
    }
    return "idle";
  });
  const [draftNotice, setDraftNotice] = useState<DraftNotice | null>(() => {
    if (!initialEditorDirty && initialDraftRead.status === "recoverable") {
      return { kind: "restored", savedAt: initialDraftRead.draft.savedAt };
    }
    if (initialDraftRead.status === "conflict") {
      return { kind: "conflict", draft: initialDraftRead.draft };
    }
    return null;
  });
  const deferredMarkdown = useDeferredValue(contentMarkdown);
  const dialogRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const baseValueRef = useRef<CanvasNoteEditorValue>(persistedBaseValue);
  const currentValueRef = useRef<CanvasNoteEditorValue>({ ...recoveredValue });
  const dirtyRef = useRef(!sameEditorValue(persistedBaseValue, recoveredValue));
  const editRevisionRef = useRef(0);
  const draftTimerRef = useRef<number | null>(null);
  const initialDraftToken = canvasNoteDraftSourceToken(initialDraftRead, initialEditorDirty);
  const sourceDraftTokenRef = useRef<CanvasNoteDraftToken | null>(initialDraftToken);
  const ownedDraftTokenRef = useRef<CanvasNoteDraftToken | null>(
    initialDraftToken?.ownerId === draftOwnerId ? initialDraftToken : null,
  );
  const unresolvedConflictRef = useRef(initialDraftRead.status === "conflict");
  const savingRef = useRef(false);
  const composingRef = useRef(false);
  const routePreparationRef = useRef<{
    promise: Promise<CanvasEditorPreparationDecision>;
    resolve: (decision: CanvasEditorPreparationDecision) => void;
  } | null>(null);
  const preparationSaveRef = useRef<(() => Promise<CanvasNoteEditorCommitResult>) | null>(null);
  const preparationFlushDraftRef = useRef<((updateUi?: boolean) => void) | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const dirty =
    title !== persistedBaseValue.title || contentMarkdown !== persistedBaseValue.contentMarkdown;
  const conflictLocked = draftNotice?.kind === "conflict";
  const lineCount = contentMarkdown ? contentMarkdown.split("\n").length : 0;
  const exitDialogOpen = closePromptOpen;

  const resolveDraftTokens = useCallback(
    (tokens: Array<CanvasNoteDraftToken | null>, updateUi = true) => {
      let unavailable = false;
      let superseded = false;
      const seen = new Set<string>();
      for (const token of tokens) {
        if (!token || seen.has(token.storageKey)) continue;
        seen.add(token.storageKey);
        const result = resolveCanvasNoteDraftOwned(workspaceId, nodeId, draftOwnerId, token);
        if (result.status === "unavailable") {
          unavailable = true;
          continue;
        }
        if (result.status === "superseded") superseded = true;
        if (ownedDraftTokenRef.current?.storageKey === token.storageKey) {
          ownedDraftTokenRef.current = null;
        }
        if (sourceDraftTokenRef.current?.storageKey === token.storageKey) {
          sourceDraftTokenRef.current = null;
        }
      }
      if (updateUi) setDraftStatus(unavailable || superseded ? "unavailable" : "idle");
      return unavailable ? "unavailable" : superseded ? "superseded" : "cleared";
    },
    [draftOwnerId, nodeId, workspaceId],
  );

  const writeDraftNow = useCallback(
    (value: CanvasNoteEditorValue, updateUi = true) => {
      if (unresolvedConflictRef.current) return { status: "superseded" } as const;
      const result = writeCanvasNoteDraftOwned({
        workspaceId,
        nodeId,
        ownerId: draftOwnerId,
        previousToken: ownedDraftTokenRef.current,
        baseValue: baseValueRef.current,
        value,
      });
      if (result.status === "saved") {
        ownedDraftTokenRef.current = result.token;
      } else if (result.status === "cleared") {
        ownedDraftTokenRef.current = null;
      }
      if (updateUi) {
        setDraftStatus(
          result.status === "saved"
            ? "saved"
            : result.status === "cleared"
              ? "idle"
              : "unavailable",
        );
      }
      return result;
    },
    [draftOwnerId, nodeId, workspaceId],
  );

  useEffect(() => {
    if (!initialEditorDirty || initialDraftRead.status === "conflict") return;
    writeDraftNow(currentValueRef.current);
  }, [initialDraftRead.status, initialEditorDirty, writeDraftNow]);

  const flushCurrentDraft = useCallback(
    (updateUi = true) => {
      if (unresolvedConflictRef.current) return;
      if (draftTimerRef.current !== null) {
        window.clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      if (!dirtyRef.current) {
        resolveDraftTokens([ownedDraftTokenRef.current, sourceDraftTokenRef.current], updateUi);
        return;
      }
      writeDraftNow(currentValueRef.current, updateUi);
    },
    [resolveDraftTokens, writeDraftNow],
  );

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      flushCurrentDraft(false);
      event.preventDefault();
      event.returnValue = "";
    };
    const handlePageHide = () => {
      if (dirtyRef.current) flushCurrentDraft(false);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && dirtyRef.current) {
        flushCurrentDraft(false);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (draftTimerRef.current !== null) {
        window.clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      if (dirtyRef.current) writeDraftNow(currentValueRef.current, false);
    };
  }, [flushCurrentDraft, writeDraftNow]);

  const updateEditorValue = (nextValue: CanvasNoteEditorValue) => {
    if (savingRef.current || unresolvedConflictRef.current) return;
    editRevisionRef.current += 1;
    currentValueRef.current = nextValue;
    const nextDirty = !sameEditorValue(baseValueRef.current, nextValue);
    dirtyRef.current = nextDirty;
    setTitle(nextValue.title);
    setContentMarkdown(nextValue.contentMarkdown);
    setCommitError("");

    if (draftTimerRef.current !== null) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    if (!nextDirty) {
      resolveDraftTokens([ownedDraftTokenRef.current, sourceDraftTokenRef.current]);
      if (draftNotice?.kind === "restored") setDraftNotice(null);
      return;
    }
    setDraftStatus("pending");
    draftTimerRef.current = window.setTimeout(() => {
      draftTimerRef.current = null;
      writeDraftNow(currentValueRef.current);
    }, 320);
  };

  const requestClose = useCallback(() => {
    if (savingRef.current) return;
    if (unresolvedConflictRef.current) {
      setCommitError("请先恢复或删除旧版本草稿，再保存、放弃或关闭编辑器。");
      return;
    }
    if (dirtyRef.current) {
      flushCurrentDraft();
      setExitError("");
      setClosePromptOpen(true);
      return;
    }
    onClose();
  }, [flushCurrentDraft, onClose]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: requestClose,
  });

  const settleRoutePreparation = useCallback((decision: CanvasEditorPreparationDecision) => {
    const pending = routePreparationRef.current;
    routePreparationRef.current = null;
    pending?.resolve(decision);
  }, []);

  const continueEditing = () => {
    if (savingRef.current) return;
    setExitError("");
    setClosePromptOpen(false);
    settleRoutePreparation("cancel");
  };

  const finishClose = useCallback(() => onClose(), [onClose]);

  const discardAndClose = () => {
    if (savingRef.current || unresolvedConflictRef.current) return;
    if (draftTimerRef.current !== null) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    const result = resolveDraftTokens([ownedDraftTokenRef.current, sourceDraftTokenRef.current]);
    if (result === "unavailable") {
      setDraftStatus("unavailable");
      setExitError("无法清除这台设备上的恢复草稿。请继续编辑，稍后重试或先保存到白板。");
      return;
    }
    dirtyRef.current = false;
    setExitError("");
    setClosePromptOpen(false);
    settleRoutePreparation("ready");
    finishClose();
  };

  const save = useCallback(async (): Promise<CanvasNoteEditorCommitResult> => {
    if (savingRef.current || unresolvedConflictRef.current) return "rejected";
    flushCurrentDraft();
    const submittedValue = { ...currentValueRef.current };
    const submittedRevision = editRevisionRef.current;
    const submittedOwnedToken = ownedDraftTokenRef.current;
    const submittedSourceToken = sourceDraftTokenRef.current;
    savingRef.current = true;
    setSaving(true);
    setCommitError("");
    setExitError("");
    let result: CanvasNoteEditorCommitResult;
    try {
      result = await Promise.resolve(onCommit(submittedValue));
    } catch {
      result = "rejected";
    }
    savingRef.current = false;
    setSaving(false);
    if (result === "saved" || result === "unchanged") {
      resolveDraftTokens([submittedOwnedToken, submittedSourceToken]);
      baseValueRef.current = submittedValue;
      setPersistedBaseValue(submittedValue);
      const unchangedDuringSave =
        editRevisionRef.current === submittedRevision &&
        sameEditorValue(currentValueRef.current, submittedValue);
      dirtyRef.current = !unchangedDuringSave;
      if (!unchangedDuringSave) {
        writeDraftNow(currentValueRef.current);
        setCommitError("保存期间检测到新的编辑；已保存上一版，并保留当前内容供你继续确认。");
        setClosePromptOpen(false);
        settleRoutePreparation("cancel");
        return "rejected";
      }
      setClosePromptOpen(false);
      settleRoutePreparation("ready");
      finishClose();
      return result;
    }
    setCommitError("写入白板存储未完成或内容已变化，本地草稿仍保留；请核对后重试。");
    setClosePromptOpen(false);
    settleRoutePreparation("cancel");
    return "rejected";
  }, [
    finishClose,
    flushCurrentDraft,
    onCommit,
    resolveDraftTokens,
    settleRoutePreparation,
    writeDraftNow,
  ]);

  useLayoutEffect(() => {
    preparationSaveRef.current = save;
    preparationFlushDraftRef.current = flushCurrentDraft;
  }, [flushCurrentDraft, save]);

  useEffect(() => {
    const unregister = registerCanvasEditorPreparer(async ({ reason }) => {
      const plan = planCanvasEditorPreparation({
        composing: composingRef.current,
        conflict: unresolvedConflictRef.current,
        dirty: dirtyRef.current,
        reason,
        saving: savingRef.current,
      });
      const flushDraft = preparationFlushDraftRef.current;
      if (plan === "cancel") {
        if (dirtyRef.current) flushDraft?.(false);
        return "cancel";
      }
      if (plan === "ready") return "ready";
      if (plan === "save") {
        const saveCurrent = preparationSaveRef.current;
        if (!saveCurrent) return "cancel";
        const result = await saveCurrent();
        return result === "saved" || result === "unchanged" ? "ready" : "cancel";
      }

      flushDraft?.();
      setExitError("");
      setClosePromptOpen(true);
      const existing = routePreparationRef.current;
      if (existing) return existing.promise;
      let resolvePending: (decision: CanvasEditorPreparationDecision) => void = () => undefined;
      const promise = new Promise<CanvasEditorPreparationDecision>((resolve) => {
        resolvePending = resolve;
      });
      routePreparationRef.current = { promise, resolve: resolvePending };
      return promise;
    });
    return () => {
      unregister();
      settleRoutePreparation("cancel");
    };
  }, [settleRoutePreparation]);

  const formatSelection = (action: MarkdownFormatAction) => {
    if (savingRef.current || unresolvedConflictRef.current) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const result = applyMarkdownFormat(
      contentMarkdown,
      textarea.selectionStart,
      textarea.selectionEnd,
      action,
    );
    updateEditorValue({ title: currentValueRef.current.title, contentMarkdown: result.value });
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
      void save();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      void save();
    }
  };

  return createPortal(
    <>
      <div
        aria-hidden={exitDialogOpen || undefined}
        className="canvas-note-editor-overlay"
        inert={exitDialogOpen ? true : undefined}
        role="presentation"
        onMouseDown={requestClose}
      >
        <section
          ref={dialogRef}
          aria-busy={saving || undefined}
          aria-describedby={descriptionId}
          aria-labelledby={titleId}
          aria-modal={!exitDialogOpen}
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
            <div className="canvas-note-editor__view-switch" aria-label="编辑器视图" role="group">
              <button
                type="button"
                aria-pressed={mode === "source"}
                onClick={() => setMode("source")}
              >
                编辑
              </button>
              <button
                type="button"
                aria-pressed={mode === "split"}
                onClick={() => setMode("split")}
              >
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
              onClick={requestClose}
              aria-label="关闭 Markdown 编辑器"
              title="关闭编辑器"
            >
              <X size={18} weight="bold" />
            </button>
          </header>

          <div className="canvas-note-editor__title-region">
            {draftNotice && (
              <div
                className={`canvas-note-editor__draft-banner canvas-note-editor__draft-banner--${draftNotice.kind}`}
                role={draftNotice.kind === "conflict" ? "alert" : "status"}
              >
                <div>
                  <ArrowCounterClockwise size={17} weight="duotone" />
                  <span>
                    {draftNotice.kind === "restored"
                      ? `已恢复这台设备上 ${formatDraftTime(draftNotice.savedAt)} 保存的未写入草稿。`
                      : "检测到基于旧版本的本地草稿，未自动覆盖当前笔记。"}
                  </span>
                </div>
                {draftNotice.kind === "conflict" && (
                  <div className="canvas-note-editor__draft-banner-actions">
                    <button
                      type="button"
                      onClick={() => {
                        const restored = draftValueToEditorValue(draftNotice.draft.value);
                        unresolvedConflictRef.current = false;
                        setDraftNotice({
                          kind: "restored",
                          savedAt: draftNotice.draft.savedAt,
                        });
                        updateEditorValue(restored);
                        window.requestAnimationFrame(() => flushCurrentDraft());
                      }}
                    >
                      恢复草稿
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const result = resolveDraftTokens([sourceDraftTokenRef.current]);
                        if (result !== "cleared") {
                          setDraftStatus("unavailable");
                          setCommitError(
                            result === "superseded"
                              ? "这份草稿已在另一个窗口更新，请重新打开编辑器后再处理。"
                              : "无法删除旧版本草稿，请稍后重试。",
                          );
                          return;
                        }
                        unresolvedConflictRef.current = false;
                        setDraftNotice(null);
                        setCommitError("");
                        if (dirtyRef.current) {
                          writeDraftNow(currentValueRef.current);
                        } else {
                          setDraftStatus("idle");
                        }
                      }}
                    >
                      删除旧草稿
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="canvas-note-editor__title-field">
              <label htmlFor={`${titleId}-input`}>标题</label>
              <input
                id={`${titleId}-input`}
                value={title}
                maxLength={180}
                onChange={(event) =>
                  updateEditorValue({
                    title: event.target.value,
                    contentMarkdown: currentValueRef.current.contentMarkdown,
                  })
                }
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
                placeholder="给这条研究想法一个清晰标题"
                readOnly={saving || conflictLocked}
              />
            </div>
          </div>

          <p className="sr-only" id={descriptionId}>
            支持 GitHub Flavored Markdown、任务列表、表格和 LaTeX 数学公式。
          </p>

          {mode !== "preview" && (
            <div className="canvas-note-editor__toolbar" role="toolbar" aria-label="Markdown 格式">
              <FormatButton
                action="heading"
                disabled={saving || conflictLocked}
                icon={<TextHTwo size={17} weight="bold" />}
                onFormat={formatSelection}
              >
                二级标题
              </FormatButton>
              <FormatButton
                action="bold"
                disabled={saving || conflictLocked}
                icon={<TextB size={17} weight="bold" />}
                onFormat={formatSelection}
              >
                粗体
              </FormatButton>
              <FormatButton
                action="italic"
                disabled={saving || conflictLocked}
                icon={<TextItalic size={17} weight="bold" />}
                onFormat={formatSelection}
              >
                斜体
              </FormatButton>
              <FormatButton
                action="inline-code"
                disabled={saving || conflictLocked}
                icon={<Code size={17} weight="bold" />}
                onFormat={formatSelection}
              >
                行内代码
              </FormatButton>
              <FormatButton
                action="link"
                disabled={saving || conflictLocked}
                icon={<LinkSimple size={17} weight="bold" />}
                onFormat={formatSelection}
              >
                链接
              </FormatButton>
              <FormatButton
                action="bullet-list"
                disabled={saving || conflictLocked}
                icon={<ListBullets size={17} weight="bold" />}
                onFormat={formatSelection}
              >
                项目列表
              </FormatButton>
              <FormatButton
                action="quote"
                disabled={saving || conflictLocked}
                icon={<Quotes size={17} weight="bold" />}
                onFormat={formatSelection}
              >
                引用
              </FormatButton>
              <FormatButton
                action="formula"
                disabled={saving || conflictLocked}
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
                  onChange={(event) =>
                    updateEditorValue({
                      title: currentValueRef.current.title,
                      contentMarkdown: event.target.value,
                    })
                  }
                  onCompositionStart={() => {
                    composingRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    composingRef.current = false;
                  }}
                  placeholder="写下假设、证据、推理过程或下一步实验……"
                  readOnly={saving || conflictLocked}
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
              <span
                aria-atomic={draftStatus === "unavailable" ? true : undefined}
                aria-live={draftStatus === "unavailable" ? "assertive" : undefined}
                className={draftStatus === "unavailable" ? "canvas-note-editor__draft-error" : ""}
                role={draftStatus === "unavailable" ? "alert" : undefined}
              >
                {draftStatus === "unavailable"
                  ? "无法写入本机草稿"
                  : conflictLocked
                    ? "发现旧版本草稿，等待处理"
                    : draftStatus === "pending"
                      ? "正在保存本机草稿…"
                      : dirty
                        ? "本机草稿已保存"
                        : "没有未保存改动"}
              </span>
              <span>{contentMarkdown.length.toLocaleString()} 字符</span>
              <span>{lineCount.toLocaleString()} 行</span>
              {commitError && (
                <span className="canvas-note-editor__commit-error" role="alert">
                  {commitError}
                </span>
              )}
            </div>
            <div className="canvas-note-editor__actions">
              <button type="button" onClick={requestClose} disabled={saving}>
                关闭
              </button>
              <button
                type="button"
                className="canvas-note-editor__save"
                disabled={saving || conflictLocked}
                onClick={() => void save()}
              >
                <FloppyDisk size={17} weight="duotone" />
                {saving ? "正在保存…" : "保存"}
                <kbd>⌘/Ctrl S</kbd>
              </button>
            </div>
          </footer>
        </section>
      </div>
      {exitDialogOpen && (
        <CanvasNoteExitDialog
          draftProtected={draftStatus !== "unavailable"}
          errorMessage={exitError}
          onContinue={continueEditing}
          onDiscard={discardAndClose}
          onSave={() => void save()}
          resolutionRequired={conflictLocked}
          saving={saving}
        />
      )}
    </>,
    document.body,
  );
}

function draftValueToEditorValue(value: CanvasNoteDraftValue): CanvasNoteEditorValue {
  return {
    title: value.title ?? "",
    contentMarkdown: value.contentMarkdown,
  };
}

function sameEditorValue(left: CanvasNoteEditorValue, right: CanvasNoteEditorValue): boolean {
  return left.title === right.title && left.contentMarkdown === right.contentMarkdown;
}

function formatDraftTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      month: "numeric",
      day: "numeric",
    }).format(timestamp);
  } catch {
    return "此前";
  }
}

export default CanvasNoteEditorDialog;
