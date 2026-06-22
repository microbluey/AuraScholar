import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import {
  analyzeInput,
  analyzeOaPdf,
  analyzePdf,
  attachPdfToWork,
  attachStagedPdf,
  commitIngest,
  restoreDedup,
  listDeletedWorks,
  listWorks,
  type IngestDraft,
} from "../services/library";
import { generateFlashcardsForWork } from "../services/ai";
import { exportWorks, bibliographyText, type ExportFormat } from "../services/cite";
import { importReferences, previewReferences } from "../services/import-refs";
import { fetchScholarEnrichment, type S2Enrichment } from "../services/scholar";
import { MetadataEditor } from "../components/MetadataEditor";
import { ImportConfirmDialog, type ImportDecision } from "../components/ImportConfirmDialog";
import { STYLES } from "@aurascholar/cite";

function isTauriRuntime(): boolean {
  return "aura" in window;
}

type LibraryFilter = "all" | "reading" | "unread" | "noted" | "starred" | "trash";
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

interface TextPromptConfig {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel: string;
  description?: string;
  allowEmpty?: boolean;
  onSubmit: (value: string) => Promise<void>;
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
  const [trashCount, setTrashCount] = useState(0);
  const [workMeta, setWorkMeta] = useState<Record<string, WorkTableMeta>>({});
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<LibraryFilter>("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("added");
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<WorkRuntimeMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [attachingPdf, setAttachingPdf] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(0);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [collectionManagerOpen, setCollectionManagerOpen] = useState(false);
  const [textPrompt, setTextPrompt] = useState<TextPromptConfig | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [citeMenuOpen, setCiteMenuOpen] = useState(false);
  const [editingMetaId, setEditingMetaId] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<{ count: number; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  // Import confirmation: analyze returns a draft (blob already staged by sha,
  // no library rows written); commitIngest writes only after the user confirms.
  const [confirmDraft, setConfirmDraft] = useState<IngestDraft | null>(null);
  const [findingFulltext, setFindingFulltext] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedPdfInputRef = useRef<HTMLInputElement>(null);
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
    const [collectionRows, trashRows] = await Promise.all([
      colRepo.list(),
      db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM works WHERE deleted_at IS NOT NULL`),
    ]);
    setCollections(collectionRows);
    setTrashCount(trashRows[0]?.n ?? 0);
    const showTrash = activeFilter === "trash";
    const works = showTrash
      ? await listDeletedWorks(search || undefined, LIST_HARD_LIMIT)
      : await listWorks(search || undefined, activeCollection ?? undefined, LIST_HARD_LIMIT);
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
  }, [search, activeCollection, activeFilter]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [refresh, search]);

  const autoDigest = useCallback((workId: string, title: string) => {
    void generateFlashcardsForWork(workId, title)
      .then(() => setMessage(`已入库并提取重点:${title}`))
      .catch(() => {}); // no AI config / scanned PDF — manual extraction remains
  }, []);

  // Surface a dedup hit (already in library) without a confirm card.
  const surfaceDedup = useCallback(
    async (draft: IngestDraft): Promise<boolean> => {
      if (!draft.dedup) return false;
      await restoreDedup(draft.dedup.workId);
      // A fresh PDF for an existing work: attach it directly (work identity is
      // already settled, no confirmation needed).
      if (draft.pdf) {
        await attachStagedPdf(draft.dedup.workId, draft.pdf).catch(() => {});
      }
      setMessage(`已在库中:${draft.dedup.title}`);
      await refresh();
      return true;
    },
    [refresh],
  );

  const handleAdd = useCallback(async () => {
    if (!input.trim() || busy) return;
    setBusy(true);
    setMessage("正在识别…");
    try {
      const draft = await analyzeInput(input);
      if (!draft) {
        setMessage("无法识别输入 — 请提供 DOI、arXiv ID、论文链接或标题");
      } else if (await surfaceDedup(draft)) {
        setInput("");
      } else {
        setConfirmDraft(draft);
        setInput("");
      }
    } catch (e) {
      setMessage(`解析失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [input, busy, surfaceDedup]);

  const handleUpload = useCallback(
    async (file: File) => {
      setBusy(true);
      setMessage("正在识别 PDF…");
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const draft = await analyzePdf(file.name, data);
        if (await surfaceDedup(draft)) return;
        setMessage(null);
        setConfirmDraft(draft);
      } catch (e) {
        setMessage(`解析失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [surfaceDedup],
  );

  // User confirmed the import card → write to the library (create or attach).
  const handleConfirmImport = useCallback(
    async (decision: ImportDecision) => {
      const draft = confirmDraft;
      setConfirmDraft(null);
      if (decision.mode === "attach") {
        await restoreDedup(decision.workId);
        if (decision.pdf) await attachStagedPdf(decision.workId, decision.pdf);
        setMessage("已将 PDF 挂到所选文献");
      } else {
        const result = await commitIngest({
          workInput: decision.workInput,
          pdf: decision.pdf,
          source: draft?.source ?? "pdf",
        });
        setMessage(`已入库:${result.title}`);
        if (!result.deduped && result.pdfFetched) autoDigest(result.workId, result.title);
      }
      window.dispatchEvent(new Event("aurascholar:library-updated"));
      await refresh();
    },
    [confirmDraft, refresh, autoDigest],
  );

  const handleCancelImport = useCallback(() => {
    setConfirmDraft(null);
    setMessage("已取消入库");
  }, []);

  const handleNewFolder = useCallback(async () => {
    if (!isTauriRuntime()) {
      setMessage("预览模式下不会写入本地数据库");
      return;
    }
    setTextPrompt({
      title: "新建文件夹",
      label: "文件夹名称",
      placeholder: "例如：Transformer 综述",
      confirmLabel: "创建",
      onSubmit: async (value) => {
        const name = value.trim();
        const db = await getDb();
        const id = await new CollectionsRepo(db).create(name);
        setActiveFilter("all");
        setActiveCollection(id);
        setActiveTag(null);
        setActiveSource(null);
        setMessage(`已新建文件夹「${name}」`);
        await refresh();
      },
    });
  }, [refresh]);

  const handleRenameFolder = useCallback(
    async (id: string, name: string) => {
      if (!isTauriRuntime()) {
        setMessage("预览模式下不会写入本地数据库");
        return;
      }
      setTextPrompt({
        title: "重命名文件夹",
        label: "文件夹名称",
        initialValue: name,
        confirmLabel: "保存",
        onSubmit: async (value) => {
          const next = value.trim();
          if (next === name) return;
          const db = await getDb();
          await new CollectionsRepo(db).rename(id, next);
          setMessage(`已重命名为「${next}」`);
          await refresh();
        },
      });
    },
    [refresh],
  );

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
      setMessage(`已删除文件夹「${name}」`);
      await refresh();
    },
    [activeCollection, refresh],
  );

  useEffect(() => {
    const onLibraryView = (event: Event) => {
      const detail = (event as CustomEvent<LibraryViewDetail>).detail ?? {};
      const nextFilter = detail.filter ?? "all";
      setActiveFilter(nextFilter);
      setActiveCollection(nextFilter === "trash" ? null : (detail.collectionId ?? null));
      setActiveTag(nextFilter === "trash" ? null : (detail.tag ?? null));
      setActiveSource(null);
      setSelectedWorkId(null);
      setSelectedIds(new Set());
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

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("aurascholar:library-view-state", {
        detail: { filter: activeFilter, collectionId: activeCollection, tag: activeTag },
      }),
    );
  }, [activeCollection, activeFilter, activeTag]);

  const handleTagFilter = useCallback(() => {
    const tagNames = Array.from(new Set(Object.values(workMeta).flatMap((meta) => meta.tags))).sort(
      (a, b) => a.localeCompare(b, "zh-CN"),
    );
    if (tagNames.length === 0) {
      setMessage("当前结果没有可筛选的标签");
      return;
    }
    setTextPrompt({
      title: "按标签筛选",
      label: "标签名称",
      initialValue: activeTag ?? tagNames[0],
      confirmLabel: "应用",
      description: "留空可以清除当前标签筛选。",
      allowEmpty: true,
      onSubmit: async (value) => {
        setActiveTag(value.trim() || null);
      },
    });
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
    setTextPrompt({
      title: "按来源筛选",
      label: "来源名称",
      initialValue: activeSource ?? sourceNames[0],
      confirmLabel: "应用",
      description: "留空可以清除当前来源筛选。",
      allowEmpty: true,
      onSubmit: async (value) => {
        setActiveSource(value.trim() || null);
      },
    });
  }, [activeSource, items]);

  const isTrashView = activeFilter === "trash";
  const filteredItems = useMemo(() => {
    const sortWorks = (works: WorkWithAuthors[]) =>
      [...works].sort((a, b) => {
        if (sortMode === "year") return (b.year ?? 0) - (a.year ?? 0);
        return (b.created_at ?? 0) - (a.created_at ?? 0);
      });
    if (activeFilter === "trash") return sortWorks(items);
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
    return sortWorks(filtered);
  }, [activeFilter, activeSource, activeTag, items, sortMode, workMeta]);
  const countBaseItems = isTrashView ? [] : items;
  const totalDisplay = countBaseItems.length.toLocaleString("zh-CN");
  const tableRows = filteredItems;
  const pageCount = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedRows = useMemo(
    () => tableRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [tableRows, safePage],
  );
  const readingCount = countBaseItems.filter((w) => w.reading_status === "reading").length;
  const unreadCount = countBaseItems.filter((w) => w.reading_status === "unread").length;
  const notedCount = countBaseItems.filter((w) => (workMeta[w.id]?.annotations ?? 0) > 0).length;
  const starredCount = countBaseItems.filter((w) => w.starred === 1).length;
  const activeCollectionRow =
    collections.find((collection) => collection.id === activeCollection) ?? null;
  const viewTitle = isTrashView
    ? "回收站"
    : activeCollectionRow?.name ??
      (activeTag ? `标签:${activeTag}` : activeSource ? `来源:${activeSource}` : "全部文献");
  const viewMetaParts = [
    `${tableRows.length.toLocaleString("zh-CN")} 条结果`,
    activeFilter === "reading"
      ? "阅读中"
      : activeFilter === "unread"
        ? "未读"
        : activeFilter === "noted"
          ? "有笔记"
          : activeFilter === "starred"
            ? "重点文献"
            : null,
    activeCollectionRow ? "文件夹视图" : null,
    activeTag ? `标签 ${activeTag}` : null,
    activeSource ? `来源 ${activeSource}` : null,
    sortMode === "year" ? "按发表时间" : "按添加时间",
  ].filter(Boolean);
  const viewSubtitle = viewMetaParts.join(" · ");
  const activeViewLabel = activeCollectionRow
    ? `文件夹 / ${activeCollectionRow.name}`
    : isTrashView
      ? "系统分组 / 回收站"
      : activeFilter === "all"
        ? "系统分组 / 全部文献"
        : "系统分组 / 状态筛选";

  const selectedWork = useMemo(
    () => tableRows.find((w) => w.id === selectedWorkId) ?? tableRows[0] ?? null,
    [tableRows, selectedWorkId],
  );

  const handleAttachPdf = useCallback(
    async (file: File) => {
      if (!selectedWork) return;
      if (!isTauriRuntime()) {
        setMessage("预览模式下不会写入本地数据库");
        return;
      }
      setAttachingPdf(true);
      setMessage(null);
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const result = await attachPdfToWork(selectedWork.id, file.name, data);
        setMessage(
          result.deduped
            ? `这份 PDF 已经附加在《${selectedWork.title}》上`
            : `已为《${selectedWork.title}》上传 PDF(${result.pageCount} 页)`,
        );
        if (!result.deduped) autoDigest(selectedWork.id, selectedWork.title);
        await refresh();
        setSelectedWorkId(selectedWork.id);
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (e) {
        setMessage(`上传 PDF 失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setAttachingPdf(false);
      }
    },
    [autoDigest, refresh, selectedWork],
  );

  // "Find full text" for a work missing a PDF: try OA first (still confirmed via
  // the card, defaulting to attach); otherwise open the browser at its landing
  // page carrying the work id so the eventual download attaches to this work.
  const handleFindFulltext = useCallback(async () => {
    if (!selectedWork) return;
    if (!isTauriRuntime()) {
      setMessage("预览模式下无法联网查找全文");
      return;
    }
    setFindingFulltext(true);
    setMessage("正在查找开放获取全文…");
    try {
      const draft = await analyzeOaPdf({
        doi: selectedWork.doi ?? undefined,
        arxivId: selectedWork.arxiv_id ?? undefined,
        title: selectedWork.title,
      });
      if (draft) {
        setMessage(null);
        setConfirmDraft({ ...draft, targetWorkId: selectedWork.id, targetTitle: selectedWork.title });
        return;
      }
      // No OA copy — hand off to the browser at the publisher / search page.
      const landing = selectedWork.doi
        ? `https://doi.org/${selectedWork.doi}`
        : `https://scholar.google.com/scholar?q=${encodeURIComponent(selectedWork.title)}`;
      const params = new URLSearchParams({
        pendingWorkId: selectedWork.id,
        pendingTitle: selectedWork.title,
        url: landing,
      });
      navigate(`/discovery?${params.toString()}`);
    } catch (e) {
      setMessage(`查找全文失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFindingFulltext(false);
    }
  }, [selectedWork, navigate]);

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
      if (e instanceof MouseEvent && (e.target as HTMLElement)?.closest?.(".library-cite-menu")) {
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
    if (selectedIds.size === 0) {
      setMessage("请先勾选要添加标签的文献");
      return;
    }
    if (!isTauriRuntime()) {
      setMessage("预览模式下不会写入本地数据库");
      return;
    }
    const workIds = Array.from(selectedIds);
    setTextPrompt({
      title: "添加标签",
      label: "标签名称",
      placeholder: "例如：必读 / 方法 / 综述",
      confirmLabel: "添加",
      description: `将标签添加到已选的 ${workIds.length} 篇文献。`,
      onSubmit: async (value) => {
        const name = value.trim();
        const db = await getDb();
        await new TagsRepo(db).addToWorks(workIds, name);
        setMessage(`已为 ${workIds.length} 篇文献添加标签「${name}」`);
        setSelectedIds(new Set());
        await refresh();
      },
    });
  }, [selectedIds, refresh]);

  const bulkMoveToCollection = useCallback(async () => {
    if (selectedIds.size === 0) {
      setMessage("请先勾选要移动的文献");
      return;
    }
    if (!isTauriRuntime()) {
      setMessage("预览模式下不会写入本地数据库");
      return;
    }
    setMoveDialogOpen(true);
  }, [selectedIds]);

  const moveSelectedToCollection = useCallback(async (target: string | null, targetName: string) => {
    if (selectedIds.size === 0 || !isTauriRuntime()) return;
    const workIds = Array.from(selectedIds);
    const db = await getDb();
    const colRepo = new CollectionsRepo(db);
    for (const workId of workIds) {
      await colRepo.setWorkCollection(workId, target);
    }
    setMessage(target ? `已移动 ${workIds.length} 篇文献到「${targetName}」` : `已将 ${workIds.length} 篇文献移出所有文件夹`);
    setSelectedIds(new Set());
    await refresh();
  }, [selectedIds, collections, refresh]);

  const bulkDelete = useCallback(async () => {
    if (selectedIds.size === 0 || !isTauriRuntime()) return;
    if (!window.confirm(`将选中的 ${selectedIds.size} 篇文献移入回收站?`)) return;
    const db = await getDb();
    const worksRepo = new WorksRepo(db);
    for (const workId of selectedIds) {
      await worksRepo.softDelete(workId);
    }
    setMessage(`已将 ${selectedIds.size} 篇文献移入回收站`);
    setSelectedIds(new Set());
    await refresh();
  }, [selectedIds, refresh]);

  const restoreWorks = useCallback(
    async (workIds: string[]) => {
      if (workIds.length === 0 || !isTauriRuntime()) return;
      const db = await getDb();
      const worksRepo = new WorksRepo(db);
      for (const workId of workIds) {
        await worksRepo.restore(workId);
      }
      setMessage(`已恢复 ${workIds.length} 篇文献`);
      setSelectedIds(new Set());
      await refresh();
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    },
    [refresh],
  );

  const purgeWorks = useCallback(
    async (workIds: string[]) => {
      if (workIds.length === 0 || !isTauriRuntime()) return;
      if (
        !window.confirm(
          `永久删除 ${workIds.length} 篇回收站文献?这会移除元数据、标签、笔记、闪卡和关联记录，不能撤销。`,
        )
      ) {
        return;
      }
      const db = await getDb();
      const worksRepo = new WorksRepo(db);
      for (const workId of workIds) {
        await worksRepo.purgeDeleted(workId);
      }
      setMessage(`已永久删除 ${workIds.length} 篇文献`);
      setSelectedIds(new Set());
      await refresh();
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    },
    [refresh],
  );

  const bulkMerge = useCallback(async () => {
    if (selectedIds.size < 2 || !isTauriRuntime()) return;
    if (!selectedWork || !selectedIds.has(selectedWork.id)) {
      setMessage("请先在已勾选的文献中点选一篇作为主记录，再执行合并");
      return;
    }
    const duplicates = Array.from(selectedIds).filter((id) => id !== selectedWork.id);
    const titles = items
      .filter((work) => duplicates.includes(work.id))
      .slice(0, 4)
      .map((work) => `《${work.title}》`)
      .join("、");
    const ok = window.confirm(
      `将 ${duplicates.length} 篇重复文献合并到主记录《${selectedWork.title}》?\n\n会迁移 PDF、批注、闪卡、标签、摘录、文件夹、引文和任务；主记录的题名与作者优先保留，重复项会软删除。\n\n重复项:${titles}${duplicates.length > 4 ? "…" : ""}`,
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      const db = await getDb();
      const result = await new WorksRepo(db).mergeInto(selectedWork.id, duplicates);
      setMessage(
        `已合并 ${result.merged} 篇重复文献到《${selectedWork.title}》${result.movedAttachments ? `，迁移 ${result.movedAttachments} 个附件` : ""}`,
      );
      setSelectedIds(new Set());
      setSelectedWorkId(selectedWork.id);
      await refresh();
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    } catch (e) {
      setMessage(`合并失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [items, refresh, selectedIds, selectedWork]);

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

  const clearLibraryView = useCallback(() => {
    setActiveFilter("all");
    setActiveCollection(null);
    setActiveTag(null);
    setActiveSource(null);
    setSelectedIds(new Set());
  }, []);

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
        <div className="library-topbar__actions">
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            导入 PDF
          </Button>
          <Button
            variant="secondary"
            onClick={() => refsInputRef.current?.click()}
            disabled={busy}
          >
            导入文献库
          </Button>
          <Button onClick={() => void handleAdd()} disabled={busy}>
            {busy ? "处理中..." : "添加文献"}
          </Button>
          <ActionIconButton label="刷新" icon="refresh" onClick={() => void refresh()} />
        </div>
      </div>
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
        ref={selectedPdfInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleAttachPdf(f);
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
      {message && <p className="library-command__message">{message}</p>}

      {selectedIds.size > 0 && (
        <div className="library-bulkbar">
          <span className="library-bulkbar__count">已选 {selectedIds.size} 篇</span>
          {isTrashView ? (
            <>
              <button type="button" onClick={() => void restoreWorks(Array.from(selectedIds))}>
                恢复
              </button>
              <button
                type="button"
                className="library-bulkbar__danger"
                onClick={() => void purgeWorks(Array.from(selectedIds))}
              >
                永久删除
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => void bulkAddTag()}>
                添加标签
              </button>
              <button type="button" onClick={() => void bulkMoveToCollection()}>
                移动到文件夹
              </button>
              {selectedIds.size > 1 && (
                <button type="button" onClick={() => void bulkMerge()} disabled={busy}>
                  合并文献
                </button>
              )}
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
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => void handleCopyBibliography(s.id)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="library-bulkbar__danger"
                onClick={() => void bulkDelete()}
              >
                删除
              </button>
            </>
          )}
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
          <div className="library-list-header">
            <div className="library-list-header__copy">
              <span className="library-view-eyebrow">{activeViewLabel}</span>
              <div className="library-view-title-row">
                <h2>{viewTitle}</h2>
                <span>{viewSubtitle}</span>
              </div>
            </div>
            <div className="library-inline-search library-inline-search--header">
              <Input
                placeholder={isTrashView ? "搜索回收站" : "在结果中搜索"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="au-kbd">⌘ F</span>
            </div>
          </div>

          <div className="library-tabs library-tabs--compact">
            <button
              className={`library-tab ${activeFilter === "all" ? "library-tab--active" : ""}`}
              type="button"
              onClick={clearLibraryView}
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
            <button
              className={`library-tab ${activeFilter === "trash" ? "library-tab--active" : ""}`}
              type="button"
              onClick={() => {
                setActiveFilter("trash");
                setActiveCollection(null);
                setActiveTag(null);
                setActiveSource(null);
                setSelectedIds(new Set());
              }}
            >
              回收站 <span>{trashCount}</span>
            </button>
          </div>

          <div className="library-filterbar library-filterbar--compact">
            {isTrashView ? (
              <>
                <button className="library-filter-button" type="button" onClick={clearLibraryView}>
                  返回全部
                </button>
                <button
                  className="library-filter-button"
                  type="button"
                  onClick={() => setCollectionManagerOpen(true)}
                >
                  管理分组
                </button>
              </>
            ) : (
              <>
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
                <button
                  className="library-filter-button"
                  type="button"
                  onClick={handleSourceFilter}
                >
                  {activeSource ? `来源:${activeSource}` : "来源"}
                </button>
                <button
                  className="library-filter-button"
                  type="button"
                  onClick={() => setCollectionManagerOpen(true)}
                >
                  管理分组
                </button>
                <button
                  className="library-filter-button"
                  type="button"
                  onClick={() => setTagManagerOpen(true)}
                >
                  管理标签
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
                {(activeCollection || activeTag || activeSource || activeFilter !== "all") && (
                  <button
                    className="library-filter-button"
                    type="button"
                    onClick={clearLibraryView}
                  >
                    清除筛选
                  </button>
                )}
              </>
            )}
          </div>

          {tableRows.length === 0 ? (
            <div className="library-empty au-surface">
              <h3>{isTrashView ? "回收站为空" : items.length === 0 ? "还没有文献" : "当前筛选无结果"}</h3>
              <p className="au-text-muted">
                {isTrashView
                  ? "移入回收站的文献会显示在这里，可以恢复或永久删除。"
                  : items.length > 0
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
                <span>{isTrashView ? "删除时间" : "添加时间"}</span>
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
                  <span className="library-table__cell">
                    {formatAddedDate(isTrashView ? w.deleted_at : w.created_at)}
                  </span>
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
            isTrashView={isTrashView}
            generating={generating}
            attachingPdf={attachingPdf}
            onOpenReader={() => {
              if (selectedWork) openReader(selectedWork);
            }}
            onRestoreWork={() => {
              if (selectedWork) void restoreWorks([selectedWork.id]);
            }}
            onPurgeWork={() => {
              if (selectedWork) void purgeWorks([selectedWork.id]);
            }}
            onUploadPdf={() => selectedPdfInputRef.current?.click()}
            onFindFulltext={() => void handleFindFulltext()}
            findingFulltext={findingFulltext}
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
            onEditMetadata={() => {
              if (selectedWork) setEditingMetaId(selectedWork.id);
            }}
          />
        </aside>
      </div>

      {editingMetaId && (
        <MetadataEditor
          workId={editingMetaId}
          onClose={() => setEditingMetaId(null)}
          onSaved={() => void refresh()}
        />
      )}

      {confirmDraft && (
        <ImportConfirmDialog
          draft={confirmDraft}
          onCommit={handleConfirmImport}
          onCancel={handleCancelImport}
        />
      )}

      {collectionManagerOpen && (
        <CollectionManager
          collections={collections}
          activeCollection={activeCollection}
          trashCount={trashCount}
          isTrashView={isTrashView}
          onClose={() => setCollectionManagerOpen(false)}
          onSelectAll={() => {
            clearLibraryView();
            setCollectionManagerOpen(false);
          }}
          onSelectTrash={() => {
            setActiveFilter("trash");
            setActiveCollection(null);
            setActiveTag(null);
            setActiveSource(null);
            setSelectedIds(new Set());
            setCollectionManagerOpen(false);
          }}
          onSelectCollection={(collectionId) => {
            setActiveFilter("all");
            setActiveCollection(collectionId);
            setActiveTag(null);
            setActiveSource(null);
            setSelectedIds(new Set());
            setCollectionManagerOpen(false);
          }}
          onCreate={() => {
            setCollectionManagerOpen(false);
            void handleNewFolder();
          }}
          onRename={(collection) => {
            setCollectionManagerOpen(false);
            void handleRenameFolder(collection.id, collection.name);
          }}
          onDelete={(collection) => {
            setCollectionManagerOpen(false);
            void handleDeleteFolder(collection.id, collection.name);
          }}
        />
      )}

      {tagManagerOpen && (
        <TagManager
          onClose={() => setTagManagerOpen(false)}
          onChanged={() => {
            void refresh();
            window.dispatchEvent(new Event("aurascholar:library-updated"));
          }}
        />
      )}

      {textPrompt && (
        <TextPromptDialog config={textPrompt} onClose={() => setTextPrompt(null)} />
      )}

      {moveDialogOpen && (
        <MoveToCollectionDialog
          collections={collections}
          selectedCount={selectedIds.size}
          onClose={() => setMoveDialogOpen(false)}
          onMove={async (collectionId, collectionName) => {
            await moveSelectedToCollection(collectionId, collectionName);
            setMoveDialogOpen(false);
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
              <Button
                variant="secondary"
                onClick={() => setImportPreview(null)}
                disabled={importing}
              >
                取消
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TextPromptDialog({
  config,
  onClose,
}: {
  config: TextPromptConfig;
  onClose: () => void;
}) {
  const [value, setValue] = useState(config.initialValue ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = value.trim();
  const canSubmit = config.allowEmpty || Boolean(trimmed);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      setError("请输入内容");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await config.onSubmit(config.allowEmpty ? trimmed : trimmed);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="library-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="library-modal library-prompt-modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <div className="library-modal__head">
          <h2>{config.title}</h2>
          <button
            type="button"
            className="library-modal__close"
            onClick={onClose}
            aria-label="关闭"
            disabled={submitting}
          >
            ×
          </button>
        </div>
        {config.description && <p className="library-prompt-modal__description">{config.description}</p>}
        <label className="library-prompt-field">
          <span>{config.label}</span>
          <Input
            autoFocus
            placeholder={config.placeholder}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            disabled={submitting}
          />
        </label>
        {error && <p className="library-prompt-modal__error">{error}</p>}
        <div className="library-modal-actions">
          <Button type="submit" disabled={submitting || !canSubmit}>
            {submitting ? "处理中..." : config.confirmLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            取消
          </Button>
        </div>
      </form>
    </div>
  );
}

function MoveToCollectionDialog({
  collections,
  selectedCount,
  onMove,
  onClose,
}: {
  collections: CollectionRow[];
  selectedCount: number;
  onMove: (collectionId: string | null, collectionName: string) => Promise<void>;
  onClose: () => void;
}) {
  const [movingTo, setMovingTo] = useState<string | null>(null);

  const move = async (collectionId: string | null, collectionName: string) => {
    setMovingTo(collectionId ?? "__none__");
    try {
      await onMove(collectionId, collectionName);
    } finally {
      setMovingTo(null);
    }
  };

  return (
    <div className="library-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="library-modal library-move-modal" onClick={(e) => e.stopPropagation()}>
        <div className="library-modal__head">
          <h2>移动到文件夹</h2>
          <button
            type="button"
            className="library-modal__close"
            onClick={onClose}
            aria-label="关闭"
            disabled={movingTo !== null}
          >
            ×
          </button>
        </div>
        <p className="library-prompt-modal__description">
          为已选的 {selectedCount} 篇文献选择目标文件夹。
        </p>
        <div className="library-move-options">
          <button
            type="button"
            className="library-move-option"
            onClick={() => void move(null, "全部文献")}
            disabled={movingTo !== null}
          >
            <span>移出所有文件夹</span>
            <small>保留在全部文献中</small>
          </button>
          {collections.length === 0 ? (
            <p className="library-panel-empty">还没有文件夹。先新建文件夹后再移动文献。</p>
          ) : (
            collections.map((collection) => (
              <button
                key={collection.id}
                type="button"
                className="library-move-option"
                onClick={() => void move(collection.id, collection.name)}
                disabled={movingTo !== null}
              >
                <span>{collection.name}</span>
                <small>{collection.count.toLocaleString("zh-CN")} 篇</small>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CollectionManager({
  collections,
  activeCollection,
  trashCount,
  isTrashView,
  onClose,
  onSelectAll,
  onSelectTrash,
  onSelectCollection,
  onCreate,
  onRename,
  onDelete,
}: {
  collections: CollectionRow[];
  activeCollection: string | null;
  trashCount: number;
  isTrashView: boolean;
  onClose: () => void;
  onSelectAll: () => void;
  onSelectTrash: () => void;
  onSelectCollection: (collectionId: string) => void;
  onCreate: () => void;
  onRename: (collection: CollectionRow) => void;
  onDelete: (collection: CollectionRow) => void;
}) {
  return (
    <div className="library-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="library-modal library-collection-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="library-modal__head">
          <div>
            <h2>管理分组</h2>
            <p className="library-modal__subhead">选择当前视图，或整理自定义文件夹。</p>
          </div>
          <button
            type="button"
            className="library-modal__close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="library-collection-manager__section">
          <button
            type="button"
            className={`library-collection-manager__system ${
              !activeCollection && !isTrashView
                ? "library-collection-manager__system--active"
                : ""
            }`}
            onClick={onSelectAll}
          >
            <span>全部文献</span>
            <small>主视图</small>
          </button>
          <button
            type="button"
            className={`library-collection-manager__system ${
              isTrashView ? "library-collection-manager__system--active" : ""
            }`}
            onClick={onSelectTrash}
          >
            <span>回收站</span>
            <small>{trashCount.toLocaleString("zh-CN")} 篇</small>
          </button>
        </div>

        <div className="library-collection-manager__head">
          <span>自定义文件夹</span>
          <button type="button" onClick={onCreate}>
            新建
          </button>
        </div>

        {collections.length === 0 ? (
          <p className="library-panel-empty">还没有文件夹。新建后会同时出现在左侧分组里。</p>
        ) : (
          <ul className="library-collection-manager">
            {collections.map((collection) => (
              <li
                key={collection.id}
                className={`library-collection-manager__row ${
                  activeCollection === collection.id
                    ? "library-collection-manager__row--active"
                    : ""
                }`}
              >
                <button
                  type="button"
                  className="library-collection-manager__select"
                  onClick={() => onSelectCollection(collection.id)}
                >
                  <span>{collection.name}</span>
                  <small>{collection.count.toLocaleString("zh-CN")} 篇</small>
                </button>
                <button type="button" onClick={() => onRename(collection)}>
                  重命名
                </button>
                <button
                  type="button"
                  className="library-collection-manager__delete"
                  onClick={() => onDelete(collection)}
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

function TagManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagPrompt, setTagPrompt] = useState<TextPromptConfig | null>(null);

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
      setTagPrompt({
        title: "重命名标签",
        label: "标签名称",
        initialValue: tag.name,
        confirmLabel: "保存",
        onSubmit: async (value) => {
          const next = value.trim();
          if (next === tag.name) return;
          await (await repo()).rename(tag.id, next);
          await load();
          onChanged();
        },
      });
    },
    [repo, load, onChanged],
  );

  const recolor = useCallback(
    async (tag: TagRow) => {
      setTagPrompt({
        title: "设置标签颜色",
        label: "CSS 颜色值",
        initialValue: tag.color ?? "",
        placeholder: "#4f8f86 或 teal",
        confirmLabel: "保存",
        description: "留空会清除自定义颜色。",
        allowEmpty: true,
        onSubmit: async (value) => {
          await (await repo()).setColor(tag.id, value.trim() || null);
          await load();
          onChanged();
        },
      });
    },
    [repo, load, onChanged],
  );

  const remove = useCallback(
    async (tag: TagRow) => {
      if (!window.confirm(`删除标签「${tag.name}」?这会从 ${tag.count} 篇文献上移除该标签。`))
        return;
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
          <button
            type="button"
            className="library-modal__close"
            onClick={onClose}
            aria-label="关闭"
          >
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
        {tagPrompt && (
          <TextPromptDialog config={tagPrompt} onClose={() => setTagPrompt(null)} />
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

function SelectedWorkPanel({
  work,
  meta,
  tableMeta,
  isTrashView,
  generating,
  attachingPdf,
  onOpenReader,
  onRestoreWork,
  onPurgeWork,
  onUploadPdf,
  onFindFulltext,
  findingFulltext,
  onGenerateFlashcards,
  onOpenFlashcards,
  onOpenSentinel,
  onOpenGraph,
  onEditMetadata,
}: {
  work: WorkWithAuthors | null;
  meta: WorkRuntimeMeta | null;
  tableMeta?: WorkTableMeta;
  isTrashView: boolean;
  generating: boolean;
  attachingPdf: boolean;
  onOpenReader: () => void;
  onRestoreWork: () => void;
  onPurgeWork: () => void;
  onUploadPdf: () => void;
  onFindFulltext: () => void;
  findingFulltext: boolean;
  onGenerateFlashcards: () => void;
  onOpenFlashcards: () => void;
  onOpenSentinel: () => void;
  onOpenGraph: () => void;
  onEditMetadata: () => void;
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

  if (isTrashView) {
    return (
      <>
        <div className="library-detail au-panel library-detail--selected library-detail--trash">
          <div className="library-panel-heading">
            <span className="library-panel-kicker">Recycle bin</span>
            <button type="button" onClick={onRestoreWork}>
              恢复 ›
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
          <Button className="library-detail__read" onClick={onRestoreWork}>
            恢复到文献库
          </Button>
          <button type="button" className="library-danger-button" onClick={onPurgeWork}>
            永久删除
          </button>
        </div>
        <div className="library-automation au-panel">
          <div className="library-panel-heading">
            <h3>书目信息</h3>
          </div>
          <BibliographicLines work={work} />
          <StatusLine label="题录来源" value={sourceText} variant="neutral" />
          <StatusLine
            label="PDF 附件"
            value={meta ? (meta.pdfCount ? `${meta.pdfCount} 个` : "无") : "读取中"}
            variant={meta?.pdfCount ? "success" : "neutral"}
          />
          <p className="library-preview-copy">{work.abstract || "暂无摘要。"}</p>
        </div>
      </>
    );
  }

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
          <h3>书目信息</h3>
          <button type="button" onClick={onEditMetadata}>
            编辑 ›
          </button>
        </div>
        <BibliographicLines work={work} />
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
          <div className="library-panel-actions">
            <button type="button" onClick={onUploadPdf} disabled={attachingPdf}>
              {attachingPdf ? "上传中..." : meta?.pdfCount ? "添加 PDF" : "上传 PDF"}
            </button>
            {!isTrashView && meta && !meta.pdfCount && (
              <button type="button" onClick={onFindFulltext} disabled={findingFulltext}>
                {findingFulltext ? "查找中..." : "去找全文"}
              </button>
            )}
            <button type="button" onClick={onOpenReader}>
              打开阅读器 ›
            </button>
          </div>
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
      <ScholarPanel doi={work.doi} />
    </>
  );
}

/** Live Semantic Scholar signals (AI tldr + citation counts) by DOI. */
function ScholarPanel({ doi }: { doi: string | null }) {
  const [data, setData] = useState<S2Enrichment | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "missing" | "error">("idle");

  useEffect(() => {
    if (!doi || !isTauriRuntime()) {
      setState("idle");
      setData(null);
      return;
    }
    let cancelled = false;
    setState("loading");
    setData(null);
    void fetchScholarEnrichment(doi)
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          setState("missing");
        } else {
          setData(d);
          setState("done");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [doi]);

  if (!doi) return null;

  return (
    <div className="library-automation au-panel">
      <div className="library-panel-heading">
        <h3>Semantic Scholar</h3>
        {data?.url && (
          <a href={data.url} target="_blank" rel="noreferrer">
            查看 ›
          </a>
        )}
      </div>
      {state === "loading" && <p className="library-panel-empty">读取中…</p>}
      {state === "missing" && <p className="library-panel-empty">S2 暂无这篇文献的记录。</p>}
      {state === "error" && <p className="library-panel-empty">读取失败,稍后重试。</p>}
      {state === "done" && data && (
        <>
          {data.tldr && (
            <p className="library-scholar-tldr">
              <strong>AI 摘要</strong>
              {data.tldr}
            </p>
          )}
          <div className="library-citation-stats">
            <span>被引 {data.citationCount ?? "—"}</span>
            <span>高影响 {data.influentialCitationCount ?? "—"}</span>
            <span>参考 {data.referenceCount ?? "—"}</span>
          </div>
        </>
      )}
    </div>
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

/** Read-only list of the rich bibliographic fields that are populated. */
function BibliographicLines({ work }: { work: WorkWithAuthors }) {
  const vol = [
    work.volume && `卷 ${work.volume}`,
    work.issue && `期 ${work.issue}`,
    work.pages && `页 ${work.pages}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const lines: Array<[string, string | null]> = [
    ["卷期页", vol || null],
    ["出版社", work.publisher],
    ["出版地", work.place_published],
    ["版本", work.edition],
    ["ISSN", work.issn],
    ["ISBN", work.isbn],
    ["语言", work.language],
    ["DOI", work.doi],
  ];
  const present = lines.filter(([, v]) => v);
  if (present.length === 0) {
    return (
      <p className="library-bib-empty au-text-muted">
        暂无详细书目信息,点「编辑」补全卷期页、出版社、ISSN 等。
      </p>
    );
  }
  return (
    <dl className="library-bib-list">
      {present.map(([label, value]) => (
        <div className="library-bib-row" key={label}>
          <dt>{label}</dt>
          <dd title={value!}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
