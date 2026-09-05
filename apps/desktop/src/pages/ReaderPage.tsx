// Reader page: PDF + research panel for annotations, translation, and citation context.
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AnnotationSidebar,
  PdfDocument,
  PdfReader,
  annotationsToMarkdown,
  configureWorker,
  type ReaderAnnotation,
  type ReaderEvidenceSelection,
  type ReaderTextSelection,
} from "@aurascholar/reader";
import { newId } from "@aurascholar/db/ids";
import { Badge, Button } from "@aurascholar/ui";
import "@aurascholar/reader/reader.css";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { writeClipboardText } from "../clipboard";
import { useConfirmDialog } from "../components/ConfirmDialog";
import { downloadBlob } from "../download";
import { useCanvasIngress, type CanvasIngressRequest } from "../features/canvas/useCanvasIngress";
import { SaveEvidencePopover } from "../features/evidence/SaveEvidencePopover";
import {
  ReaderCommentDraftNavigationGuard,
  ReaderEmptyState,
  ReaderPageNavigator,
  type ReaderWorkContext,
} from "../features/reader/ReaderPageChrome";
import { ReaderDocumentSynthesisTab } from "../features/reader/DocumentSynthesisPanel";
import {
  SelectionTranslationPopover,
  translationSettingsCta,
} from "../features/reader/SelectionTranslationPopover";
import {
  consumeReaderSmokeAnnotationCreateFailure,
  consumeReaderSmokeAnnotationDeleteFailure,
  consumeReaderSmokeAnnotationRestoreFailure,
  consumeReaderSmokeCommentSaveFailure,
  consumeReaderSmokeOpenFailure,
  consumeReaderSmokeSnippetSaveFailure,
} from "../features/reader/reader-smoke-failures";
import { useReaderEvidenceDeepLink } from "../features/reader/useReaderEvidenceDeepLink";
import {
  normalizeReaderPanelTab,
  readerPanelTabIsMounted,
  readerPanelTabs,
  type ReaderPanelTab,
} from "../features/reader/reader-panel-tabs";
import { resolveReaderScrollPage } from "../features/reader/evidence-deep-link";
import { recoverReaderEvidenceSource } from "../features/reader/reader-evidence-recovery";
import {
  createLibraryReaderAnnotation,
  deleteLibraryReaderAnnotation,
  isLibraryReaderAbort,
  LibraryReaderSessionError,
  loadLibraryReaderSession,
  markLibraryReaderWorkStarted,
  restoreLibraryReaderAnnotation,
  updateLibraryReaderAnnotationContent,
  type LibraryReaderSession,
} from "../features/reader/library-reader-session";
import {
  applyReaderSessionCompletion,
  createReaderSessionCoordinator,
  libraryReaderRouteRequestKey,
  withReaderAttachmentSearchParam,
  type ReaderSessionGeneration,
  type ReaderSessionLease,
  type ReaderSessionScope,
} from "../features/reader/reader-session-coordinator";
import {
  readReaderSessionOwnedValue,
  rollbackReaderAnnotationContent,
  updateReaderSessionOwnedValue,
  type ReaderSessionOwnedValue,
} from "../features/reader/reader-session-state";
import { fulltextWorkHandoffPath } from "../services/fulltext";
import { isDesktopRuntime } from "../services/aura-platform";
import { describeSafeError } from "../services/sensitive-text";
import {
  resolveTranslator,
  loadTranslateConfig,
  type TranslateConfig,
} from "../services/translate";
import { langLabel, splitForTranslation } from "@aurascholar/translate";
import { addSnippet } from "../services/snippets";

const CitationGraphView = lazy(() =>
  import("../components/CitationGraphView").then((mod) => ({ default: mod.CitationGraphView })),
);

configureWorker(workerSrc);

type PageFilter = "none" | "sepia" | "invert";
type TranslationMode = "selection" | "split" | "inline";
interface TranslatedSegment {
  source: string;
  result: string | null;
  error?: string;
}

interface PendingAttachmentRepair {
  attachmentId: string;
  message: string;
  workId: string;
}
type TranslatedPages = Record<number, TranslatedSegment[]>;
const EMPTY_TRANSLATED_PAGES: TranslatedPages = {};
const EMPTY_SESSION_TRANSLATED_PAGES: ReaderSessionOwnedValue<TranslatedPages> = {
  generation: null,
  value: EMPTY_TRANSLATED_PAGES,
};
const PAGE_FILTERS: Array<{ value: PageFilter; label: string; title: string }> = [
  { value: "none", label: "原色", title: "保持 PDF 原始色彩" },
  { value: "sepia", label: "护眼", title: "降低长时间阅读的视觉刺激" },
  { value: "invert", label: "反色", title: "适合夜间阅读扫描清晰的页面" },
];

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

