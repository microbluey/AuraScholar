import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, Input } from "@aurascholar/ui";
import {
  CollectionsRepo,
  WorksRepo,
  type CollectionRow,
  type WorkWithAuthors,
} from "@aurascholar/db";
import { getDb } from "../services/tauri-db";
import { ingestFromInput, ingestFromPdf, listWorks } from "../services/library";
import { generateFlashcardsForWork } from "../services/ai";

export function LibraryPage() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<WorkWithAuthors[]>([]);
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [workCollections, setWorkCollections] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const db = await getDb();
    const colRepo = new CollectionsRepo(db);
    setCollections(await colRepo.list());
    const works = await listWorks(search || undefined, activeCollection ?? undefined);
    setItems(works);
    setWorkCollections(await colRepo.collectionsOf(works.map((w) => w.id)));
  }, [search, activeCollection]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [refresh, search]);

  const autoDigest = useCallback((workId: string, title: string) => {
    void generateFlashcardsForWork(workId, title)
      .then(() => setMessage(`已入库并提取重点:${title}`))
      .catch(() => {}); // no AI config / scanned PDF — manual extraction remains
  }, []);

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
            : `已入库:${result.title}${result.pdfFetched ? "(含 PDF,正在后台提取重点…)" : "(未找到开放获取 PDF)"}`,
        );
        if (!result.deduped && result.pdfFetched) autoDigest(result.workId, result.title);
        setInput("");
        await refresh();
      }
    } catch (e) {
      setMessage(`入库失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [input, busy, refresh, autoDigest]);

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
            : `已入库:${result.title}(正在后台提取重点…)`,
        );
        if (!result.deduped) autoDigest(result.workId, result.title);
        await refresh();
      } catch (e) {
        setMessage(`上传失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [refresh, autoDigest],
  );

  const handleNewFolder = useCallback(async () => {
    const name = window.prompt("新建文件夹名称:");
    if (!name?.trim()) return;
    const db = await getDb();
    await new CollectionsRepo(db).create(name.trim());
    await refresh();
  }, [refresh]);

  const handleDeleteFolder = useCallback(
    async (id: string, name: string) => {
      if (!window.confirm(`删除文件夹「${name}」?其中的文献会回到“全部文献”,不会被删除。`)) return;
      const db = await getDb();
      await new CollectionsRepo(db).softDelete(id);
      if (activeCollection === id) setActiveCollection(null);
      await refresh();
    },
    [activeCollection, refresh],
  );

  const handleMoveWork = useCallback(
    async (workId: string, collectionId: string | null) => {
      const db = await getDb();
      await new CollectionsRepo(db).setWorkCollection(workId, collectionId);
      await refresh();
    },
    [refresh],
  );

  const handleDeleteWork = useCallback(
    async (work: WorkWithAuthors) => {
      if (!window.confirm(`从文献库删除《${work.title}》?批注与闪卡也将一并隐藏。`)) return;
      const db = await getDb();
      await new WorksRepo(db).softDelete(work.id);
      await refresh();
    },
    [refresh],
  );

  return (
    <div style={{ display: "flex", gap: 20, height: "100%", alignItems: "stretch" }}>
      {/* Folder sidebar */}
      <div style={{ width: 200, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <h3 className="au-heading" style={{ fontSize: 14 }}>
            文件夹
          </h3>
          <button
            className="au-annsidebar__add-comment"
            style={{ marginLeft: "auto", fontSize: 16 }}
            title="新建文件夹"
            onClick={() => void handleNewFolder()}
          >
            +
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <FolderItem
            label="📚 全部文献"
            active={activeCollection === null}
            onClick={() => setActiveCollection(null)}
          />
          {collections.map((c) => (
            <FolderItem
              key={c.id}
              label={`📁 ${c.name}`}
              active={activeCollection === c.id}
              onClick={() => setActiveCollection(c.id)}
              onDelete={() => void handleDeleteFolder(c.id, c.name)}
            />
          ))}
        </div>
      </div>

      {/* Main column */}
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
        <h1 className="app-page-title">文献库</h1>
        <p className="app-page-subtitle">通过 DOI、论文链接或本地 PDF 添加文献,点击文献开始阅读</p>

        <Card style={{ maxWidth: 720, marginBottom: 16 }}>
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
          <Input placeholder="搜索标题、摘要、笔记…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {items.length === 0 ? (
          <p className="au-text-muted">
            {activeCollection ? "这个文件夹是空的。" : "库是空的 — 添加你的第一篇文献吧。"}
          </p>
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
                <div
                  style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <select
                    className="au-input"
                    style={{ width: "auto", padding: "3px 6px", fontSize: 12 }}
                    value={workCollections.get(w.id) ?? ""}
                    onChange={(e) => void handleMoveWork(w.id, e.target.value || null)}
                    title="移动到文件夹"
                  >
                    <option value="">未分类</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        📁 {c.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    style={{ fontSize: 12, padding: "4px 8px", marginLeft: "auto" }}
                    onClick={() => void handleDeleteWork(w)}
                  >
                    🗑️ 删除
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FolderItem({
  label,
  active,
  onClick,
  onDelete,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className="app-nav-item"
      style={{
        cursor: "pointer",
        background: active ? "var(--color-accent-subtle)" : undefined,
        color: active ? "var(--color-accent-strong)" : undefined,
        fontWeight: active ? 500 : undefined,
        display: "flex",
      }}
      onClick={onClick}
    >
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {onDelete && (
        <button
          className="au-annsidebar__action"
          style={{ flexShrink: 0 }}
          title="删除文件夹"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
