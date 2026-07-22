// Reader page: PDF + research panel for annotations, translation, and citation context.
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { useBlocker, useNavigate, useSearchParams } from "react-router-dom";
import {
  AnnotationSidebar,
  PdfDocument,
  PdfReader,
  annotationsToMarkdown,
  configureWorker,
  parseAnnotationAnchorJson,
  type ReaderAnnotation,
  type ReaderTextSelection,
} from "@aurascholar/reader";
import { newId } from "@aurascholar/db/ids";
import { AnnotationsRepo, type AnnotationRow } from "@aurascholar/db/repos/annotations";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { Badge, Button } from "@aurascholar/ui";
import "@aurascholar/reader/reader.css";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { writeClipboardText } from "../clipboard";
import { useConfirmDialog, type ConfirmFunction } from "../components/ConfirmDialog";
import { downloadBlob } from "../download";
import { getDb } from "../services/aura-db";
import { fulltextLandingUrl } from "../services/fulltext";
import { isDesktopRuntime } from "../services/aura-platform";
import { loadPdfForWork } from "../services/library-read";
import { describeSafeError } from "../services/sensitive-text";
import { resolveTranslator, loadTranslateConfig } from "../services/translate";
import { langLabel, splitForTranslation, type TranslateConfig } from "@aurascholar/translate";
import { addSnippet } from "../services/snippets";

const CitationGraphView = lazy(() =>
  import("../components/CitationGraphView").then((mod) => ({ default: mod.CitationGraphView })),
);

configureWorker(workerSrc);

type PageFilter = "none" | "sepia" | "invert";
type PanelTab = "annotations" | "translate" | "graph";
type TranslationMode = "selection" | "split" | "inline";
const PANEL_TABS = new Set<PanelTab>(["annotations", "translate", "graph"]);

interface ReaderSmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_READER_FAIL_NEXT_OPEN__?: string;
  __AURASCHOLAR_SMOKE_READER_FAIL_NEXT_COMMENT_SAVE__?: string;
  __AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_CREATE__?: string;
  __AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_DELETE__?: string;
  __AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_RESTORE__?: string;
  __AURASCHOLAR_SMOKE_READER_FAIL_NEXT_SNIPPET_SAVE__?: string;
}

function normalizePanelTab(value: string | null): PanelTab | null {
  return value && PANEL_TABS.has(value as PanelTab) ? (value as PanelTab) : null;
}

const AI_CONFIGURATION_ERROR_RE = /配置 AI 服务|配置.*AI/;
const TRANSLATION_CONFIGURATION_ERROR_RE = /填写 DeepL|填写百度翻译|配置.*翻译/;

function isAiConfigurationError(message: string | null): boolean {
  return Boolean(message && AI_CONFIGURATION_ERROR_RE.test(message));
}

function translationSettingsCta(message: string | null): { label: string; path: string } | null {
  if (isAiConfigurationError(message)) {
    return { label: "去配置 AI", path: "/settings?section=ai" };
  }
  if (message && TRANSLATION_CONFIGURATION_ERROR_RE.test(message)) {
    return { label: "去配置翻译", path: "/settings?section=translate" };
  }
  return null;
}

const PAGE_FILTERS: Array<{ value: PageFilter; label: string; title: string }> = [
  { value: "none", label: "原色", title: "保持 PDF 原始色彩" },
  { value: "sepia", label: "护眼", title: "降低长时间阅读的视觉刺激" },
  { value: "invert", label: "反色", title: "适合夜间阅读扫描清晰的页面" },
];

