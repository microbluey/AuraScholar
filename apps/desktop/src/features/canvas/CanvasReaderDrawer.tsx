import type { AttachmentRow } from "@aurascholar/db/repos/attachments";
import type { WorkWithAuthors } from "@aurascholar/db/repos/works";
import { PdfReader, configureWorker, type ReaderAnnotation } from "@aurascholar/reader";
import {
  ArrowLineLeft,
  ArrowSquareOut,
  FilePdf,
  Quotes,
  SpinnerGap,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "@aurascholar/reader/reader.css";
import { isDesktopRuntime } from "../../services/aura-platform";
import { describeSafeError } from "../../services/sensitive-text";
import {
  CANVAS_EXCERPT_DRAG_VERSION,
  writeCanvasExcerptDragPayload,
  type CanvasExcerptDragPayload,
} from "./canvas-excerpt-dnd";
import {
  createLibraryReaderAnnotation,
  isLibraryReaderAbort,
  loadLibraryReaderSession,
  type LibraryReaderSession,
} from "../reader/library-reader-session";
import "./canvas-reader-drawer.css";

configureWorker(workerSrc);

const DEFAULT_DRAWER_VIEWPORT_RATIO = 0.4;
const MIN_DRAWER_WIDTH = 360;
const MAX_DRAWER_VIEWPORT_RATIO = 0.72;
const READER_INITIAL_SCALE = 0.8;
const READER_REFERENCE_PAGE_WIDTH = 640;

export interface CanvasReaderAnnotationPayload {
  annotation: ReaderAnnotation;
  attachment: AttachmentRow;
  sourceNodeId?: string;
  work: WorkWithAuthors;
  workspaceId: string;
}

export interface CanvasReaderFullReaderTarget {
  annotationId?: string;
  attachmentId?: string;
  pageIndex: number;
  workId: string;
}

export interface CanvasReaderDrawerProps {
  fallbackTitle?: string;
  initialAnnotationId?: string;
  initialPageIndex?: number;
  onAddAnnotation?: (
    payload: CanvasReaderAnnotationPayload,
  ) => boolean | void | Promise<boolean | void>;
  onAnnotationReady?: (payload: CanvasReaderAnnotationPayload) => void;
  onClose: () => void;
  onOpenFullReader: (target: CanvasReaderFullReaderTarget) => void;
  preferredAttachmentId?: string;
  sourceNodeId?: string;
  workId: string;
  workspaceId: string;
}

interface ResizeState {
  pointerId: number;
  startWidth: number;
  startX: number;
}

export function clampCanvasReaderDrawerWidth(width: number, viewportWidth: number): number {
  const safeViewport = Math.max(320, viewportWidth);
  const minimum = Math.min(MIN_DRAWER_WIDTH, safeViewport);
  const maximum = Math.max(minimum, safeViewport * MAX_DRAWER_VIEWPORT_RATIO);
  return Math.min(maximum, Math.max(minimum, width));
}

function canvasReaderDrawerWidthBounds(viewportWidth: number): {
  maximum: number;
  minimum: number;
} {
  const safeViewport = Math.max(320, viewportWidth);
  const minimum = Math.min(MIN_DRAWER_WIDTH, safeViewport);
  return {
    minimum,
    maximum: Math.max(minimum, safeViewport * MAX_DRAWER_VIEWPORT_RATIO),
  };
}

export function canvasReaderExcerptDragPayload(
  payload: CanvasReaderAnnotationPayload,
): CanvasExcerptDragPayload {
  return {
    version: CANVAS_EXCERPT_DRAG_VERSION,
    workspaceId: payload.workspaceId,
    sourceNodeId: payload.sourceNodeId,
    workId: payload.work.id,
    attachmentId: payload.attachment.id,
    paperTitle: payload.work.title,
    annotation: payload.annotation,
  };
}

function initialDrawerWidth(): number {
  if (typeof window === "undefined") return 560;
  return clampCanvasReaderDrawerWidth(
    window.innerWidth * DEFAULT_DRAWER_VIEWPORT_RATIO,
    window.innerWidth,
  );
}

function initialPageFor(
  session: LibraryReaderSession,
  annotationId?: string,
  requestedPage?: number,
): number {
  const annotation = annotationId
    ? session.annotations.find((candidate) => candidate.id === annotationId)
    : undefined;
  const pageIndex = annotation?.pageIndex ?? requestedPage ?? 0;
  return Math.max(0, Math.min(session.doc.pageCount - 1, pageIndex));
}

function annotationDescription(annotation: ReaderAnnotation): string {
  return (
    annotation.anchor.quote?.exact.trim() ||
    annotation.contentMd?.trim() ||
    `第 ${annotation.pageIndex + 1} 页批注`
  );
}

export function CanvasReaderDrawer({
  fallbackTitle,
  initialAnnotationId,
  initialPageIndex,
  onAddAnnotation,
  onAnnotationReady,
  onClose,
  onOpenFullReader,
  preferredAttachmentId,
  sourceNodeId,
  workId,
  workspaceId,
}: CanvasReaderDrawerProps) {
  const [session, setSession] = useState<LibraryReaderSession | null>(null);
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(
    initialAnnotationId ?? null,
  );
  const [currentPage, setCurrentPage] = useState(Math.max(0, initialPageIndex ?? 0));
  const [jumpPage, setJumpPage] = useState<number | null>(initialPageIndex ?? null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [reloadSequence, setReloadSequence] = useState(0);
  const [drawerWidth, setDrawerWidth] = useState(initialDrawerWidth);
  const requestSequenceRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const resizeAnimationFrameRef = useRef<number | null>(null);
  const pendingDrawerWidthRef = useRef(drawerWidth);
  const resizeRef = useRef<ResizeState | null>(null);
  const activeWriteIdentityRef = useRef("");
  const writeIdentity = `${workspaceId}\u0000${workId}\u0000${sourceNodeId ?? ""}\u0000${preferredAttachmentId ?? ""}`;

  useLayoutEffect(() => {
    activeWriteIdentityRef.current = writeIdentity;
  }, [writeIdentity]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [onClose]);

  useEffect(() => () => session?.doc.destroy(), [session]);

  useEffect(() => {
    const sequence = ++requestSequenceRef.current;
    const controller = new AbortController();
    activeControllerRef.current?.abort();
    activeControllerRef.current = controller;

    const startId = window.setTimeout(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setLoadError("");
      setActionMessage("");
      setAdding(false);
      setSession(null);
      setAnnotations([]);
      setSelectedAnnotationId(initialAnnotationId ?? null);

      if (!isDesktopRuntime()) {
        setLoading(false);
        setLoadError("浏览器预览暂不读取本地 PDF，请在桌面应用中使用同屏阅读。");
        return;
      }

      void loadLibraryReaderSession(workId, {
        attachmentId: preferredAttachmentId,
        signal: controller.signal,
      })
        .then((next) => {
          if (controller.signal.aborted || requestSequenceRef.current !== sequence) {
            next.doc.destroy();
            return;
          }
          const pageIndex = initialPageFor(next, initialAnnotationId, initialPageIndex);
          setSession(next);
          setAnnotations(next.annotations);
          setCurrentPage(pageIndex);
          setJumpPage(pageIndex);
        })
        .catch((error) => {
          if (controller.signal.aborted || isLibraryReaderAbort(error)) return;
          if (requestSequenceRef.current !== sequence) return;
          setLoadError(describeSafeError(error));
        })
        .finally(() => {
          if (!controller.signal.aborted && requestSequenceRef.current === sequence) {
            setLoading(false);
          }
        });
    }, 0);

    return () => {
      window.clearTimeout(startId);
      controller.abort();
    };
  }, [
    initialAnnotationId,
    initialPageIndex,
    preferredAttachmentId,
    reloadSequence,
    workId,
    workspaceId,
  ]);

  useEffect(() => {
    const handleResize = () => {
      setDrawerWidth((current) => clampCanvasReaderDrawerWidth(current, window.innerWidth));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(
    () => () => {
      if (resizeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeAnimationFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!actionMessage) return;
    const timeout = window.setTimeout(() => setActionMessage(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [actionMessage]);

  const selectedPayload = useMemo<CanvasReaderAnnotationPayload | null>(() => {
    if (!session || !selectedAnnotationId) return null;
    const annotation = annotations.find((candidate) => candidate.id === selectedAnnotationId);
    if (!annotation) return null;
    return {
      annotation,
      attachment: session.attachment,
      sourceNodeId,
      work: session.work,
      workspaceId,
    };
  }, [annotations, selectedAnnotationId, session, sourceNodeId, workspaceId]);

  useEffect(() => {
    if (selectedPayload) onAnnotationReady?.(selectedPayload);
  }, [onAnnotationReady, selectedPayload]);

  const handleCreateAnnotation = useCallback(
    async (draft: Omit<ReaderAnnotation, "id">): Promise<boolean> => {
      if (!session) return false;
      const requestSequence = requestSequenceRef.current;
      const controller = activeControllerRef.current;
      const writeIdentity = activeWriteIdentityRef.current;
      setActionMessage("正在保存高亮…");
      try {
        const annotation = await createLibraryReaderAnnotation(session, draft, controller?.signal);
        if (
          controller?.signal.aborted ||
          requestSequenceRef.current !== requestSequence ||
          activeWriteIdentityRef.current !== writeIdentity
        ) {
          return true;
        }
        setAnnotations((current) => [...current, annotation]);
        setSelectedAnnotationId(annotation.id);
        setCurrentPage(annotation.pageIndex);
        setActionMessage(
          sourceNodeId
            ? "高亮已保存，可拖入或加入当前白板。"
            : "高亮已保存，请从文献卡打开后加入白板。",
        );
        return true;
      } catch (error) {
        if (
          isLibraryReaderAbort(error) ||
          controller?.signal.aborted ||
          requestSequenceRef.current !== requestSequence ||
          activeWriteIdentityRef.current !== writeIdentity
        ) {
          return false;
        }
        setActionMessage(`保存高亮失败：${describeSafeError(error)}`);
        return false;
      }
    },
    [session, sourceNodeId],
  );

  const handleSelectAnnotation = useCallback(
    (annotationId: string) => {
      const annotation = annotations.find((candidate) => candidate.id === annotationId);
      if (!annotation) return;
      setSelectedAnnotationId(annotation.id);
      setCurrentPage(annotation.pageIndex);
      setJumpPage(annotation.pageIndex);
    },
    [annotations],
  );

  const handleAddAnnotation = useCallback(async () => {
    if (!selectedPayload || !sourceNodeId || !onAddAnnotation || adding) return;
    setAdding(true);
    try {
      const added = await onAddAnnotation(selectedPayload);
      setActionMessage(added === false ? "未加入白板，可再次尝试。" : "摘录已加入当前白板。");
    } catch (error) {
      setActionMessage(`加入白板失败：${describeSafeError(error)}`);
    } finally {
      setAdding(false);
    }
  }, [adding, onAddAnnotation, selectedPayload, sourceNodeId]);

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!selectedPayload || !sourceNodeId) {
        event.preventDefault();
        setActionMessage("请从白板上的文献卡打开阅读器，再拖入摘录。");
        return;
      }
      writeCanvasExcerptDragPayload(
        event.dataTransfer,
        canvasReaderExcerptDragPayload(selectedPayload),
      );
    },
    [selectedPayload, sourceNodeId],
  );

  const handleResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      resizeRef.current = {
        pointerId: event.pointerId,
        startWidth: drawerWidth,
        startX: event.clientX,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [drawerWidth],
  );

  const handleResizePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    pendingDrawerWidthRef.current = clampCanvasReaderDrawerWidth(
      resize.startWidth + resize.startX - event.clientX,
      window.innerWidth,
    );
    if (resizeAnimationFrameRef.current !== null) return;
    resizeAnimationFrameRef.current = window.requestAnimationFrame(() => {
      resizeAnimationFrameRef.current = null;
      setDrawerWidth(pendingDrawerWidthRef.current);
    });
  }, []);

  const handleResizePointerEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleResizeKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? 1 : -1;
    setDrawerWidth((current) =>
      clampCanvasReaderDrawerWidth(current + direction * 24, window.innerWidth),
    );
  }, []);

  const style = {
    "--canvas-reader-drawer-width": `${Math.round(drawerWidth)}px`,
  } as CSSProperties;
  const canAddSelected = Boolean(selectedPayload && sourceNodeId && onAddAnnotation);
  const selectedDescription = selectedPayload
    ? annotationDescription(selectedPayload.annotation)
    : "";
  const readerInitialScale = Math.min(
    READER_INITIAL_SCALE,
    Math.max(0.5, (drawerWidth - 32) / READER_REFERENCE_PAGE_WIDTH),
  );
  const drawerWidthBounds = canvasReaderDrawerWidthBounds(window.innerWidth);

  return (
    <aside
      className="canvas-reader-drawer"
      style={style}
      aria-label="同屏 PDF 阅读器"
      data-workspace-id={workspaceId}
    >
      <div
        className="canvas-reader-drawer__resize"
        role="separator"
        aria-label="调整阅读器宽度"
        aria-orientation="vertical"
        aria-valuemin={Math.round(drawerWidthBounds.minimum)}
        aria-valuemax={Math.round(drawerWidthBounds.maximum)}
        aria-valuenow={Math.round(drawerWidth)}
        tabIndex={0}
        onKeyDown={handleResizeKeyDown}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
      />

      <header className="canvas-reader-drawer__header">
        <div className="canvas-reader-drawer__title">
          <FilePdf size={19} weight="duotone" aria-hidden="true" />
          <div>
            <span>同屏研读</span>
            <strong title={session?.work.title ?? fallbackTitle}>
              {session?.work.title || fallbackTitle || "正在打开文献…"}
            </strong>
          </div>
        </div>
        <div className="canvas-reader-drawer__actions">
          <button
            type="button"
            aria-label="在完整阅读器中打开"
            title="在完整阅读器中打开"
            onClick={() => {
              onOpenFullReader({
                workId: session?.work.id ?? workId,
                ...(session?.attachment.id || preferredAttachmentId
                  ? { attachmentId: session?.attachment.id ?? preferredAttachmentId }
                  : {}),
                ...(selectedPayload?.annotation.id || initialAnnotationId
                  ? { annotationId: selectedPayload?.annotation.id ?? initialAnnotationId }
                  : {}),
                pageIndex: session ? currentPage : Math.max(0, initialPageIndex ?? 0),
              });
            }}
          >
            <ArrowSquareOut size={18} weight="bold" aria-hidden="true" />
          </button>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="关闭同屏阅读器"
            title="关闭"
            onClick={onClose}
          >
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>
        {session && (
          <div className="canvas-reader-drawer__meta" aria-live="polite">
            <span>
              第 {currentPage + 1} / {session.doc.pageCount} 页
            </span>
            <span>{annotations.length} 条批注</span>
          </div>
        )}
      </header>

      <div className="canvas-reader-drawer__body">
        {loading && (
          <div className="canvas-reader-drawer__state" role="status" aria-busy="true">
            <SpinnerGap className="canvas-reader-drawer__spinner" size={28} weight="bold" />
            <strong>正在载入 PDF</strong>
            <span>同步文献元数据与批注。</span>
          </div>
        )}
        {!loading && loadError && (
          <div className="canvas-reader-drawer__state" role="alert">
            <WarningCircle size={30} weight="duotone" />
            <strong>无法打开这篇文献</strong>
            <span>{loadError}</span>
            {isDesktopRuntime() && (
              <button type="button" onClick={() => setReloadSequence((value) => value + 1)}>
                重新载入
              </button>
            )}
          </div>
        )}
        {!loading && session && (
          <PdfReader
            doc={session.doc}
            annotations={annotations}
            initialScale={readerInitialScale}
            onCreateAnnotation={handleCreateAnnotation}
            onAnnotationClick={handleSelectAnnotation}
            onVisiblePageChange={setCurrentPage}
            scrollToPage={jumpPage}
          />
        )}
      </div>

      {selectedPayload && (
        <div className="canvas-reader-drawer__excerpt-tray">
          <div
            className={`canvas-reader-drawer__excerpt${canAddSelected ? "" : " canvas-reader-drawer__excerpt--disabled"}`}
            data-canvas-annotation-id={selectedPayload.annotation.id}
            draggable={canAddSelected}
            onDragStart={handleDragStart}
            title={
              canAddSelected ? "拖到左侧白板创建摘录卡" : "需要关联白板上的来源文献卡，才能加入摘录"
            }
          >
            <Quotes size={18} weight="duotone" aria-hidden="true" />
            <span>
              <strong>已保存高亮 · 第 {selectedPayload.annotation.pageIndex + 1} 页</strong>
              <small>{selectedDescription}</small>
            </span>
          </div>
          <button
            className="canvas-reader-drawer__add"
            type="button"
            disabled={!canAddSelected || adding}
            aria-busy={adding || undefined}
            onClick={() => void handleAddAnnotation()}
          >
            <ArrowLineLeft size={17} weight="bold" aria-hidden="true" />
            {adding ? "加入中…" : "加入当前白板"}
          </button>
          {!sourceNodeId && (
            <small className="canvas-reader-drawer__excerpt-hint">
              请从一张文献卡打开同屏阅读器，以自动建立来源连线。
            </small>
          )}
        </div>
      )}

      {actionMessage && (
        <div className="canvas-reader-drawer__notice" role="status" aria-live="polite">
          {actionMessage}
        </div>
      )}
    </aside>
  );
}