interface OpenContext {
  doc: PdfDocument;
  fileName: string;
  sessionLease: ReaderSessionLease;
  sessionGeneration: ReaderSessionGeneration;
  routeRequestKey?: string;
  librarySession?: LibraryReaderSession;
  workId?: string;
  attachmentId?: string;
  workTitle?: string;
  workAuthors?: string[];
  workYear?: number;
  workDoi?: string;
}

type MissingWorkContext = ReaderWorkContext;

interface LibraryReaderLoadFailure {
  archivedWork: MissingWorkContext | null;
  archivedWorkId: string | null;
  allowRetry: boolean;
  error: string;
  missingWork: MissingWorkContext | null;
}

interface AnnotationDeleteUndoState {
  annotation: ReaderAnnotation;
  index: number;
  message: string;
  sessionGeneration: ReaderSessionGeneration;
}

interface ReaderEvidenceCaptureDraft {
  evidenceId: string;
  selection: ReaderEvidenceSelection;
  sessionGeneration: ReaderSessionGeneration;
}

function workToMissingContext(
  workId: string,
  work: LibraryReaderSession["work"] | null | undefined,
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

function librarySessionToOpenContext(
  session: LibraryReaderSession,
  sessionLease: ReaderSessionLease,
  routeRequestKey: string,
): OpenContext {
  return {
    doc: session.doc,
    fileName: session.work.title ?? "文献库文档",
    sessionLease,
    sessionGeneration: sessionLease.generation,
    routeRequestKey,
    librarySession: session,
    workId: session.work.id,
    attachmentId: session.attachment.id,
    workTitle: session.work.title,
    workAuthors: session.work.authorNames,
    workYear: session.work.year ?? undefined,
    workDoi: session.work.doi ?? undefined,
  };
}

function libraryReaderLoadFailure(
  workId: string,
  error: LibraryReaderSessionError,
): LibraryReaderLoadFailure {
  const work = workToMissingContext(workId, error.work);
  switch (error.code) {
    case "work-archived":
      return {
        archivedWork: work,
        archivedWorkId: workId,
        allowRetry: false,
        error: "这篇文献已在回收站。请先在文献库恢复后再阅读、补 PDF 或编辑批注。",
        missingWork: null,
      };
    case "attachment-unavailable":
    case "attachment-too-large":
    case "attachment-opening":
      return {
        archivedWork: null, archivedWorkId: null,
        allowRetry: error.code !== "attachment-too-large",
        error: error.message, missingWork: error.code === "attachment-opening" ? null : work,
      };
    case "attachment-missing":
      return {
        archivedWork: null,
        archivedWorkId: null,
        allowRetry: false,
        error: "这篇文献还没有 PDF 附件。可以上传本地文件，或去检索全文后自动挂回这篇文献。",
        missingWork: work,
      };
    case "pdf-invalid":
      return {
        archivedWork: null,
        archivedWorkId: null,
        allowRetry: true,
        error: "PDF 附件文件无法解析。可以重新选择 PDF 修复这篇文献。",
        missingWork: work,
      };
    case "work-missing":
      return {
        archivedWork: null,
        archivedWorkId: null,
        allowRetry: false,
        error: error.message,
        missingWork: null,
      };
  }
}

export function ReaderPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const workIdParam = params.get("work");
  const rawTabParam = params.get("tab");
  const annotationIdParam = params.get("annotation");
  const evidenceIdParam = params.get("evidence")?.trim() || undefined;
  const attachmentIdParam = params.get("attachment")?.trim() || undefined;
  const pageParam = params.get("page");
  const tabParam = normalizeReaderPanelTab(rawTabParam);
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
  const [tab, setTab] = useState<ReaderPanelTab>(tabParam ?? "annotations");
  const [panelOpen, setPanelOpen] = useState(true);
  const [translationMode, setTranslationMode] = useState<TranslationMode>("selection");
  const [translatedPagesState, setTranslatedPagesState] = useState<
    ReaderSessionOwnedValue<TranslatedPages>
  >(EMPTY_SESSION_TRANSLATED_PAGES);
  const [currentReaderPage, setCurrentReaderPage] = useState(0);
  const [translationJumpPage, setTranslationJumpPage] = useState<number | null>(null);
  const [selectionTranslation, setSelectionTranslation] = useState<{
    selection: ReaderTextSelection;
    seq: number;
    sessionGeneration: ReaderSessionGeneration;
  } | null>(null);
  const [snippetToast, setSnippetToast] = useState<string | null>(null);
  const [evidenceCapture, setEvidenceCapture] = useState<ReaderEvidenceCaptureDraft | null>(null);
  const [graphMounted, setGraphMounted] = useState(tabParam === "graph");
  const [commentDraftDirty, setCommentDraftDirty] = useState(false);
  const [fileActionBusy, setFileActionBusy] = useState(false);
  const [deletingAnnotationId, setDeletingAnnotationId] = useState<string | null>(null);
  const [annotationDeleteUndo, setAnnotationDeleteUndo] =
    useState<AnnotationDeleteUndoState | null>(null);
  const [annotationDeleteUndoBusy, setAnnotationDeleteUndoBusy] = useState(false);
  const readerRouteRequestKey = libraryReaderRouteRequestKey(
    workIdParam,
    attachmentIdParam,
    readerReloadSeq,
  );
  const { cancelConfirm, confirm, confirmDialog } = useConfirmDialog();
  const reportCanvasIngressError = useCallback(
    (error: string) => setSnippetToast(error),
    [setSnippetToast],
  );
  const { cancelCanvasIngress, openInCanvas, targetPicker } =
    useCanvasIngress(reportCanvasIngressError);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savingSnippetRef = useRef<ReaderSessionGeneration | null>(null);
  const deletingAnnotationIdRef = useRef<{
    id: string;
    sessionGeneration: ReaderSessionGeneration;
  } | null>(null);
  const annotationDeleteUndoBusyRef = useRef<ReaderSessionGeneration | null>(null);
  const pendingAttachmentRepairRef = useRef<PendingAttachmentRepair | null>(null);
  const readerSessionCoordinatorRef = useRef(createReaderSessionCoordinator());
  const activeReaderSessionLeaseRef = useRef<ReaderSessionLease | null>(null);
  const tabWorkIdRef = useRef<string | null>(workIdParam);
  const appliedDeepLinkRef = useRef<string | null>(null);
  const canShowGraphTab = Boolean(ctx?.workDoi);
  const canSynthesizeDocument = Boolean(ctx?.workId && ctx?.librarySession && isDesktopRuntime());
  const translatedPages = readReaderSessionOwnedValue(
    translatedPagesState,
    ctx?.sessionGeneration,
    EMPTY_TRANSLATED_PAGES,
  );

  const beginReaderSession = useCallback(
    (scope: ReaderSessionScope): ReaderSessionLease => {
      cancelCanvasIngress();
      cancelConfirm();
      const lease = readerSessionCoordinatorRef.current.begin(scope);
      activeReaderSessionLeaseRef.current = lease;
      savingSnippetRef.current = null;
      deletingAnnotationIdRef.current = null;
      annotationDeleteUndoBusyRef.current = null;
      return lease;
    },
    [cancelCanvasIngress, cancelConfirm],
  );

  const invalidateReaderSession = useCallback(() => {
    cancelCanvasIngress();
    cancelConfirm();
    readerSessionCoordinatorRef.current.invalidate();
    activeReaderSessionLeaseRef.current = null;
    savingSnippetRef.current = null;
    deletingAnnotationIdRef.current = null;
    annotationDeleteUndoBusyRef.current = null;
  }, [cancelCanvasIngress, cancelConfirm]);

  const activeLeaseForContext = useCallback(
    (context: OpenContext | null): ReaderSessionLease | null => {
      const lease = context?.sessionLease;
      if (!context || !lease || context.sessionGeneration !== lease.generation) return null;
      if (
        context.workId &&
        (!readerRouteRequestKey || context.routeRequestKey !== readerRouteRequestKey)
      ) {
        return null;
      }
      if (!context.workId && lease.scope.kind !== "local") return null;
      return lease.isCurrent() ? lease : null;
    },
    [readerRouteRequestKey],
  );
  const evidenceDeepLink = useReaderEvidenceDeepLink({
    attachmentId: ctx?.attachmentId,
    evidenceId: evidenceIdParam,
    lease: activeLeaseForContext(ctx),
    onError: reportCanvasIngressError,
    workId: ctx?.workId,
  });

  useLayoutEffect(() => {
    activeReaderSessionLeaseRef.current?.abort();
    cancelCanvasIngress();
    cancelConfirm();
  }, [cancelCanvasIngress, cancelConfirm, readerRouteRequestKey]);

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
      setAnnotationDeleteUndoBusy(false);
      setDeletingAnnotationId(null);
    }, 0);
    return () => window.clearTimeout(resetId);
  }, [ctx?.attachmentId, ctx?.workId]);

  useEffect(() => () => ctx?.doc.destroy(), [ctx]);

  useEffect(
    () => () => {
      invalidateReaderSession();
    },
    [invalidateReaderSession],
  );

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
    const lease = activeLeaseForContext(ctx);
    if (!lease) return;
    const key = `${ctx.sessionGeneration}:${ctx.workId ?? "local"}:${annotationIdParam ?? ""}:${pageParam ?? ""}`;
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
      if (!lease.isCurrent()) return;
      setJumpPage(pageIndex);
      setCurrentReaderPage(pageIndex);
      if (targetAnnotation) {
        setActiveId(targetAnnotation.id);
        setTab("annotations");
        setPanelOpen(true);
      }
    }, 0);
    return () => window.clearTimeout(applyId);
  }, [activeLeaseForContext, annotationIdParam, annotations, ctx, pageParam]);

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
      pendingAttachmentRepairRef.current = null;
      invalidateReaderSession();
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
        setJumpPage(null);
        setCurrentReaderPage(0);
        setTranslationJumpPage(null);
        setSelectionTranslation(null);
        setTranslatedPagesState(EMPTY_SESSION_TRANSLATED_PAGES);
        setAnnotationDeleteUndo(null);
        setAnnotationDeleteUndoBusy(false);
        setDeletingAnnotationId(null);
        setSnippetToast(null);
        setFileActionBusy(false);
      }, 0);
      return () => window.clearTimeout(resetId);
    }
    if (pendingAttachmentRepairRef.current?.workId !== workIdParam) {
      pendingAttachmentRepairRef.current = null;
    }
    const lease = beginReaderSession({
      kind: "library",
      workId: workIdParam,
      attachmentId: attachmentIdParam ?? null,
    });
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
      setJumpPage(null);
      setCurrentReaderPage(0);
      setTranslationJumpPage(null);
      setSelectionTranslation(null);
      setTranslatedPagesState(EMPTY_SESSION_TRANSLATED_PAGES);
      setAnnotationDeleteUndo(null);
      setAnnotationDeleteUndoBusy(false);
      setDeletingAnnotationId(null);
      setSnippetToast(null);
      setFileActionBusy(false);
      if (!isDesktopRuntime()) {
        if (lease.isCurrent()) setMissingWork(readerPreviewWorkContext(workIdParam));
        return;
      }
      const smokeFailure = consumeReaderSmokeOpenFailure();
      if (smokeFailure) throw smokeFailure;
      const session = await loadLibraryReaderSession(workIdParam, {
        attachmentId: attachmentIdParam,
        signal: lease.signal,
      });
      const applied = applyReaderSessionCompletion(lease, () => {
        setAnnotations(session.annotations);
        setMissingWork(null);
        setArchivedWork(null);
        setArchivedWorkId(null);
        setAllowRetryOpen(false);
        setCtx(librarySessionToOpenContext(session, lease, readerRouteRequestKey!));
        const pendingRepair = pendingAttachmentRepairRef.current;
        if (
          pendingRepair?.workId === workIdParam &&
          pendingRepair.attachmentId === session.attachment.id
        ) {
          pendingAttachmentRepairRef.current = null;
          setSnippetToast(pendingRepair.message);
        }
      });
      if (!applied) {
        session.doc.destroy();
        return;
      }

      void markLibraryReaderWorkStarted(workIdParam, lease.signal)
        .then((changed) => {
          if (changed) window.dispatchEvent(new Event("aurascholar:library-updated"));
        })
        .catch((error) => {
          if (isLibraryReaderAbort(error) || !lease.isCurrent()) return;
          setSnippetToast(
            `文献已打开，但阅读状态未自动更新，可在文献库中手动设置:${describeSafeError(error)}`,
          );
        });
    })()
      .catch((e) => {
        if (isLibraryReaderAbort(e) || !lease.isCurrent()) return;
        if (e instanceof LibraryReaderSessionError) {
          const failure = libraryReaderLoadFailure(workIdParam, e);
          setMissingWork(failure.missingWork);
          setArchivedWork(failure.archivedWork);
          setArchivedWorkId(failure.archivedWorkId);
          setAllowRetryOpen(failure.allowRetry);
          setLoadError(failure.error);
        } else {
          setMissingWork(null);
          setArchivedWork(null);
          setArchivedWorkId(null);
          setAllowRetryOpen(Boolean(workIdParam));
          setLoadError(describeSafeError(e));
        }
      })
      .finally(() => {
        if (lease.isCurrent()) setReaderLoading(false);
      });
    return () => {
      lease.abort();
    };
  }, [
    attachmentIdParam,
    beginReaderSession,
    invalidateReaderSession,
    readerRouteRequestKey,
    readerReloadSeq,
    workIdParam,
  ]);

  const retryOpenWork = () => {
    if (!workIdParam || readerLoading) return;
    setReaderReloadSeq((value) => value + 1);
  };

  const handleFindFulltext = () => {
    if (!missingWork) return;
    navigate(
      fulltextWorkHandoffPath(missingWork, "reader"),
    );
  };

  const handleTranslate = (selection: ReaderTextSelection) => {
    const lease = activeLeaseForContext(ctx);
    if (!lease) return;
    setEvidenceCapture(null);
    setSelectionTranslation((current) => ({
      selection,
      seq: (current?.seq ?? 0) + 1,
      sessionGeneration: lease.generation,
    }));
  };

  const handleTranslatedDocumentPageChange = (pageIndex: number) => {
    const lease = activeLeaseForContext(ctx);
    if (!lease) return;
    setCurrentReaderPage(pageIndex);
    setTranslationJumpPage(pageIndex);
    window.setTimeout(() => {
      if (!lease.isCurrent()) return;
      setTranslationJumpPage((current) => (current === pageIndex ? null : current));
    }, 120);
  };

  const handlePageNavigate = (pageIndex: number) => {
    const lease = activeLeaseForContext(ctx);
    if (!lease) return;
    setCurrentReaderPage(pageIndex);
    setJumpPage(pageIndex);
    window.setTimeout(() => {
      if (!lease.isCurrent()) return;
      setJumpPage((current) => (current === pageIndex ? null : current));
    }, 160);
  };

  const handleVisibleReaderPageChange = (pageIndex: number) => {
    if (activeLeaseForContext(ctx)) setCurrentReaderPage(pageIndex);
  };

  const setTranslatedPagesForActiveSession = useCallback<Dispatch<SetStateAction<TranslatedPages>>>(
    (update) => {
      const lease = activeLeaseForContext(ctx);
      if (!lease) return;
      applyReaderSessionCompletion(lease, () => {
        setTranslatedPagesState((current) =>
          updateReaderSessionOwnedValue(current, lease.generation, EMPTY_TRANSLATED_PAGES, update),
        );
      });
    },
    [activeLeaseForContext, ctx, setTranslatedPagesState],
  );

  const openActiveReaderItemInCanvas = async (request: CanvasIngressRequest): Promise<void> => {
    const lease = activeLeaseForContext(ctx);
    if (!lease) return;
    await openInCanvas(request, { signal: lease.signal });
  };

  // Selecting text + tapping ✦ saves a writing snippet (only when the doc is a
  // library work — a bare local file has no work to attach it to).
  const handleSaveSnippet = async (text: string, pageIndex: number): Promise<boolean> => {
    const context = ctx;
    const lease = activeLeaseForContext(context);
    if (!lease || savingSnippetRef.current === lease.generation) return false;
    savingSnippetRef.current = lease.generation;
    const startedAt = Date.now();
    let message = "请先入库，素材会关联到对应文献";
    let saved = false;
    try {
      if (context?.workId) {
        setSnippetToast("正在保存为写作素材...");
        const smokeFailure = consumeReaderSmokeSnippetSaveFailure();
        if (smokeFailure) throw smokeFailure;
        await addSnippet({ workId: context.workId, pageIndex, quote: text });
        message = "已存为写作素材";
        saved = true;
      }
    } catch (e) {
      message = `保存写作素材失败，选中文本仍保留，可重新保存:${describeSafeError(e)}`;
      saved = false;
    } finally {
      await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
      if (lease.isCurrent()) setSnippetToast(message);
      if (savingSnippetRef.current === lease.generation) savingSnippetRef.current = null;
    }
    return saved;
  };

  const openFile = async (file: File) => {
    if (fileActionBusy) return;
    const missingWorkSnapshot = missingWork;
    const repairingLibraryWork = Boolean(missingWorkSnapshot && isDesktopRuntime());
    if (
      repairingLibraryWork &&
      (!workIdParam || missingWorkSnapshot?.id !== workIdParam || !readerRouteRequestKey)
    ) {
      setLoadError("当前文献已经切换，请在目标文献上重新选择 PDF。");
      return;
    }
    const lease = beginReaderSession(
      repairingLibraryWork && missingWorkSnapshot
        ? {
            kind: "library",
            workId: missingWorkSnapshot.id,
            attachmentId: null,
          }
        : { kind: "local", replacementId: newId() },
    );
    const startedAt = Date.now();
    setFileActionBusy(true);
    setAnnotationDeleteUndo(null);
    setAnnotationDeleteUndoBusy(false);
    setDeletingAnnotationId(null);
    setJumpPage(null);
    setCurrentReaderPage(0);
    setTranslationJumpPage(null);
    setSelectionTranslation(null);
    setTranslatedPagesState(EMPTY_SESSION_TRANSLATED_PAGES);
    try {
      setLoadError(null);
      if (!lease.isCurrent()) return;
      if (missingWorkSnapshot && evidenceIdParam && isDesktopRuntime()) {
        setSnippetToast("正在校验 Evidence 的原始 PDF...");
        const recovery = await recoverReaderEvidenceSource({
          evidenceId: evidenceIdParam,
          expectedWorkId: missingWorkSnapshot.id,
          file,
          signal: lease.signal,
        });
        if (!lease.isCurrent()) return;
        pendingAttachmentRepairRef.current = {
          attachmentId: recovery.attachmentId,
          message: `已恢复《${missingWorkSnapshot.title}》中这条 Evidence 的原始修订`,
          workId: recovery.workId,
        };
        const nextParams = withReaderAttachmentSearchParam(params, recovery.attachmentId);
        nextParams.set("page", String(recovery.pageIndex + 1));
        navigate({ search: nextParams.toString() }, { replace: true });
        return;
      }
      const data = new Uint8Array(await file.arrayBuffer());
      if (!lease.isCurrent()) return;
      if (missingWorkSnapshot && isDesktopRuntime()) {
        const { attachPdfToWork } = await import("../services/library");
        const result = await attachPdfToWork(missingWorkSnapshot.id, file.name, data);
        window.dispatchEvent(new Event("aurascholar:library-updated"));
        if (!lease.isCurrent()) return;
        await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
        if (!lease.isCurrent()) return;
        const annotationMessage =
          result.restoredAnnotationCount > 0
            ? `，已恢复 ${result.restoredAnnotationCount} 条备份批注`
            : "";
        pendingAttachmentRepairRef.current = {
          attachmentId: result.attachmentId,
          message: result.deduped
            ? `这份 PDF 已经附加在《${missingWorkSnapshot.title}》上${annotationMessage}`
            : `已为《${missingWorkSnapshot.title}》补上 PDF(${result.pageCount} 页)${annotationMessage}`,
          workId: missingWorkSnapshot.id,
        };
        if (attachmentIdParam === result.attachmentId) {
          setReaderReloadSeq((value) => value + 1);
        } else {
          const nextParams = withReaderAttachmentSearchParam(params, result.attachmentId);
          navigate({ search: nextParams.toString() }, { replace: true });
        }
        return;
      }
      const loaded = await PdfDocument.load(data);
      await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
      const applied = applyReaderSessionCompletion(lease, () => {
        setAnnotations([]);
        setMissingWork(null);
        setArchivedWork(null);
        setArchivedWorkId(null);
        setAllowRetryOpen(false);
        setCtx({
          doc: loaded,
          fileName: file.name,
          sessionLease: lease,
          sessionGeneration: lease.generation,
        });
        setSnippetToast("已打开本地 PDF。未入库文件的批注只保存在本次会话。");
      });
      if (!applied) {
        loaded.destroy();
        return;
      }
    } catch (e) {
      if (!isLibraryReaderAbort(e) && lease.isCurrent()) {
        setLoadError(
          `${evidenceIdParam ? "恢复 Evidence 原始来源失败" : "打开 PDF 失败"}:${describeSafeError(e)}`,
        );
      }
    } finally {
      if (lease.isCurrent()) setFileActionBusy(false);
    }
  };

  const handleCreate = async (a: Omit<ReaderAnnotation, "id">): Promise<boolean> => {
    const context = ctx;
    const lease = activeLeaseForContext(context);
    if (!lease) return false;
    setAnnotationDeleteUndo(null);
    if (context?.librarySession) {
      const startedAt = Date.now();
      setSnippetToast("正在保存批注...");
      try {
        const smokeFailure = consumeReaderSmokeAnnotationCreateFailure();
        if (smokeFailure) throw smokeFailure;
        const annotation = await createLibraryReaderAnnotation(
          context.librarySession,
          a,
          lease.signal,
        );
        await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
        applyReaderSessionCompletion(lease, () => {
          setAnnotations((prev) => [...prev, annotation]);
          setSnippetToast("批注已保存");
        });
        return true;
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
        if (lease.isCurrent() && !isLibraryReaderAbort(e)) {
          setSnippetToast(`保存批注失败，选区仍保留，可重新保存:${describeSafeError(e)}`);
        }
        return false;
      }
    }
    if (!lease.isCurrent()) return false;
    setAnnotations((prev) => [...prev, { ...a, id: newId() }]);
    setSnippetToast("批注已加入本次会话");
    return true;
  };

  const handleDelete = async (id: string) => {
    const context = ctx;
    const lease = activeLeaseForContext(context);
    if (!lease) return;
    if (
      deletingAnnotationIdRef.current?.sessionGeneration === lease.generation ||
      annotationDeleteUndoBusyRef.current === lease.generation
    ) {
      return;
    }
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
        context?.workId ? "已入库批注会从文献库中移除。" : "本地 PDF 会话中的批注会立即移除。",
      ],
      confirmLabel: "删除批注",
      tone: "warning",
    });
    if (!confirmed || !lease.isCurrent()) return;
    const startedAt = Date.now();
    const operation = { id, sessionGeneration: lease.generation };
    deletingAnnotationIdRef.current = operation;
    setDeletingAnnotationId(id);
    setSnippetToast("正在删除批注...");
    try {
      const smokeFailure = consumeReaderSmokeAnnotationDeleteFailure();
      if (smokeFailure) {
        await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
        throw smokeFailure;
      }
      if (context?.librarySession) {
        await deleteLibraryReaderAnnotation(id, lease.signal);
      }
      await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
      applyReaderSessionCompletion(lease, () => {
        setAnnotationDeleteUndo({
          annotation: target,
          index: targetIndex,
          message: "已删除批注",
          sessionGeneration: lease.generation,
        });
        setAnnotations((prev) => prev.filter((x) => x.id !== id));
        setSnippetToast("已删除批注");
      });
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
      if (lease.isCurrent() && !isLibraryReaderAbort(e)) {
        setSnippetToast(`删除批注失败，批注仍保留，可重新删除:${describeSafeError(e)}`);
      }
    } finally {
      if (deletingAnnotationIdRef.current === operation) deletingAnnotationIdRef.current = null;
      if (lease.isCurrent()) setDeletingAnnotationId(null);
    }
  };

  const undoAnnotationDelete = async () => {
    const context = ctx;
    const lease = activeLeaseForContext(context);
    if (
      !annotationDeleteUndo ||
      !lease ||
      annotationDeleteUndo.sessionGeneration !== lease.generation ||
      annotationDeleteUndoBusyRef.current === lease.generation
    ) {
      return;
    }
    const { annotation, index } = annotationDeleteUndo;
    const startedAt = Date.now();
    annotationDeleteUndoBusyRef.current = lease.generation;
    setAnnotationDeleteUndoBusy(true);
    setSnippetToast("正在撤销删除批注...");
    try {
      const smokeFailure = consumeReaderSmokeAnnotationRestoreFailure();
      if (smokeFailure) {
        await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
        throw smokeFailure;
      }
      if (context?.librarySession) {
        await restoreLibraryReaderAnnotation(annotation.id, lease.signal);
      }
      if (
        !applyReaderSessionCompletion(lease, () => {
          setAnnotations((prev) => {
            if (prev.some((item) => item.id === annotation.id)) return prev;
            const next = [...prev];
            next.splice(Math.min(Math.max(index, 0), next.length), 0, annotation);
            return next;
          });
          setActiveId(annotation.id);
          setTab("annotations");
        })
      ) {
        return;
      }
      await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
      if (!lease.isCurrent()) return;
      setAnnotationDeleteUndo(null);
      setSnippetToast("已撤销删除批注");
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
      if (lease.isCurrent() && !isLibraryReaderAbort(e)) {
        setSnippetToast(`撤销删除批注失败，撤销入口仍保留，可重新撤销:${describeSafeError(e)}`);
      }
    } finally {
      if (annotationDeleteUndoBusyRef.current === lease.generation) {
        annotationDeleteUndoBusyRef.current = null;
      }
      if (lease.isCurrent()) setAnnotationDeleteUndoBusy(false);
    }
  };

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

  const handleSaveComment = async (id: string, contentMd: string) => {
    const context = ctx;
    const lease = activeLeaseForContext(context);
    if (!lease) return false;
    const previousContent = annotations.find((annotation) => annotation.id === id)?.contentMd;
    setAnnotations((prev) => prev.map((x) => (x.id === id ? { ...x, contentMd } : x)));
    try {
      if (context?.librarySession) {
        const smokeFailure = consumeReaderSmokeCommentSaveFailure();
        if (smokeFailure) throw smokeFailure;
        await updateLibraryReaderAnnotationContent(id, contentMd, lease.signal);
      }
      if (lease.isCurrent()) setSnippetToast("批注评论已保存");
      return true;
    } catch (e) {
      if (lease.isCurrent() && !isLibraryReaderAbort(e)) {
        setAnnotations((current) =>
          rollbackReaderAnnotationContent(current, id, contentMd, previousContent),
        );
        setSnippetToast(`保存评论失败，草稿仍保留，可重新保存:${describeSafeError(e)}`);
      }
      return false;
    }
  };

  const handleSaveEvidence = useCallback(
    (selection: ReaderEvidenceSelection): boolean => {
      const context = ctx;
      const lease = activeLeaseForContext(context);
      if (!context?.librarySession || !lease) {
        setSnippetToast("请从文献库打开当前 PDF 后再保存为证据。");
        return false;
      }
      setSelectionTranslation(null);
      setEvidenceCapture({
        evidenceId: newId(),
        selection,
        sessionGeneration: lease.generation,
      });
      return true;
    },
    [
      activeLeaseForContext,
      ctx,
      setEvidenceCapture,
      setSelectionTranslation,
      setSnippetToast,
    ],
  );

  const handleExport = () => {
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
  };

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

  const tabs = readerPanelTabs({ annotationCount: annotations.length, canSynthesizeDocument, workDoi: ctx.workDoi });
  const visibleAnnotationDeleteUndo =
    annotationDeleteUndo?.sessionGeneration === ctx.sessionGeneration ? annotationDeleteUndo : null;
  const evidenceLease = activeLeaseForContext(ctx);
  const visibleEvidenceCapture =
    evidenceCapture?.sessionGeneration === ctx.sessionGeneration ? evidenceCapture : null;
  const renderSourceReader = () => (
    <PdfReader
      doc={ctx.doc}
      annotations={
        evidenceDeepLink ? [...annotations, evidenceDeepLink.annotation] : annotations
      }
      onCreateAnnotation={handleCreate}
      onAnnotationClick={(id) => {
        if (id === evidenceDeepLink?.annotation.id) return;
        setActiveId(id);
        setTab("annotations");
        setPanelOpen(true);
      }}
      onTranslate={handleTranslate}
      onSaveSnippet={handleSaveSnippet}
      onSaveEvidence={ctx.librarySession ? handleSaveEvidence : undefined}
      pageFilter={pageFilter}
      scrollToPage={resolveReaderScrollPage({
        evidencePage: evidenceDeepLink?.pageIndex,
        page: jumpPage,
        translationPage: translationJumpPage,
      })}
      onVisiblePageChange={handleVisibleReaderPageChange}
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
          {visibleAnnotationDeleteUndo &&
          (snippetToast === visibleAnnotationDeleteUndo.message ||
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
      {targetPicker}
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
              onClick={() =>
                void openActiveReaderItemInCanvas({
                  workId: ctx.workId!,
                  sourceLabel: ctx.workTitle ?? ctx.fileName,
                })
              }
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
                const panelMounted = readerPanelTabIsMounted(t.key, {
                  graphMounted,
                  workDoi: ctx.workDoi,
                });
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
                    handlePageNavigate(ann.pageIndex);
                  }}
                  onSaveComment={handleSaveComment}
                  onAddToCanvas={
                    ctx.workId
                      ? (annotation) =>
                          void openActiveReaderItemInCanvas({
                            workId: ctx.workId!,
                            annotationId: annotation.id,
                            sourceLabel: `${ctx.workTitle ?? ctx.fileName} · 第 ${annotation.pageIndex + 1} 页批注`,
                          })
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
                  key={ctx.sessionGeneration}
                  doc={ctx.doc}
                  mode={translationMode}
                  onModeChange={setTranslationMode}
                  currentPage={currentReaderPage}
                  pages={translatedPages}
                  onPagesChange={setTranslatedPagesForActiveSession}
                />
              </div>
              <ReaderDocumentSynthesisTab
                key={ctx.sessionGeneration}
                active={tab === "synthesis"}
                enabled={canSynthesizeDocument}
                workId={ctx.workId ?? ""}
                workTitle={ctx.workTitle ?? ctx.fileName}
              />
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
      {selectionTranslation && selectionTranslation.sessionGeneration === ctx.sessionGeneration && (
        <SelectionTranslationPopover
          key={`${selectionTranslation.sessionGeneration}:${selectionTranslation.seq}`}
          selection={selectionTranslation.selection}
          onClose={() => setSelectionTranslation(null)}
        />
      )}
      {visibleEvidenceCapture && evidenceLease && ctx.librarySession ? (
        <SaveEvidencePopover
          key={visibleEvidenceCapture.evidenceId}
          evidenceId={visibleEvidenceCapture.evidenceId}
          selection={visibleEvidenceCapture.selection}
          session={evidenceLease}
          source={{
            attachmentId: ctx.librarySession.attachment.id,
            expectedBlobSha256: ctx.librarySession.attachment.sha256,
            workId: ctx.librarySession.work.id,
            workTitle: ctx.librarySession.work.title,
          }}
          onCancel={() => setEvidenceCapture(null)}
          onSaved={(message) => {
            if (!evidenceLease.isCurrent()) return;
            setEvidenceCapture(null);
            setSnippetToast(message);
          }}
        />
      ) : null}
    </div>
  );
}

