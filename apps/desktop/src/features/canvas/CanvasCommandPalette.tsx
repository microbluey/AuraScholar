import type { AISynthesisType } from "@aurascholar/core";
import { Article, CheckCircle, MagnifyingGlass, Plus, Sparkle } from "@phosphor-icons/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { isImeComposing } from "../../keyboard";
import {
  buildCanvasCommandItems,
  clampCanvasCommandIndex,
  resolveCanvasCommandKey,
  type CanvasCommandItem,
} from "./canvas-command";
import type { CanvasLibraryWork } from "./model";

const CANVAS_COMMAND_SEARCH_DEBOUNCE_MS = 150;
const CANVAS_COMMAND_QUERY_MAX_LENGTH = 240;
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface CanvasCommandCloseOptions {
  restoreFocus: boolean;
}

export interface CanvasCommandPaletteProps {
  addedWorkIds: ReadonlySet<string>;
  canSynthesize: boolean;
  commonWorkIds?: readonly string[];
  onAddWork: (work: CanvasLibraryWork) => void;
  onClose: (options: CanvasCommandCloseOptions) => void;
  onFocusWork: (work: CanvasLibraryWork) => void;
  onSynthesize: (type: AISynthesisType) => void;
  open: boolean;
  searchWorks: (query: string) => Promise<CanvasLibraryWork[]>;
  synthesisHint?: string;
  works: readonly CanvasLibraryWork[];
}

interface CanvasCommandSearchState {
  error: boolean;
  query: string;
  status: "idle" | "loading" | "ready";
  works: CanvasLibraryWork[];
}

function optionId(index: number): string {
  return `canvas-command-option-${index}`;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length),
  );
}

function CanvasCommandIcon({ item }: { item: CanvasCommandItem }) {
  if (item.kind === "synthesis") {
    return <Sparkle size={19} weight="fill" aria-hidden="true" />;
  }
  if (item.added) {
    return <CheckCircle size={19} weight="fill" aria-hidden="true" />;
  }
  return <Article size={19} weight="duotone" aria-hidden="true" />;
}

