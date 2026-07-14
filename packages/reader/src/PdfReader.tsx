// The reader view: virtualized page list + selection capture + highlight
// toolbar. Storage-agnostic — annotation CRUD is delegated to callbacks.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PdfDocument } from "./document.js";
import type { PendingSelection, ReaderAnnotation, AnnotationType } from "./annotations.js";
import type { AnnotationAnchor } from "./anchor-types.js";
import { makeQuoteSelector } from "./anchoring.js";
import { rectsForTextRange, textRangeFromDomSelection } from "./quads.js";
import { PdfPage } from "./PdfPage.js";

export interface ReaderTextSelection {
  text: string;
  pageIndex: number;
  clientRect: { x: number; y: number; width: number; height: number };
}

export interface PdfReaderProps {
  doc: PdfDocument;
  annotations: ReaderAnnotation[];
  onCreateAnnotation?: (
    a: Omit<ReaderAnnotation, "id">,
  ) => boolean | void | Promise<boolean | void>;
  onAnnotationClick?: (id: string) => void;
  /** Invoked with the selected text and viewport anchor when translation is requested. */
  onTranslate?: (selection: ReaderTextSelection) => void;
  /** Invoked with the selected text + page when the user saves a writing snippet. */
  onSaveSnippet?: (text: string, pageIndex: number) => boolean | void | Promise<boolean | void>;
  /** Highlight palette: name → CSS color. */
  palette?: Record<string, string>;
  pageFilter?: "none" | "sepia" | "invert";
  /** When set (and changed), the reader scrolls to this page. */
  scrollToPage?: number | null;
  /** Reports the page nearest the reading focus as the document scrolls. */
  onVisiblePageChange?: (pageIndex: number) => void;
}

const DEFAULT_PALETTE: Record<string, string> = {
  yellow: "#ffd866",
  green: "#a9dc76",
  blue: "#78dce8",
  pink: "#ff6188",
};

/** Pages rendered above/below the viewport. */
const OVERSCAN = 2;

