import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Input } from "@aurascholar/ui";
import {
  AttachmentsRepo,
  CollectionsRepo,
  FlashcardsRepo,
  TagsRepo,
  WorksRepo,
  type AttachmentRow,
  type CollectionRow,
  type TagRow,
  type WorkWithAuthors,
} from "@aurascholar/db";
import { getDb } from "../services/tauri-db";
import { ingestFromInput, ingestFromPdf, listWorks } from "../services/library";
import { generateFlashcardsForWork } from "../services/ai";
import { exportWorks, bibliographyText, type ExportFormat } from "../services/cite";
import { importReferences, previewReferences } from "../services/import-refs";
import { STYLES } from "@aurascholar/cite";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

type LibraryFilter = "all" | "reading" | "unread" | "noted" | "starred";
type SortMode = "added" | "year";
type DetailPanelTab = "overview" | "notes";

// How many works to show per page. The DB list() caps at a higher hard limit
// (works.ts:list default 200); paging is a client-side window over that set.
const PAGE_SIZE = 30;
const LIST_HARD_LIMIT = 1000;

interface LibraryViewDetail {
  filter?: LibraryFilter;
  collectionId?: string | null;
  tag?: string | null;
}

interface WorkRuntimeMeta {
  pdfCount: number;
  flashcardCount: number;
  annotationCount: number;
  pdfPreview: AttachmentRow | null;
  notePreviews: WorkNotePreview[];
  latestAiJobStatus: string | null;
  latestAiJobError: string | null;
}

interface WorkNotePreview {
  id: string;
  type: string;
  page_index: number;
  content_md: string | null;
  updated_at: number;
}

interface WorkTableMeta {
  tags: string[];
  references: number;
  citedBy: number;
  annotations: number;
}

function emptyWorkMeta(): WorkTableMeta {
  return {
    tags: [],
    references: 0,
    citedBy: 0,
    annotations: 0,
  };
}

