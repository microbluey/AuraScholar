// Reader page: PDF + right panel with three tabs — 批注 / 重点 (AI digest,
// generated at import time or on demand) / 脉络 (citation graph of this paper).
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useBlocker, useNavigate, useSearchParams } from "react-router-dom";
import {
  AnnotationSidebar,
  PdfDocument,
  PdfReader,
  annotationsToMarkdown,
  configureWorker,
  extractFullText,
  type ReaderAnnotation,
} from "@aurascholar/reader";
import { newId } from "@aurascholar/db/ids";
import { AnnotationsRepo, type AnnotationRow } from "@aurascholar/db/repos/annotations";
import { FlashcardsRepo, type FlashcardRow } from "@aurascholar/db/repos/flashcards";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { Badge, Button } from "@aurascholar/ui";
import "@aurascholar/reader/reader.css";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { writeClipboardText } from "../clipboard";
import { useConfirmDialog, type ConfirmFunction } from "../components/ConfirmDialog";
import { downloadBlob } from "../download";
import { getDb } from "../services/tauri-db";
import { loadPdfForWork } from "../services/library-read";
import { resolveTranslator, loadTranslateConfig } from "../services/translate";
import { langLabel, splitForTranslation, type TranslateConfig } from "@aurascholar/translate";
import { addSnippet } from "../services/snippets";

const CitationGraphView = lazy(() =>
  import("../components/CitationGraphView").then((mod) => ({ default: mod.CitationGraphView })),
);

configureWorker(workerSrc);

type PageFilter = "none" | "sepia" | "invert";
type PanelTab = "annotations" | "translate" | "digest" | "graph";

const PAGE_FILTERS: Array<{ value: PageFilter; label: string; title: string }> = [
  { value: "none", label: "原色", title: "保持 PDF 原始色彩" },
  { value: "sepia", label: "护眼", title: "降低长时间阅读的视觉刺激" },
  { value: "invert", label: "反色", title: "适合夜间阅读扫描清晰的页面" },
];

const MIN_READER_WRITE_BUSY_MS = 250;

async function waitForMinimumElapsed(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
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
  ctx: OpenContext | null;
  error?: string;
  missingWork: MissingWorkContext | null;
}

function rowToAnnotation(row: AnnotationRow): ReaderAnnotation {
  return {
    id: row.id,
    type: row.type as ReaderAnnotation["type"],
    color: row.color ?? "#ffd866",
    pageIndex: row.page_index,
    anchor: row.anchor_json
      ? JSON.parse(row.anchor_json)
      : { version: 1, pageIndex: row.page_index },
    contentMd: row.content_md ?? undefined,
    orphaned: row.orphaned === 1,
  };
}

