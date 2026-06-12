import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, Input } from "@aurascholar/ui";
import type { WorkWithAuthors } from "@aurascholar/db";
import { ingestFromInput, ingestFromPdf, listWorks } from "../services/library";
import { generateFlashcardsForWork } from "../services/ai";

export function LibraryPage() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<WorkWithAuthors[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (q?: string) => {
    setItems(await listWorks(q));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(search), 250);
    return () => clearTimeout(t);
  }, [search, refresh]);

  const handleAdd = useCallback(async () => {
    if (!input.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await ingestFromInput(input);
      if (!result) {
        setMessage("无法识别输入 — 请提供 DOI、arXiv ID、论文链接或标题");
      } else {
        setMessage(
          result.deduped
            ? `已在库中:${result.title}`
            : `已入库:${result.title}${result.pdfFetched ? "(含 PDF)" : "(未找到开放获取 PDF)"}`,
        );
        setInput("");
        await refresh();
      }
    } catch (e) {
      setMessage(`入库失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [input, busy, refresh]);

  const handleUpload = useCallback(
    async (file: File) => {
      setBusy(true);
      setMessage(null);
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const result = await ingestFromPdf(file.name, data);
        setMessage(
          result.needsConfirmation
            ? `已入库(未能自动识别元数据):${result.title}`
            : `已入库:${result.title}`,
        );
        await refresh();
      } catch (e) {
        setMessage(`上传失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const handleGenerateCards = useCallback(async (workId: string, title: string) => {
    setGeneratingId(workId);
    setMessage(null);
    try {
      const { created } = await generateFlashcardsForWork(workId, title);
      setMessage(`已为《${title}》生成 ${created} 张闪卡 — 去"闪卡复习"页查看`);
    } catch (e) {
      setMessage(`闪卡生成失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGeneratingId(null);
    }
  }, []);

  return (
    <div>
      <h1 className="app-page-title">文献库</h1>
      <p className="app-page-subtitle">通过 DOI、论文链接或本地 PDF 添加文献</p>

      <Card style={{ maxWidth: 720, marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
          <Input
            placeholder="粘贴 DOI / arXiv ID / 论文链接 / 标题…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
            disabled={busy}
          />
          <Button onClick={() => void handleAdd()} disabled={busy}>
            {busy ? "处理中…" : "添加"}
          </Button>
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            上传 PDF
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
              e.target.value = "";
            }}
          />
        </div>
        {message && (
          <p style={{ fontSize: 13, margin: 0, color: "var(--color-text-secondary)" }}>{message}</p>
        )}
      </Card>

      <div style={{ maxWidth: 720, marginBottom: 16 }}>
        <Input
          placeholder="搜索标题、摘要、笔记…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {items.length === 0 ? (
        <p className="au-text-muted">库是空的 — 添加你的第一篇文献吧。</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
          {items.map((w) => (
            <Card
              key={w.id}
              style={{ cursor: "pointer", padding: 16 }}
              onClick={() => navigate(`/reader?work=${w.id}`)}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <strong style={{ fontFamily: "var(--font-heading)", fontSize: 15, flex: 1 }}>
                  {w.title}
                </strong>
                {w.year && <Badge variant="neutral">{w.year}</Badge>}
              </div>
              <div className="au-text-muted" style={{ fontSize: 13, marginTop: 4 }}>
                {w.authorNames.slice(0, 4).join(", ")}
                {w.authorNames.length > 4 && " 等"}
                {w.venue_name && ` · ${w.venue_name}`}
              </div>
              <div style={{ marginTop: 8 }}>
                <Button
                  variant="ghost"
                  style={{ fontSize: 12, padding: "4px 8px" }}
                  disabled={generatingId !== null}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleGenerateCards(w.id, w.title);
                  }}
                >
                  {generatingId === w.id ? "生成中…" : "🗂️ 生成闪卡"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
