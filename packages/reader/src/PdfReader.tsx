// The reader view: virtualized page list + selection capture + highlight
// toolbar. Storage-agnostic — annotation CRUD is delegated to callbacks.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PdfDocument } from "./document";
import type { PendingSelection, ReaderAnnotation, AnnotationType } from "./annotations";
import type { AnnotationAnchor } from "./anchor-types";
import { makeQuoteSelector } from "./anchoring";
import { rectsForTextRange, textRangeFromDomSelection } from "./quads";
import { PdfPage } from "./PdfPage";

export interface PdfReaderProps {
  doc: PdfDocument;
  annotations: ReaderAnnotation[];
  onCreateAnnotation?: (a: Omit<ReaderAnnotation, "id">) => void;
  onAnnotationClick?: (id: string) => void;
  /** Invoked with the selected text when the user taps the translate tool. */
  onTranslate?: (text: string) => void;
  /** Invoked with the selected text + page when the user saves a writing snippet. */
  onSaveSnippet?: (text: string, pageIndex: number) => void | Promise<void>;
  /** Highlight palette: name → CSS color. */
  palette?: Record<string, string>;
  pageFilter?: "none" | "sepia" | "invert";
  /** When set (and changed), the reader scrolls to this page. */
  scrollToPage?: number | null;
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
}: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1.2);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 2]);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [pageHeight, setPageHeight] = useState(800); // estimated until first page loads
  const [snippetSaving, setSnippetSaving] = useState(false);

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
  }, [doc.pageCount, scaledPageHeight]);

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
      onCreateAnnotation({ type, color, pageIndex: pending.pageIndex, anchor });
      setPending(null);
      window.getSelection()?.removeAllRanges();
    },
    [pending, onCreateAnnotation, doc, snippetSaving],
  );

  const saveSnippetFromPending = useCallback(async () => {
    if (!pending || !onSaveSnippet || snippetSaving) return;
    setSnippetSaving(true);
    try {
      await onSaveSnippet(pending.exact, pending.pageIndex);
      setPending(null);
      window.getSelection()?.removeAllRanges();
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

  return (
    <div className="au-reader" onMouseUp={() => void handleMouseUp()}>
      <div className="au-reader__toolbar">
        <button className="au-reader__zoom" onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>
          −
        </button>
        <span className="au-reader__zoom-label">{Math.round(scale * 100)}%</span>
        <button className="au-reader__zoom" onClick={() => setScale((s) => Math.min(4, s + 0.2))}>
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
              className="au-reader__swatch"
              style={{ background: color }}
              disabled={snippetSaving}
              title={`高亮 · ${name}`}
              onClick={() => void createFromPending("highlight", color)}
            />
          ))}
          <button
            className="au-reader__tool"
            disabled={snippetSaving}
            title="下划线"
            onClick={() => void createFromPending("underline", "var(--color-accent)")}
          >
            U̲
          </button>
          <button
            className="au-reader__tool"
            disabled={snippetSaving}
            title="批注"
            onClick={() => void createFromPending("note", palette.yellow ?? "#ffd866")}
          >
            ✎
          </button>
          {onTranslate && (
            <button
              className="au-reader__tool"
              disabled={snippetSaving}
              title="翻译选中文本"
              onClick={() => {
                if (snippetSaving) return;
                onTranslate(pending.exact);
                setPending(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              译
            </button>
          )}
          {onSaveSnippet && (
            <button
              className="au-reader__tool au-reader__tool--snippet"
              aria-busy={snippetSaving}
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
