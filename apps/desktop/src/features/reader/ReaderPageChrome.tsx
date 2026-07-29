import { useEffect, useRef, useState, type RefObject } from "react";
import { useBlocker } from "react-router-dom";
import { type PdfDocument, type ReaderAnnotation } from "@aurascholar/reader";
import { Button } from "@aurascholar/ui";
import { type ConfirmFunction } from "../../components/ConfirmDialog";
import { isDesktopRuntime } from "../../services/aura-platform";

export interface ReaderWorkContext {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
}

function ReaderPageThumbnail({ doc, pageIndex }: { doc: PdfDocument; pageIndex: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shouldRender, setShouldRender] = useState(() => !("IntersectionObserver" in window));

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldRender(true);
        observer.disconnect();
      },
      { rootMargin: "260px 0px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldRender || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    void doc
      .getPage(pageIndex)
      .then((page) => {
        if (cancelled || !canvasRef.current) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const cssWidth = 126;
        const cssScale = cssWidth / baseViewport.width;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale: cssScale * dpr });
        const canvas = canvasRef.current;
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.width = `${Math.round(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.round(viewport.height / dpr)}px`;
        const context = canvas.getContext("2d");
        if (!context) return;
        renderTask = page.render({ canvasContext: context, viewport });
        renderTask.promise.catch(() => {});
      })
      .catch(() => {
        // Page thumbnails are decorative; destroying a previous document while
        // switching sessions can reject a pending getPage request.
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageIndex, shouldRender]);

  return (
    <div ref={hostRef} className="reader-page-thumbnail" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

export function ReaderPageNavigator({
  annotations,
  currentPage,
  doc,
  onSelect,
}: {
  annotations: ReaderAnnotation[];
  currentPage: number;
  doc: PdfDocument;
  onSelect: (pageIndex: number) => void;
}) {
  const annotationCounts = new Map<number, number>();
  annotations.forEach((annotation) => {
    annotationCounts.set(
      annotation.pageIndex,
      (annotationCounts.get(annotation.pageIndex) ?? 0) + 1,
    );
  });

  return (
    <aside className="reader-page-nav" aria-label="PDF 页面导航">
      <div className="reader-page-nav__head">
        <div>
          <strong>页面</strong>
          <span>{doc.pageCount} 页</span>
        </div>
        <small>
          {currentPage + 1} / {doc.pageCount}
        </small>
      </div>
      <div className="reader-page-nav__list">
        {Array.from({ length: doc.pageCount }, (_, pageIndex) => {
          const isCurrent = currentPage === pageIndex;
          const annotationCount = annotationCounts.get(pageIndex) ?? 0;
          return (
            <button
              key={pageIndex}
              type="button"
              className={
                isCurrent
                  ? "reader-page-nav__item reader-page-nav__item--active"
                  : "reader-page-nav__item"
              }
              aria-current={isCurrent ? "page" : undefined}
              aria-label={`第 ${pageIndex + 1} 页${annotationCount ? `，${annotationCount} 条批注` : ""}`}
              onClick={() => onSelect(pageIndex)}
            >
              <ReaderPageThumbnail doc={doc} pageIndex={pageIndex} />
              <span>
                {pageIndex + 1}
                {annotationCount > 0 && <small>{annotationCount}</small>}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export function ReaderCommentDraftNavigationGuard({ confirm }: { confirm: ConfirmFunction }) {
  const blockerDialogOpenRef = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search,
  );

  useEffect(() => {
    if (blocker.state === "unblocked") {
      blockerDialogOpenRef.current = false;
    }
  }, [blocker.state]);

  useEffect(() => {
    if (blocker.state !== "blocked" || blockerDialogOpenRef.current) return;
    blockerDialogOpenRef.current = true;
    void confirm({
      cancelLabel: "继续编辑",
      confirmLabel: "离开页面",
      description: "离开阅读器会丢失尚未保存的批注评论草稿。",
      details: ["保存评论后，它才会进入批注导出、文献库同步和后续写作流程。"],
      eyebrow: "未保存",
      title: "要离开阅读器吗？",
      tone: "warning",
    }).then((confirmed) => {
      blockerDialogOpenRef.current = false;
      if (confirmed) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    });
  }, [blocker, confirm]);

  return null;
}

export function ReaderEmptyState({
  loading,
  loadError,
  archivedWork,
  archivedWorkId,
  missingWork,
  fileInputRef,
  fileActionBusy,
  onOpenFile,
  onBackToLibrary,
  onFindFulltext,
  onRetryOpen,
}: {
  loading: boolean;
  loadError: string | null;
  archivedWork: ReaderWorkContext | null;
  archivedWorkId: string | null;
  missingWork: ReaderWorkContext | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  fileActionBusy: boolean;
  onOpenFile: (file: File) => void | Promise<void>;
  onBackToLibrary: () => void;
  onFindFulltext?: () => void;
  onRetryOpen?: () => void;
}) {
  const archived = Boolean(archivedWorkId);
  const previewMode = !isDesktopRuntime();
  const contextualWork = archived ? archivedWork : missingWork;
  const authors = contextualWork?.authors.slice(0, 3).join(", ");
  const primaryActionLabel = loading
    ? "正在打开..."
    : fileActionBusy
      ? missingWork && !previewMode
        ? "正在补上..."
        : "打开中..."
      : missingWork && !previewMode
        ? "补上 PDF 并打开"
        : "打开本地 PDF";

  return (
    <div className="reader-empty-page">
      <div className="reader-empty-hero">
        <div className="reader-empty-hero__copy">
          <h1>
            {loading
              ? "正在打开文献"
              : archived
                ? "文献在回收站"
                : missingWork
                  ? "PDF 未就绪"
                  : "阅读器"}
          </h1>
          <p>
            {loading
              ? "正在读取文献库里的 PDF、题录和批注。大文件会多等一会儿。"
              : archived
                ? "先在文献库恢复这篇文献，再继续阅读、补全文或编辑批注。"
                : missingWork
                  ? "这篇文献已经在库里，补上 PDF 后就能进入批注、翻译、重点和素材链路。"
                  : "等待一篇 PDF。入库文献会保留批注与素材，本地文件适合快速查看。"}
          </p>
          {contextualWork && (
            <div className="reader-empty-work">
              <span>{archived ? "待恢复文献" : "待补全文"}</span>
              <strong>{contextualWork.title}</strong>
              <small>
                {[
                  authors,
                  contextualWork.year,
                  contextualWork.doi ? `DOI ${contextualWork.doi}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || (archived ? "回收站中" : "题录已定位")}
              </small>
            </div>
          )}
          {loadError && <p className="reader-empty-hero__error">{loadError}</p>}
          <div className="reader-empty-hero__actions">
            {!archived && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file && !fileActionBusy) void onOpenFile(file);
                    event.target.value = "";
                  }}
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || fileActionBusy}
                  aria-busy={loading || fileActionBusy ? "true" : undefined}
                >
                  {primaryActionLabel}
                </Button>
              </>
            )}
            {onRetryOpen && (
              <Button
                variant="secondary"
                onClick={onRetryOpen}
                disabled={loading || fileActionBusy}
              >
                重试打开
              </Button>
            )}
            {onFindFulltext && (
              <Button variant="secondary" onClick={onFindFulltext} disabled={fileActionBusy}>
                去找全文
              </Button>
            )}
            <Button variant="secondary" onClick={onBackToLibrary} disabled={fileActionBusy}>
              {archived ? "去文献库恢复" : missingWork ? "回文献库定位" : "返回文献库"}
            </Button>
          </div>
        </div>
        <div className="reader-empty-hero__workflow" aria-label="阅读工作流">
          <div>
            <strong>01</strong>
            <span>深读队列</span>
            <small>{loading ? "正在定位 PDF" : "PDF 尚未打开"}</small>
          </div>
          <div>
            <strong>02</strong>
            <span>译文状态</span>
            <small>等待正文</small>
          </div>
          <div>
            <strong>03</strong>
            <span>素材归档</span>
            <small>等待关联论文</small>
          </div>
        </div>
      </div>
    </div>
  );
}
