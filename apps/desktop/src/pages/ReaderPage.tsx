// Reader page: open a local PDF and read/annotate it. For now annotations
// live in component state; persistence into @aurascholar/db lands with the
// repository layer.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PdfDocument,
  PdfReader,
  configureWorker,
  type ReaderAnnotation,
} from "@aurascholar/reader";
import { newId } from "@aurascholar/db";
import { Button, Card } from "@aurascholar/ui";
import "@aurascholar/reader/reader.css";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

configureWorker(workerSrc);

type PageFilter = "none" | "sepia" | "invert";

export function ReaderPage() {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([]);
  const [pageFilter, setPageFilter] = useState<PageFilter>("none");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Destroy the pdf.js document when replaced or on unmount.
  useEffect(() => () => doc?.destroy(), [doc]);

  const openFile = useCallback(async (file: File) => {
    const data = new Uint8Array(await file.arrayBuffer());
    const loaded = await PdfDocument.load(data);
    setFileName(file.name);
    setAnnotations([]);
    setDoc(loaded);
  }, []);

  const handleCreate = useCallback((a: Omit<ReaderAnnotation, "id">) => {
    setAnnotations((prev) => [...prev, { ...a, id: newId() }]);
  }, []);

  if (!doc) {
    return (
      <div>
        <h1 className="app-page-title">阅读器</h1>
        <p className="app-page-subtitle">打开一篇 PDF,选中文字即可高亮与批注</p>
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
        <strong style={{ fontFamily: "var(--font-heading)", fontSize: 14 }}>{fileName}</strong>
        <span className="au-text-muted" style={{ fontSize: 12 }}>
          {doc.pageCount} 页 · {annotations.length} 条批注
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
          <Button variant="secondary" onClick={() => setDoc(null)}>
            关闭
          </Button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <PdfReader
          doc={doc}
          annotations={annotations}
          onCreateAnnotation={handleCreate}
          pageFilter={pageFilter}
        />
      </div>
    </div>
  );
}