export function CanvasCommandPalette({
  addedWorkIds,
  canSynthesize,
  commonWorkIds,
  onAddWork,
  onClose,
  onFocusWork,
  onSynthesize,
  open,
  searchWorks,
  synthesisHint,
  works,
}: CanvasCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchState, setSearchState] = useState<CanvasCommandSearchState>({
    error: false,
    query: "",
    status: "idle",
    works: [],
  });
  const dialogRef = useRef<HTMLElement>(null);
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);
  const requestSequenceRef = useRef(0);
  const restoreFocusOnCloseRef = useRef(true);
  const onCloseRef = useRef(onClose);

  const normalizedQuery = query.trim();
  const aiMode = normalizedQuery.toLowerCase().startsWith("/ai");
  const remoteSearch = normalizedQuery.length > 0 && !aiMode;
  const currentSearchState =
    remoteSearch && searchState.query === normalizedQuery ? searchState : null;
  const searchBusy = remoteSearch && currentSearchState?.status !== "ready";
  const searchFailed = Boolean(currentSearchState?.error);
  const items = useMemo(() => {
    const commandWorks = remoteSearch
      ? currentSearchState?.status === "ready"
        ? currentSearchState.works
        : []
      : works;
    return buildCanvasCommandItems({
      addedWorkIds,
      canSynthesize,
      commonWorkIds,
      prefilteredSearchResults: remoteSearch,
      query,
      synthesisHint,
      works: commandWorks,
    });
  }, [
    addedWorkIds,
    canSynthesize,
    commonWorkIds,
    currentSearchState,
    query,
    remoteSearch,
    synthesisHint,
    works,
  ]);
  const boundedActiveIndex = clampCanvasCommandIndex(activeIndex, items.length);
  const activeItem = items[boundedActiveIndex];

  const requestClose = useCallback((restoreFocus: boolean) => {
    restoreFocusOnCloseRef.current = restoreFocus;
    onCloseRef.current({ restoreFocus });
  }, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const sequence = ++requestSequenceRef.current;
    if (!open || !remoteSearch) return;

    let disposed = false;
    const timer = window.setTimeout(() => {
      void searchWorks(normalizedQuery)
        .then((nextWorks) => {
          if (disposed || requestSequenceRef.current !== sequence) return;
          setSearchState({
            error: false,
            query: normalizedQuery,
            status: "ready",
            works: nextWorks,
          });
        })
        .catch(() => {
          if (disposed || requestSequenceRef.current !== sequence) return;
          setSearchState({
            error: true,
            query: normalizedQuery,
            status: "ready",
            works: [],
          });
        });
    }, CANVAS_COMMAND_SEARCH_DEBOUNCE_MS);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [normalizedQuery, open, remoteSearch, searchWorks]);

  useEffect(() => {
    if (!open) return;
    restoreFocusOnCloseRef.current = true;
    const container = dialogRef.current;
    if (!container) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => {
      container.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    });

    const handleModalKeyDown = (event: KeyboardEvent) => {
      const modalRoots = Array.from(
        document.querySelectorAll<HTMLElement>("[data-modal-root='true']"),
      );
      if (modalRoots.at(-1) !== container || isImeComposing(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        requestClose(true);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements(container);
      if (!focusable.length) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const activeElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!container.contains(activeElement)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", handleModalKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleModalKeyDown, true);
      if (
        restoreFocusOnCloseRef.current &&
        previouslyFocused?.isConnected &&
        document.contains(previouslyFocused)
      ) {
        window.requestAnimationFrame(() => previouslyFocused.focus({ preventScroll: true }));
      }
    };
  }, [open, requestClose]);

  useEffect(() => {
    if (!open) return;
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [boundedActiveIndex, items, open]);

  if (!open) return null;

  const runItem = (item: CanvasCommandItem | undefined) => {
    if (!item) return;
    if (item.kind === "work") {
      if (item.added) onFocusWork(item.work);
      else onAddWork(item.work);
      requestClose(false);
      return;
    }
    if (item.disabled) return;
    onSynthesize(item.synthesisType);
    requestClose(true);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const result = resolveCanvasCommandKey({
      altKey: event.altKey,
      composing: isImeComposing(event),
      ctrlKey: event.ctrlKey,
      currentIndex: boundedActiveIndex,
      itemCount: items.length,
      key: event.key,
      metaKey: event.metaKey,
      repeat: event.repeat,
    });
    if (!result.handled) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveIndex(result.nextIndex);
    if (result.action === "close") requestClose(true);
    if (result.action === "activate") runItem(items[result.nextIndex]);
  };

  const statusMessage = searchBusy
    ? "正在搜索文献库…"
    : searchFailed
      ? "搜索文献库失败，请重试。"
      : remoteSearch && items.length === 0
        ? "没有匹配的论文。"
        : !remoteSearch && !aiMode && items.length === 0
          ? "文献库中暂无常用论文。"
          : "";

  return createPortal(
    <div
      className="app-command-overlay canvas-command-overlay"
      role="presentation"
      onMouseDown={() => requestClose(true)}
    >
      <section
        ref={dialogRef}
        aria-label="画布快速命令"
        aria-modal="true"
        className="app-command-palette canvas-command-palette"
        data-canvas-command-palette="true"
        data-modal-root="true"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="app-command-palette__search">
          <MagnifyingGlass size={20} aria-hidden="true" />
          <input
            aria-activedescendant={activeItem ? optionId(boundedActiveIndex) : undefined}
            aria-autocomplete="list"
            aria-controls="canvas-command-list"
            aria-describedby={statusMessage ? "canvas-command-status" : undefined}
            aria-expanded="true"
            aria-haspopup="listbox"
            aria-label="搜索论文或输入 AI 命令"
            autoComplete="off"
            data-autofocus="true"
            maxLength={CANVAS_COMMAND_QUERY_MAX_LENGTH}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setSearchState({ error: false, query: "", status: "idle", works: [] });
            }}
            placeholder="搜索标题、作者、期刊、年份，或输入 /ai"
            role="combobox"
            spellCheck={false}
            value={query}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="app-command-palette__meta">
          <span>{aiMode ? "AI 合成" : query.trim() ? "文献搜索" : "常用论文"}</span>
          <span>{searchBusy ? "搜索中…" : `${items.length} 项`}</span>
        </div>

        <div
          aria-busy={searchBusy || undefined}
          className="app-command-list canvas-command-list"
          id="canvas-command-list"
          role="listbox"
          aria-label={aiMode ? "AI 合成命令" : "可加入画布的论文"}
        >
          {items.map((item, index) => {
            const active = index === boundedActiveIndex;
            const disabled = item.kind === "synthesis" && item.disabled;
            const actionLabel =
              item.kind === "work"
                ? item.added
                  ? "已加入 · 定位"
                  : "添加"
                : disabled
                  ? "暂不可用"
                  : "运行";
            return (
              <button
                key={item.id}
                ref={active ? activeOptionRef : undefined}
                id={optionId(index)}
                aria-disabled={disabled || undefined}
                aria-label={
                  disabled && item.kind === "synthesis"
                    ? `${item.title}，暂不可用，${item.disabledReason}`
                    : undefined
                }
                aria-selected={active}
                className={`app-command-item canvas-command-item${
                  active ? " app-command-item--active canvas-command-item--active" : ""
                }${item.kind === "work" && item.added ? " canvas-command-item--added" : ""}`}
                data-canvas-command-id={item.id}
                disabled={disabled}
                onClick={() => runItem(item)}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
                tabIndex={-1}
                type="button"
              >
                <span className="app-command-item__icon">
                  <CanvasCommandIcon item={item} />
                </span>
                <span className="app-command-item__body">
                  <strong>{item.title}</strong>
                  <small>
                    {item.kind === "synthesis" && item.disabled
                      ? item.disabledReason
                      : item.description}
                  </small>
                </span>
                <span className="app-command-item__group">
                  {item.kind === "work" && !item.added && (
                    <Plus size={13} weight="bold" aria-hidden="true" />
                  )}
                  {actionLabel}
                </span>
              </button>
            );
          })}
        </div>

        {statusMessage && (
          <div
            className="app-command-empty canvas-command-empty"
            id="canvas-command-status"
            role="status"
            aria-live="polite"
          >
            <strong>{statusMessage}</strong>
            {!searchBusy && !searchFailed && remoteSearch && (
              <span>试试题目、作者、期刊、标签或发表年份，也可输入 /ai。</span>
            )}
          </div>
        )}

        <div className="canvas-command-palette__hint" aria-hidden="true">
          <span>↑↓ 选择</span>
          <span>Home / End 跳转</span>
          <span>Enter 确认</span>
        </div>
      </section>
    </div>,
    document.body,
  );
}
