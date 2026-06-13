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
import { langLabel } from "@aurascholar/translate";
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
                <TranslatePanel source={translateSource} seq={translateSeq} />
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

/** 译文 tab: select PDF text + tap 译 → original ⇄ translation, copyable. */
function TranslatePanel({ source, seq }: { source: string; seq: number }) {
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<string | null>(null);
  const config = loadTranslateConfig();

  // Re-run whenever a new selection arrives (seq bumps even on identical text).
  useEffect(() => {
    if (!source.trim()) return;
    let cancelled = false;
    const controller = new AbortController();
    setBusy(true);
    setError(null);
    setResult(null);
    void (async () => {
      const resolved = resolveTranslator();
      if ("error" in resolved) {
        if (!cancelled) setError(resolved.error);
        return;
      }
      try {
        const out = await resolved.translator.translate(
          { text: source, targetLang: config.targetLang },
          { signal: controller.signal },
        );
        if (!cancelled) {
          setResult(out.text);
          setEngine(out.engine);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, seq]);

  if (!source.trim()) {
    return (
      <div className="reader-digest-panel">
        <p className="au-text-muted" style={{ fontSize: 13 }}>
          在左侧选中 PDF 文本，点击工具条上的「译」按钮，这里会显示对照译文。
          <br />
          目标语言:{langLabel(config.targetLang)} · 引擎:{config.engine === "llm" ? "大模型" : config.engine}
          （可在设置页调整）
        </p>
      </div>
    );
  }

  return (
    <div className="reader-translate-panel">
      <div className="reader-translate-block">
        <div className="reader-translate-block__head">
          <span>原文</span>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(source)}>
            复制
          </button>
        </div>
        <p className="reader-translate-text reader-translate-text--source">{source}</p>
      </div>
      <div className="reader-translate-block">
        <div className="reader-translate-block__head">
          <span>译文 {engine ? `· ${engine}` : ""}</span>
          {result && (
            <button type="button" onClick={() => void navigator.clipboard?.writeText(result)}>
              复制
            </button>
          )}
        </div>
        {busy ? (
          <p className="au-text-muted" style={{ fontSize: 13 }}>
            翻译中…
          </p>
        ) : error ? (
          <p style={{ fontSize: 12.5, color: "var(--color-danger)" }}>{error}</p>
        ) : (
          <p className="reader-translate-text">{result}</p>
        )}
      </div>
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