interface TranslationSmokeSegmentsEventDetail {
  engine?: string;
  pageIndex?: number;
  segments?: TranslatedSegment[];
}

type TranslateAction = "full" | "page";

async function pageParagraphsForTranslation(
  doc: PdfDocument,
  pageIndex: number,
  signal?: AbortSignal,
): Promise<string[]> {
  signal?.throwIfAborted();
  const lines = await doc.getPageTextLines(pageIndex);
  signal?.throwIfAborted();
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
  signal?.throwIfAborted();
  return paragraphs;
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
  const [config, setConfig] = useState<TranslateConfig>({
    baidu: { appid: "", hasApiKey: false },
    deepl: { hasApiKey: false },
    engine: "llm",
    targetLang: "zh",
  });
  useEffect(() => {
    let cancelled = false;
    void loadTranslateConfig()
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(describeSafeError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      cancelRef.current?.abort();
      cancelRef.current = null;
      copyingAllRef.current = false;
    },
    [doc],
  );

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
    const controller = new AbortController();
    void pageParagraphsForTranslation(doc, currentPage, controller.signal)
      .then((paragraphs) => {
        if (controller.signal.aborted || paragraphs.length === 0) return;
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
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(describeSafeError(error));
      });
    return () => {
      controller.abort();
    };
  }, [currentPage, doc, mode, onPagesChange, pages]);

  useEffect(() => {
    if (busy) return;
    const timer = window.setTimeout(() => setPageInput(String(currentPage + 1)), 0);
    return () => window.clearTimeout(timer);
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
          const chunks = await pageParagraphsForTranslation(doc, pageIndex, controller.signal);
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
              const message = describeSafeError(e);
              // Main owns the LLM provider, so a missing configuration arrives
              // here as a per-segment command error. Surface setup failures at
              // panel level to preserve the actionable Settings CTA; ordinary
              // provider failures remain attached to the affected segment.
              if (translationSettingsCta(message)) {
                setError(message);
                return;
              }
              onPagesChange((current) => ({
                ...current,
                [page.pageIndex]: (current[page.pageIndex] ?? []).map((segment, segmentIndex) =>
                  segmentIndex === index ? { ...segment, error: message } : segment,
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