function workToMissingContext(workId: string, work: Awaited<ReturnType<WorksRepo["get"]>>): MissingWorkContext {
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
  if (work.doi) return `https://doi.org/${work.doi}`;
  if (work.arxivId) return `https://arxiv.org/abs/${encodeURIComponent(work.arxivId)}`;
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(work.title)}`;
}

async function loadLibraryPdfContext(workId: string): Promise<LibraryPdfContext> {
  const db = await getDb();
  const workPromise = new WorksRepo(db).get(workId);
  let pdf: Awaited<ReturnType<typeof loadPdfForWork>>;
  try {
    pdf = await loadPdfForWork(workId);
  } catch (error) {
    const work = await workPromise;
    return {
      annotations: [],
      ctx: null,
      error:
        "已找到 PDF 附件记录，但本地文件无法读取。可以重新选择 PDF 修复这篇文献。",
      missingWork: workToMissingContext(workId, work),
    };
  }
  const work = await workPromise;
  if (!pdf) {
    return {
      annotations: [],
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
      ctx: null,
      error:
        "PDF 附件文件无法解析。可以重新选择 PDF 修复这篇文献。",
      missingWork: workToMissingContext(workId, work),
    };
  }
  try {
    const rows = await new AnnotationsRepo(db).listForAttachment(pdf.attachmentId);
    return {
      annotations: rows.map(rowToAnnotation),
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
  const tabParam = params.get("tab") as PanelTab | null;
  const [ctx, setCtx] = useState<OpenContext | null>(null);
  const [missingWork, setMissingWork] = useState<MissingWorkContext | null>(null);
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([]);
  const [pageFilter, setPageFilter] = useState<PageFilter>("none");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [jumpPage, setJumpPage] = useState<number | null>(null);
  const [tab, setTab] = useState<PanelTab>(tabParam ?? "annotations");
  const [panelOpen, setPanelOpen] = useState(true);
  const [translateSource, setTranslateSource] = useState("");
  const [translateSeq, setTranslateSeq] = useState(0);
  const [snippetToast, setSnippetToast] = useState<string | null>(null);
  const [graphMounted, setGraphMounted] = useState(tabParam === "graph");
  const [commentDraftDirty, setCommentDraftDirty] = useState(false);
  const [fileActionBusy, setFileActionBusy] = useState(false);
  const [deletingAnnotationId, setDeletingAnnotationId] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savingSnippetRef = useRef(false);
  const deletingAnnotationIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!snippetToast) return;
    const t = setTimeout(() => setSnippetToast(null), 2500);
    return () => clearTimeout(t);
  }, [snippetToast]);

  useEffect(() => () => ctx?.doc.destroy(), [ctx]);

  useEffect(() => {
    if (tab === "graph") setGraphMounted(true);
  }, [tab]);

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
    if (!workIdParam) return;
    let cancelled = false;
    void (async () => {
      setLoadError(null);
      setMissingWork(null);
      setCtx(null);
      setAnnotations([]);
      const next = await loadLibraryPdfContext(workIdParam);
      if (cancelled) {
        next.ctx?.doc.destroy();
        return;
      }
      if (!next.ctx) {
        setMissingWork(next.missingWork);
        setLoadError(next.error ?? "这篇文献暂时无法打开 PDF。");
        return;
      }
      setAnnotations(next.annotations);
      setMissingWork(null);
      setCtx(next.ctx);
    })().catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [workIdParam]);

  const handleFindFulltext = useCallback(() => {
    if (!missingWork) return;
    const params = new URLSearchParams({
      pendingWorkId: missingWork.id,
      pendingTitle: missingWork.title,
      url: fullTextLanding(missingWork),
    });
    navigate(`/discovery?${params.toString()}`);
  }, [missingWork, navigate]);

  // Selecting text + tapping 译 routes here: open the panel on the 译文 tab and
  // hand the text to TranslatePanel (seq bump re-triggers even on same text).
  const handleTranslate = useCallback((text: string) => {
    setTranslateSource(text);
    setTranslateSeq((n) => n + 1);
    setTab("translate");
    setPanelOpen(true);
  }, []);

  // Selecting text + tapping ✦ saves a writing snippet (only when the doc is a
  // library work — a bare local file has no work to attach it to).
  const handleSaveSnippet = useCallback(
    async (text: string, pageIndex: number) => {
      if (savingSnippetRef.current) return;
      savingSnippetRef.current = true;
      const startedAt = Date.now();
      let message = "";
      if (!ctx?.workId) {
        message = "请先入库，素材会关联到对应文献";
      } else {
        setSnippetToast("正在保存为写作素材...");
        try {
          await addSnippet({ workId: ctx.workId, pageIndex, quote: text });
          message = "已存为写作素材";
        } catch (e) {
          message = `保存失败:${e instanceof Error ? e.message : String(e)}`;
        }
      }
      await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
      setSnippetToast(message);
      savingSnippetRef.current = false;
    },
    [ctx?.workId],
  );

  const openFile = useCallback(async (file: File) => {
    if (fileActionBusy) return;
    const startedAt = Date.now();
    setFileActionBusy(true);
    try {
      setLoadError(null);
      const data = new Uint8Array(await file.arrayBuffer());
      if (missingWork) {
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
        setSnippetToast(
          result.deduped
            ? `这份 PDF 已经附加在《${missingWork.title}》上`
            : `已为《${missingWork.title}》补上 PDF(${result.pageCount} 页)`,
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
      setLoadError(`打开 PDF 失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFileActionBusy(false);
    }
  }, [fileActionBusy, missingWork]);

  const handleCreate = useCallback(
    (a: Omit<ReaderAnnotation, "id">) => {
      if (ctx?.workId && ctx.attachmentId) {
        void (async () => {
          try {
            const db = await getDb();
            const id = await new AnnotationsRepo(db).create({
              attachmentId: ctx.attachmentId!,
              workId: ctx.workId!,
              type: a.type,
              color: a.color,
              pageIndex: a.pageIndex,
              anchor: a.anchor,
              contentMd: a.contentMd,
            });
            setAnnotations((prev) => [...prev, { ...a, id }]);
          } catch (e) {
            setSnippetToast(`保存批注失败:${e instanceof Error ? e.message : String(e)}`);
          }
        })();
      } else {
        setAnnotations((prev) => [...prev, { ...a, id: newId() }]);
      }
    },
    [ctx],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (deletingAnnotationIdRef.current) return;
      const target = annotations.find((annotation) => annotation.id === id);
      const confirmed = await confirm({
        title: "删除这条批注？",
        description: target?.anchor.quote?.exact
          ? `将删除第 ${target.pageIndex + 1} 页的批注：“${target.anchor.quote.exact.slice(0, 80)}”`
          : `将删除第 ${(target?.pageIndex ?? 0) + 1} 页的批注。`,
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
        if (ctx?.workId) {
          const db = await getDb();
          await new AnnotationsRepo(db).softDelete(id);
        }
        await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
        setAnnotations((prev) => prev.filter((x) => x.id !== id));
        setSnippetToast("已删除批注");
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
        setSnippetToast(`删除批注失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        deletingAnnotationIdRef.current = null;
        setDeletingAnnotationId(null);
      }
    },
    [annotations, confirm, ctx?.workId],
  );

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
          const db = await getDb();
          await new AnnotationsRepo(db).updateContent(id, contentMd);
        }
        setSnippetToast("批注评论已保存");
        return true;
      } catch (e) {
        setAnnotations(previous);
        setSnippetToast(`保存评论失败:${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    },
    [annotations, ctx?.workId],
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
        loadError={loadError}
        missingWork={missingWork}
        fileInputRef={fileInputRef}
        fileActionBusy={fileActionBusy}
        onOpenFile={openFile}
        onBackToLibrary={() =>
          navigate(missingWork ? `/library?work=${encodeURIComponent(missingWork.id)}` : "/library")
        }
        onFindFulltext={missingWork ? handleFindFulltext : undefined}
      />
    );
  }

  const tabs: Array<{ key: PanelTab; label: string; disabled?: boolean; title?: string }> = [
    { key: "annotations", label: `批注 ${annotations.length}` },
    { key: "translate", label: "译文" },
    {
      key: "digest",
      label: "重点",
      disabled: !ctx.workId,
      title: ctx.workId ? undefined : "需先入库",
    },
    {
      key: "graph",
      label: "脉络",
      disabled: !ctx.workDoi,
      title: ctx.workDoi ? undefined : "无 DOI,无法构建图谱",
    },
  ];

  return (
    <div className="reader-workspace">
      {snippetToast && <div className="reader-toast">{snippetToast}</div>}
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
          <div className="reader-filter-toggle" aria-label="页面显示模式">
            {PAGE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={pageFilter === filter.value ? "reader-filter-toggle__active" : ""}
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
          <Button variant="ghost" style={{ fontSize: 13 }} onClick={() => setPanelOpen((v) => !v)}>
            {panelOpen ? "收起面板" : "展开面板"}
          </Button>
          <Button variant="secondary" style={{ fontSize: 13 }} onClick={() => navigate("/library")}>
            返回文献库
          </Button>
        </div>
      </div>
      <div className="reader-shell">
        <div style={{ flex: 1, minWidth: 0 }}>
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
            scrollToPage={jumpPage}
          />
        </div>
        {panelOpen && (
          <div className="reader-research-panel">
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
            <div className="reader-tabs au-tablist">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  className={`au-tab ${tab === t.key ? "au-tab--active" : ""}`}
                  disabled={t.disabled}
                  title={t.title}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {/* All panels stay mounted — switching tabs must not lose
                in-flight digest generation or the loaded graph. */}
            <div className="reader-research-panel__body">
              <div style={{ height: "100%", display: tab === "annotations" ? "block" : "none" }}>
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
                  onDelete={handleDelete}
                  deletingId={deletingAnnotationId}
                />
              </div>
              <div style={{ height: "100%", display: tab === "translate" ? "block" : "none" }}>
                <TranslatePanel source={translateSource} seq={translateSeq} doc={ctx.doc} />
              </div>
              {ctx.workId && (
                <div style={{ height: "100%", display: tab === "digest" ? "block" : "none" }}>
                  <DigestPanel workId={ctx.workId} title={ctx.workTitle ?? ctx.fileName} />
                </div>
              )}
              {ctx.workDoi && graphMounted && (
                <div style={{ height: "100%", display: tab === "graph" ? "block" : "none" }}>
                  <Suspense
                    fallback={<p className="au-text-muted">正在载入引用脉络...</p>}
                  >
                    <CitationGraphView doi={ctx.workDoi} height={400} />
                  </Suspense>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
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
  loadError,
  missingWork,
  fileInputRef,
  fileActionBusy,
  onOpenFile,
  onBackToLibrary,
  onFindFulltext,
}: {
  loadError: string | null;
  missingWork: MissingWorkContext | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  fileActionBusy: boolean;
  onOpenFile: (file: File) => void | Promise<void>;
  onBackToLibrary: () => void;
  onFindFulltext?: () => void;
}) {
  const authors = missingWork?.authors.slice(0, 3).join(", ");

  return (
    <div className="reader-empty-page">
      <div className="reader-empty-hero">
        <div className="reader-empty-hero__copy">
          <h1>{missingWork ? "PDF 未就绪" : "阅读器"}</h1>
          <p>
            {missingWork
              ? "这篇文献已经在库里，补上 PDF 后就能进入批注、翻译、重点和素材链路。"
              : "等待一篇 PDF。入库文献会保留批注与素材，本地文件适合快速查看。"}
          </p>
          {missingWork && (
            <div className="reader-empty-work">
              <span>待补全文</span>
              <strong>{missingWork.title}</strong>
              <small>
                {[authors, missingWork.year, missingWork.doi ? `DOI ${missingWork.doi}` : null]
                  .filter(Boolean)
                  .join(" · ") || "题录已定位"}
              </small>
            </div>
          )}
          {loadError && <p className="reader-empty-hero__error">{loadError}</p>}
          <div className="reader-empty-hero__actions">
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
              disabled={fileActionBusy}
              aria-busy={fileActionBusy ? "true" : undefined}
            >
              {fileActionBusy ? "打开中..." : "打开本地 PDF"}
            </Button>
            {onFindFulltext && (
              <Button variant="secondary" onClick={onFindFulltext} disabled={fileActionBusy}>
                去找全文
              </Button>
            )}
            <Button variant="secondary" onClick={onBackToLibrary} disabled={fileActionBusy}>
              {missingWork ? "回文献库定位" : "返回文献库"}
            </Button>
          </div>
        </div>
        <div className="reader-empty-hero__workflow" aria-label="阅读工作流">
          <div>
            <strong>01</strong>
            <span>深读队列</span>
            <small>PDF 尚未打开</small>
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

interface TranslationSmokeSegmentsEventDetail {
  engine?: string;
  segments?: TranslatedSegment[];
}

type TranslateAction = "full" | "page" | "selection";

/**
 * 译文 tab. Two modes:
 *  - selection: text selected in the PDF + 译 button → single original/translation pair
 *  - page / full text: extract page text from the doc, chunk it, translate each
 *    chunk sequentially (cancellable) with progress, rendered as comparison pairs
 */
function TranslatePanel({ source, seq, doc }: { source: string; seq: number; doc: PdfDocument }) {
  const [segments, setSegments] = useState<TranslatedSegment[]>([]);
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
      setSegments(
        detail.segments.map((segment) => ({
          source: segment.source,
          result: segment.result,
          error: segment.error,
        })),
      );
    };
    window.addEventListener("aurascholar:reader-translation-smoke-segments", onSmokeSegments);
    return () =>
      window.removeEventListener("aurascholar:reader-translation-smoke-segments", onSmokeSegments);
  }, []);

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

  // Translate an arbitrary list of source chunks sequentially with progress.
  const translateChunks = useCallback(
    async (chunks: string[], action: TranslateAction = "selection") => {
      if (chunks.length === 0) return;
      const startedAt = Date.now();
      cancelRef.current?.abort();
      const controller = new AbortController();
      cancelRef.current = controller;
      setError(null);
      setBusy(true);
      setTranslateAction(action);
      setEngine(null);
      setSegments(chunks.map((c) => ({ source: c, result: null })));
      setProgress({ done: 0, total: chunks.length });
      try {
        const resolved = await resolveTranslator();
        if (controller.signal.aborted) return;
        if ("error" in resolved) {
          setError(resolved.error);
          return;
        }
        for (let i = 0; i < chunks.length; i++) {
          if (controller.signal.aborted) return;
          try {
            const out = await resolved.translator.translate(
              { text: chunks[i]!, targetLang: config.targetLang },
              { signal: controller.signal },
            );
            if (controller.signal.aborted) return;
            setEngine(out.engine);
            setSegments((prev) =>
              prev.map((s, idx) => (idx === i ? { ...s, result: out.text } : s)),
            );
          } catch (e) {
            if (controller.signal.aborted) return;
            setSegments((prev) =>
              prev.map((s, idx) =>
                idx === i ? { ...s, error: e instanceof Error ? e.message : String(e) } : s,
              ),
            );
          }
          setProgress({ done: i + 1, total: chunks.length });
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : String(e));
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
    [config.targetLang],
  );

  // Selection → single-pair translation (seq bumps to re-trigger same text).
  useEffect(() => {
    if (!source.trim()) return;
    void translateChunks([source], "selection");
    return () => cancelRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, seq]);

  const translatePage = useCallback(async () => {
    const pageNum = Number(pageInput);
    if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > doc.pageCount) {
      setError(`请输入 1–${doc.pageCount} 之间的页码`);
      return;
    }
    const { text } = await doc.getPageText(pageNum - 1);
    if (!text.trim()) {
      setError("这一页没有可提取的文本(可能是扫描版)");
      return;
    }
    await translateChunks(splitForTranslation(text), "page");
  }, [pageInput, doc, translateChunks]);

  const translateFullText = useCallback(async () => {
    const full = await extractFullText(doc, Math.min(doc.pageCount, 40));
    if (!full.trim()) {
      setError("无法从文档提取文本(可能是扫描版)");
      return;
    }
    await translateChunks(splitForTranslation(full), "full");
  }, [doc, translateChunks]);

  const copyAll = useCallback(async () => {
    if (copyingAllRef.current) return;
    const translated = segments
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
        message: `复制失败:${e instanceof Error ? e.message : String(e)}`,
        tone: "danger",
      });
    } finally {
      copyingAllRef.current = false;
      setCopyingAll(false);
    }
  }, [segments]);

  const pageTranslating = translateAction === "page";
  const fullTextTranslating = translateAction === "full";

  return (
    <div className="reader-translate-panel" aria-busy={busy || undefined}>
      <div className="reader-translate-controls">
        <div className="reader-translate-controls__row">
          <span className="reader-translate-controls__label">翻译本页</span>
          <input
            type="number"
            className="au-input reader-translate-pageinput"
            min={1}
            max={doc.pageCount}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            disabled={busy}
          />
          <span className="au-text-muted" style={{ fontSize: 12 }}>
            / {doc.pageCount}
          </span>
          <Button
            variant="secondary"
            style={{ fontSize: 12 }}
            onClick={() => void translatePage()}
            disabled={busy}
            aria-busy={pageTranslating || undefined}
          >
            {pageTranslating ? "翻译中..." : "翻译该页"}
          </Button>
        </div>
        <div className="reader-translate-controls__row">
          <Button
            variant="ghost"
            style={{ fontSize: 12 }}
            onClick={() => void translateFullText()}
            disabled={busy}
            aria-busy={fullTextTranslating || undefined}
          >
            {fullTextTranslating ? "翻译中..." : "翻译全文(前 40 页)"}
          </Button>
          {busy && (
            <Button variant="ghost" style={{ fontSize: 12 }} onClick={cancel}>
              取消
            </Button>
          )}
          {segments.length > 1 && !busy && (
            <Button
              variant="ghost"
              style={{ fontSize: 12 }}
              onClick={() => void copyAll()}
              disabled={copyingAll}
              aria-busy={copyingAll || undefined}
            >
              {copyingAll ? "复制中..." : "复制全部译文"}
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
        <p className="au-text-muted" style={{ fontSize: 11.5, margin: 0 }}>
          目标语言:{langLabel(config.targetLang)} · 引擎:
          {config.engine === "llm" ? "大模型" : config.engine}
          {engine ? ` (${engine})` : ""}（设置页可调整）。或在左侧选中文本点「译」。
        </p>
      </div>

      {error && <p style={{ fontSize: 12.5, color: "var(--color-danger)" }}>{error}</p>}
      {progress && (
        <p className="au-text-muted" style={{ fontSize: 12 }}>
          翻译中… {progress.done}/{progress.total} 段
        </p>
      )}

      {segments.length === 0 && !error ? (
        <p className="au-text-muted" style={{ fontSize: 13 }}>
          选中 PDF 文本点「译」做即时翻译，或用上方按钮翻译整页 / 全文(原文 ⇄ 译文对照)。
        </p>
      ) : (
        segments.map((seg, i) => (
          <div className="reader-translate-pair" key={i}>
            <p className="reader-translate-text reader-translate-text--source">{seg.source}</p>
            {seg.error ? (
              <p style={{ fontSize: 12, color: "var(--color-danger)", margin: "4px 0 0" }}>
                {seg.error}
              </p>
            ) : (
              <p className="reader-translate-text">
                {seg.result ?? <span className="au-text-muted">…</span>}
              </p>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/** 重点 tab: the paper's AI digest (cards generated at import or on demand). */
function DigestPanel({ workId, title }: { workId: string; title: string }) {
  const [cards, setCards] = useState<FlashcardRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generatingRef = useRef(false);

  const refresh = useCallback(async () => {
    const db = await getDb();
    setCards(await new FlashcardsRepo(db).forWork(workId));
  }, [workId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A generation job may still be running in the background — poll briefly
  // until cards appear (or a persisted ai_jobs error surfaces), then stop.
  useEffect(() => {
    if (cards.length > 0 || error) return;
    let attempts = 0;
    let cancelled = false;
    const timer = setInterval(async () => {
      attempts += 1;
      const db = await getDb();
      const nextCards = await new FlashcardsRepo(db).forWork(workId);
      if (cancelled) return;
      setCards(nextCards);
      if (nextCards.length > 0) {
        clearInterval(timer);
        return;
      }
      const jobs = await db.query<{ status: string; error: string | null }>(
        `SELECT status, error FROM ai_jobs WHERE work_id = ? ORDER BY created_at DESC LIMIT 1`,
        [workId],
      );
      if (cancelled) return;
      if (jobs[0]?.status === "error" && jobs[0].error) {
        setError(jobs[0].error);
        clearInterval(timer);
      } else if (attempts >= 20) {
        clearInterval(timer);
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [cards.length, error, workId]);

  const generate = useCallback(async () => {
    if (generatingRef.current) return;
    const startedAt = Date.now();
    generatingRef.current = true;
    setGenerating(true);
    setError(null);
    try {
      const { generateFlashcardsForWork } = await import("../services/ai");
      await generateFlashcardsForWork(workId, title);
      await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
      await refresh();
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_READER_WRITE_BUSY_MS);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }, [workId, title, refresh]);

  const TYPE_LABEL: Record<string, string> = {
    tldr: "一句话",
    method: "问题与方法",
    contribution: "贡献",
    limitation: "结果与局限",
    qa: "自测",
  };

  return (
    <div className="reader-digest-panel" aria-busy={generating || undefined}>
      {cards.length === 0 ? (
        <div className="reader-digest-empty">
          <p className="au-text-muted" style={{ fontSize: 13 }}>
            还没有提取重点。
            <br />
            AI 会从全文提炼核心贡献、方法与局限。
          </p>
          {generating && (
            <p className="reader-digest-status" role="status">
              正在提取重点，完成后会同步到「闪卡」。
            </p>
          )}
          <Button
            onClick={() => void generate()}
            disabled={generating}
            aria-busy={generating || undefined}
          >
            {generating ? "提取中..." : "提取重点"}
          </Button>
          {error && <p className="reader-digest-error">{error}</p>}
        </div>
      ) : (
        <>
          {cards.map((c) => (
            <div key={c.id} className="reader-digest-card">
              <div style={{ marginBottom: 6 }}>
                <Badge variant="neutral">{TYPE_LABEL[c.card_type] ?? c.card_type}</Badge>
              </div>
              <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>{c.front_md}</p>
              <p
                style={{
                  fontSize: 13,
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  color: "var(--color-text-secondary)",
                }}
              >
                {c.back_md}
              </p>
            </div>
          ))}
          <Button
            variant="secondary"
            style={{ fontSize: 12 }}
            onClick={() => void generate()}
            disabled={generating}
            aria-busy={generating || undefined}
          >
            {generating ? "提取中..." : "重新提取"}
          </Button>
          {generating && (
            <p className="reader-digest-status" role="status">
              正在重新提取重点，完成后会同步到「闪卡」。
            </p>
          )}
          {error && <p className="reader-digest-error">{error}</p>}
          <p className="au-text-muted" style={{ fontSize: 11, margin: 0 }}>
            这些卡片同时进入「闪卡」页的间隔复习队列
          </p>
        </>
      )}
    </div>
  );
}