export function PdfReader({
  doc,
  annotations,
  onCreateAnnotation,
  onAnnotationClick,
  onTranslate,
  onSaveSnippet,
  palette = DEFAULT_PALETTE,
  pageFilter = "none",
  scrollToPage = null,
  onVisiblePageChange,
}: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1.2);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 2]);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [pageHeight, setPageHeight] = useState(800); // estimated until first page loads
  const [snippetSaving, setSnippetSaving] = useState(false);
  const visiblePageRef = useRef(0);

  // Measure first page to estimate scroll heights for virtualization.
  useEffect(() => {
    void doc.getPage(0).then((p) => {
      const vp = p.getViewport({ scale: 1 });
      setPageHeight(vp.height);
    });
  }, [doc]);

  const scaledPageHeight = pageHeight * scale + 16; // + gap

  const updateVisible = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const first = Math.max(0, Math.floor(el.scrollTop / scaledPageHeight) - OVERSCAN);
    const last = Math.min(
      doc.pageCount - 1,
      Math.ceil((el.scrollTop + el.clientHeight) / scaledPageHeight) + OVERSCAN,
    );
    setVisibleRange([first, last]);
    const focusedPage = Math.min(
      doc.pageCount - 1,
      Math.max(0, Math.floor((el.scrollTop + el.clientHeight * 0.32) / scaledPageHeight)),
    );
    if (focusedPage !== visiblePageRef.current) {
      visiblePageRef.current = focusedPage;
      onVisiblePageChange?.(focusedPage);
    }
  }, [doc.pageCount, onVisiblePageChange, scaledPageHeight]);

  useEffect(updateVisible, [updateVisible]);

  // External page navigation (annotation sidebar jump).
  useEffect(() => {
    if (scrollToPage == null || !containerRef.current) return;
    containerRef.current.scrollTo({ top: scrollToPage * scaledPageHeight, behavior: "smooth" });
  }, [scrollToPage, scaledPageHeight]);

  // Selection capture: map DOM selection in text layers → page text range.
  const handleMouseUp = useCallback(async () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) {
      setPending(null);
      return;
    }
    const anchorSpan = spanOf(sel.anchorNode);
    const focusSpan = spanOf(sel.focusNode);
    if (!anchorSpan || !focusSpan) return;
    const pageIndex = Number(anchorSpan.parentElement?.dataset.pageIndex);
    if (Number.isNaN(pageIndex) || Number(focusSpan.parentElement?.dataset.pageIndex) !== pageIndex)
      return; // cross-page selection: out of scope for v0.1

    const index = await doc.getPageText(pageIndex);
    const range = textRangeFromDomSelection(
      index,
      Number(anchorSpan.dataset.itemIndex),
      sel.anchorOffset,
      Number(focusSpan.dataset.itemIndex),
      sel.focusOffset,
    );
    if (!range) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setPending({
      pageIndex,
      start: range.start,
      end: range.end,
      exact: index.text.slice(range.start, range.end),
      clientRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  }, [doc]);

  const createFromPending = useCallback(
    async (type: AnnotationType, color: string) => {
      if (!pending || !onCreateAnnotation || snippetSaving) return;
      setSnippetSaving(true);
      let shouldClear: boolean;
      try {
        const index = await doc.getPageText(pending.pageIndex);
        const anchor: AnnotationAnchor = {
          version: 1,
          pageIndex: pending.pageIndex,
          quote: makeQuoteSelector(index.text, pending.start, pending.end),
          position: { start: pending.start, end: pending.end },
          quads: {
            pageIndex: pending.pageIndex,
            rects: rectsForTextRange(index, pending.start, pending.end),
          },
        };
        const result = await onCreateAnnotation({
          type,
          color,
          pageIndex: pending.pageIndex,
          anchor,
        });
        shouldClear = result !== false;
      } catch {
        shouldClear = false;
      } finally {
        setSnippetSaving(false);
      }
      if (shouldClear) {
        setPending(null);
        window.getSelection()?.removeAllRanges();
      }
    },
    [pending, onCreateAnnotation, doc, snippetSaving],
  );

  const saveSnippetFromPending = useCallback(async () => {
    if (!pending || !onSaveSnippet || snippetSaving) return;
    setSnippetSaving(true);
    try {
      const result = await onSaveSnippet(pending.exact, pending.pageIndex);
      if (result !== false) {
        setPending(null);
        window.getSelection()?.removeAllRanges();
      }
    } finally {
      setSnippetSaving(false);
    }
  }, [onSaveSnippet, pending, snippetSaving]);

  const pages = useMemo(() => {
    const maxPage = doc.pageCount - 1;
    if (maxPage < 0) return [];
    const [first, last] = visibleRange;
    const start = Math.min(Math.max(0, first), maxPage);
    const end = Math.min(Math.max(start, last), maxPage);
    const out: number[] = [];
    for (let i = start; i <= end; i++) out.push(i);
    return out;
  }, [doc.pageCount, visibleRange]);
  const zoomPercent = Math.round(scale * 100);

  return (
    <div className="au-reader" onMouseUp={() => void handleMouseUp()}>
      <div className="au-reader__toolbar" role="toolbar" aria-label="PDF 缩放">
        <button
          type="button"
          className="au-reader__zoom"
          aria-label={`缩小 PDF，当前 ${zoomPercent}%`}
          title="缩小 PDF"
          onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}
        >
          −
        </button>
        <span className="au-reader__zoom-label" role="status" aria-live="polite">
          {zoomPercent}%
        </span>
        <button
          type="button"
          className="au-reader__zoom"
          aria-label={`放大 PDF，当前 ${zoomPercent}%`}
          title="放大 PDF"
          onClick={() => setScale((s) => Math.min(4, s + 0.2))}
        >
          +
        </button>
      </div>
      <div ref={containerRef} className="au-reader__scroll" onScroll={updateVisible}>
        <div style={{ height: doc.pageCount * scaledPageHeight, position: "relative" }}>
          {pages.map((i) => (
            <div
              key={i}
              style={{ position: "absolute", top: i * scaledPageHeight, left: 0, right: 0 }}
            >
              <div className="au-reader__page-wrap">
                <PdfPage
                  doc={doc}
                  pageIndex={i}
                  scale={scale}
                  annotations={annotations}
                  onAnnotationClick={onAnnotationClick}
                  pageFilter={pageFilter}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      {pending && (
        <div
          className="au-reader__selection-toolbar"
          role="toolbar"
          aria-label="选中文本操作"
          style={{
            position: "fixed",
            left: pending.clientRect.x + pending.clientRect.width / 2,
            top: pending.clientRect.y - 44,
            transform: "translateX(-50%)",
          }}
        >
          {Object.entries(palette).map(([name, color]) => (
            <button
              key={name}
              type="button"
              className="au-reader__swatch"
              style={{ background: color }}
              aria-busy={snippetSaving}
              aria-label={snippetSaving ? "正在保存批注" : `添加${name}高亮`}
              disabled={snippetSaving}
              title={snippetSaving ? "正在保存批注" : `高亮 · ${name}`}
              onClick={() => void createFromPending("highlight", color)}
            />
          ))}
          <button
            type="button"
            className="au-reader__tool"
            aria-busy={snippetSaving}
            aria-label={snippetSaving ? "正在保存批注" : "添加下划线"}
            disabled={snippetSaving}
            title={snippetSaving ? "正在保存批注" : "下划线"}
            onClick={() => void createFromPending("underline", "var(--color-accent)")}
          >
            U̲
          </button>
          <button
            type="button"
            className="au-reader__tool"
            aria-busy={snippetSaving}
            aria-label={snippetSaving ? "正在保存批注" : "添加批注"}
            disabled={snippetSaving}
            title={snippetSaving ? "正在保存批注" : "批注"}
            onClick={() => void createFromPending("note", palette.yellow ?? "#ffd866")}
          >
            ✎
          </button>
          {onTranslate && (
            <button
              type="button"
              className="au-reader__tool"
              aria-label="翻译选中文本"
              disabled={snippetSaving}
              title="翻译选中文本"
              onClick={() => {
                if (snippetSaving) return;
                onTranslate({
                  text: pending.exact,
                  pageIndex: pending.pageIndex,
                  clientRect: pending.clientRect,
                });
                setPending(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              译
            </button>
          )}
          {onSaveSnippet && (
            <button
              type="button"
              className="au-reader__tool au-reader__tool--snippet"
              aria-busy={snippetSaving}
              aria-label={snippetSaving ? "正在保存为写作素材" : "存为写作素材"}
              disabled={snippetSaving}
              title={snippetSaving ? "正在保存为写作素材" : "存为写作素材"}
              onClick={() => void saveSnippetFromPending()}
            >
              {snippetSaving ? "…" : "✦"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function spanOf(node: Node): HTMLElement | null {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  return el?.dataset?.itemIndex !== undefined ? el : null;
}
