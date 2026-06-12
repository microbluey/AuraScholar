// Reader page: open a work's PDF from the library (?work=<id>) or a local
// file. Annotations persist to the database when a library work is open;
// ad-hoc local files keep annotations in memory until saved to the library.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AnnotationSidebar,
  PdfDocument,
  PdfReader,
  annotationsToMarkdown,
  configureWorker,
  type ReaderAnnotation,
} from "@aurascholar/reader";
import { newId, AnnotationsRepo, WorksRepo, type AnnotationRow } from "@aurascholar/db";
import { Button, Card } from "@aurascholar/ui";
import "@aurascholar/reader/reader.css";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getDb } from "../services/tauri-db";
import { loadPdfForWork } from "../services/library";

configureWorker(workerSrc);

type PageFilter = "none" | "sepia" | "invert";

interface OpenContext {
  doc: PdfDocument;
  fileName: string;
  /** Set when opened from the library — enables persistence. */
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
  const [params] = useSearchParams();
  const workIdParam = params.get("work");
  const [ctx, setCtx] = useState<OpenContext | null>(null);
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([]);
  const [pageFilter, setPageFilter] = useState<PageFilter>("none");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [jumpPage, setJumpPage] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => ctx?.doc.destroy(), [ctx]);

  // Open from library when ?work= is present.
  useEffect(() => {
    if (!workIdParam) return;
    let cancelled = false;
    void (async () => {
      setLoadError(null);
      const pdf = await loadPdfForWork(workIdParam);
      if (cancelled) return;
      if (!pdf) {
        setLoadError("这篇文献还没有 PDF 附件 — 可以在下方手动打开本地文件。");
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
      if (ctx?.workId) {
        void getDb().then((db) => new AnnotationsRepo(db).softDelete(id));
      }
    },
    [ctx],
  );

  const handleSaveComment = useCallback(
    (id: string, contentMd: string) => {
      setAnnotations((prev) => prev.map((x) => (x.id === id ? { ...x, contentMd } : x)));
      if (ctx?.workId) {
        void getDb().then((db) => new AnnotationsRepo(db).updateContent(id, contentMd));
      }
    },
    [ctx],
  );

  const handleExport = useCallback(() => {
    if (!ctx) return;
    const md = annotationsToMarkdown(
      {
        title: ctx.workTitle ?? ctx.fileName,
        authors: ctx.workAuthors,
        year: ctx.workYear,
        doi: ctx.workDoi,
      },
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
      <div>
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", margin: -32 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          borderBottom: "var(--border-width) solid var(--color-border)",
        }}
      >
        <strong
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 14,
            maxWidth: 420,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {ctx.fileName}
        </strong>
        <span className="au-text-muted" style={{ fontSize: 12, flexShrink: 0 }}>
          {ctx.doc.pageCount} 页 · {annotations.length} 条批注
          {ctx.workId ? "" : " · 未入库(批注不会保存)"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <select
            className="au-input"
            style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}
            value={pageFilter}
            onChange={(e) => setPageFilter(e.target.value as PageFilter)}
          >
            <option value="none">原色</option>
            <option value="sepia">护眼</option>
            <option value="invert">夜间反色</option>
          </select>
          <Button variant="ghost" onClick={handleExport} disabled={annotations.length === 0}>
            导出笔记
          </Button>
          <Button variant="ghost" onClick={() => setSidebarOpen((v) => !v)}>
            {sidebarOpen ? "隐藏批注" : "显示批注"}
          </Button>
          <Button variant="secondary" onClick={() => setCtx(null)}>
            关闭
          </Button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PdfReader
            doc={ctx.doc}
            annotations={annotations}
            onCreateAnnotation={handleCreate}
            onAnnotationClick={setActiveId}
            pageFilter={pageFilter}
            scrollToPage={jumpPage}
          />
        </div>
        {sidebarOpen && (
          <div style={{ width: 300, flexShrink: 0 }}>
            <AnnotationSidebar
              annotations={annotations}
              activeId={activeId}
              onJump={(ann) => {
                setActiveId(ann.id);
                setJumpPage(ann.pageIndex);
                // Reset so jumping to the same page twice still triggers.
                setTimeout(() => setJumpPage(null), 100);
              }}
              onSaveComment={handleSaveComment}
              onDelete={handleDelete}
            />
          </div>
        )}
      </div>
    </div>
  );
}