function ReaderPageThumbnail({ doc, pageIndex }: { doc: PdfDocument; pageIndex: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!("IntersectionObserver" in window)) {
      setShouldRender(true);
      return;
    }
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
    void doc.getPage(pageIndex).then((page) => {
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

function ReaderPageNavigator({
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
  const annotationCounts = useMemo(() => {
    const counts = new Map<number, number>();
    annotations.forEach((annotation) => {
      counts.set(annotation.pageIndex, (counts.get(annotation.pageIndex) ?? 0) + 1);
    });
    return counts;
  }, [annotations]);

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

const MIN_READER_WRITE_BUSY_MS = 250;

const READER_PREVIEW_WORKS: Record<string, MissingWorkContext> = {
  "preview-attention": {
    id: "preview-attention",
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
    year: 2017,
    doi: "10.48550/arXiv.1706.03762",
    arxivId: "1706.03762",
  },
  "preview-alphafold": {
    id: "preview-alphafold",
    title: "Highly accurate protein structure prediction with AlphaFold",
    authors: ["John Jumper", "Richard Evans", "Alexander Pritzel"],
    year: 2021,
    doi: "10.1038/s41586-021-03819-2",
  },
  "preview-sam": {
    id: "preview-sam",
    title: "Segment Anything",
    authors: ["Alexander Kirillov", "Eric Mintun", "Nikhila Ravi"],
    year: 2023,
    arxivId: "2304.02643",
  },
  "preview-scaling-laws": {
    id: "preview-scaling-laws",
    title: "Scaling Laws for Neural Language Models",
    authors: ["Jared Kaplan", "Sam McCandlish", "Tom Henighan"],
    year: 2020,
    arxivId: "2001.08361",
  },
  "preview-library:preview-discovery-human-centered-ai": {
    id: "preview-library:preview-discovery-human-centered-ai",
    title: "Human-Centered AI Systems for Research Workflows",
    authors: ["Zhiwei Lin", "Maya Chen", "Nora Patel"],
    year: 2024,
    doi: "10.1145/preview.hcai.2024",
  },
  "preview-library:preview-discovery-literature-sensemaking": {
    id: "preview-library:preview-discovery-literature-sensemaking",
    title: "Literature Sensemaking with Retrieval-Augmented Assistants",
    authors: ["Elena Rossi", "Jun Park"],
    year: 2024,
    doi: "10.48550/arXiv.2402.01234",
  },
  "preview-library:preview-discovery-evaluation": {
    id: "preview-library:preview-discovery-evaluation",
    title: "Evaluating AI Writing Support for Scholarly Knowledge Work",
    authors: ["Samira Haddad", "Leo Martins", "Zhiwei Lin"],
    year: 2023,
    doi: "10.1145/preview.eval.2023",
  },
};

function readerPreviewWorkContext(workId: string): MissingWorkContext {
  return (
    READER_PREVIEW_WORKS[workId] ?? {
      id: workId,
      title: "浏览器预览文献",
      authors: [],
    }
  );
}

async function waitForMinimumElapsed(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

function consumeReaderSmokeOpenFailure(): Error | null {
  const smokeWindow = window as ReaderSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_OPEN__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_OPEN__;
  return new Error(message);
}

function consumeReaderSmokeCommentSaveFailure(): Error | null {
  const smokeWindow = window as ReaderSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_COMMENT_SAVE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_COMMENT_SAVE__;
  return new Error(message);
}

function consumeReaderSmokeAnnotationCreateFailure(): Error | null {
  const smokeWindow = window as ReaderSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_CREATE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_CREATE__;
  return new Error(message);
}

function consumeReaderSmokeAnnotationDeleteFailure(): Error | null {
  const smokeWindow = window as ReaderSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_DELETE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_DELETE__;
  return new Error(message);
}

function consumeReaderSmokeAnnotationRestoreFailure(): Error | null {
  const smokeWindow = window as ReaderSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_RESTORE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_RESTORE__;
  return new Error(message);
}

function consumeReaderSmokeSnippetSaveFailure(): Error | null {
  const smokeWindow = window as ReaderSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_SNIPPET_SAVE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_SNIPPET_SAVE__;
  return new Error(message);
}

interface OpenContext {
  doc: PdfDocument;
  fileName: string;
  workId?: string;
  attachmentId?: string;
  workTitle?: string;
  workAuthors?: string[];
  workYear?: number;
  workDoi?: string;
}

interface MissingWorkContext {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
}

interface LibraryPdfContext {
  annotations: ReaderAnnotation[];
  archivedWork: MissingWorkContext | null;
  archivedWorkId: string | null;
  allowRetry: boolean;
  ctx: OpenContext | null;
  error?: string;
  missingWork: MissingWorkContext | null;
}

interface AnnotationDeleteUndoState {
  annotation: ReaderAnnotation;
  index: number;
  message: string;
}

function rowToAnnotation(row: AnnotationRow): ReaderAnnotation {
  const parsedAnchor = parseAnnotationAnchorJson(row.anchor_json, row.page_index);
  return {
    id: row.id,
    type: row.type as ReaderAnnotation["type"],
    color: row.color ?? "#ffd866",
    pageIndex: row.page_index,
    anchor: parsedAnchor.anchor,
    contentMd: row.content_md ?? undefined,
    orphaned: row.orphaned === 1 || parsedAnchor.recovered,
  };
}

function workToMissingContext(
  workId: string,
  work: Awaited<ReturnType<WorksRepo["get"]>>,
): MissingWorkContext {
  return {
    id: workId,
    title: work?.title ?? "未找到题录",
    authors: work?.authorNames ?? [],
    year: work?.year ?? undefined,
    doi: work?.doi ?? undefined,
    arxivId: work?.arxiv_id ?? undefined,
  };
}

function fullTextLanding(work: MissingWorkContext): string {
  return fulltextLandingUrl(work);
}

async function loadLibraryPdfContext(
  workId: string,
  preferredAttachmentId?: string,
): Promise<LibraryPdfContext> {
  const db = await getDb();
  const work = await new WorksRepo(db).get(workId);
  if (work?.deleted_at != null) {
    return {
      annotations: [],
      archivedWork: workToMissingContext(workId, work),
      archivedWorkId: workId,
      allowRetry: false,
      ctx: null,
      error: "这篇文献已在回收站。请先在文献库恢复后再阅读、补 PDF 或编辑批注。",
      missingWork: null,
    };
  }
  let pdf: Awaited<ReturnType<typeof loadPdfForWork>>;
  try {
    pdf = await loadPdfForWork(workId, preferredAttachmentId);
  } catch (error) {
    return {
      annotations: [],
      archivedWork: null,
      archivedWorkId: null,
      allowRetry: true,
      ctx: null,
      error: "已找到 PDF 附件记录，但本地文件无法读取。可以重新选择 PDF 修复这篇文献。",
      missingWork: workToMissingContext(workId, work),
    };
  }
  if (!pdf) {
    return {
      annotations: [],
      archivedWork: null,
      archivedWorkId: null,
      allowRetry: false,
      ctx: null,
      error: "这篇文献还没有 PDF 附件。可以上传本地文件，或去检索全文后自动挂回这篇文献。",
      missingWork: workToMissingContext(workId, work),
    };
  }

  let doc: PdfDocument;
  try {
    doc = await PdfDocument.load(pdf.data);
  } catch {
    return {
      annotations: [],
      archivedWork: null,
      archivedWorkId: null,
      allowRetry: true,
      ctx: null,
      error: "PDF 附件文件无法解析。可以重新选择 PDF 修复这篇文献。",
      missingWork: workToMissingContext(workId, work),
    };
  }
  try {
    const rows = await new AnnotationsRepo(db).listForAttachment(pdf.attachmentId);
    return {
      annotations: rows.map(rowToAnnotation),
      archivedWork: null,
      archivedWorkId: null,
      allowRetry: false,
      ctx: {
        doc,
        fileName: work?.title ?? "文献库文档",
        workId,
        attachmentId: pdf.attachmentId,
        workTitle: work?.title,
        workAuthors: work?.authorNames,
        workYear: work?.year ?? undefined,
        workDoi: work?.doi ?? undefined,
      },
      error: undefined,
      missingWork: null,
    };
  } catch (error) {
    doc.destroy();
    throw error;
  }
}

export function ReaderPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const workIdParam = params.get("work");
  const rawTabParam = params.get("tab");
  const annotationIdParam = params.get("annotation");
  const attachmentIdParam = params.get("attachment")?.trim() || undefined;
  const pageParam = params.get("page");
  const tabParam = normalizePanelTab(rawTabParam);
  const [ctx, setCtx] = useState<OpenContext | null>(null);
  const [missingWork, setMissingWork] = useState<MissingWorkContext | null>(null);
  const [archivedWork, setArchivedWork] = useState<MissingWorkContext | null>(null);
  const [archivedWorkId, setArchivedWorkId] = useState<string | null>(null);
  const [allowRetryOpen, setAllowRetryOpen] = useState(false);
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([]);
  const [pageFilter, setPageFilter] = useState<PageFilter>("none");
  const [readerLoading, setReaderLoading] = useState(false);
  const [readerReloadSeq, setReaderReloadSeq] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [jumpPage, setJumpPage] = useState<number | null>(null);
  const [tab, setTab] = useState<PanelTab>(tabParam ?? "annotations");
  const [panelOpen, setPanelOpen] = useState(true);
  const [translationMode, setTranslationMode] = useState<TranslationMode>("selection");
  const [translatedPages, setTranslatedPages] = useState<TranslatedPages>({});
  const [currentReaderPage, setCurrentReaderPage] = useState(0);
  const [translationJumpPage, setTranslationJumpPage] = useState<number | null>(null);
  const [selectionTranslation, setSelectionTranslation] = useState<{
    selection: ReaderTextSelection;
    seq: number;
  } | null>(null);
  const [snippetToast, setSnippetToast] = useState<string | null>(null);
  const [graphMounted, setGraphMounted] = useState(tabParam === "graph");
  const [commentDraftDirty, setCommentDraftDirty] = useState(false);
  const [fileActionBusy, setFileActionBusy] = useState(false);
  const [deletingAnnotationId, setDeletingAnnotationId] = useState<string | null>(null);
  const [annotationDeleteUndo, setAnnotationDeleteUndo] =
    useState<AnnotationDeleteUndoState | null>(null);
  const [annotationDeleteUndoBusy, setAnnotationDeleteUndoBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savingSnippetRef = useRef(false);
  const deletingAnnotationIdRef = useRef<string | null>(null);
  const tabWorkIdRef = useRef<string | null>(workIdParam);
  const appliedDeepLinkRef = useRef<string | null>(null);
  const canShowGraphTab = Boolean(ctx?.workDoi);

  useEffect(() => {
    if (!snippetToast) return;
    if (annotationDeleteUndoBusy || /正在/.test(snippetToast)) return;
    const isUndoNotice = Boolean(
      annotationDeleteUndo &&
      (snippetToast === annotationDeleteUndo.message ||
        snippetToast.startsWith("撤销删除批注失败")),
    );
    const t = window.setTimeout(
      () => {
        setSnippetToast(null);
        if (isUndoNotice) setAnnotationDeleteUndo(null);
      },
      isUndoNotice ? 6500 : 2800,
    );
    return () => window.clearTimeout(t);
  }, [annotationDeleteUndo, annotationDeleteUndoBusy, snippetToast]);

  useEffect(() => {
    const resetId = window.setTimeout(() => {
      setAnnotationDeleteUndo(null);
    }, 0);
    return () => window.clearTimeout(resetId);
  }, [ctx?.attachmentId, ctx?.workId]);

  useEffect(() => () => ctx?.doc.destroy(), [ctx]);

  useEffect(() => {
    if (tab !== "graph") return;
    const mountId = window.setTimeout(() => {
      setGraphMounted(true);
    }, 0);
    return () => window.clearTimeout(mountId);
  }, [tab]);

  useEffect(() => {
    const syncId = window.setTimeout(() => {
      const workChanged = tabWorkIdRef.current !== workIdParam;
      tabWorkIdRef.current = workIdParam;
      setTab(tabParam ?? "annotations");
      if (workChanged) setGraphMounted(tabParam === "graph");
      if (tabParam) setPanelOpen(true);
    }, 0);
    return () => window.clearTimeout(syncId);
  }, [rawTabParam, tabParam, workIdParam]);

  useEffect(() => {
    if (!ctx) return;
    if (tab !== "graph" || canShowGraphTab) return;
    const fallbackId = window.setTimeout(() => {
      setTab("annotations");
    }, 0);
    return () => window.clearTimeout(fallbackId);
  }, [canShowGraphTab, ctx, tab]);

  useEffect(() => {
    if (!ctx) return;
    const key = `${ctx.workId ?? "local"}:${annotationIdParam ?? ""}:${pageParam ?? ""}`;
    if (appliedDeepLinkRef.current === key) return;
    const targetAnnotation = annotationIdParam
      ? annotations.find((annotation) => annotation.id === annotationIdParam)
      : undefined;
    const requestedPage = pageParam ? Number(pageParam) - 1 : Number.NaN;
    const pageIndex =
      targetAnnotation?.pageIndex ??
      (Number.isInteger(requestedPage) && requestedPage >= 0 ? requestedPage : null);
    if (pageIndex === null) return;
    appliedDeepLinkRef.current = key;
    const applyId = window.setTimeout(() => {
      setJumpPage(pageIndex);
      setCurrentReaderPage(pageIndex);
      if (targetAnnotation) {
        setActiveId(targetAnnotation.id);
        setTab("annotations");
        setPanelOpen(true);
      }
    }, 0);
    return () => window.clearTimeout(applyId);
  }, [annotationIdParam, annotations, ctx, pageParam]);

  useEffect(() => {
    if (!commentDraftDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [commentDraftDirty]);

  useEffect(() => {
    if (!workIdParam) {
      const resetId = window.setTimeout(() => {
        setReaderLoading(false);
        setLoadError(null);
        setMissingWork(null);
        setArchivedWork(null);
        setArchivedWorkId(null);
        setAllowRetryOpen(false);
        setCtx(null);
        setAnnotations([]);
        setActiveId(null);
      }, 0);
      return () => window.clearTimeout(resetId);
    }
    let cancelled = false;
    void (async () => {
      setReaderLoading(true);
      setLoadError(null);
      setMissingWork(null);
      setArchivedWork(null);
      setArchivedWorkId(null);
      setAllowRetryOpen(false);
      setCtx(null);
      setAnnotations([]);
      setActiveId(null);
      if (!isDesktopRuntime()) {
        setMissingWork(readerPreviewWorkContext(workIdParam));
        return;
      }
      const smokeFailure = consumeReaderSmokeOpenFailure();
      if (smokeFailure) throw smokeFailure;
      const next = await loadLibraryPdfContext(workIdParam, attachmentIdParam);
      if (cancelled) {
        next.ctx?.doc.destroy();
        return;
      }
      if (!next.ctx) {
        setMissingWork(next.missingWork);
        setArchivedWork(next.archivedWork);
        setArchivedWorkId(next.archivedWorkId);
        setAllowRetryOpen(next.allowRetry);
        setLoadError(next.error ?? "这篇文献暂时无法打开 PDF。");
        return;
      }
      let readingStatusError: string | null = null;
      try {
        const db = await getDb();
        const changed = await new WorksRepo(db).markReadingStarted(workIdParam);
        if (changed) window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (error) {
        readingStatusError = describeSafeError(error);
      }
      if (cancelled) {
        next.ctx.doc.destroy();
        return;
      }
      setAnnotations(next.annotations);
      setMissingWork(null);
      setArchivedWork(null);
      setArchivedWorkId(null);
      setAllowRetryOpen(false);
      setCtx(next.ctx);
      if (readingStatusError) {
        setSnippetToast(
          `文献已打开，但阅读状态未自动更新，可在文献库中手动设置:${readingStatusError}`,
        );
      }
    })()
      .catch((e) => {
        if (!cancelled) {
          setMissingWork(null);
          setArchivedWork(null);
          setArchivedWorkId(null);
          setAllowRetryOpen(Boolean(workIdParam));
          setLoadError(describeSafeError(e));
        }
      })
      .finally(() => {
        if (!cancelled) setReaderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentIdParam, readerReloadSeq, workIdParam]);

  const retryOpenWork = useCallback(() => {
    if (!workIdParam || readerLoading) return;
    setReaderReloadSeq((value) => value + 1);
  }, [readerLoading, workIdParam]);

  const handleFindFulltext = useCallback(() => {
    if (!missingWork) return;
    const params = new URLSearchParams({
      pendingWorkId: missingWork.id,
      pendingTitle: missingWork.title,
      url: fullTextLanding(missingWork),
    });
    navigate(`/discovery?${params.toString()}`);
  }, [missingWork, navigate]);

  const handleTranslate = useCallback((selection: ReaderTextSelection) => {
    setSelectionTranslation((current) => ({
      selection,
      seq: (current?.seq ?? 0) + 1,
    }));
  }, []);

  const handleTranslatedDocumentPageChange = useCallback((pageIndex: number) => {
    setCurrentReaderPage(pageIndex);
    setTranslationJumpPage(pageIndex);
    window.setTimeout(() => {
      setTranslationJumpPage((current) => (current === pageIndex ? null : current));
    }, 120);
  }, []);

  const handlePageNavigate = useCallback((pageIndex: number) => {
    setCurrentReaderPage(pageIndex);
    setJumpPage(pageIndex);
    window.setTimeout(() => {
      setJumpPage((current) => (current === pageIndex ? null : current));
    }, 160);
  }, []);

  useEffect(() => {
    setTranslatedPages({});
    setCurrentReaderPage(0);
    setTranslationJumpPage(null);
    setSelectionTranslation(null);
  }, [ctx?.attachmentId, ctx?.fileName]);

  // Selecting text + tapping ✦ saves a writing snippet (only when the doc is a
  // library work — a bare local file has no work to attach it to).
  const handleSaveSnippet = useCallback(
    async (text: string, pageIndex: number): Promise<boolean> => {
      if (savingSnippetRef.current) return false;
      savingSnippetRef.current = true;
      const startedAt = Date.now();
      let message = "请先入库，素材会关联到对应文献";
      let saved = false;
      try {
        if (ctx?.workId) {
          setSnippetToast("正在保存为写作素材...");
          const smokeFailure = consumeReaderSmokeSnippetSaveFailure();
          if (smokeFailure) throw smokeFailure;
          await addSnippet({ workId: ctx.workId, pageIndex, quote: text });
          message = "已存为写作素材";
          saved = true;
        }
      } catch (e) {
        message = `保存写作素材失败，选中文本仍保留，可重新保存:${describeSafeError(e)}`;
        saved = false;
      } finally {
        await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
        setSnippetToast(message);
        savingSnippetRef.current = false;
      }
      return saved;
    },
    [ctx],
  );

  const openFile = useCallback(
    async (file: File) => {
      if (fileActionBusy) return;
      const startedAt = Date.now();
      setFileActionBusy(true);
      try {
        setLoadError(null);
        const data = new Uint8Array(await file.arrayBuffer());
        if (missingWork && isDesktopRuntime()) {
          const { attachPdfToWork } = await import("../services/library");
          const result = await attachPdfToWork(missingWork.id, file.name, data);
          const next = await loadLibraryPdfContext(missingWork.id);
          if (!next.ctx) {
            throw new Error("PDF 已写入，但未能重新读取附件");
          }
          await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
          setAnnotations(next.annotations);
          setMissingWork(null);
          setCtx(next.ctx);
          const annotationMessage =
            result.restoredAnnotationCount > 0
              ? `，已恢复 ${result.restoredAnnotationCount} 条备份批注`
              : "";
          setSnippetToast(
            result.deduped
              ? `这份 PDF 已经附加在《${missingWork.title}》上${annotationMessage}`
              : `已为《${missingWork.title}》补上 PDF(${result.pageCount} 页)${annotationMessage}`,
          );
          window.dispatchEvent(new Event("aurascholar:library-updated"));
          return;
        }
        const loaded = await PdfDocument.load(data);
        await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
        setAnnotations([]);
        setMissingWork(null);
        setCtx({ doc: loaded, fileName: file.name });
        setSnippetToast("已打开本地 PDF。未入库文件的批注只保存在本次会话。");
      } catch (e) {
        setLoadError(`打开 PDF 失败:${describeSafeError(e)}`);
      } finally {
        setFileActionBusy(false);
      }
    },
    [fileActionBusy, missingWork],
  );

  const handleCreate = useCallback(
    async (a: Omit<ReaderAnnotation, "id">): Promise<boolean> => {
      setAnnotationDeleteUndo(null);
      if (ctx?.workId && ctx.attachmentId) {
        const startedAt = Date.now();
        setSnippetToast("正在保存批注...");
        try {
          const smokeFailure = consumeReaderSmokeAnnotationCreateFailure();
          if (smokeFailure) throw smokeFailure;
          const db = await getDb();
          const id = await new AnnotationsRepo(db).create({
            attachmentId: ctx.attachmentId,
            workId: ctx.workId,
            type: a.type,
            color: a.color,
            pageIndex: a.pageIndex,
            anchor: a.anchor,
            contentMd: a.contentMd,
          });
          await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
          setAnnotations((prev) => [...prev, { ...a, id }]);
          setSnippetToast("批注已保存");
          return true;
        } catch (e) {
          await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
          setSnippetToast(`保存批注失败，选区仍保留，可重新保存:${describeSafeError(e)}`);
          return false;
        }
      }
      setAnnotations((prev) => [...prev, { ...a, id: newId() }]);
      setSnippetToast("批注已加入本次会话");
      return true;
    },
    [ctx],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (deletingAnnotationIdRef.current || annotationDeleteUndoBusy) return;
      const targetIndex = annotations.findIndex((annotation) => annotation.id === id);
      const target = annotations[targetIndex];
      if (!target) {
        setSnippetToast("没有找到要删除的批注。");
        return;
      }
      const confirmed = await confirm({
        title: "删除这条批注？",
        description: target.anchor.quote?.exact
          ? `将删除第 ${target.pageIndex + 1} 页的批注：“${target.anchor.quote.exact.slice(0, 80)}”`
          : `将删除第 ${target.pageIndex + 1} 页的批注。`,
        details: [
          "删除后不会影响原始 PDF 或写作素材。",
          ctx?.workId ? "已入库批注会从文献库中移除。" : "本地 PDF 会话中的批注会立即移除。",
        ],
        confirmLabel: "删除批注",
        tone: "warning",
      });
      if (!confirmed) return;
      const startedAt = Date.now();
      deletingAnnotationIdRef.current = id;
      setDeletingAnnotationId(id);
      setSnippetToast("正在删除批注...");
      try {
        const smokeFailure = consumeReaderSmokeAnnotationDeleteFailure();
        if (smokeFailure) {
          await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
          throw smokeFailure;
        }
        if (ctx?.workId) {
          const db = await getDb();
          await new AnnotationsRepo(db).softDelete(id);
        }
        await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
        setAnnotationDeleteUndo({ annotation: target, index: targetIndex, message: "已删除批注" });
        setAnnotations((prev) => prev.filter((x) => x.id !== id));
        setSnippetToast("已删除批注");
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
        setSnippetToast(`删除批注失败，批注仍保留，可重新删除:${describeSafeError(e)}`);
      } finally {
        deletingAnnotationIdRef.current = null;
        setDeletingAnnotationId(null);
      }
    },
    [annotationDeleteUndoBusy, annotations, confirm, ctx],
  );

  const undoAnnotationDelete = useCallback(async () => {
    if (!annotationDeleteUndo || annotationDeleteUndoBusy) return;
    const { annotation, index } = annotationDeleteUndo;
    const startedAt = Date.now();
    setAnnotationDeleteUndoBusy(true);
    setSnippetToast("正在撤销删除批注...");
    try {
      const smokeFailure = consumeReaderSmokeAnnotationRestoreFailure();
      if (smokeFailure) {
        await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
        throw smokeFailure;
      }
      if (ctx?.workId) {
        const db = await getDb();
        await new AnnotationsRepo(db).restore(annotation.id);
      }
      setAnnotations((prev) => {
        if (prev.some((item) => item.id === annotation.id)) return prev;
        const next = [...prev];
        next.splice(Math.min(Math.max(index, 0), next.length), 0, annotation);
        return next;
      });
      setActiveId(annotation.id);
      setTab("annotations");
      await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
      setAnnotationDeleteUndo(null);
      setSnippetToast("已撤销删除批注");
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
      setSnippetToast(`撤销删除批注失败，撤销入口仍保留，可重新撤销:${describeSafeError(e)}`);
    } finally {
      setAnnotationDeleteUndoBusy(false);
    }
  }, [annotationDeleteUndo, annotationDeleteUndoBusy, ctx]);

  const confirmDiscardCommentDraft = useCallback(
    (annotation: ReaderAnnotation) =>
      confirm({
        cancelLabel: "继续编辑",
        confirmLabel: "放弃草稿",
        description: "这条批注评论有未保存修改。放弃后，当前草稿不会写入文献库。",
        details: [
          `第 ${annotation.pageIndex + 1} 页`,
          annotation.anchor.quote?.exact
            ? `原文：“${annotation.anchor.quote.exact.slice(0, 80)}”`
            : "这不会影响 PDF 原文或已有批注高亮。",
        ],
        eyebrow: "未保存",
        title: "放弃批注评论草稿？",
        tone: "warning",
      }),
    [confirm],
  );

  const handleSaveComment = useCallback(
    async (id: string, contentMd: string) => {
      const previous = annotations;
      setAnnotations((prev) => prev.map((x) => (x.id === id ? { ...x, contentMd } : x)));
      try {
        if (ctx?.workId) {
          const smokeFailure = consumeReaderSmokeCommentSaveFailure();
          if (smokeFailure) throw smokeFailure;
          const db = await getDb();
          await new AnnotationsRepo(db).updateContent(id, contentMd);
        }
        setSnippetToast("批注评论已保存");
        return true;
      } catch (e) {
        setAnnotations(previous);
        setSnippetToast(`保存评论失败，草稿仍保留，可重新保存:${describeSafeError(e)}`);
        return false;
      }
    },
    [annotations, ctx],
  );

  const handleExport = useCallback(() => {
    if (!ctx) return;
    if (commentDraftDirty) {
      setSnippetToast("请先保存批注评论草稿，再导出笔记。");
      return;
    }
    const md = annotationsToMarkdown(
      {
        title: ctx.workTitle ?? ctx.fileName,
        authors: ctx.workAuthors,
        year: ctx.workYear,
        doi: ctx.workDoi,
      },
      annotations,
    );
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    downloadBlob(blob, `${(ctx.workTitle ?? ctx.fileName).slice(0, 60)}-笔记.md`);
    setSnippetToast(`已导出 ${annotations.length} 条批注`);
  }, [annotations, commentDraftDirty, ctx]);

  if (!ctx) {
    return (
      <ReaderEmptyState
        loading={readerLoading}
        loadError={loadError}
        archivedWork={archivedWork}
        archivedWorkId={archivedWorkId}
        missingWork={missingWork}
        fileInputRef={fileInputRef}
        fileActionBusy={fileActionBusy}
        onOpenFile={openFile}
        onBackToLibrary={() => {
          if (archivedWorkId) {
            navigate(`/library?work=${encodeURIComponent(archivedWorkId)}&filter=trash`);
            return;
          }
          navigate(
            missingWork ? `/library?work=${encodeURIComponent(missingWork.id)}` : "/library",
          );
        }}
        onFindFulltext={missingWork ? handleFindFulltext : undefined}
        onRetryOpen={workIdParam && loadError && allowRetryOpen ? retryOpenWork : undefined}
      />
    );
  }

  const tabs: Array<{ key: PanelTab; label: string; disabled?: boolean; title?: string }> = [
    { key: "annotations", label: `批注 ${annotations.length}` },
    { key: "translate", label: "翻译" },
    {
      key: "graph",
      label: "脉络",
      disabled: !ctx.workDoi,
      title: ctx.workDoi ? undefined : "无 DOI,无法构建图谱",
    },
  ];
  const renderSourceReader = () => (
    <PdfReader
      doc={ctx.doc}
      annotations={annotations}
      onCreateAnnotation={handleCreate}
      onAnnotationClick={(id) => {
        setActiveId(id);
        setTab("annotations");
        setPanelOpen(true);
      }}
      onTranslate={handleTranslate}
      onSaveSnippet={handleSaveSnippet}
      pageFilter={pageFilter}
      scrollToPage={jumpPage ?? translationJumpPage}
      onVisiblePageChange={setCurrentReaderPage}
    />
  );

  return (
    <div className="reader-workspace">
      {snippetToast && (
        <div
          className="reader-toast"
          role="status"
          aria-live="polite"
          aria-busy={annotationDeleteUndoBusy ? "true" : undefined}
        >
          <span className="reader-toast__text">{snippetToast}</span>
          {annotationDeleteUndo &&
          (snippetToast === annotationDeleteUndo.message ||
            annotationDeleteUndoBusy ||
            snippetToast.startsWith("撤销删除批注失败，撤销入口仍保留")) ? (
            <button
              type="button"
              className="reader-toast__action"
              onClick={() => void undoAnnotationDelete()}
              disabled={annotationDeleteUndoBusy}
              aria-busy={annotationDeleteUndoBusy ? "true" : undefined}
              aria-label="撤销删除批注"
            >
              {annotationDeleteUndoBusy ? "撤销中..." : "撤销"}
            </button>
          ) : null}
          <button
            type="button"
            className="reader-toast__close"
            aria-label="关闭提示"
            title="关闭提示"
            onClick={() => {
              setSnippetToast(null);
              setAnnotationDeleteUndo(null);
            }}
          >
            ×
          </button>
        </div>
      )}
      {confirmDialog}
      {commentDraftDirty && <ReaderCommentDraftNavigationGuard confirm={confirm} />}
      <div className="reader-topbar">
        <div className="reader-topbar__identity">
          <span className="reader-topbar__kicker">PDF Reader</span>
          <strong title={ctx.fileName}>{ctx.fileName}</strong>
        </div>
        <div className="reader-topbar__meta">
          <Badge variant={ctx.workId ? "success" : "warning"}>
            {ctx.workId ? "已入库" : "临时阅读"}
          </Badge>
          <span>{ctx.doc.pageCount} 页</span>
          <span>{annotations.length} 批注</span>
        </div>
        <div className="reader-topbar__actions">
          <div className="reader-filter-toggle" role="group" aria-label="页面显示模式">
            {PAGE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={pageFilter === filter.value ? "reader-filter-toggle__active" : ""}
                aria-label={`${filter.label}，${filter.title}${
                  pageFilter === filter.value ? "，当前显示模式" : ""
                }`}
                aria-pressed={pageFilter === filter.value}
                title={filter.title}
                onClick={() => setPageFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            style={{ fontSize: 13 }}
            onClick={handleExport}
            disabled={annotations.length === 0}
            title={commentDraftDirty ? "请先保存批注评论草稿" : undefined}
          >
            导出笔记
          </Button>
          {ctx.workId && (
            <Button
              variant="ghost"
              style={{ fontSize: 13 }}
              onClick={() => navigate(`/canvas?workId=${encodeURIComponent(ctx.workId!)}`)}
            >
              加入空间白板
            </Button>
          )}
          <Button variant="ghost" style={{ fontSize: 13 }} onClick={() => setPanelOpen((v) => !v)}>
            {panelOpen ? "收起面板" : "展开面板"}
          </Button>
          <Button variant="secondary" style={{ fontSize: 13 }} onClick={() => navigate("/library")}>
            返回文献库
          </Button>
        </div>
      </div>
      <div className={`reader-shell ${tab === "graph" ? "reader-shell--graph" : ""}`}>
        <ReaderPageNavigator
          annotations={annotations}
          currentPage={currentReaderPage}
          doc={ctx.doc}
          onSelect={handlePageNavigate}
        />
        <div className="reader-document-stage">
          {tab === "translate" && translationMode === "split" ? (
            <div className="reader-pdf-split" aria-label="原文与译文 PDF 对照">
              <section className="reader-pdf-pane reader-pdf-pane--source">
                <div className="reader-pdf-pane__head">
                  <strong>原文 PDF</strong>
                  <span>
                    {currentReaderPage + 1} / {ctx.doc.pageCount}
                  </span>
                </div>
                {renderSourceReader()}
              </section>
              <TranslatedDocumentPane
                currentPage={currentReaderPage}
                onVisiblePageChange={handleTranslatedDocumentPageChange}
                pageCount={ctx.doc.pageCount}
                pages={translatedPages}
              />
            </div>
          ) : tab === "translate" && translationMode === "inline" ? (
            <BilingualDocumentPane
              currentPage={currentReaderPage}
              onVisiblePageChange={handleTranslatedDocumentPageChange}
              pageCount={ctx.doc.pageCount}
              pages={translatedPages}
            />
          ) : (
            renderSourceReader()
          )}
        </div>
        {panelOpen && (
          <div
            className={`reader-research-panel ${
              tab === "translate"
                ? `reader-research-panel--translate reader-research-panel--translate-${translationMode}`
                : ""
            } ${tab === "graph" ? "reader-research-panel--graph" : ""}`}
          >
            <div className="reader-research-panel__head">
              <div>
                <span>研究面板</span>
                <p>
                  {ctx.workTitle
                    ? `${ctx.workAuthors?.slice(0, 2).join(", ") || "作者未标注"} · ${
                        ctx.workYear ?? "年份未标注"
                      }`
                    : "本地 PDF 会话"}
                </p>
              </div>
              <Badge variant="neutral">{annotations.length} 批注</Badge>
            </div>
            <div className="reader-tabs au-tablist" role="tablist" aria-label="研究面板">
              {tabs.map((t) => {
                const panelMounted =
                  t.key === "annotations" ||
                  t.key === "translate" ||
                  (t.key === "graph" && Boolean(ctx.workDoi && graphMounted));
                return (
                  <button
                    key={t.key}
                    id={`reader-tab-${t.key}`}
                    className={`au-tab ${tab === t.key ? "au-tab--active" : ""}`}
                    disabled={t.disabled}
                    role="tab"
                    aria-controls={panelMounted ? `reader-panel-${t.key}` : undefined}
                    aria-selected={tab === t.key}
                    title={t.title}
                    onClick={() => setTab(t.key)}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            {/* Panels stay mounted so switching tabs does not lose translation state or the graph. */}
            <div className="reader-research-panel__body">
              <div
                id="reader-panel-annotations"
                role="tabpanel"
                aria-labelledby="reader-tab-annotations"
                hidden={tab !== "annotations"}
                style={{ height: "100%", display: tab === "annotations" ? "block" : "none" }}
              >
                <AnnotationSidebar
                  annotations={annotations}
                  activeId={activeId}
                  onDiscardCommentDraft={confirmDiscardCommentDraft}
                  onDraftDirtyChange={setCommentDraftDirty}
                  onJump={(ann) => {
                    setActiveId(ann.id);
                    setJumpPage(ann.pageIndex);
                    setTimeout(() => setJumpPage(null), 100);
                  }}
                  onSaveComment={handleSaveComment}
                  onAddToCanvas={
                    ctx.workId
                      ? (annotation) => {
                          const nextParams = new URLSearchParams({
                            workId: ctx.workId!,
                            annotationId: annotation.id,
                          });
                          navigate(`/canvas?${nextParams.toString()}`);
                        }
                      : undefined
                  }
                  onDelete={handleDelete}
                  deletingId={deletingAnnotationId}
                />
              </div>
              <div
                id="reader-panel-translate"
                role="tabpanel"
                aria-labelledby="reader-tab-translate"
                hidden={tab !== "translate"}
                style={{ height: "100%", display: tab === "translate" ? "block" : "none" }}
              >
                <TranslatePanel
                  doc={ctx.doc}
                  mode={translationMode}
                  onModeChange={setTranslationMode}
                  currentPage={currentReaderPage}
                  pages={translatedPages}
                  onPagesChange={setTranslatedPages}
                />
              </div>
              {ctx.workDoi && graphMounted && (
                <div
                  id="reader-panel-graph"
                  role="tabpanel"
                  aria-labelledby="reader-tab-graph"
                  hidden={tab !== "graph"}
                  style={{ height: "100%", display: tab === "graph" ? "block" : "none" }}
                >
                  <Suspense fallback={<p className="au-text-muted">正在载入引用脉络...</p>}>
                    <CitationGraphView key={ctx.workDoi} doi={ctx.workDoi} height={520} />
                  </Suspense>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {selectionTranslation && (
        <SelectionTranslationPopover
          key={selectionTranslation.seq}
          selection={selectionTranslation.selection}
          onClose={() => setSelectionTranslation(null)}
        />
      )}
    </div>
  );
}

function ReaderCommentDraftNavigationGuard({ confirm }: { confirm: ConfirmFunction }) {
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

function ReaderEmptyState({
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
  archivedWork: MissingWorkContext | null;
  archivedWorkId: string | null;
  missingWork: MissingWorkContext | null;
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
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && !fileActionBusy) void onOpenFile(f);
                    e.target.value = "";
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

interface TranslatedSegment {
  source: string;
  result: string | null;
  error?: string;
}

type TranslatedPages = Record<number, TranslatedSegment[]>;

interface TranslationSmokeSegmentsEventDetail {
  engine?: string;
  pageIndex?: number;
  segments?: TranslatedSegment[];
}

type TranslateAction = "full" | "page";

async function pageParagraphsForTranslation(
  doc: PdfDocument,
  pageIndex: number,
): Promise<string[]> {
  const lines = await doc.getPageTextLines(pageIndex);
  const paragraphs: string[] = [];
  let buffer = "";
  const flush = () => {
    const paragraph = buffer.replace(/\s+/g, " ").trim();
    if (paragraph) paragraphs.push(...splitForTranslation(paragraph, 1200));
    buffer = "";
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) {
      flush();
      continue;
    }
    const headingLike =
      line.length <= 96 &&
      (/^(?:\d+(?:\.\d+)*\.?\s+|abstract\b|introduction\b|conclusion\b|references\b)/i.test(line) ||
        /^[A-Z][A-Za-z\s-]{2,48}$/.test(line));
    if (headingLike && buffer) flush();
    buffer = buffer ? `${buffer} ${line}` : line;
    if (headingLike || (buffer.length >= 90 && /[.!?。！？][”"')\]]?$/.test(line))) flush();
    else if (buffer.length >= 1200) flush();
  }
  flush();
  return paragraphs;
}

function selectionPopoverPosition(rect: ReaderTextSelection["clientRect"]): CSSProperties {
  const margin = 12;
  const width = Math.min(360, Math.max(260, window.innerWidth - margin * 2));
  const estimatedHeight = 230;
  const centeredLeft = rect.x + rect.width / 2 - width / 2;
  const left = Math.min(window.innerWidth - width - margin, Math.max(margin, centeredLeft));
  const below = rect.y + rect.height + 10;
  const top =
    below + estimatedHeight <= window.innerHeight
      ? below
      : Math.max(margin, rect.y - estimatedHeight - 10);
  return { left, top, width };
}

function SelectionTranslationPopover({
  selection,
  onClose,
}: {
  selection: ReaderTextSelection;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>(() =>
    selectionPopoverPosition(selection.clientRect),
  );
  const [result, setResult] = useState<string | null>(null);
  const [engine, setEngine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [config, setConfig] = useState<TranslateConfig>({ engine: "llm", targetLang: "zh" });

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError(null);
    setEngine(null);
    void (async () => {
      try {
        const nextConfig = await loadTranslateConfig();
        if (controller.signal.aborted) return;
        setConfig(nextConfig);
        const resolved = await resolveTranslator();
        if (controller.signal.aborted) return;
        if ("error" in resolved) {
          setError(resolved.error);
          return;
        }
        const translated = await resolved.translator.translate(
          { text: selection.text, targetLang: nextConfig.targetLang },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setResult(translated.text);
        setEngine(translated.engine);
      } catch (e) {
        if (!controller.signal.aborted) setError(describeSafeError(e));
      }
    })();
    return () => controller.abort();
  }, [selection.text]);

  useEffect(() => {
    const updatePosition = () => setPosition(selectionPopoverPosition(selection.clientRect));
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [selection.clientRect]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  useEffect(() => {
    if (!copyStatus) return;
    const timer = window.setTimeout(() => setCopyStatus(null), 2200);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const settingsCta = translationSettingsCta(error);

  return (
    <div
      ref={popoverRef}
      className="reader-selection-translation"
      style={position}
      role="dialog"
      aria-label="划词翻译"
      aria-busy={!result && !error}
    >
      <div className="reader-selection-translation__head">
        <div>
          <strong>划词翻译</strong>
          <span>
            {langLabel(config.targetLang)}
            {engine ? ` · ${engine}` : ""}
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭划词翻译" title="关闭">
          ×
        </button>
      </div>
      <p className="reader-selection-translation__source">{selection.text}</p>
      <div className="reader-selection-translation__result" aria-live="polite">
        {error ? (
          <span className="reader-selection-translation__error">{error}</span>
        ) : result ? (
          result
        ) : (
          <span className="reader-selection-translation__loading">翻译中...</span>
        )}
      </div>
      <div className="reader-selection-translation__actions">
        {copyStatus && <span role="status">{copyStatus}</span>}
        {settingsCta && (
          <button type="button" onClick={() => navigate(settingsCta.path)}>
            {settingsCta.label}
          </button>
        )}
        {result && (
          <button
            type="button"
            onClick={() =>
              void writeClipboardText(result)
                .then(() => setCopyStatus("已复制"))
                .catch((e) => setCopyStatus(`复制失败:${describeSafeError(e)}`))
            }
          >
            复制译文
          </button>
        )}
      </div>
    </div>
  );
}

interface TranslationDocumentPaneProps {
  currentPage: number;
  onVisiblePageChange: (pageIndex: number) => void;
  pageCount: number;
  pages: TranslatedPages;
}

function TranslatedDocumentPane(props: TranslationDocumentPaneProps) {
  return <TranslationDocumentPane {...props} mode="translated" />;
}

function BilingualDocumentPane(props: TranslationDocumentPaneProps) {
  return <TranslationDocumentPane {...props} mode="bilingual" />;
}

function TranslationDocumentPane({
  currentPage,
  mode,
  onVisiblePageChange,
  pageCount,
  pages,
}: TranslationDocumentPaneProps & { mode: "bilingual" | "translated" }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const reportedPageRef = useRef(currentPage);
  const [scale, setScale] = useState(1);
  const pageHeight = 980 * scale + 22;

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const targetTop = currentPage * pageHeight;
    if (Math.abs(scroller.scrollTop - targetTop) > pageHeight * 0.55) {
      scroller.scrollTo({ top: targetTop, behavior: "smooth" });
    }
  }, [currentPage, pageHeight]);

  const onScroll = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const focusedPage = Math.min(
      pageCount - 1,
      Math.max(0, Math.floor((scroller.scrollTop + scroller.clientHeight * 0.32) / pageHeight)),
    );
    if (focusedPage === reportedPageRef.current) return;
    reportedPageRef.current = focusedPage;
    onVisiblePageChange(focusedPage);
  }, [onVisiblePageChange, pageCount, pageHeight]);

  return (
    <section
      className={`reader-pdf-pane reader-translation-document reader-translation-document--${mode}`}
      aria-label={mode === "translated" ? "译文 PDF" : "文内对照 PDF"}
    >
      <div className="reader-pdf-pane__head">
        <strong>{mode === "translated" ? "译文 PDF" : "文内对照 PDF"}</strong>
        <div className="reader-translation-document__zoom" role="group" aria-label="译文缩放">
          <button
            type="button"
            onClick={() => setScale((value) => Math.max(0.72, value - 0.12))}
            aria-label="缩小译文"
            title="缩小"
          >
            −
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            type="button"
            onClick={() => setScale((value) => Math.min(1.6, value + 0.12))}
            aria-label="放大译文"
            title="放大"
          >
            +
          </button>
        </div>
        <span>
          {currentPage + 1} / {pageCount}
        </span>
      </div>
      <div ref={scrollRef} className="reader-translation-document__scroll" onScroll={onScroll}>
        <div className="reader-translation-document__stack">
          {Array.from({ length: pageCount }, (_, pageIndex) => {
            const segments = pages[pageIndex] ?? [];
            return (
              <article
                key={pageIndex}
                className="reader-translation-page"
                data-page-index={pageIndex}
                style={{
                  minHeight: `${Math.round(950 * scale)}px`,
                  width: `${Math.round(720 * scale)}px`,
                }}
              >
                <span className="reader-translation-page__number">{pageIndex + 1}</span>
                {segments.length === 0 ? (
                  <div className="reader-translation-page__empty">
                    第 {pageIndex + 1} 页尚无译文
                  </div>
                ) : mode === "translated" ? (
                  <div className="reader-translation-page__translated">
                    {segments.map((segment, index) => (
                      <p key={`${pageIndex}-${index}-${segment.source.slice(0, 18)}`}>
                        {segment.error ? (
                          <span className="reader-translation-page__error">{segment.error}</span>
                        ) : (
                          (segment.result ?? <span className="au-text-muted">待翻译</span>)
                        )}
                      </p>
                    ))}
                  </div>
                ) : (
                  <div className="reader-translation-page__bilingual">
                    {segments.map((segment, index) => (
                      <section key={`${pageIndex}-${index}-${segment.source.slice(0, 18)}`}>
                        <p className="reader-translation-page__source">{segment.source}</p>
                        <p className="reader-translation-page__result">
                          {segment.error ? (
                            <span className="reader-translation-page__error">{segment.error}</span>
                          ) : (
                            (segment.result ?? <span className="au-text-muted">待翻译</span>)
                          )}
                        </p>
                      </section>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function TranslatePanel({
  currentPage,
  doc,
  mode,
  onPagesChange,
  onModeChange,
  pages,
}: {
  currentPage: number;
  doc: PdfDocument;
  mode: TranslationMode;
  onPagesChange: Dispatch<SetStateAction<TranslatedPages>>;
  onModeChange: (mode: TranslationMode) => void;
  pages: TranslatedPages;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState("1");
  const [translateAction, setTranslateAction] = useState<TranslateAction | null>(null);
  const [copyStatus, setCopyStatus] = useState<{
    message: string;
    tone: "busy" | "danger" | "success";
  } | null>(null);
  const [copyingAll, setCopyingAll] = useState(false);
  const cancelRef = useRef<AbortController | null>(null);
  const copyingAllRef = useRef(false);
  const [config, setConfig] = useState<TranslateConfig>({ engine: "llm", targetLang: "zh" });
  useEffect(() => {
    void loadTranslateConfig().then(setConfig);
  }, []);

  useEffect(() => {
    const onSmokeSegments = (event: Event) => {
      const detail = (event as CustomEvent<TranslationSmokeSegmentsEventDetail>).detail;
      if (!Array.isArray(detail?.segments)) return;
      setBusy(false);
      setProgress(null);
      setError(null);
      setTranslateAction(null);
      setCopyStatus(null);
      setEngine(detail.engine ?? "smoke");
      const pageIndex = Math.min(doc.pageCount - 1, Math.max(0, detail.pageIndex ?? currentPage));
      onPagesChange((current) => ({
        ...current,
        [pageIndex]: detail.segments!.map((segment) => ({
          source: segment.source,
          result: segment.result,
          error: segment.error,
        })),
      }));
    };
    window.addEventListener("aurascholar:reader-translation-smoke-segments", onSmokeSegments);
    return () =>
      window.removeEventListener("aurascholar:reader-translation-smoke-segments", onSmokeSegments);
  }, [currentPage, doc.pageCount, onPagesChange]);

  useEffect(() => {
    if (mode === "selection" || pages[currentPage]) return;
    let cancelled = false;
    void pageParagraphsForTranslation(doc, currentPage).then((paragraphs) => {
      if (cancelled || paragraphs.length === 0) return;
      onPagesChange((current) =>
        current[currentPage]
          ? current
          : {
              ...current,
              [currentPage]: paragraphs.map((source) => ({
                source,
                result: null,
              })),
            },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [currentPage, doc, mode, onPagesChange, pages]);

  useEffect(() => {
    if (!busy) setPageInput(String(currentPage + 1));
  }, [busy, currentPage]);

  useEffect(() => {
    if (!copyStatus) return;
    if (copyStatus.tone === "busy") return;
    const timer = setTimeout(() => setCopyStatus(null), 3000);
    return () => clearTimeout(timer);
  }, [copyStatus]);

  const cancel = useCallback(() => {
    cancelRef.current?.abort();
    cancelRef.current = null;
    setBusy(false);
    setProgress(null);
    setTranslateAction(null);
  }, []);

  const translatePages = useCallback(
    async (pageIndexes: number[], action: TranslateAction) => {
      if (pageIndexes.length === 0) return;
      const startedAt = Date.now();
      cancelRef.current?.abort();
      const controller = new AbortController();
      cancelRef.current = controller;
      setError(null);
      setBusy(true);
      setTranslateAction(action);
      setEngine(null);
      const pageSources: Array<{ pageIndex: number; chunks: string[] }> = [];
      try {
        for (const pageIndex of pageIndexes) {
          if (controller.signal.aborted) return;
          const chunks = await pageParagraphsForTranslation(doc, pageIndex);
          if (chunks.length > 0) pageSources.push({ pageIndex, chunks });
        }
        const total = pageSources.reduce((sum, page) => sum + page.chunks.length, 0);
        if (total === 0) {
          setError("无法从所选页面提取文本(可能是扫描版)");
          return;
        }
        onPagesChange((current) => {
          const next = { ...current };
          for (const page of pageSources) {
            next[page.pageIndex] = page.chunks.map((source) => ({ source, result: null }));
          }
          return next;
        });
        setProgress({ done: 0, total });
        const resolved = await resolveTranslator();
        if (controller.signal.aborted) return;
        if ("error" in resolved) {
          setError(resolved.error);
          return;
        }
        let completed = 0;
        for (const page of pageSources) {
          for (let index = 0; index < page.chunks.length; index += 1) {
            if (controller.signal.aborted) return;
            try {
              const out = await resolved.translator.translate(
                { text: page.chunks[index]!, targetLang: config.targetLang },
                { signal: controller.signal },
              );
              if (controller.signal.aborted) return;
              setEngine(out.engine);
              onPagesChange((current) => ({
                ...current,
                [page.pageIndex]: (current[page.pageIndex] ?? []).map((segment, segmentIndex) =>
                  segmentIndex === index ? { ...segment, result: out.text } : segment,
                ),
              }));
            } catch (e) {
              if (controller.signal.aborted) return;
              onPagesChange((current) => ({
                ...current,
                [page.pageIndex]: (current[page.pageIndex] ?? []).map((segment, segmentIndex) =>
                  segmentIndex === index ? { ...segment, error: describeSafeError(e) } : segment,
                ),
              }));
            }
            completed += 1;
            setProgress({ done: completed, total });
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(describeSafeError(e));
        }
      } finally {
        if (cancelRef.current === controller) {
          await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
          cancelRef.current = null;
          setBusy(false);
          setProgress(null);
          setTranslateAction(null);
        }
      }
    },
    [config.targetLang, doc, onPagesChange],
  );

  const translatePage = useCallback(async () => {
    const pageNum = Number(pageInput);
    if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > doc.pageCount) {
      setError(`请输入 1–${doc.pageCount} 之间的页码`);
      return;
    }
    await translatePages([pageNum - 1], "page");
  }, [pageInput, doc.pageCount, translatePages]);

  const translateFullText = useCallback(async () => {
    await translatePages(
      Array.from({ length: doc.pageCount }, (_, pageIndex) => pageIndex),
      "full",
    );
  }, [doc.pageCount, translatePages]);

  const copyAll = useCallback(async () => {
    if (copyingAllRef.current) return;
    const translated = Object.entries(pages)
      .sort(([a], [b]) => Number(a) - Number(b))
      .flatMap(([, segments]) => segments)
      .map((segment) => segment.result?.trim())
      .filter((text): text is string => Boolean(text));
    if (translated.length === 0) {
      setCopyStatus({ message: "还没有可复制的译文", tone: "danger" });
      return;
    }
    const startedAt = Date.now();
    copyingAllRef.current = true;
    setCopyingAll(true);
    setCopyStatus({ message: `正在复制 ${translated.length} 段译文...`, tone: "busy" });
    try {
      await writeClipboardText(translated.join("\n\n"));
      await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
      setCopyStatus({ message: `已复制 ${translated.length} 段译文`, tone: "success" });
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
      setCopyStatus({
        message: `复制失败:${describeSafeError(e)}`,
        tone: "danger",
      });
    } finally {
      copyingAllRef.current = false;
      setCopyingAll(false);
    }
  }, [pages]);

  const pageTranslating = translateAction === "page";
  const fullTextTranslating = translateAction === "full";
  const settingsCta = translationSettingsCta(error);
  const preparedPageCount = Object.keys(pages).length;
  const translatedSegmentCount = Object.values(pages)
    .flat()
    .filter((segment) => Boolean(segment.result)).length;

  return (
    <div
      className={`reader-translate-panel reader-translate-panel--${mode}`}
      aria-busy={busy || undefined}
    >
      <div className="reader-translate-modebar" role="group" aria-label="翻译模式">
        {(
          [
            ["selection", "划词翻译"],
            ["split", "双栏对照"],
            ["inline", "文内对照"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={mode === value ? "reader-translate-modebar__active" : ""}
            aria-pressed={mode === value}
            onClick={() => onModeChange(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="reader-translate-controls">
        {mode !== "selection" ? (
          <div className="reader-translate-controls__row">
            <span className="reader-translate-controls__label">页码</span>
            <input
              type="number"
              className="au-input reader-translate-pageinput"
              min={1}
              max={doc.pageCount}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              disabled={busy}
            />
            <span className="reader-translate-pagecount">/ {doc.pageCount}</span>
            <Button
              variant="secondary"
              onClick={() => void translatePage()}
              disabled={busy}
              aria-busy={pageTranslating || undefined}
            >
              {pageTranslating ? "翻译中..." : "翻译该页"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void translateFullText()}
              disabled={busy}
              aria-busy={fullTextTranslating || undefined}
            >
              {fullTextTranslating ? "翻译中..." : "翻译全文"}
            </Button>
          </div>
        ) : null}
        <div className="reader-translate-controls__row reader-translate-controls__row--meta">
          <span>
            {langLabel(config.targetLang)} · {config.engine === "llm" ? "大模型" : config.engine}
            {engine ? ` · ${engine}` : ""}
          </span>
          {busy && (
            <Button variant="ghost" onClick={cancel}>
              取消
            </Button>
          )}
          {translatedSegmentCount > 0 && !busy && (
            <Button
              variant="ghost"
              onClick={() => void copyAll()}
              disabled={copyingAll}
              aria-busy={copyingAll || undefined}
            >
              {copyingAll ? "复制中..." : "复制译文"}
            </Button>
          )}
        </div>
        {copyStatus && (
          <p
            className={`reader-translate-copy-status reader-translate-copy-status--${copyStatus.tone}`}
            role="status"
          >
            {copyStatus.message}
          </p>
        )}
      </div>

      {error && (
        <div className="reader-translate-error" role="alert">
          <span>{error}</span>
          {settingsCta && (
            <Button variant="secondary" onClick={() => navigate(settingsCta.path)}>
              {settingsCta.label}
            </Button>
          )}
        </div>
      )}
      {progress && (
        <p className="au-text-muted" style={{ fontSize: 12 }}>
          翻译中… {progress.done}/{progress.total} 段
        </p>
      )}

      {mode === "selection" && !error ? (
        <div className="reader-translate-empty">
          <strong>等待划词</strong>
        </div>
      ) : (
        <div className="reader-translate-document-status" role="status">
          <strong>{busy ? "正在生成双语文档" : "双语文档"}</strong>
          <span>
            已准备 {preparedPageCount} 页 · 已完成 {translatedSegmentCount} 段
          </span>
        </div>
      )}
    </div>
  );
}
