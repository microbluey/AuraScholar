// Reader page: PDF + right panel with three tabs — 批注 / 重点 (AI digest,
// generated at import time or on demand) / 脉络 (citation graph of this paper).
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AnnotationSidebar,
  PdfDocument,
  PdfReader,
  annotationsToMarkdown,
  configureWorker,
  extractFullText,
  type ReaderAnnotation,
} from "@aurascholar/reader";
import {
  newId,
  AnnotationsRepo,
  FlashcardsRepo,
  WorksRepo,
  type AnnotationRow,
  type FlashcardRow,
} from "@aurascholar/db";
import { Badge, Button, Card } from "@aurascholar/ui";
import "@aurascholar/reader/reader.css";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getDb } from "../services/tauri-db";
import { loadPdfForWork } from "../services/library";
import { generateFlashcardsForWork } from "../services/ai";
import { resolveTranslator, loadTranslateConfig } from "../services/translate";
import { langLabel, splitForTranslation } from "@aurascholar/translate";
import { addSnippet } from "../services/snippets";
import { CitationGraphView } from "../components/CitationGraphView";

configureWorker(workerSrc);

type PageFilter = "none" | "sepia" | "invert";
type PanelTab = "annotations" | "translate" | "digest" | "graph";

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

export function ReaderPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const workIdParam = params.get("work");
  const tabParam = params.get("tab") as PanelTab | null;
  const [ctx, setCtx] = useState<OpenContext | null>(null);
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!snippetToast) return;
    const t = setTimeout(() => setSnippetToast(null), 2500);
    return () => clearTimeout(t);
  }, [snippetToast]);

  useEffect(() => () => ctx?.doc.destroy(), [ctx]);

  useEffect(() => {
    if (!workIdParam) return;
    let cancelled = false;
    void (async () => {
      setLoadError(null);
      const pdf = await loadPdfForWork(workIdParam);
      if (cancelled) return;
      if (!pdf) {
        setLoadError(
          "这篇文献还没有 PDF 附件(可能未找到开放获取版本)— 可以在下方手动打开本地文件。",
        );
        return;
      }
      const doc = await PdfDocument.load(pdf.data);
      const db = await getDb();
      const rows = await new AnnotationsRepo(db).listForAttachment(pdf.attachmentId);
      const work = await new WorksRepo(db).get(workIdParam);
      if (cancelled) {
        doc.destroy();
        return;
      }
      setAnnotations(rows.map(rowToAnnotation));
      setCtx({
        doc,
        fileName: work?.title ?? "文献库文档",
        workId: workIdParam,
        attachmentId: pdf.attachmentId,
        workTitle: work?.title,
        workAuthors: work?.authorNames,
        workYear: work?.year ?? undefined,
        workDoi: work?.doi ?? undefined,
      });
    })().catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [workIdParam]);

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
    (text: string, pageIndex: number) => {
      if (!ctx?.workId) {
        setSnippetToast("请先入库,素材会关联到对应文献");
        return;
      }
      void addSnippet({ workId: ctx.workId, pageIndex, quote: text })
        .then(() => setSnippetToast("已存为写作素材"))
        .catch((e) => setSnippetToast(`保存失败:${e instanceof Error ? e.message : String(e)}`));
    },
    [ctx?.workId],
  );

  const openFile = useCallback(async (file: File) => {
    const data = new Uint8Array(await file.arrayBuffer());
    const loaded = await PdfDocument.load(data);
    setAnnotations([]);
    setCtx({ doc: loaded, fileName: file.name });
  }, []);

  const handleCreate = useCallback(
    (a: Omit<ReaderAnnotation, "id">) => {
      if (ctx?.workId && ctx.attachmentId) {
        void (async () => {
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
        })();
      } else {
        setAnnotations((prev) => [...prev, { ...a, id: newId() }]);
      }
    },
    [ctx],
  );

  const handleDelete = useCallback(
    (id: string) => {
      setAnnotations((prev) => prev.filter((x) => x.id !== id));
      if (ctx?.workId) void getDb().then((db) => new AnnotationsRepo(db).softDelete(id));
    },
    [ctx],
  );

  const handleSaveComment = useCallback(
    (id: string, contentMd: string) => {
      setAnnotations((prev) => prev.map((x) => (x.id === id ? { ...x, contentMd } : x)));
      if (ctx?.workId) void getDb().then((db) => new AnnotationsRepo(db).updateContent(id, contentMd));
    },
    [ctx],
  );

  const handleExport = useCallback(() => {
    if (!ctx) return;
    const md = annotationsToMarkdown(
      { title: ctx.workTitle ?? ctx.fileName, authors: ctx.workAuthors, year: ctx.workYear, doi: ctx.workDoi },
      annotations,
    );
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(ctx.workTitle ?? ctx.fileName).slice(0, 60)}-笔记.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [ctx, annotations]);

  if (!ctx) {
    return (
      <div style={{ padding: 32 }}>
        <h1 className="app-page-title">阅读器</h1>
        <p className="app-page-subtitle">从文献库点击一篇文献,或打开本地 PDF</p>
        {loadError && <p style={{ color: "var(--color-warning)", fontSize: 14 }}>{loadError}</p>}
        <Card style={{ maxWidth: 480 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openFile(f);
            }}
          />
          <Button onClick={() => fileInputRef.current?.click()}>选择 PDF 文件…</Button>
        </Card>
      </div>
    );
  }

  const tabs: Array<{ key: PanelTab; label: string; disabled?: boolean; title?: string }> = [
    { key: "annotations", label: `批注 ${annotations.length}` },
    { key: "translate", label: "译文" },
    { key: "digest", label: "重点", disabled: !ctx.workId, title: ctx.workId ? undefined : "需先入库" },
    { key: "graph", label: "脉络", disabled: !ctx.workDoi, title: ctx.workDoi ? undefined : "无 DOI,无法构建图谱" },
  ];

  return (
    <div className="reader-workspace">
      {snippetToast && <div className="reader-toast">{snippetToast}</div>}
      <div className="reader-topbar">
        <div className="reader-topbar__identity">
          <span className="reader-topbar__kicker">Reader</span>
          <strong title={ctx.fileName}>{ctx.fileName}</strong>
        </div>
        <span className="reader-topbar__meta">
          {ctx.doc.pageCount} 页{ctx.workId ? "" : " · 未入库(批注不保存)"}
        </span>
        <div className="reader-topbar__actions">
          <select
            className="au-input"
            value={pageFilter}
            onChange={(e) => setPageFilter(e.target.value as PageFilter)}
          >
            <option value="none">原色</option>
            <option value="sepia">护眼</option>
            <option value="invert">夜间反色</option>
          </select>
          <Button variant="ghost" style={{ fontSize: 13 }} onClick={handleExport} disabled={annotations.length === 0}>
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
              <span>研究面板</span>
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
                  onJump={(ann) => {
                    setActiveId(ann.id);
                    setJumpPage(ann.pageIndex);
                    setTimeout(() => setJumpPage(null), 100);
                  }}
                  onSaveComment={handleSaveComment}
                  onDelete={handleDelete}
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
              {ctx.workDoi && (
                <div style={{ height: "100%", display: tab === "graph" ? "block" : "none" }}>
                  <CitationGraphView doi={ctx.workDoi} height={400} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface TranslatedSegment {
  source: string;
  result: string | null;
  error?: string;
}

/**
 * 译文 tab. Two modes:
 *  - selection: text selected in the PDF + 译 button → single original/translation pair
 *  - page / full text: extract page text from the doc, chunk it, translate each
 *    chunk sequentially (cancellable) with progress, rendered as comparison pairs
 */
function TranslatePanel({
  source,
  seq,
  doc,
}: {
  source: string;
  seq: number;
  doc: PdfDocument;
}) {
  const [segments, setSegments] = useState<TranslatedSegment[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState("1");
  const cancelRef = useRef<AbortController | null>(null);
  const config = loadTranslateConfig();

  const cancel = useCallback(() => {
    cancelRef.current?.abort();
    cancelRef.current = null;
    setBusy(false);
    setProgress(null);
  }, []);

  // Translate an arbitrary list of source chunks sequentially with progress.
  const translateChunks = useCallback(
    async (chunks: string[]) => {
      const resolved = resolveTranslator();
      if ("error" in resolved) {
        setError(resolved.error);
        return;
      }
      cancelRef.current?.abort();
      const controller = new AbortController();
      cancelRef.current = controller;
      setError(null);
      setBusy(true);
      setEngine(null);
      setSegments(chunks.map((c) => ({ source: c, result: null })));
      setProgress({ done: 0, total: chunks.length });
      try {
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
      } finally {
        if (cancelRef.current === controller) {
          cancelRef.current = null;
          setBusy(false);
          setProgress(null);
        }
      }
    },
    [config.targetLang],
  );

  // Selection → single-pair translation (seq bumps to re-trigger same text).
  useEffect(() => {
    if (!source.trim()) return;
    void translateChunks([source]);
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
    await translateChunks(splitForTranslation(text));
  }, [pageInput, doc, translateChunks]);

  const translateFullText = useCallback(async () => {
    const full = await extractFullText(doc, Math.min(doc.pageCount, 40));
    if (!full.trim()) {
      setError("无法从文档提取文本(可能是扫描版)");
      return;
    }
    await translateChunks(splitForTranslation(full));
  }, [doc, translateChunks]);

  const copyAll = useCallback(() => {
    const text = segments.map((s) => s.result ?? "").join("\n\n");
    void navigator.clipboard?.writeText(text);
  }, [segments]);

  return (
    <div className="reader-translate-panel">
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
          <Button variant="secondary" style={{ fontSize: 12 }} onClick={() => void translatePage()} disabled={busy}>
            翻译该页
          </Button>
        </div>
        <div className="reader-translate-controls__row">
          <Button variant="ghost" style={{ fontSize: 12 }} onClick={() => void translateFullText()} disabled={busy}>
            翻译全文(前 40 页)
          </Button>
          {busy && (
            <Button variant="ghost" style={{ fontSize: 12 }} onClick={cancel}>
              取消
            </Button>
          )}
          {segments.length > 1 && !busy && (
            <Button variant="ghost" style={{ fontSize: 12 }} onClick={copyAll}>
              复制全部译文
            </Button>
          )}
        </div>
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

  const refresh = useCallback(async () => {
    const db = await getDb();
    setCards(await new FlashcardsRepo(db).forWork(workId));
  }, [workId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Import-time extraction may still be running in the background — poll
  // until cards appear (or an ai_jobs error surfaces), then stop.
  useEffect(() => {
    if (cards.length > 0) return;
    const timer = setInterval(async () => {
      await refresh();
      const db = await getDb();
      const jobs = await db.query<{ status: string; error: string | null }>(
        `SELECT status, error FROM ai_jobs WHERE work_id = ? ORDER BY created_at DESC LIMIT 1`,
        [workId],
      );
      if (jobs[0]?.status === "error" && jobs[0].error) setError(jobs[0].error);
    }, 3000);
    return () => clearInterval(timer);
  }, [cards.length, refresh, workId]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      await generateFlashcardsForWork(workId, title);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
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
    <div className="reader-digest-panel">
      {cards.length === 0 ? (
        <div className="reader-digest-empty">
          <p className="au-text-muted" style={{ fontSize: 13 }}>
            还没有提取重点。
            <br />
            AI 会从全文提炼核心贡献、方法与局限。
          </p>
          <Button onClick={() => void generate()} disabled={generating}>
            {generating ? "提取中..." : "提取重点"}
          </Button>
          {error && <p style={{ fontSize: 12, color: "var(--color-danger)", marginTop: 8 }}>{error}</p>}
        </div>
      ) : (
        <>
          {cards.map((c) => (
            <div
              key={c.id}
              className="reader-digest-card"
            >
              <div style={{ marginBottom: 6 }}>
                <Badge variant="neutral">{TYPE_LABEL[c.card_type] ?? c.card_type}</Badge>
              </div>
              <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>{c.front_md}</p>
              <p style={{ fontSize: 13, margin: 0, whiteSpace: "pre-wrap", color: "var(--color-text-secondary)" }}>
                {c.back_md}
              </p>
            </div>
          ))}
          <Button variant="secondary" style={{ fontSize: 12 }} onClick={() => void generate()} disabled={generating}>
            {generating ? "提取中…" : "重新提取"}
          </Button>
          {error && <p style={{ fontSize: 12, color: "var(--color-danger)" }}>{error}</p>}
          <p className="au-text-muted" style={{ fontSize: 11, margin: 0 }}>
            这些卡片同时进入「闪卡」页的间隔复习队列
          </p>
        </>
      )}
    </div>
  );
}
