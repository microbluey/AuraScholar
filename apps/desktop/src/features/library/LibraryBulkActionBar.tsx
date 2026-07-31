import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { ExportFormat } from "../../services/cite";

const CITATION_STYLES = [
  { id: "apa", label: "APA 7th" },
  { id: "gb7714", label: "GB/T 7714-2015" },
  { id: "ieee", label: "IEEE" },
  { id: "vancouver", label: "Vancouver" },
  { id: "mla", label: "MLA 9th" },
  { id: "nature", label: "Nature" },
  { id: "chicago", label: "Chicago (note)" },
] as const;

export type LibraryBulkWorkAction = "merge" | "purge" | "restore" | "trash";
export type LibraryCitationBusyAction = "copy" | "export" | null;

export interface LibraryBulkActionBarProps {
  busy: boolean;
  citationBusy: LibraryCitationBusyAction;
  isTrashView: boolean;
  onAddTag: () => void | Promise<void>;
  onAddToProject?: () => void | Promise<void>;
  onClear: () => void;
  onCopyBibliography: (styleId: string) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onExportCitations: (format: ExportFormat) => void | Promise<void>;
  onMerge: () => void | Promise<void>;
  onMoveToCollection: () => void | Promise<void>;
  onPurge: () => void | Promise<void>;
  onRestore: () => void | Promise<void>;
  projectIngressBusy?: boolean;
  selectedCount: number;
  workActionBusy: LibraryBulkWorkAction | null;
}

export function LibraryBulkActionBar({
  busy,
  citationBusy,
  isTrashView,
  onAddTag,
  onAddToProject,
  onClear,
  onCopyBibliography,
  onDelete,
  onExportCitations,
  onMerge,
  onMoveToCollection,
  onPurge,
  onRestore,
  projectIngressBusy = false,
  selectedCount,
  workActionBusy,
}: LibraryBulkActionBarProps) {
  const [citeMenuOpen, setCiteMenuOpen] = useState(false);
  const citeMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const citeMenuRef = useRef<HTMLDivElement>(null);

  const getCiteMenuItems = useCallback(
    () =>
      Array.from(
        citeMenuRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]:not(:disabled)',
        ) ?? [],
      ),
    [],
  );

  useEffect(() => {
    if (!citeMenuOpen) return;
    const frame = window.requestAnimationFrame(() => {
      getCiteMenuItems()[0]?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [citeMenuOpen, getCiteMenuItems]);

  useEffect(() => {
    if (!citeMenuOpen) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        (event.target as HTMLElement)?.closest?.(".library-cite-menu")
      ) {
        return;
      }
      setCiteMenuOpen(false);
      if (event instanceof KeyboardEvent) {
        citeMenuTriggerRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [citeMenuOpen]);

  const handleCiteMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const items = getCiteMenuItems();
      if (!items.length) return;
      const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
      let nextIndex: number | null = null;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        nextIndex = (currentIndex + 1) % items.length;
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        nextIndex = (currentIndex - 1 + items.length) % items.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = items.length - 1;
      } else if (event.key === "Escape") {
        event.preventDefault();
        setCiteMenuOpen(false);
        citeMenuTriggerRef.current?.focus({ preventScroll: true });
        return;
      }
      if (nextIndex === null) return;
      event.preventDefault();
      items[nextIndex]?.focus({ preventScroll: true });
    },
    [getCiteMenuItems],
  );

  const workMutationBusy = Boolean(workActionBusy);

  return (
    <div className="library-bulkbar">
      <span className="library-bulkbar__count">已选 {selectedCount} 篇</span>
      {isTrashView ? (
        <>
          <button
            type="button"
            onClick={() => void onRestore()}
            disabled={workMutationBusy}
            aria-busy={workActionBusy === "restore" ? "true" : undefined}
          >
            {workActionBusy === "restore" ? "恢复中..." : "恢复"}
          </button>
          <button
            type="button"
            className="library-bulkbar__danger"
            onClick={() => void onPurge()}
            disabled={workMutationBusy}
            aria-busy={workActionBusy === "purge" ? "true" : undefined}
          >
            {workActionBusy === "purge" ? "删除中..." : "永久删除"}
          </button>
        </>
      ) : (
        <>
          {onAddToProject && (
            <button
              type="button"
              onClick={() => void onAddToProject()}
              disabled={workMutationBusy || projectIngressBusy}
              aria-busy={projectIngressBusy ? "true" : undefined}
            >
              {projectIngressBusy ? "加入中..." : "加入项目"}
            </button>
          )}
          <button type="button" onClick={() => void onAddTag()} disabled={workMutationBusy}>
            添加标签
          </button>
          <button type="button" onClick={() => void onMoveToCollection()} disabled={workMutationBusy}>
            移动到文件夹
          </button>
          {selectedCount > 1 && (
            <button
              type="button"
              onClick={() => void onMerge()}
              disabled={busy || workMutationBusy}
              aria-busy={workActionBusy === "merge" ? "true" : undefined}
            >
              {workActionBusy === "merge" ? "合并中..." : "合并文献"}
            </button>
          )}
          <div className="library-cite-menu" aria-busy={citationBusy ? "true" : undefined}>
            <button
              ref={citeMenuTriggerRef}
              id="library-cite-menu-trigger"
              type="button"
              aria-controls="library-cite-dropdown"
              aria-expanded={citeMenuOpen}
              aria-haspopup="menu"
              onClick={() => setCiteMenuOpen((open) => !open)}
              disabled={Boolean(citationBusy) || workMutationBusy}
            >
              {citationBusy === "export"
                ? "导出中..."
                : citationBusy === "copy"
                  ? "复制中..."
                  : "导出引用 ▾"}
            </button>
            {citeMenuOpen && (
              <div
                ref={citeMenuRef}
                className="library-cite-dropdown"
                id="library-cite-dropdown"
                role="menu"
                aria-labelledby="library-cite-menu-trigger"
                onKeyDown={handleCiteMenuKeyDown}
              >
                <div className="library-cite-dropdown__group" id="library-cite-export-heading">
                  导出文件
                </div>
                <div role="group" aria-labelledby="library-cite-export-heading">
                  {(["bibtex", "ris", "csljson"] as const).map((format) => (
                    <button
                      key={format}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setCiteMenuOpen(false);
                        void onExportCitations(format);
                      }}
                      disabled={Boolean(citationBusy)}
                    >
                      {format === "bibtex"
                        ? "BibTeX (.bib)"
                        : format === "ris"
                          ? "RIS (.ris)"
                          : "CSL-JSON (.json)"}
                    </button>
                  ))}
                </div>
                <div className="library-cite-dropdown__group" id="library-cite-copy-heading">
                  复制参考文献
                </div>
                <div role="group" aria-labelledby="library-cite-copy-heading">
                  {CITATION_STYLES.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setCiteMenuOpen(false);
                        void onCopyBibliography(style.id);
                      }}
                      disabled={Boolean(citationBusy)}
                    >
                      {style.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            className="library-bulkbar__danger"
            onClick={() => void onDelete()}
            disabled={workMutationBusy}
            aria-busy={workActionBusy === "trash" ? "true" : undefined}
          >
            {workActionBusy === "trash" ? "移入中..." : "删除"}
          </button>
        </>
      )}
      <button
        type="button"
        className="library-bulkbar__clear"
        onClick={onClear}
        disabled={workMutationBusy}
      >
        取消选择
      </button>
    </div>
  );
}