export function LibraryPage() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<WorkWithAuthors[]>([]);
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [workMeta, setWorkMeta] = useState<Record<string, WorkTableMeta>>({});
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<LibraryFilter>("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("added");
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<WorkRuntimeMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(0);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [citeMenuOpen, setCiteMenuOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<{ count: number; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refsInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!isTauriRuntime()) {
      setCollections([]);
      setItems([]);
      setWorkMeta({});
      setMessage(
        (current) => current ?? "浏览器预览无法读取本地文献库，请在桌面应用中查看真实数据。",
      );
      return;
    }
    const db = await getDb();
    const colRepo = new CollectionsRepo(db);
    setCollections(await colRepo.list());
    const works = await listWorks(search || undefined, activeCollection ?? undefined, LIST_HARD_LIMIT);
    setItems(works);
    if (works.length === 0) {
      setWorkMeta({});
      window.dispatchEvent(new Event("aurascholar:library-updated"));
      return;
    }

    const ids = works.map((work) => work.id);
    const placeholders = ids.map(() => "?").join(",");
    const [tagRows, referenceRows, citedByRows, annotationRows] = await Promise.all([
      db.query<{ work_id: string; name: string }>(
        `SELECT wt.work_id, t.name
         FROM work_tags wt
         JOIN tags t ON t.id = wt.tag_id
         WHERE wt.work_id IN (${placeholders}) AND t.deleted_at IS NULL
         ORDER BY t.name`,
        ids,
      ),
      db.query<{ work_id: string; count: number }>(
        `SELECT citing_work_id AS work_id, COUNT(*) AS count
         FROM citations
         WHERE citing_work_id IN (${placeholders})
         GROUP BY citing_work_id`,
        ids,
      ),
      db.query<{ work_id: string; count: number }>(
        `SELECT cited_work_id AS work_id, COUNT(*) AS count
         FROM citations
         WHERE cited_work_id IN (${placeholders})
         GROUP BY cited_work_id`,
        ids,
      ),
      db.query<{ work_id: string; count: number }>(
        `SELECT work_id, COUNT(*) AS count
         FROM annotations
         WHERE work_id IN (${placeholders}) AND deleted_at IS NULL
         GROUP BY work_id`,
        ids,
      ),
    ]);

    const nextMeta = Object.fromEntries(works.map((work) => [work.id, emptyWorkMeta()])) as Record<
      string,
      WorkTableMeta
    >;
    for (const row of tagRows) {
      nextMeta[row.work_id]?.tags.push(row.name);
    }
    for (const row of referenceRows) {
      const meta = nextMeta[row.work_id];
      if (meta) meta.references = Number(row.count);
    }
    for (const row of citedByRows) {
      const meta = nextMeta[row.work_id];
      if (meta) meta.citedBy = Number(row.count);
    }
    for (const row of annotationRows) {
      const meta = nextMeta[row.work_id];
      if (meta) meta.annotations = Number(row.count);
    }
    setWorkMeta(nextMeta);
    window.dispatchEvent(new Event("aurascholar:library-updated"));
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
    if (!isTauriRuntime()) {
      setMessage("预览模式下不会写入本地数据库");
      return;
    }
    const name = window.prompt("新建文件夹名称:");
    if (!name?.trim()) return;
    const db = await getDb();
    await new CollectionsRepo(db).create(name.trim());
    await refresh();
  }, [refresh]);

  const handleDeleteFolder = useCallback(
    async (id: string, name: string) => {
      if (!isTauriRuntime()) {
        setMessage("预览模式下不会写入本地数据库");
        return;
      }
      if (!window.confirm(`删除文件夹「${name}」?其中的文献会回到“全部文献”,不会被删除。`)) return;
      const db = await getDb();
      await new CollectionsRepo(db).softDelete(id);
      if (activeCollection === id) setActiveCollection(null);
      await refresh();
    },
    [activeCollection, refresh],
  );

  useEffect(() => {
    const onLibraryView = (event: Event) => {
      const detail = (event as CustomEvent<LibraryViewDetail>).detail ?? {};
      setActiveFilter(detail.filter ?? "all");
      setActiveCollection(detail.collectionId ?? null);
      setActiveTag(detail.tag ?? null);
      setActiveSource(null);
      setSelectedWorkId(null);
    };
    const onCreateCollection = () => void handleNewFolder();
    const onManageTags = () => setTagManagerOpen(true);
    window.addEventListener("aurascholar:library-view", onLibraryView);
    window.addEventListener("aurascholar:create-collection", onCreateCollection);
    window.addEventListener("aurascholar:manage-tags", onManageTags);
    return () => {
      window.removeEventListener("aurascholar:library-view", onLibraryView);
      window.removeEventListener("aurascholar:create-collection", onCreateCollection);
      window.removeEventListener("aurascholar:manage-tags", onManageTags);
    };
  }, [handleNewFolder]);

  const handleTagFilter = useCallback(() => {
    const tagNames = Array.from(new Set(Object.values(workMeta).flatMap((meta) => meta.tags))).sort(
      (a, b) => a.localeCompare(b, "zh-CN"),
    );
    if (tagNames.length === 0) {
      setMessage("当前结果没有可筛选的标签");
      return;
    }
    const next = window.prompt("输入要筛选的标签名称，留空清除:", activeTag ?? tagNames[0]);
    if (next === null) return;
    setActiveTag(next.trim() || null);
  }, [activeTag, workMeta]);

  const handleSourceFilter = useCallback(() => {
    const sourceNames = Array.from(
      new Set(
        items
          .flatMap((work) => [work.venue_name, work.type, work.arxiv_id ? "arXiv" : null])
          .filter((value): value is string => Boolean(value?.trim())),
      ),
    ).sort((a, b) => a.localeCompare(b, "zh-CN"));
    if (sourceNames.length === 0) {
      setMessage("当前结果没有可筛选的来源");
      return;
    }
    const next = window.prompt("输入要筛选的来源，留空清除:", activeSource ?? sourceNames[0]);
    if (next === null) return;
    setActiveSource(next.trim() || null);
  }, [activeSource, items]);

  const isPreview = !isTauriRuntime();
  const filteredItems = useMemo(() => {
    const filtered = items.filter((work) => {
      if (activeTag && !(workMeta[work.id]?.tags ?? []).includes(activeTag)) return false;
      if (
        activeSource &&
        !`${work.venue_name ?? ""} ${work.type ?? ""} ${work.arxiv_id ? "arXiv" : ""}`
          .toLowerCase()
          .includes(activeSource.toLowerCase())
      ) {
        return false;
      }
      if (activeFilter === "reading") return work.reading_status === "reading";
      if (activeFilter === "unread") return work.reading_status === "unread";
      if (activeFilter === "noted") return (workMeta[work.id]?.annotations ?? 0) > 0;
      if (activeFilter === "starred") return work.starred === 1;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sortMode === "year") return (b.year ?? 0) - (a.year ?? 0);
      return (b.created_at ?? 0) - (a.created_at ?? 0);
    });
  }, [activeFilter, activeSource, activeTag, items, sortMode, workMeta]);
  const totalDisplay = items.length.toLocaleString("zh-CN");
  const tableRows = filteredItems;
  const pageCount = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedRows = useMemo(
    () => tableRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [tableRows, safePage],
  );
  const readingCount = items.filter((w) => w.reading_status === "reading").length;
  const unreadCount = items.filter((w) => w.reading_status === "unread").length;
  const notedCount = items.filter((w) => (workMeta[w.id]?.annotations ?? 0) > 0).length;
  const starredCount = items.filter((w) => w.starred === 1).length;

  const selectedWork = useMemo(
    () => tableRows.find((w) => w.id === selectedWorkId) ?? tableRows[0] ?? null,
    [tableRows, selectedWorkId],
  );

  useEffect(() => {
    if (tableRows.length === 0) {
      setSelectedWorkId(null);
      return;
    }
    if (!selectedWorkId || !tableRows.some((w) => w.id === selectedWorkId)) {
      setSelectedWorkId(tableRows[0]?.id ?? null);
    }
  }, [tableRows, selectedWorkId]);

  useEffect(() => {
    if (!selectedWork || !isTauriRuntime()) {
      setSelectedMeta(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const db = await getDb();
      const [attachments, flashcards, jobs, notes] = await Promise.all([
        new AttachmentsRepo(db).forWork(selectedWork.id),
        new FlashcardsRepo(db).forWork(selectedWork.id),
        db.query<{ status: string; error: string | null }>(
          `SELECT status, error FROM ai_jobs WHERE work_id = ? ORDER BY created_at DESC LIMIT 1`,
          [selectedWork.id],
        ),
        db.query<WorkNotePreview>(
          `SELECT id, type, page_index, content_md, updated_at
           FROM annotations
           WHERE work_id = ? AND deleted_at IS NULL
           ORDER BY updated_at DESC
           LIMIT 3`,
          [selectedWork.id],
        ),
      ]);
      if (cancelled) return;
      const pdfPreview = attachments.find((a) => a.kind === "pdf") ?? null;
      setSelectedMeta({
        pdfCount: attachments.filter((a) => a.kind === "pdf").length,
        flashcardCount: flashcards.length,
        annotationCount: workMeta[selectedWork.id]?.annotations ?? 0,
        pdfPreview,
        notePreviews: notes,
        latestAiJobStatus: jobs[0]?.status ?? null,
        latestAiJobError: jobs[0]?.error ?? null,
      });
    })().catch(() => {
      if (!cancelled) setSelectedMeta(null);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedWork, workMeta]);

  // Reset to first page whenever the filtered set changes shape.
  useEffect(() => {
    setPage(0);
  }, [activeFilter, activeSource, activeTag, activeCollection, search, sortMode]);

  // Close the cite dropdown on any outside click / Escape.
  useEffect(() => {
    if (!citeMenuOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (
        e instanceof MouseEvent &&
        (e.target as HTMLElement)?.closest?.(".library-cite-menu")
      ) {
        return;
      }
      setCiteMenuOpen(false);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [citeMenuOpen]);

  const selectWork = useCallback((work: WorkWithAuthors) => {
    setSelectedWorkId(work.id);
  }, []);

  const openReader = useCallback(
    (work: WorkWithAuthors) => {
      setSelectedWorkId(work.id);
      navigate(`/reader?work=${encodeURIComponent(work.id)}`);
    },
    [navigate],
  );

  const generateForSelected = useCallback(async () => {
    if (!selectedWork || generating) return;
    if (!isTauriRuntime()) {
      setMessage("浏览器预览没有本地数据库和 PDF 附件，无法生成闪卡");
      return;
    }
    setGenerating(true);
    setMessage(null);
    try {
      const result = await generateFlashcardsForWork(selectedWork.id, selectedWork.title);
      setMessage(`已为《${selectedWork.title}》生成 ${result.created} 张闪卡`);
      window.dispatchEvent(new Event("aurascholar:library-updated"));
      const db = await getDb();
      const cards = await new FlashcardsRepo(db).forWork(selectedWork.id);
      setSelectedMeta((prev) => ({
        pdfCount: prev?.pdfCount ?? 0,
        flashcardCount: cards.length,
        annotationCount: prev?.annotationCount ?? 0,
        pdfPreview: prev?.pdfPreview ?? null,
        notePreviews: prev?.notePreviews ?? [],
        latestAiJobStatus: "done",
        latestAiJobError: null,
      }));
    } catch (e) {
      setMessage(`生成闪卡失败:${e instanceof Error ? e.message : String(e)}`);
      setSelectedMeta((prev) => ({
        pdfCount: prev?.pdfCount ?? 0,
        flashcardCount: prev?.flashcardCount ?? 0,
        annotationCount: prev?.annotationCount ?? 0,
        pdfPreview: prev?.pdfPreview ?? null,
        notePreviews: prev?.notePreviews ?? [],
        latestAiJobStatus: "error",
        latestAiJobError: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setGenerating(false);
    }
  }, [generating, selectedWork]);

  // --- Multi-select & bulk operations -------------------------------------
  const toggleRowSelected = useCallback((workId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(workId)) next.delete(workId);
      else next.add(workId);
      return next;
    });
  }, []);

  const bulkAddTag = useCallback(async () => {
    if (selectedIds.size === 0 || !isTauriRuntime()) return;
    const name = window.prompt(`为选中的 ${selectedIds.size} 篇文献添加标签:`);
    if (!name?.trim()) return;
    const db = await getDb();
    await new TagsRepo(db).addToWorks(Array.from(selectedIds), name.trim());
    setMessage(`已为 ${selectedIds.size} 篇文献添加标签「${name.trim()}」`);
    setSelectedIds(new Set());
    await refresh();
  }, [selectedIds, refresh]);

  const bulkMoveToCollection = useCallback(async () => {
    if (selectedIds.size === 0 || !isTauriRuntime()) return;
    const choices = collections.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
    const raw = window.prompt(
      `移动选中的 ${selectedIds.size} 篇文献到文件夹(输入编号，0=移出所有文件夹):\n${choices}`,
      "0",
    );
    if (raw === null) return;
    const idx = Number(raw.trim());
    const target = idx === 0 ? null : collections[idx - 1]?.id ?? null;
    if (idx !== 0 && !target) {
      setMessage("无效的文件夹编号");
      return;
    }
    const db = await getDb();
    const colRepo = new CollectionsRepo(db);
    for (const workId of selectedIds) {
      await colRepo.setWorkCollection(workId, target);
    }
    setMessage(
      target
        ? `已移动 ${selectedIds.size} 篇文献到「${collections[idx - 1]?.name}」`
        : `已将 ${selectedIds.size} 篇文献移出所有文件夹`,
    );
    setSelectedIds(new Set());
    await refresh();
  }, [selectedIds, collections, refresh]);

  const bulkDelete = useCallback(async () => {
    if (selectedIds.size === 0 || !isTauriRuntime()) return;
    if (!window.confirm(`确定删除选中的 ${selectedIds.size} 篇文献?(可在数据库中恢复)`)) return;
    const db = await getDb();
    const worksRepo = new WorksRepo(db);
    for (const workId of selectedIds) {
      await worksRepo.softDelete(workId);
    }
    setMessage(`已删除 ${selectedIds.size} 篇文献`);
    setSelectedIds(new Set());
    await refresh();
  }, [selectedIds, refresh]);

  const handleExportCitations = useCallback(
    async (format: ExportFormat) => {
      if (selectedIds.size === 0) return;
      setCiteMenuOpen(false);
      try {
        await exportWorks(Array.from(selectedIds), format);
        setMessage(`已导出 ${selectedIds.size} 篇文献的引用(${format.toUpperCase()})`);
      } catch (e) {
        setMessage(`导出失败:${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [selectedIds],
  );

  const handleCopyBibliography = useCallback(
    async (styleId: string) => {
      if (selectedIds.size === 0) return;
      setCiteMenuOpen(false);
      try {
        const text = await bibliographyText(Array.from(selectedIds), styleId);
        await navigator.clipboard?.writeText(text);
        setMessage(`已复制 ${selectedIds.size} 条参考文献到剪贴板`);
      } catch (e) {
        setMessage(`复制失败:${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [selectedIds],
  );

  const handleRefsFile = useCallback(async (file: File) => {
    const text = await file.text();
    try {
      const items = previewReferences(text);
      if (items.length === 0) {
        setMessage("没有从文件中解析出任何文献(支持 .bib / .ris / CSL-JSON)");
        return;
      }
      setImportPreview({ count: items.length, text });
    } catch (e) {
      setMessage(`解析失败:${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const confirmImport = useCallback(async () => {
    if (!importPreview || !isTauriRuntime()) {
      setImportPreview(null);
      if (!isTauriRuntime()) setMessage("预览模式下不会写入本地数据库");
      return;
    }
    setImporting(true);
    try {
      const summary = await importReferences(importPreview.text);
      setMessage(
        `导入完成:新增 ${summary.imported} 篇,已存在 ${summary.deduped} 篇(共 ${summary.total} 条)`,
      );
      setImportPreview(null);
      await refresh();
    } catch (e) {
      setMessage(`导入失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  }, [importPreview, refresh]);

  return (
    <div className="library-page">
      <h1 className="sr-only">文献库</h1>
      <div className="library-topbar">
        <div className="library-command">
          <Input
            placeholder="快速入库：DOI / arXiv / PDF 链接或拖拽文件到此处..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
            disabled={busy}
          />
          <span className="au-kbd">Enter</span>
        </div>
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          导入 PDF
        </Button>
        <Button variant="secondary" onClick={() => refsInputRef.current?.click()} disabled={busy}>
          导入文献库
        </Button>
        <Button onClick={() => void handleAdd()} disabled={busy}>
          {busy ? "处理中..." : "添加文献"}
        </Button>
        <ActionIconButton label="刷新" icon="refresh" onClick={() => void refresh()} />
        <ActionIconButton
          label="管理标签"
          icon="tag"
          onClick={() => setTagManagerOpen(true)}
        />
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
        <input
          ref={refsInputRef}
          type="file"
          accept=".bib,.ris,.json,application/json,text/plain"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleRefsFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {message && <p className="library-command__message">{message}</p>}

      {selectedIds.size > 0 && (
        <div className="library-bulkbar">
          <span className="library-bulkbar__count">已选 {selectedIds.size} 篇</span>
          <button type="button" onClick={() => void bulkAddTag()}>
            添加标签
          </button>
          <button type="button" onClick={() => void bulkMoveToCollection()}>
            移动到文件夹
          </button>
          <div className="library-cite-menu">
            <button type="button" onClick={() => setCiteMenuOpen((v) => !v)}>
              导出引用 ▾
            </button>
            {citeMenuOpen && (
              <div className="library-cite-dropdown">
                <div className="library-cite-dropdown__group">导出文件</div>
                <button type="button" onClick={() => void handleExportCitations("bibtex")}>
                  BibTeX (.bib)
                </button>
                <button type="button" onClick={() => void handleExportCitations("ris")}>
                  RIS (.ris)
                </button>
                <button type="button" onClick={() => void handleExportCitations("csljson")}>
                  CSL-JSON (.json)
                </button>
                <div className="library-cite-dropdown__group">复制参考文献</div>
                {STYLES.map((s) => (
                  <button key={s.id} type="button" onClick={() => void handleCopyBibliography(s.id)}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="library-bulkbar__danger" onClick={() => void bulkDelete()}>
            删除
          </button>
          <button
            type="button"
            className="library-bulkbar__clear"
            onClick={() => setSelectedIds(new Set())}
          >
            取消选择
          </button>
        </div>
      )}

      <div className="app-workspace">
        <div className="library-main">
          <div className="library-tabs">
            <button
              className={`library-tab ${activeFilter === "all" ? "library-tab--active" : ""}`}
              type="button"
              onClick={() => {
                setActiveCollection(null);
                setActiveFilter("all");
                setActiveTag(null);
                setActiveSource(null);
              }}
            >
              全部 <span>{totalDisplay}</span>
            </button>
            <button
              className={`library-tab ${activeFilter === "reading" ? "library-tab--active" : ""}`}
              type="button"
              onClick={() => setActiveFilter("reading")}
            >
              阅读中 <span>{readingCount}</span>
            </button>
            <button
              className={`library-tab ${activeFilter === "noted" ? "library-tab--active" : ""}`}
              type="button"
              onClick={() => setActiveFilter("noted")}
            >
              有笔记 <span>{notedCount}</span>
            </button>
            <button
              className={`library-tab ${activeFilter === "unread" ? "library-tab--active" : ""}`}
              type="button"
              onClick={() => setActiveFilter("unread")}
            >
              未读 <span>{unreadCount}</span>
            </button>
            <button
              className={`library-tab ${activeFilter === "starred" ? "library-tab--active" : ""}`}
              type="button"
              onClick={() => setActiveFilter("starred")}
            >
              重点 <span>{starredCount}</span>
            </button>
          </div>

          <div className="library-filterbar">
            <button
              className="library-filter-button"
              type="button"
              onClick={() => setActiveFilter(activeFilter === "starred" ? "all" : "starred")}
            >
              {activeFilter === "starred" ? "取消重点" : "智能筛选"}
            </button>
            <button className="library-filter-button" type="button" onClick={handleTagFilter}>
              {activeTag ? `标签:${activeTag}` : "标签"}
            </button>
            <button className="library-filter-button" type="button" onClick={handleSourceFilter}>
              {activeSource ? `来源:${activeSource}` : "来源"}
            </button>
            <button
              className="library-filter-button"
              type="button"
              onClick={() => setSortMode(sortMode === "year" ? "added" : "year")}
            >
              {sortMode === "year" ? "按添加时间" : "按发表时间"}
            </button>
            <button
              className="library-filter-button"
              type="button"
              onClick={() => setMessage("更多筛选即将接入标签、附件、AI 状态和哨兵状态")}
            >
              更多
            </button>
            <div className="library-inline-search">
              <Input
                placeholder="在结果中搜索"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="au-kbd">⌘ F</span>
            </div>
          </div>

          {!isPreview && (
            <div className="library-collection-row">
              <FolderItem
                label="全部文献"
                count={items.length}
                active={activeCollection === null}
                onClick={() => {
                  setActiveCollection(null);
                  setActiveTag(null);
                  setActiveSource(null);
                }}
              />
              {collections.map((c) => (
                <FolderItem
                  key={c.id}
                  label={c.name}
                  active={activeCollection === c.id}
                  onClick={() => {
                    setActiveCollection(c.id);
                    setActiveTag(null);
                    setActiveSource(null);
                  }}
                  onDelete={() => void handleDeleteFolder(c.id, c.name)}
                />
              ))}
              <button
                className="library-folder-add"
                title="新建文件夹"
                onClick={() => void handleNewFolder()}
              >
                新建文件夹
              </button>
            </div>
          )}

          {tableRows.length === 0 ? (
            <div className="library-empty au-surface">
              <h3>{items.length === 0 ? "还没有文献" : "当前筛选无结果"}</h3>
              <p className="au-text-muted">
                {items.length > 0
                  ? "换一个筛选条件，或在上方搜索框里缩小/清除关键词。"
                  : activeCollection
                    ? "这个文件夹是空的。"
                    : "从 DOI、arXiv、论文链接或 PDF 开始建立你的研究工作台。"}
              </p>
            </div>
          ) : (
            <div className="library-table">
              <div className="library-table__head">
                <span>
                  <input
                    type="checkbox"
                    className="library-checkbox-input"
                    aria-label="全选本页"
                    checked={pagedRows.length > 0 && pagedRows.every((w) => selectedIds.has(w.id))}
                    onChange={(e) => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) pagedRows.forEach((w) => next.add(w.id));
                        else pagedRows.forEach((w) => next.delete(w.id));
                        return next;
                      });
                    }}
                  />
                </span>
                <span>题名 / 作者</span>
                <span>年份</span>
                <span>来源</span>
                <span>标签</span>
                <span>引用</span>
                <span>添加时间</span>
              </div>
              {pagedRows.map((w, index) => (
                <div
                  key={w.id}
                  className={`library-table__row ${selectedWork?.id === w.id ? "library-table__row--selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`选择文献:${w.title}`}
                  onClick={() => selectWork(w)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectWork(w);
                    }
                  }}
                >
                  <div className="library-table__select">
                    <input
                      type="checkbox"
                      className="library-checkbox-input"
                      aria-label={`勾选 ${w.title}`}
                      checked={selectedIds.has(w.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleRowSelected(w.id)}
                    />
                    <span
                      className={w.starred ? "library-star library-star--active" : "library-star"}
                    >
                      ☆
                    </span>
                  </div>
                  <div className="library-table__paper">
                    <strong>{w.title}</strong>
                    <span>
                      {w.authorNames.slice(0, 4).join(", ")}
                      {w.authorNames.length > 4 && " 等"}
                    </span>
                  </div>
                  <span className="library-table__cell">{w.year ?? "—"}</span>
                  <span className="library-table__cell">{w.venue_name ?? "未标注"}</span>
                  <div className="library-table__tags">
                    <WorkTags work={w} meta={workMeta[w.id]} index={index} />
                  </div>
                  <span className="library-table__cell">{citationLabel(workMeta[w.id])}</span>
                  <span className="library-table__cell">{formatAddedDate(w.created_at)}</span>
                </div>
              ))}
              <div className="library-table__footer">
                <span>共 {tableRows.length.toLocaleString("zh-CN")} 条</span>
                <div className="library-pagination">
                  <button
                    className="library-filter-button"
                    type="button"
                    disabled={safePage <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    上一页
                  </button>
                  <span className="library-pagination__page">
                    第 {safePage + 1} / {pageCount} 页
                  </span>
                  <button
                    className="library-filter-button"
                    type="button"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  >
                    下一页
                  </button>
                </div>
                <span className="library-pagination__hint">{PAGE_SIZE} 条 / 页</span>
              </div>
            </div>
          )}
        </div>

        <aside className="app-context-panel">
          <SelectedWorkPanel
            work={selectedWork}
            meta={selectedMeta}
            tableMeta={selectedWork ? workMeta[selectedWork.id] : undefined}
            generating={generating}
            onOpenReader={() => {
              if (selectedWork) openReader(selectedWork);
            }}
            onGenerateFlashcards={() => void generateForSelected()}
            onOpenFlashcards={() => navigate("/flashcards")}
            onOpenSentinel={() => navigate("/sentinel")}
            onOpenGraph={() => {
              if (selectedWork?.doi) {
                navigate(`/graph?doi=${encodeURIComponent(selectedWork.doi)}`);
              } else {
                setMessage("这篇文献没有 DOI，暂时无法打开引文图谱");
              }
            }}
          />
        </aside>
      </div>

      {tagManagerOpen && (
        <TagManager
          onClose={() => setTagManagerOpen(false)}
          onChanged={() => {
            void refresh();
            window.dispatchEvent(new Event("aurascholar:library-updated"));
          }}
        />
      )}

      {importPreview && (
        <div
          className="library-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => !importing && setImportPreview(null)}
        >
          <div className="library-modal" onClick={(e) => e.stopPropagation()}>
            <div className="library-modal__head">
              <h2>导入文献库</h2>
              <button
                type="button"
                className="library-modal__close"
                onClick={() => !importing && setImportPreview(null)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <p className="au-text-muted" style={{ fontSize: 13 }}>
              已解析出 <strong>{importPreview.count}</strong> 条文献。导入时会按 DOI
              与标题自动去重,已存在的不会重复入库。
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <Button onClick={() => void confirmImport()} disabled={importing}>
                {importing ? "导入中…" : `导入 ${importPreview.count} 条`}
              </Button>
              <Button variant="secondary" onClick={() => setImportPreview(null)} disabled={importing}>
                取消
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TagManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isTauriRuntime()) {
      setTags([]);
      setLoading(false);
      return;
    }
    const db = await getDb();
    setTags(await new TagsRepo(db).list());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const repo = useCallback(async () => new TagsRepo(await getDb()), []);

  const rename = useCallback(
    async (tag: TagRow) => {
      const next = window.prompt("重命名标签:", tag.name);
      if (!next?.trim() || next.trim() === tag.name) return;
      await (await repo()).rename(tag.id, next.trim());
      await load();
      onChanged();
    },
    [repo, load, onChanged],
  );

  const recolor = useCallback(
    async (tag: TagRow) => {
      const next = window.prompt("设置标签颜色(CSS 颜色值，留空清除):", tag.color ?? "");
      if (next === null) return;
      await (await repo()).setColor(tag.id, next.trim() || null);
      await load();
      onChanged();
    },
    [repo, load, onChanged],
  );

  const remove = useCallback(
    async (tag: TagRow) => {
      if (!window.confirm(`删除标签「${tag.name}」?这会从 ${tag.count} 篇文献上移除该标签。`)) return;
      await (await repo()).softDelete(tag.id);
      await load();
      onChanged();
    },
    [repo, load, onChanged],
  );

  return (
    <div className="library-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="library-modal" onClick={(e) => e.stopPropagation()}>
        <div className="library-modal__head">
          <h2>管理标签</h2>
          <button type="button" className="library-modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {loading ? (
          <p className="au-text-muted">读取中…</p>
        ) : tags.length === 0 ? (
          <p className="au-text-muted">还没有标签。在文献上添加标签后会显示在这里。</p>
        ) : (
          <ul className="library-tag-manager">
            {tags.map((tag) => (
              <li key={tag.id} className="library-tag-manager__row">
                <span
                  className="library-tag-manager__dot"
                  style={tag.color ? { background: tag.color } : undefined}
                />
                <span className="library-tag-manager__name">{tag.name}</span>
                <small className="library-tag-manager__count">{tag.count}</small>
                <button type="button" onClick={() => void rename(tag)}>
                  重命名
                </button>
                <button type="button" onClick={() => void recolor(tag)}>
                  颜色
                </button>
                <button
                  type="button"
                  className="library-tag-manager__delete"
                  onClick={() => void remove(tag)}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ActionIconButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: "refresh" | "menu" | "tag";
  onClick?: () => void;
}) {
  return (
    <button
      className="library-icon-button"
      title={label}
      aria-label={label}
      type="button"
      onClick={onClick}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {icon === "refresh" ? (
          <>
            <path d="M20 12a8 8 0 0 1-13.6 5.7" />
            <path d="M4 12A8 8 0 0 1 17.6 6.3" />
            <path d="M17.6 3.5v2.8h-2.8" />
            <path d="M6.4 20.5v-2.8h2.8" />
          </>
        ) : icon === "tag" ? (
          <>
            <path d="M3 11.5V5a2 2 0 0 1 2-2h6.5a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8l-6.5 6.5a2 2 0 0 1-2.8 0l-7-7a2 2 0 0 1-.6-1.4z" />
            <circle cx="7.5" cy="7.5" r="1.3" />
          </>
        ) : (
          <>
            <path d="M4 7h16" />
            <path d="M4 12h16" />
            <path d="M4 17h16" />
          </>
        )}
      </svg>
    </button>
  );
}

function WorkTags({
  work,
  meta,
  index,
}: {
  work: WorkWithAuthors;
  meta?: WorkTableMeta;
  index: number;
}) {
  const labels = (meta?.tags.length ? meta.tags : fallbackWorkLabels(work)).slice(0, 2);
  if (labels.length === 0) {
    return <span className="library-research-tag library-research-tag--neutral">未标注</span>;
  }
  return (
    <>
      {labels.map((label, offset) => (
        <span
          key={label}
          className={`library-research-tag library-research-tag--${tagTone(label, index + offset)}`}
        >
          {label}
        </span>
      ))}
    </>
  );
}

function fallbackWorkLabels(work: WorkWithAuthors) {
  const labels: string[] = [];
  if (work.arxiv_id) labels.push("arXiv");
  if (work.doi) labels.push("DOI");
  if (work.type && work.type !== "article") labels.push(work.type);
  if (work.reading_status === "reading") labels.push("阅读中");
  if (work.reading_status === "read") labels.push("已读");
  return labels;
}

function tagTone(label: string, index: number) {
  if (/arxiv/i.test(label)) return "teal";
  if (/doi/i.test(label)) return "blue";
  if (label === "阅读中") return "green";
  if (label === "已读") return "purple";
  return ["teal", "blue", "purple", "amber", "green"][index % 5] ?? "teal";
}

function citationLabel(meta?: WorkTableMeta) {
  const references = meta?.references ?? 0;
  const citedBy = meta?.citedBy ?? 0;
  if (references === 0 && citedBy === 0) return "—";
  if (references > 0 && citedBy > 0) return `参${references} / 引${citedBy}`;
  if (references > 0) return `参${references}`;
  return `引${citedBy}`;
}

function formatAddedDate(createdAt: number | null | undefined) {
  if (!createdAt) return "—";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function FolderItem({
  label,
  count,
  active,
  onClick,
  onDelete,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={`library-folder ${active ? "library-folder--active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <span>{label}</span>
      {typeof count === "number" && <span className="library-folder__count">{count}</span>}
      {onDelete && (
        <button
          className="library-folder__delete"
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

function SelectedWorkPanel({
  work,
  meta,
  tableMeta,
  generating,
  onOpenReader,
  onGenerateFlashcards,
  onOpenFlashcards,
  onOpenSentinel,
  onOpenGraph,
}: {
  work: WorkWithAuthors | null;
  meta: WorkRuntimeMeta | null;
  tableMeta?: WorkTableMeta;
  generating: boolean;
  onOpenReader: () => void;
  onGenerateFlashcards: () => void;
  onOpenFlashcards: () => void;
  onOpenSentinel: () => void;
  onOpenGraph: () => void;
}) {
  const [activePanelTab, setActivePanelTab] = useState<DetailPanelTab>("overview");

  useEffect(() => {
    setActivePanelTab("overview");
  }, [work?.id]);

  if (!work) {
    return (
      <div className="library-detail au-panel">
        <h2>文献详情</h2>
        <p className="au-text-muted">
          选择一篇文献后，这里会显示元信息、笔记、预览、处理状态和引用脉络。
        </p>
      </div>
    );
  }

  const authorText =
    work.authorNames.length > 0 ? work.authorNames.slice(0, 4).join(", ") : "作者未标注";
  const sourceText = [work.venue_name, work.year].filter(Boolean).join(" · ") || "来源未标注";
  const tags = (tableMeta?.tags.length ? tableMeta.tags : fallbackWorkLabels(work)).slice(0, 4);

  return (
    <>
      <div className="library-side-tabs">
        <button
          className={`library-side-tab ${activePanelTab === "overview" ? "library-side-tab--active" : ""}`}
          type="button"
          onClick={() => setActivePanelTab("overview")}
        >
          工作台
        </button>
        <button
          className={`library-side-tab ${activePanelTab === "notes" ? "library-side-tab--active" : ""}`}
          type="button"
          onClick={() => setActivePanelTab("notes")}
        >
          笔记
        </button>
        <button
          className="library-side-tab"
          type="button"
          onClick={onGenerateFlashcards}
          disabled={generating}
          title="生成闪卡"
        >
          +
        </button>
      </div>
      <div className="library-detail au-panel library-detail--selected">
        <div className="library-panel-heading">
          <span className="library-panel-kicker">Selected paper</span>
          <button type="button" onClick={onOpenReader}>
            阅读 ›
          </button>
        </div>
        <h2>{work.title}</h2>
        <p>{authorText}</p>
        <div className="library-detail__meta-grid">
          <span>
            <strong>{work.year ?? "—"}</strong>
            <small>年份</small>
          </span>
          <span>
            <strong>{work.venue_name ?? "—"}</strong>
            <small>来源</small>
          </span>
          <span>
            <strong>{work.doi ? "有" : "无"}</strong>
            <small>DOI</small>
          </span>
        </div>
        <div className="library-detail__chips">
          {tags.length > 0 ? (
            tags.map((tag, index) => (
              <span
                key={tag}
                className={`library-research-tag library-research-tag--${tagTone(tag, index)}`}
              >
                {tag}
              </span>
            ))
          ) : (
            <span className="library-research-tag library-research-tag--neutral">未标注</span>
          )}
        </div>
        <Button className="library-detail__read" onClick={onOpenReader}>
          打开阅读器
        </Button>
      </div>
      {activePanelTab === "notes" && (
        <NotesPanel meta={meta} onOpenReader={onOpenReader} expanded />
      )}
      <div className="library-automation au-panel">
        <div className="library-panel-heading">
          <h3>元信息与预览</h3>
          <button type="button" onClick={onOpenReader}>
            阅读全文 ›
          </button>
        </div>
        <StatusLine label="题录来源" value={sourceText} variant="neutral" />
        <StatusLine
          label="PDF 预览"
          value={
            meta
              ? meta.pdfPreview
                ? `${meta.pdfPreview.page_count ?? "?"} 页`
                : "暂无 PDF"
              : "读取中"
          }
          variant={meta?.pdfPreview ? "success" : "neutral"}
        />
        {meta?.pdfPreview && (
          <div className="library-preview-box">
            <strong>{meta.pdfPreview.original_filename ?? "PDF 附件"}</strong>
            <span>
              {formatAttachmentSize(meta.pdfPreview.byte_size)}
              {meta.pdfPreview.fetched_via ? ` · ${meta.pdfPreview.fetched_via}` : ""}
            </span>
          </div>
        )}
        <p className="library-preview-copy">
          {work.abstract || "暂无摘要。进入阅读器后可以查看 PDF 正文、批注和 AI 重点。"}
        </p>
      </div>
      {activePanelTab === "overview" && <NotesPanel meta={meta} onOpenReader={onOpenReader} />}
      <div className="library-automation au-panel">
        <div className="library-panel-heading">
          <h3>入库与处理</h3>
          <button type="button" onClick={onOpenReader}>
            打开阅读器 ›
          </button>
        </div>
        <StatusLine
          label="PDF 附件"
          value={meta ? (meta.pdfCount ? `${meta.pdfCount} 个可读` : "未找到") : "读取中"}
          variant={meta ? (meta.pdfCount ? "success" : "warning") : "neutral"}
        />
        <StatusLine
          label="AI 重点"
          value={
            !meta
              ? "读取中"
              : meta.latestAiJobStatus === "done"
                ? "已生成"
                : meta.latestAiJobStatus === "error"
                  ? "生成失败"
                  : "可生成"
          }
          variant={
            !meta
              ? "neutral"
              : meta.latestAiJobStatus === "done"
                ? "success"
                : meta.latestAiJobStatus === "error"
                  ? "warning"
                  : "accent"
          }
        />
        <StatusLine
          label="正文解析"
          value={meta ? (meta.pdfCount ? "进入阅读器" : "需上传 PDF") : "读取中"}
          variant={meta?.pdfCount ? "accent" : "neutral"}
        />
        <StatusLine
          label="笔记 / 批注"
          value={meta ? `${meta.annotationCount} 条` : "读取中"}
          variant={meta?.annotationCount ? "success" : "neutral"}
        />
        {meta?.latestAiJobError && <p className="library-panel-error">{meta.latestAiJobError}</p>}
      </div>
      <div className="library-automation au-panel">
        <div className="library-panel-heading">
          <h3>闪卡队列</h3>
          <button type="button" onClick={onOpenFlashcards}>
            查看全部 ›
          </button>
        </div>
        <StatusLine
          label={work.title.length > 18 ? `${work.title.slice(0, 18)}...` : work.title}
          value={meta ? `${meta.flashcardCount} 张` : "读取中"}
          variant={meta?.flashcardCount ? "success" : "neutral"}
        />
        <Button
          className="library-panel-action"
          variant={meta?.flashcardCount ? "secondary" : "primary"}
          onClick={onGenerateFlashcards}
          disabled={generating}
        >
          {generating ? "生成中..." : meta?.flashcardCount ? "重新生成闪卡" : "生成闪卡"}
        </Button>
      </div>
      <div className="library-automation au-panel">
        <div className="library-panel-heading">
          <h3>哨兵状态</h3>
          <button type="button" onClick={onOpenSentinel}>
            管理哨兵 ›
          </button>
        </div>
        <StatusLine label={work.venue_name ?? "出版状态"} value="待监控" variant="neutral" />
        <StatusLine
          label={work.doi ? "DOI" : "DOI"}
          value={work.doi ? "可精确监控" : "缺 DOI"}
          variant={work.doi ? "success" : "warning"}
        />
      </div>
      <div className="library-note au-panel">
        <div className="library-panel-heading">
          <h3>引用脉络</h3>
          <button type="button" onClick={onOpenGraph}>
            在图谱中打开 ›
          </button>
        </div>
        <CitationMiniGraph
          references={tableMeta?.references ?? 0}
          citedBy={tableMeta?.citedBy ?? 0}
        />
        <div className="library-citation-stats">
          <span>参考 {tableMeta?.references ?? 0}</span>
          <span>被引 {tableMeta?.citedBy ?? 0}</span>
        </div>
        <p className="library-citation-copy">
          {work.doi
            ? "这篇文献有 DOI，可以构建上下游引用脉络。"
            : "这篇文献缺少 DOI，补全元数据后可构建引文脉络。"}
        </p>
      </div>
    </>
  );
}

function NotesPanel({
  meta,
  onOpenReader,
  expanded = false,
}: {
  meta: WorkRuntimeMeta | null;
  onOpenReader: () => void;
  expanded?: boolean;
}) {
  const notes = meta?.notePreviews ?? [];
  return (
    <div className="library-automation au-panel">
      <div className="library-panel-heading">
        <h3>笔记 / 批注</h3>
        <button type="button" onClick={onOpenReader}>
          编辑笔记 ›
        </button>
      </div>
      <StatusLine
        label="总数"
        value={meta ? `${meta.annotationCount} 条` : "读取中"}
        variant={meta?.annotationCount ? "success" : "neutral"}
      />
      {notes.length > 0 ? (
        <div
          className={
            expanded ? "library-notes-list library-notes-list--expanded" : "library-notes-list"
          }
        >
          {notes.map((note) => (
            <article key={note.id} className="library-note-preview">
              <div>
                <strong>{annotationTypeLabel(note.type)}</strong>
                <small>
                  第 {note.page_index + 1} 页 · {formatDateTime(note.updated_at)}
                </small>
              </div>
              <p>{notePreviewText(note)}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="library-panel-empty">
          {meta ? "暂无笔记。进入阅读器后可以高亮、批注和整理摘录。" : "正在读取笔记…"}
        </p>
      )}
    </div>
  );
}

function annotationTypeLabel(type: string) {
  const labels: Record<string, string> = {
    highlight: "高亮",
    underline: "下划线",
    strikeout: "删除线",
    note: "笔记",
    ink: "手写",
  };
  return labels[type] ?? "批注";
}

function notePreviewText(note: WorkNotePreview) {
  const content = note.content_md?.replace(/\s+/g, " ").trim();
  return content || `${annotationTypeLabel(note.type)}批注，尚未填写笔记内容。`;
}

function formatDateTime(value: number) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatAttachmentSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "大小未知";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Thumbnail of the citation neighborhood. Node counts are real (from the local
// `citations` table); the full interactive graph lives on the /graph route. We
// cap rendered dots at 5 per side so the thumbnail stays legible — the exact
// counts are shown numerically beneath it.
function CitationMiniGraph({ references, citedBy }: { references: number; citedBy: number }) {
  if (references === 0 && citedBy === 0) {
    return (
      <div className="library-citation-mini library-citation-mini--empty">
        本地暂无引文边。打开图谱可抓取上下游引用。
      </div>
    );
  }
  const spread = (n: number) => {
    const shown = Math.min(n, 5);
    if (shown === 0) return [];
    const top = 18;
    const bottom = 94;
    const step = shown === 1 ? 0 : (bottom - top) / (shown - 1);
    return Array.from({ length: shown }, (_, i) => top + step * i);
  };
  const left = spread(references);
  const right = spread(citedBy);
  return (
    <svg
      className="library-citation-mini"
      viewBox="0 0 260 112"
      role="img"
      aria-label={`引用脉络缩略图:参考 ${references} 篇，被引 ${citedBy} 篇`}
    >
      <text
        x="6"
        y="55"
        className="library-citation-mini__label library-citation-mini__label--left"
      >
        参考文献
      </text>
      <text
        x="206"
        y="55"
        className="library-citation-mini__label library-citation-mini__label--right"
      >
        被引文献
      </text>
      {left.map((y, i) => (
        <g key={`left-${i}`}>
          <path d={`M76 ${y} C 98 ${y}, 102 56, 124 56`} />
          <circle cx="72" cy={y} r={4} />
        </g>
      ))}
      {right.map((y, i) => (
        <g key={`right-${i}`}>
          <path
            d={`M136 56 C 160 56, 164 ${y}, 186 ${y}`}
            className="library-citation-mini__right-edge"
          />
          <circle className="library-citation-mini__right-node" cx="190" cy={y} r={4} />
        </g>
      ))}
      <circle className="library-citation-mini__center" cx="130" cy="56" r="18" />
      <text x="130" y="60" textAnchor="middle" className="library-citation-mini__center-label">
        本文
      </text>
    </svg>
  );
}

function StatusLine({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant: "accent" | "neutral" | "success" | "warning";
}) {
  return (
    <div className="library-status-line">
      <span>{label}</span>
      <Badge variant={variant}>{value}</Badge>
    </div>
  );
}
