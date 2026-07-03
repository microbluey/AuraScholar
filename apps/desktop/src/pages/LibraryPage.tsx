import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Button, Input } from "@aurascholar/ui";
import type {
  AttachmentRow,
  CollectionRow,
  ReadingStatus,
  TagRow,
  WorkWithAuthors,
} from "@aurascholar/db";
import { getDb } from "../services/tauri-db";
import { listDeletedWorks, listWorks } from "../services/library-list";
import type { IngestDraft, PendingPdf } from "../services/library-types";
import type { ExportFormat } from "../services/cite";
import type { S2Enrichment } from "../services/scholar";
import type { ImportDecision } from "../components/ImportConfirmDialog";
import { useConfirmDialog, type ConfirmFunction } from "../components/ConfirmDialog";
import { InlineNotice } from "../components/InlineNotice";
import { useModalFocusTrap } from "../components/useModalFocusTrap";
import { writeClipboardText } from "../clipboard";
import { isImeComposing } from "../keyboard";
import { shortcutLabel } from "../shortcut-labels";
import { blobPath, openExternalUrl, sha256Hex, tauriFs } from "../services/tauri-platform";

const MetadataEditor = lazy(() =>
  import("../components/MetadataEditor").then((m) => ({ default: m.MetadataEditor })),
);
const ImportConfirmDialog = lazy(() =>
  import("../components/ImportConfirmDialog").then((m) => ({ default: m.ImportConfirmDialog })),
);

function isTauriRuntime(): boolean {
  return "aura" in window;
}

type LibraryFilter = "all" | "reading" | "unread" | "noted" | "starred" | "trash";
type SortMode = "added" | "year";
type DetailPanelTab = "overview" | "notes";
type ExtraFilter =
  | "with-pdf"
  | "without-pdf"
  | "ai-done"
  | "ai-needed"
  | "sentinel-on"
  | "sentinel-off";

interface LibrarySmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_IMPORT_PDF__?: (file: File) => Promise<void>;
}

// How many works to show per page. The DB list() caps at a higher hard limit
// (works.ts:list default 200); paging is a client-side window over that set.
const PAGE_SIZE = 30;
const LIST_HARD_LIMIT = 1000;
const MIN_CITATION_BUSY_MS = 350;
const MIN_COLLECTION_ACTION_BUSY_MS = 250;
const MIN_BULK_TAG_BUSY_MS = 250;
const MIN_MOVE_ACTION_BUSY_MS = 250;
const MIN_REFERENCE_IMPORT_BUSY_MS = 250;
const MIN_TAG_ACTION_BUSY_MS = 250;
const MIN_WORK_ACTION_BUSY_MS = 350;
const REFERENCE_FILE_EXTENSIONS = new Set(["bib", "ris", "nbib", "enw", "json"]);
const REFERENCE_IMPORT_ACCEPT = ".bib,.ris,.nbib,.enw,.json,application/json,text/plain";
const REFERENCE_IMPORT_FORMAT_LABEL = "BibTeX、RIS、PubMed NBIB、EndNote ENW 或 CSL-JSON";
const CITATION_STYLES = [
  { id: "apa", label: "APA 7th" },
  { id: "gb7714", label: "GB/T 7714-2015" },
  { id: "ieee", label: "IEEE" },
  { id: "vancouver", label: "Vancouver" },
  { id: "mla", label: "MLA 9th" },
  { id: "nature", label: "Nature" },
  { id: "chicago", label: "Chicago (note)" },
] as const;

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
  pendingLabel?: string;
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
  sentinelTaskCount: number;
  sentinelStatus: string | null;
  sentinelState: string | null;
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
  pdfs: number;
  flashcards: number;
  latestAiJobStatus: string | null;
  sentinelTaskCount: number;
  sentinelStatus: string | null;
  sentinelState: string | null;
}

function emptyWorkMeta(): WorkTableMeta {
  return {
    tags: [],
    references: 0,
    citedBy: 0,
    annotations: 0,
    pdfs: 0,
    flashcards: 0,
    latestAiJobStatus: null,
    sentinelTaskCount: 0,
    sentinelStatus: null,
    sentinelState: null,
  };
}

function DialogLoading({ label }: { label: string }) {
  return (
    <div className="library-modal-overlay" role="presentation">
      <section
        aria-busy="true"
        aria-live="polite"
        className="library-modal"
        role="status"
        tabIndex={-1}
      >
        <p className="au-text-muted">正在打开{label}...</p>
      </section>
    </div>
  );
}

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return (
    Array.from(dataTransfer.types).includes("Files") ||
    Array.from(dataTransfer.items).some((item) => item.kind === "file")
  );
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isReferenceFile(file: File): boolean {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return REFERENCE_FILE_EXTENSIONS.has(ext);
}

function isSupportedImportFile(file: File): boolean {
  return isPdfFile(file) || isReferenceFile(file);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

async function waitForMinimumElapsed(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

export function LibraryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedWorkId = searchParams.get("work");
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
  const [extraFilter, setExtraFilter] = useState<ExtraFilter | null>(null);
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
  const [advancedFilterOpen, setAdvancedFilterOpen] = useState(false);
  const [textPrompt, setTextPrompt] = useState<TextPromptConfig | null>(null);
  const [collectionAction, setCollectionAction] = useState<{
    id: string;
    kind: "create" | "delete" | "rename";
  } | null>(null);
  const [collectionManagerStatus, setCollectionManagerStatus] = useState<string | null>(null);
  const [collectionManagerError, setCollectionManagerError] = useState<string | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [citeMenuOpen, setCiteMenuOpen] = useState(false);
  const [citationBusy, setCitationBusy] = useState<"copy" | "export" | null>(null);
  const [workActionBusy, setWorkActionBusy] = useState<
    "merge" | "purge" | "restore" | "trash" | null
  >(null);
  const [starActionBusyById, setStarActionBusyById] = useState<Record<string, boolean>>({});
  const [readingStatusBusy, setReadingStatusBusy] = useState<{
    status: ReadingStatus;
    workId: string;
  } | null>(null);
  const [sentinelActionBusyId, setSentinelActionBusyId] = useState<string | null>(null);
  const [editingMetaId, setEditingMetaId] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<{
    count: number;
    fileName?: string;
    text: string;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  // Import confirmation: analyze returns a draft (blob already staged by sha,
  // no library rows written); commitIngest writes only after the user confirms.
  const [confirmDraft, setConfirmDraft] = useState<IngestDraft | null>(null);
  const [findingFulltext, setFindingFulltext] = useState(false);
  const [quickDropActive, setQuickDropActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedPdfInputRef = useRef<HTMLInputElement>(null);
  const refsInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const importingRef = useRef(false);
  const starActionBusyRef = useRef<Record<string, boolean>>({});
  const readingStatusBusyRef = useRef<{ status: ReadingStatus; workId: string } | null>(null);
  const sentinelActionBusyRef = useRef<string | null>(null);
  const quickDropDepthRef = useRef(0);
  const { confirm, confirmDialog } = useConfirmDialog();
  const findShortcut = useMemo(() => shortcutLabel("F"), []);

  const fillExamplePaper = useCallback(() => {
    setInput("1706.03762");
    setMessage(
      isTauriRuntime()
        ? "已填入示例 arXiv ID。按 Enter 或点击“添加文献”即可预览入库卡片。"
        : "已填入示例 arXiv ID。浏览器预览只展示输入效果，真实解析和入库请在桌面应用中完成。",
    );
  }, []);

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
    const [collectionRows, trashRows] = await Promise.all([
      db.query<CollectionRow>(
        `SELECT c.id, c.name, c.parent_id, c.sort_order, COUNT(w.id) AS count
         FROM collections c
         LEFT JOIN collection_items ci ON ci.collection_id = c.id
         LEFT JOIN works w ON w.id = ci.work_id AND w.deleted_at IS NULL
         WHERE c.deleted_at IS NULL
         GROUP BY c.id, c.name, c.parent_id, c.sort_order
         ORDER BY c.name`,
      ),
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
    const [
      tagRows,
      referenceRows,
      citedByRows,
      annotationRows,
      attachmentRows,
      flashcardRows,
      aiJobRows,
      sentinelRows,
    ] = await Promise.all([
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
      db.query<{ work_id: string; count: number }>(
        `SELECT work_id, COUNT(*) AS count
         FROM attachments
         WHERE work_id IN (${placeholders}) AND deleted_at IS NULL AND kind = 'pdf'
         GROUP BY work_id`,
        ids,
      ),
      db.query<{ work_id: string; count: number }>(
        `SELECT work_id, COUNT(*) AS count
         FROM flashcards
         WHERE work_id IN (${placeholders}) AND deleted_at IS NULL
         GROUP BY work_id`,
        ids,
      ),
      db.query<{ work_id: string; status: string }>(
        `SELECT j.work_id, j.status
         FROM ai_jobs j
         JOIN (
           SELECT work_id, MAX(created_at) AS created_at
           FROM ai_jobs
           WHERE work_id IN (${placeholders})
           GROUP BY work_id
         ) latest ON latest.work_id = j.work_id AND latest.created_at = j.created_at`,
        ids,
      ),
      db.query<{
        work_id: string;
        status: string;
        current_state: string | null;
        task_count: number;
      }>(
        `SELECT st.work_id, st.status, st.current_state, latest.task_count
         FROM sentinel_tasks st
         JOIN (
           SELECT work_id, MAX(created_at) AS created_at, COUNT(*) AS task_count
           FROM sentinel_tasks
           WHERE work_id IN (${placeholders}) AND deleted_at IS NULL
           GROUP BY work_id
         ) latest ON latest.work_id = st.work_id AND latest.created_at = st.created_at
         WHERE st.deleted_at IS NULL`,
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
    for (const row of attachmentRows) {
      const meta = nextMeta[row.work_id];
      if (meta) meta.pdfs = Number(row.count);
    }
    for (const row of flashcardRows) {
      const meta = nextMeta[row.work_id];
      if (meta) meta.flashcards = Number(row.count);
    }
    for (const row of aiJobRows) {
      const meta = nextMeta[row.work_id];
      if (meta) meta.latestAiJobStatus = row.status;
    }
    for (const row of sentinelRows) {
      const meta = nextMeta[row.work_id];
      if (meta) {
        meta.sentinelTaskCount = Number(row.task_count);
        meta.sentinelStatus = row.status;
        meta.sentinelState = row.current_state;
      }
    }
    setWorkMeta(nextMeta);
    window.dispatchEvent(new Event("aurascholar:library-updated"));
  }, [search, activeCollection, activeFilter]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [refresh, search]);

  useEffect(() => {
    const onFindShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.key.toLowerCase() !== "f") return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (document.querySelector("[data-modal-root]")) return;
      if (isEditableTarget(event.target) && event.target !== searchInputRef.current) return;
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", onFindShortcut);
    return () => window.removeEventListener("keydown", onFindShortcut);
  }, []);

  const autoDigest = useCallback((workId: string, title: string) => {
    void import("../services/ai")
      .then(({ generateFlashcardsForWork }) =>
        generateFlashcardsForWork(workId, title, { persistError: false }),
      )
      .then(() => setMessage(`已入库并提取重点:${title}`))
      .catch(() => {}); // no AI config / scanned PDF — manual extraction remains
  }, []);

  // Surface a dedup hit (already in library) without a confirm card.
  const surfaceDedup = useCallback(
    async (draft: IngestDraft): Promise<boolean> => {
      if (!draft.dedup) return false;
      const { attachStagedPdf, restoreDedup } = await import("../services/library-actions");
      await restoreDedup(draft.dedup.workId);
      // A fresh PDF for an existing work: attach it directly (work identity is
      // already settled, no confirmation needed).
      let pdfMessage: string | null = null;
      if (draft.pdf) {
        try {
          const attachment = await attachStagedPdf(draft.dedup.workId, draft.pdf);
          pdfMessage = attachment.deduped ? "PDF 已经挂过" : "PDF 已挂到该文献";
        } catch (e) {
          pdfMessage = `PDF 挂载失败:${e instanceof Error ? e.message : String(e)}`;
        }
      }
      setMessage(`已在库中:${draft.dedup.title}${pdfMessage ? `，${pdfMessage}` : ""}`);
      await refresh();
      return true;
    },
    [refresh],
  );

  const handleAdd = useCallback(async () => {
    if (!input.trim() || busy) return;
    if (!isTauriRuntime()) {
      setMessage("浏览器预览不会解析或写入本地文献库，请在桌面应用中完成入库。");
      return;
    }
    setBusy(true);
    setMessage("正在识别…");
    try {
      const { analyzeInput } = await import("../services/library");
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
        const { analyzePdf } = await import("../services/library");
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

  useEffect(() => {
    const target = window as LibrarySmokeWindow;
    const importPdf = async (file: File) => {
      setBusy(true);
      setMessage("正在识别 PDF…");
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const sha = await sha256Hex(data);
        await tauriFs.writeFile(blobPath(sha), data);
        const title = file.name.replace(/\.pdf$/i, "") || "Smoke PDF";
        const pdf: PendingPdf = {
          sha,
          fileName: file.name,
          byteSize: data.byteLength,
          pageCount: 1,
          relPath: null,
          fetchedVia: "manual",
        };
        setMessage(null);
        setConfirmDraft({
          source: "pdf",
          candidates: [],
          bestIndex: -1,
          confidence: 0,
          pdf,
          dedup: null,
          fallbackTitle: title,
          pdfFields: { title, authors: [] },
          localMatches: [],
        });
      } catch (e) {
        setMessage(`解析失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    };
    target.__AURASCHOLAR_SMOKE_IMPORT_PDF__ = importPdf;
    return () => {
      if (target.__AURASCHOLAR_SMOKE_IMPORT_PDF__ === importPdf) {
        delete target.__AURASCHOLAR_SMOKE_IMPORT_PDF__;
      }
    };
  }, []);

  // User confirmed the import card → write to the library (create or attach).
  const handleConfirmImport = useCallback(
    async (decision: ImportDecision) => {
      const draft = confirmDraft;
      const { attachStagedPdf, commitIngest, restoreDedup } = await import(
        "../services/library-actions"
      );
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
      setConfirmDraft(null);
      window.dispatchEvent(new Event("aurascholar:library-updated"));
      await refresh();
    },
    [confirmDraft, refresh, autoDigest],
  );

  const handleCancelImport = useCallback(() => {
    const draft = confirmDraft;
    setConfirmDraft(null);
    setMessage("已取消入库");
    void import("../services/library-actions")
      .then(({ discardStagedPdf }) => discardStagedPdf(draft?.pdf))
      .catch(() => {});
  }, [confirmDraft]);

  const handleNewFolder = useCallback(async () => {
    if (collectionAction) return;
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
        const startedAt = Date.now();
        setCollectionAction({ id: "__create__", kind: "create" });
        setCollectionManagerStatus(`正在创建文件夹「${name}」...`);
        setCollectionManagerError(null);
        try {
          const db = await getDb();
          const { CollectionsRepo } = await import("@aurascholar/db/repos/collections");
          const id = await new CollectionsRepo(db).create(name);
          await waitForMinimumElapsed(startedAt, MIN_COLLECTION_ACTION_BUSY_MS);
          setActiveFilter("all");
          setActiveCollection(id);
          setActiveTag(null);
          setActiveSource(null);
          setMessage(`已新建文件夹「${name}」`);
          setCollectionManagerStatus(`已新建文件夹「${name}」`);
          await refresh();
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          setCollectionManagerError(`创建文件夹失败:${message}`);
          throw e;
        } finally {
          setCollectionAction(null);
        }
      },
    });
  }, [collectionAction, refresh]);

  const handleRenameFolder = useCallback(
    async (id: string, name: string) => {
      if (collectionAction) return;
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
          const startedAt = Date.now();
          setCollectionAction({ id, kind: "rename" });
          setCollectionManagerStatus(`正在重命名文件夹「${name}」...`);
          setCollectionManagerError(null);
          try {
            const db = await getDb();
            const { CollectionsRepo } = await import("@aurascholar/db/repos/collections");
            await new CollectionsRepo(db).rename(id, next);
            await waitForMinimumElapsed(startedAt, MIN_COLLECTION_ACTION_BUSY_MS);
            setMessage(`已重命名为「${next}」`);
            setCollectionManagerStatus(`已重命名为「${next}」`);
            await refresh();
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            setCollectionManagerError(`重命名文件夹失败:${message}`);
            throw e;
          } finally {
            setCollectionAction(null);
          }
        },
      });
    },
    [collectionAction, refresh],
  );

  const handleDeleteFolder = useCallback(
    async (id: string, name: string) => {
      if (collectionAction) return;
      if (!isTauriRuntime()) {
        setMessage("预览模式下不会写入本地数据库");
        return;
      }
      const confirmed = await confirm({
        title: "删除文件夹？",
        description: `「${name}」会从分组列表移除，里面的文献会回到“全部文献”。`,
        details: [
          "文献记录、PDF、批注和标签不会被删除。",
          "删除后可继续通过全部文献或搜索找到这些论文。",
        ],
        confirmLabel: "删除文件夹",
        tone: "warning",
      });
      if (!confirmed) return;
      const startedAt = Date.now();
      setCollectionAction({ id, kind: "delete" });
      setCollectionManagerStatus(`正在删除文件夹「${name}」...`);
      setCollectionManagerError(null);
      try {
        const db = await getDb();
        const { CollectionsRepo } = await import("@aurascholar/db/repos/collections");
        await new CollectionsRepo(db).softDelete(id);
        await waitForMinimumElapsed(startedAt, MIN_COLLECTION_ACTION_BUSY_MS);
        if (activeCollection === id) setActiveCollection(null);
        setMessage(`已删除文件夹「${name}」`);
        setCollectionManagerStatus(`已删除文件夹「${name}」`);
        await refresh();
      } catch (e) {
        const errorMessage = `删除文件夹失败:${e instanceof Error ? e.message : String(e)}`;
        setMessage(errorMessage);
        setCollectionManagerError(errorMessage);
      } finally {
        setCollectionAction(null);
      }
    },
    [activeCollection, collectionAction, confirm, refresh],
  );

  useEffect(() => {
    const onLibraryView = (event: Event) => {
      const detail = (event as CustomEvent<LibraryViewDetail>).detail ?? {};
      const nextFilter = detail.filter ?? "all";
      setActiveFilter(nextFilter);
      setActiveCollection(nextFilter === "trash" ? null : (detail.collectionId ?? null));
      setActiveTag(nextFilter === "trash" ? null : (detail.tag ?? null));
      setActiveSource(null);
      setExtraFilter(null);
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
    if (!requestedWorkId) return;
    setActiveFilter("all");
    setActiveCollection(null);
    setActiveTag(null);
    setActiveSource(null);
    setExtraFilter(null);
    setSelectedIds(new Set());
    setSelectedWorkId(requestedWorkId);
    const next = new URLSearchParams(searchParams);
    next.delete("work");
    setSearchParams(next, { replace: true });
  }, [requestedWorkId, searchParams, setSearchParams]);

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
      const meta = workMeta[work.id];
      if (extraFilter === "with-pdf" && (meta?.pdfs ?? 0) === 0) return false;
      if (extraFilter === "without-pdf" && (meta?.pdfs ?? 0) > 0) return false;
      if (extraFilter === "ai-done" && meta?.latestAiJobStatus !== "done") return false;
      if (
        extraFilter === "ai-needed" &&
        ((meta?.pdfs ?? 0) === 0 || meta?.latestAiJobStatus === "done")
      ) {
        return false;
      }
      if (extraFilter === "sentinel-on" && (meta?.sentinelTaskCount ?? 0) === 0) return false;
      if (extraFilter === "sentinel-off" && (meta?.sentinelTaskCount ?? 0) > 0) return false;
      if (activeFilter === "reading") return work.reading_status === "reading";
      if (activeFilter === "unread") return work.reading_status === "unread";
      if (activeFilter === "noted") return (workMeta[work.id]?.annotations ?? 0) > 0;
      if (activeFilter === "starred") return work.starred === 1;
      return true;
    });
    return sortWorks(filtered);
  }, [activeFilter, activeSource, activeTag, extraFilter, items, sortMode, workMeta]);
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
    : (activeCollectionRow?.name ??
      (activeTag ? `标签:${activeTag}` : activeSource ? `来源:${activeSource}` : "全部文献"));
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
    extraFilter ? extraFilterLabel(extraFilter) : null,
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
      const startedAt = Date.now();
      setAttachingPdf(true);
      setMessage(`正在为《${selectedWork.title}》上传 PDF...`);
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const { attachPdfToWork } = await import("../services/library");
        const result = await attachPdfToWork(selectedWork.id, file.name, data);
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
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
      const { analyzeOaPdf } = await import("../services/library");
      const draft = await analyzeOaPdf({
        doi: selectedWork.doi ?? undefined,
        arxivId: selectedWork.arxiv_id ?? undefined,
        title: selectedWork.title,
      });
      if (draft) {
        setMessage(null);
        setConfirmDraft({
          ...draft,
          targetWorkId: selectedWork.id,
          targetTitle: selectedWork.title,
        });
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

  const updateWorkStarred = useCallback(
    async (work: WorkWithAuthors, starred: boolean) => {
      if (Object.prototype.hasOwnProperty.call(starActionBusyRef.current, work.id)) return;
      if (!isTauriRuntime()) {
        setMessage("预览模式下不会写入本地数据库");
        return;
      }
      const startedAt = Date.now();
      const nextBusy = { ...starActionBusyRef.current, [work.id]: starred };
      starActionBusyRef.current = nextBusy;
      setStarActionBusyById(nextBusy);
      setMessage(starred ? `正在标记重点:《${work.title}》...` : `正在取消重点:《${work.title}》...`);
      try {
        const db = await getDb();
        const { WorksRepo } = await import("@aurascholar/db/repos/works");
        await new WorksRepo(db).setStarred(work.id, starred);
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        setMessage(starred ? `已标记重点:《${work.title}》` : `已取消重点:《${work.title}》`);
        setSelectedWorkId(work.id);
        await refresh();
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (e) {
        setMessage(`更新重点状态失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        const restBusy = { ...starActionBusyRef.current };
        delete restBusy[work.id];
        starActionBusyRef.current = restBusy;
        setStarActionBusyById(restBusy);
      }
    },
    [refresh],
  );

  const updateSelectedReadingStatus = useCallback(
    async (status: ReadingStatus) => {
      if (!selectedWork) return;
      if (readingStatusBusyRef.current) return;
      if (!isTauriRuntime()) {
        setMessage("预览模式下不会写入本地数据库");
        return;
      }
      const startedAt = Date.now();
      const busyTarget = { workId: selectedWork.id, status };
      readingStatusBusyRef.current = busyTarget;
      setReadingStatusBusy(busyTarget);
      setMessage(`正在更新阅读状态:${readingStatusLabel(status)}...`);
      try {
        const db = await getDb();
        const { WorksRepo } = await import("@aurascholar/db/repos/works");
        await new WorksRepo(db).setReadingStatus(selectedWork.id, status);
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        setMessage(`已更新阅读状态:${readingStatusLabel(status)}`);
        setSelectedWorkId(selectedWork.id);
        await refresh();
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (e) {
        setMessage(`更新阅读状态失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        readingStatusBusyRef.current = null;
        setReadingStatusBusy(null);
      }
    },
    [refresh, selectedWork],
  );

  const deleteSelectedWork = useCallback(async () => {
    if (!selectedWork || workActionBusy || !isTauriRuntime()) return;
    const confirmed = await confirm({
      title: "移入回收站？",
      description: `《${selectedWork.title}》会从当前列表移到回收站。`,
      details: ["你可以在回收站恢复它。", "永久删除前，PDF、批注、标签和闪卡都会保留。"],
      confirmLabel: "移入回收站",
      tone: "warning",
    });
    if (!confirmed) return;
    const startedAt = Date.now();
    const title = selectedWork.title;
    setWorkActionBusy("trash");
    setMessage(`正在将《${title}》移入回收站...`);
    try {
      const db = await getDb();
      const { WorksRepo } = await import("@aurascholar/db/repos/works");
      await new WorksRepo(db).softDelete(selectedWork.id);
      await refresh();
      await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
      setMessage(`已将《${title}》移入回收站`);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(selectedWork.id);
        return next;
      });
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    } catch (e) {
      setMessage(`移入回收站失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWorkActionBusy(null);
    }
  }, [confirm, refresh, selectedWork, workActionBusy]);

  const createSentinelForSelected = useCallback(async () => {
    if (!selectedWork || !isTauriRuntime() || sentinelActionBusyRef.current) return;
    if (!selectedWork.doi) {
      setMessage("这篇文献没有 DOI，无法创建精确哨兵监控");
      return;
    }
    const startedAt = Date.now();
    sentinelActionBusyRef.current = selectedWork.id;
    setSentinelActionBusyId(selectedWork.id);
    setMessage(`正在加入检索哨兵:《${selectedWork.title}》...`);
    try {
      const db = await getDb();
      const { SentinelRepo } = await import("@aurascholar/db/repos/sentinel");
      const result = await new SentinelRepo(db).createOrRestore({
        doi: selectedWork.doi,
        title: selectedWork.title,
        workId: selectedWork.id,
      });
      await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
      setMessage(librarySentinelCreateMessage(result.status));
      await refresh();
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    } catch (e) {
      setMessage(`创建哨兵失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      sentinelActionBusyRef.current = null;
      setSentinelActionBusyId(null);
    }
  }, [refresh, selectedWork]);

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
      const [attachments, flashcards, jobs, notes, sentinelTasks] = await Promise.all([
        db.query<AttachmentRow>(
          `SELECT * FROM attachments WHERE work_id = ? AND deleted_at IS NULL`,
          [selectedWork.id],
        ),
        db.query<{ id: string }>(
          `SELECT id FROM flashcards WHERE work_id = ? AND deleted_at IS NULL`,
          [selectedWork.id],
        ),
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
        db.query<{ status: string; current_state: string }>(
          `SELECT status, current_state
           FROM sentinel_tasks
           WHERE work_id = ? AND deleted_at IS NULL
           ORDER BY created_at DESC`,
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
        sentinelTaskCount: sentinelTasks.length,
        sentinelStatus: sentinelTasks[0]?.status ?? null,
        sentinelState: sentinelTasks[0]?.current_state ?? null,
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
  }, [activeFilter, activeSource, activeTag, activeCollection, extraFilter, search, sortMode]);

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

  const focusPagedRow = useCallback((index: number) => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-library-row-index="${index}"]`)?.focus();
    });
  }, []);

  const moveKeyboardSelection = useCallback(
    (index: number, nextIndex: number) => {
      if (pagedRows.length === 0) return;
      const clamped = Math.min(Math.max(nextIndex, 0), pagedRows.length - 1);
      const next = pagedRows[clamped];
      if (!next || clamped === index) return;
      setSelectedWorkId(next.id);
      focusPagedRow(clamped);
    },
    [focusPagedRow, pagedRows],
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
      const { generateFlashcardsForWork } = await import("../services/ai");
      const result = await generateFlashcardsForWork(selectedWork.id, selectedWork.title);
      setMessage(`已为《${selectedWork.title}》生成 ${result.created} 张闪卡`);
      window.dispatchEvent(new Event("aurascholar:library-updated"));
      const db = await getDb();
      const cards = await db.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM flashcards WHERE work_id = ? AND deleted_at IS NULL`,
        [selectedWork.id],
      );
      setSelectedMeta((prev) => ({
        pdfCount: prev?.pdfCount ?? 0,
        flashcardCount: Number(cards[0]?.n ?? 0),
        annotationCount: prev?.annotationCount ?? 0,
        pdfPreview: prev?.pdfPreview ?? null,
        notePreviews: prev?.notePreviews ?? [],
        latestAiJobStatus: "done",
        latestAiJobError: null,
        sentinelTaskCount: prev?.sentinelTaskCount ?? 0,
        sentinelStatus: prev?.sentinelStatus ?? null,
        sentinelState: prev?.sentinelState ?? null,
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
        sentinelTaskCount: prev?.sentinelTaskCount ?? 0,
        sentinelStatus: prev?.sentinelStatus ?? null,
        sentinelState: prev?.sentinelState ?? null,
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

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, work: WorkWithAuthors, index: number) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveKeyboardSelection(index, index + 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveKeyboardSelection(index, index - 1);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        moveKeyboardSelection(index, 0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        moveKeyboardSelection(index, pagedRows.length - 1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        openReader(work);
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        setSelectedWorkId(work.id);
        toggleRowSelected(work.id);
      }
    },
    [moveKeyboardSelection, openReader, pagedRows.length, toggleRowSelected],
  );

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
      pendingLabel: "添加中...",
      description: `将标签添加到已选的 ${workIds.length} 篇文献。`,
      onSubmit: async (value) => {
        const name = value.trim();
        const startedAt = Date.now();
        const db = await getDb();
        const { TagsRepo } = await import("@aurascholar/db/repos/tags");
        await new TagsRepo(db).addToWorks(workIds, name);
        await waitForMinimumElapsed(startedAt, MIN_BULK_TAG_BUSY_MS);
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

  const moveSelectedToCollection = useCallback(
    async (target: string | null, targetName: string): Promise<boolean> => {
      if (selectedIds.size === 0 || !isTauriRuntime()) return false;
      const workIds = Array.from(selectedIds);
      const startedAt = Date.now();
      try {
        const db = await getDb();
        const { CollectionsRepo } = await import("@aurascholar/db/repos/collections");
        const colRepo = new CollectionsRepo(db);
        for (const workId of workIds) {
          await colRepo.setWorkCollection(workId, target);
        }
        await waitForMinimumElapsed(startedAt, MIN_MOVE_ACTION_BUSY_MS);
        setMessage(
          target
            ? `已移动 ${workIds.length} 篇文献到「${targetName}」`
            : `已将 ${workIds.length} 篇文献移出所有文件夹`,
        );
        setSelectedIds(new Set());
        await refresh();
        return true;
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_MOVE_ACTION_BUSY_MS);
        setMessage(`移动文件夹失败:${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    },
    [selectedIds, refresh],
  );

  const bulkDelete = useCallback(async () => {
    if (selectedIds.size === 0 || workActionBusy || !isTauriRuntime()) return;
    const workIds = Array.from(selectedIds);
    const confirmed = await confirm({
      title: "批量移入回收站？",
      description: `将选中的 ${workIds.length} 篇文献移入回收站。`,
      details: [
        "这些文献之后可以从回收站恢复。",
        "永久删除前，关联 PDF、批注、标签和闪卡都会保留。",
      ],
      confirmLabel: `移入 ${workIds.length} 篇`,
      tone: "warning",
    });
    if (!confirmed) return;
    const startedAt = Date.now();
    setWorkActionBusy("trash");
    setMessage(`正在将 ${workIds.length} 篇文献移入回收站...`);
    try {
      const db = await getDb();
      const { WorksRepo } = await import("@aurascholar/db/repos/works");
      const worksRepo = new WorksRepo(db);
      for (const workId of workIds) {
        await worksRepo.softDelete(workId);
      }
      await refresh();
      await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
      setMessage(`已将 ${workIds.length} 篇文献移入回收站`);
      setSelectedIds(new Set());
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    } catch (e) {
      setMessage(`批量移入回收站失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWorkActionBusy(null);
    }
  }, [confirm, selectedIds, refresh, workActionBusy]);

  const restoreWorks = useCallback(
    async (workIds: string[]) => {
      if (workIds.length === 0 || workActionBusy || !isTauriRuntime()) return;
      const startedAt = Date.now();
      setWorkActionBusy("restore");
      setMessage(`正在恢复 ${workIds.length} 篇文献...`);
      try {
        const db = await getDb();
        const { WorksRepo } = await import("@aurascholar/db/repos/works");
        const worksRepo = new WorksRepo(db);
        for (const workId of workIds) {
          await worksRepo.restore(workId);
        }
        await refresh();
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        setMessage(`已恢复 ${workIds.length} 篇文献`);
        setSelectedIds(new Set());
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (e) {
        setMessage(`恢复文献失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setWorkActionBusy(null);
      }
    },
    [refresh, workActionBusy],
  );

  const purgeWorks = useCallback(
    async (workIds: string[]) => {
      if (workIds.length === 0 || workActionBusy || !isTauriRuntime()) return;
      const confirmed = await confirm({
        title: "永久删除文献？",
        description: `将永久删除 ${workIds.length} 篇回收站文献。`,
        details: ["这会移除元数据、PDF、标签、笔记、闪卡和引用关联。", "该操作不能撤销。"],
        confirmLabel: "永久删除",
        tone: "danger",
      });
      if (!confirmed) return;
      const startedAt = Date.now();
      setWorkActionBusy("purge");
      setMessage(`正在永久删除 ${workIds.length} 篇文献...`);
      try {
        const db = await getDb();
        const { WorksRepo } = await import("@aurascholar/db/repos/works");
        const worksRepo = new WorksRepo(db);
        for (const workId of workIds) {
          await worksRepo.purgeDeleted(workId);
        }
        await refresh();
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        setMessage(`已永久删除 ${workIds.length} 篇文献`);
        setSelectedIds(new Set());
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (e) {
        setMessage(`永久删除失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setWorkActionBusy(null);
      }
    },
    [confirm, refresh, workActionBusy],
  );

  const bulkMerge = useCallback(async () => {
    if (selectedIds.size < 2 || workActionBusy || !isTauriRuntime()) return;
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
    const confirmed = await confirm({
      title: "合并重复文献？",
      description: `将 ${duplicates.length} 篇重复文献合并到主记录《${selectedWork.title}》。`,
      details: [
        "PDF、批注、闪卡、标签、摘录、文件夹、引文和哨兵任务会迁移到主记录。",
        "主记录的题名与作者优先保留，重复项会移入回收站。",
        titles ? `重复项：${titles}${duplicates.length > 4 ? "…" : ""}` : null,
      ],
      confirmLabel: "确认合并",
      tone: "warning",
    });
    if (!confirmed) return;
    const startedAt = Date.now();
    setWorkActionBusy("merge");
    setMessage(`正在合并 ${duplicates.length} 篇重复文献到《${selectedWork.title}》...`);
    try {
      const db = await getDb();
      const { WorksRepo } = await import("@aurascholar/db/repos/works");
      const result = await new WorksRepo(db).mergeInto(selectedWork.id, duplicates);
      await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
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
      setWorkActionBusy(null);
    }
  }, [confirm, items, refresh, selectedIds, selectedWork, workActionBusy]);

  const handleExportCitations = useCallback(
    async (format: ExportFormat) => {
      if (selectedIds.size === 0 || citationBusy) return;
      const workIds = Array.from(selectedIds);
      const count = workIds.length;
      const startedAt = Date.now();
      setCiteMenuOpen(false);
      setCitationBusy("export");
      setMessage(`正在导出 ${count} 篇文献的引用...`);
      try {
        const { exportWorks } = await import("../services/cite");
        await exportWorks(workIds, format);
        await waitForMinimumElapsed(startedAt, MIN_CITATION_BUSY_MS);
        setMessage(`已导出 ${count} 篇文献的引用(${format.toUpperCase()})`);
      } catch (e) {
        setMessage(`导出失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setCitationBusy(null);
      }
    },
    [citationBusy, selectedIds],
  );

  const handleCopyBibliography = useCallback(
    async (styleId: string) => {
      if (selectedIds.size === 0 || citationBusy) return;
      const workIds = Array.from(selectedIds);
      const count = workIds.length;
      const startedAt = Date.now();
      setCiteMenuOpen(false);
      setCitationBusy("copy");
      setMessage(`正在复制 ${count} 条参考文献...`);
      try {
        const { bibliographyText } = await import("../services/cite");
        const text = await bibliographyText(workIds, styleId);
        await writeClipboardText(text);
        await waitForMinimumElapsed(startedAt, MIN_CITATION_BUSY_MS);
        setMessage(`已复制 ${count} 条参考文献到剪贴板`);
      } catch (e) {
        setMessage(`复制失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setCitationBusy(null);
      }
    },
    [citationBusy, selectedIds],
  );

  const handleRefsFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const { previewReferences } = await import("../services/import-refs");
      const items = previewReferences(text);
      if (items.length === 0) {
        setMessage(`没有从文件中解析出任何文献(支持 ${REFERENCE_IMPORT_FORMAT_LABEL})`);
        return;
      }
      setImportPreview({ count: items.length, fileName: file.name, text });
    } catch (e) {
      setMessage(`解析失败:${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const resetQuickDropState = useCallback(() => {
    quickDropDepthRef.current = 0;
    setQuickDropActive(false);
  }, []);

  const handleQuickDropFiles = useCallback(
    (files: File[]) => {
      resetQuickDropState();
      if (busy) {
        setMessage("当前正在处理上一项，请稍后再拖入文件");
        return;
      }
      const supported = files.filter(isSupportedImportFile);
      if (supported.length === 0) {
        setMessage(`仅支持拖入 PDF、${REFERENCE_IMPORT_FORMAT_LABEL} 文件`);
        return;
      }
      if (supported.length > 1) {
        setMessage("请一次拖入一个 PDF 或一个文献库文件，避免误入库");
        return;
      }
      const file = supported[0]!;
      if (isPdfFile(file)) {
        void handleUpload(file);
      } else {
        void handleRefsFile(file);
      }
    },
    [busy, handleRefsFile, handleUpload, resetQuickDropState],
  );

  const handleQuickDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
      quickDropDepthRef.current += 1;
      setQuickDropActive(true);
    },
    [],
  );

  const handleQuickDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = busy ? "none" : "copy";
      setQuickDropActive(true);
    },
    [busy],
  );

  const handleQuickDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    quickDropDepthRef.current = Math.max(0, quickDropDepthRef.current - 1);
    if (quickDropDepthRef.current === 0) setQuickDropActive(false);
  }, []);

  const handleQuickDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
      handleQuickDropFiles(Array.from(event.dataTransfer.files));
    },
    [handleQuickDropFiles],
  );

  const confirmImport = useCallback(async () => {
    if (importingRef.current) return;
    if (!importPreview || !isTauriRuntime()) {
      setImportPreview(null);
      if (!isTauriRuntime()) setMessage("预览模式下不会写入本地数据库");
      return;
    }
    importingRef.current = true;
    const startedAt = Date.now();
    setImporting(true);
    try {
      const { importReferences } = await import("../services/import-refs");
      const summary = await importReferences(importPreview.text);
      await waitForMinimumElapsed(startedAt, MIN_REFERENCE_IMPORT_BUSY_MS);
      setMessage(
        `导入完成:新增 ${summary.imported} 篇,已存在 ${summary.deduped} 篇(共 ${summary.total} 条)`,
      );
      setImportPreview(null);
      await refresh();
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_REFERENCE_IMPORT_BUSY_MS);
      setMessage(`导入失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }, [importPreview, refresh]);

  const clearLibraryView = useCallback(() => {
    setActiveFilter("all");
    setActiveCollection(null);
    setActiveTag(null);
    setActiveSource(null);
    setExtraFilter(null);
    setSelectedIds(new Set());
  }, []);

  return (
    <div className="library-page">
      <h1 className="sr-only">文献库</h1>
      <div
        className={`library-topbar ${quickDropActive ? "library-topbar--drop-active" : ""}`}
        onDragEnter={handleQuickDragEnter}
        onDragOver={handleQuickDragOver}
        onDragLeave={handleQuickDragLeave}
        onDragEnd={resetQuickDropState}
        onDrop={handleQuickDrop}
      >
        <div className={`library-command ${quickDropActive ? "library-command--drop-active" : ""}`}>
          <Input
            placeholder="快速入库：DOI / arXiv / PDF 链接或拖拽文件到此处..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isImeComposing(e)) void handleAdd();
            }}
            disabled={busy}
          />
          <span className="au-kbd">Enter</span>
          {quickDropActive && (
            <span className="library-command__drop-hint" role="status">
              释放导入 PDF / 文献库
            </span>
          )}
        </div>
        <div className="library-topbar__actions">
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
        accept={REFERENCE_IMPORT_ACCEPT}
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleRefsFile(f);
          e.target.value = "";
        }}
      />
      <InlineNotice className="library-command__message" message={message} />

      {selectedIds.size > 0 && (
        <div className="library-bulkbar">
          <span className="library-bulkbar__count">已选 {selectedIds.size} 篇</span>
          {isTrashView ? (
            <>
              <button
                type="button"
                onClick={() => void restoreWorks(Array.from(selectedIds))}
                disabled={Boolean(workActionBusy)}
              >
                {workActionBusy === "restore" ? "恢复中..." : "恢复"}
              </button>
              <button
                type="button"
                className="library-bulkbar__danger"
                onClick={() => void purgeWorks(Array.from(selectedIds))}
                disabled={Boolean(workActionBusy)}
              >
                {workActionBusy === "purge" ? "删除中..." : "永久删除"}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => void bulkAddTag()} disabled={Boolean(workActionBusy)}>
                添加标签
              </button>
              <button
                type="button"
                onClick={() => void bulkMoveToCollection()}
                disabled={Boolean(workActionBusy)}
              >
                移动到文件夹
              </button>
              {selectedIds.size > 1 && (
                <button
                  type="button"
                  onClick={() => void bulkMerge()}
                  disabled={busy || Boolean(workActionBusy)}
                  aria-busy={workActionBusy === "merge" ? "true" : undefined}
                >
                  {workActionBusy === "merge" ? "合并中..." : "合并文献"}
                </button>
              )}
              <div className="library-cite-menu" aria-busy={citationBusy ? "true" : undefined}>
                <button
                  type="button"
                  onClick={() => setCiteMenuOpen((v) => !v)}
                  disabled={Boolean(citationBusy) || Boolean(workActionBusy)}
                >
                  {citationBusy === "export"
                    ? "导出中..."
                    : citationBusy === "copy"
                      ? "复制中..."
                      : "导出引用 ▾"}
                </button>
                {citeMenuOpen && (
                  <div className="library-cite-dropdown">
                    <div className="library-cite-dropdown__group">导出文件</div>
                    <button
                      type="button"
                      onClick={() => void handleExportCitations("bibtex")}
                      disabled={Boolean(citationBusy)}
                    >
                      BibTeX (.bib)
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleExportCitations("ris")}
                      disabled={Boolean(citationBusy)}
                    >
                      RIS (.ris)
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleExportCitations("csljson")}
                      disabled={Boolean(citationBusy)}
                    >
                      CSL-JSON (.json)
                    </button>
                    <div className="library-cite-dropdown__group">复制参考文献</div>
                    {CITATION_STYLES.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => void handleCopyBibliography(s.id)}
                        disabled={Boolean(citationBusy)}
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
                disabled={Boolean(workActionBusy)}
              >
                {workActionBusy === "trash" ? "移入中..." : "删除"}
              </button>
            </>
          )}
          <button
            type="button"
            className="library-bulkbar__clear"
            onClick={() => setSelectedIds(new Set())}
            disabled={Boolean(workActionBusy)}
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
              <input
                ref={searchInputRef}
                className="au-input"
                placeholder={isTrashView ? "搜索回收站" : "在结果中搜索"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="au-kbd">{findShortcut}</span>
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
                setExtraFilter(null);
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
                  onClick={() => {
                    setCollectionManagerStatus(null);
                    setCollectionManagerError(null);
                    setCollectionManagerOpen(true);
                  }}
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
                  {activeFilter === "starred" ? "取消重点" : "重点筛选"}
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
                  onClick={() => {
                    setCollectionManagerStatus(null);
                    setCollectionManagerError(null);
                    setCollectionManagerOpen(true);
                  }}
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
                  onClick={() => setAdvancedFilterOpen(true)}
                >
                  {extraFilter ? extraFilterLabel(extraFilter) : "更多"}
                </button>
                {(activeCollection ||
                  activeTag ||
                  activeSource ||
                  extraFilter ||
                  activeFilter !== "all") && (
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
            items.length === 0 && !isTrashView && !activeCollection ? (
              <LibraryOnboardingEmpty
                busy={busy}
                previewMode={!isTauriRuntime()}
                onImportPdf={() => fileInputRef.current?.click()}
                onImportRefs={() => refsInputRef.current?.click()}
                onTryExample={fillExamplePaper}
                onOpenSettings={() => navigate("/settings")}
                onOpenFlashcards={() => navigate("/flashcards")}
              />
            ) : (
              <div className="library-empty library-empty--plain au-surface">
                <h3>
                  {isTrashView
                    ? "回收站为空"
                    : items.length === 0
                      ? "还没有文献"
                      : "当前筛选无结果"}
                </h3>
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
            )
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
              {pagedRows.map((w, index) => {
                const starBusyTarget = starActionBusyById[w.id];
                const starActionBusy = typeof starBusyTarget === "boolean";
                const starActionLabel = starActionBusy
                  ? starBusyTarget
                    ? "正在标记重点"
                    : "正在取消重点"
                  : w.starred
                    ? "取消重点"
                    : "标记重点";
                return (
                  <div
                    key={w.id}
                    className={`library-table__row ${selectedWork?.id === w.id ? "library-table__row--selected" : ""}`}
                    data-library-row-id={w.id}
                    data-library-row-index={index}
                    role="button"
                    tabIndex={0}
                    aria-current={selectedWork?.id === w.id ? "true" : undefined}
                    aria-label={`选择文献:${w.title}`}
                    onClick={() => selectWork(w)}
                    onDoubleClick={() => openReader(w)}
                    onKeyDown={(e) => handleRowKeyDown(e, w, index)}
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
                      <button
                        type="button"
                        className={w.starred ? "library-star library-star--active" : "library-star"}
                        aria-busy={starActionBusy ? "true" : undefined}
                        aria-label={`${starActionLabel} ${w.title}`}
                        disabled={starActionBusy}
                        title={starActionLabel}
                        onClick={(event) => {
                          event.stopPropagation();
                          void updateWorkStarred(w, w.starred !== 1);
                        }}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m12 3.4 2.5 5.1 5.6.8-4 4 1 5.5-5.1-2.7-5 2.7 1-5.5-4.1-4 5.6-.8L12 3.4Z" />
                        </svg>
                      </button>
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
                );
              })}
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
            workActionBusy={workActionBusy}
            starActionBusyTarget={selectedWork ? starActionBusyById[selectedWork.id] : undefined}
            readingStatusBusyTarget={
              selectedWork && readingStatusBusy?.workId === selectedWork.id
                ? readingStatusBusy.status
                : undefined
            }
            sentinelActionBusy={Boolean(
              selectedWork && sentinelActionBusyId === selectedWork.id,
            )}
            onOpenReader={() => {
              if (selectedWork) openReader(selectedWork);
            }}
            onRestoreWork={() => {
              if (selectedWork) void restoreWorks([selectedWork.id]);
            }}
            onPurgeWork={() => {
              if (selectedWork) void purgeWorks([selectedWork.id]);
            }}
            onDeleteWork={() => void deleteSelectedWork()}
            onToggleStar={() => {
              if (selectedWork) void updateWorkStarred(selectedWork, selectedWork.starred !== 1);
            }}
            onSetReadingStatus={(status) => void updateSelectedReadingStatus(status)}
            onUploadPdf={() => selectedPdfInputRef.current?.click()}
            onFindFulltext={() => void handleFindFulltext()}
            findingFulltext={findingFulltext}
            onGenerateFlashcards={() => void generateForSelected()}
            onOpenFlashcards={() => navigate("/flashcards")}
            onOpenSentinel={() => navigate("/sentinel")}
            onCreateSentinel={() => void createSentinelForSelected()}
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
        <Suspense fallback={<DialogLoading label="元数据编辑器" />}>
          <MetadataEditor
            workId={editingMetaId}
            onClose={() => setEditingMetaId(null)}
            onSaved={() => void refresh()}
          />
        </Suspense>
      )}

      {confirmDraft && (
        <Suspense fallback={<DialogLoading label="入库确认" />}>
          <ImportConfirmDialog
            draft={confirmDraft}
            onCommit={handleConfirmImport}
            onCancel={handleCancelImport}
          />
        </Suspense>
      )}

      {collectionManagerOpen && (
        <CollectionManager
          collections={collections}
          activeCollection={activeCollection}
          action={collectionAction}
          status={collectionManagerStatus}
          error={collectionManagerError}
          trashCount={trashCount}
          isTrashView={isTrashView}
          onClose={() => {
            if (collectionAction) return;
            setCollectionManagerOpen(false);
            setCollectionManagerStatus(null);
            setCollectionManagerError(null);
          }}
          onSelectAll={() => {
            if (collectionAction) return;
            clearLibraryView();
            setCollectionManagerOpen(false);
          }}
          onSelectTrash={() => {
            if (collectionAction) return;
            setActiveFilter("trash");
            setActiveCollection(null);
            setActiveTag(null);
            setActiveSource(null);
            setExtraFilter(null);
            setSelectedIds(new Set());
            setCollectionManagerOpen(false);
          }}
          onSelectCollection={(collectionId) => {
            if (collectionAction) return;
            setActiveFilter("all");
            setActiveCollection(collectionId);
            setActiveTag(null);
            setActiveSource(null);
            setExtraFilter(null);
            setSelectedIds(new Set());
            setCollectionManagerOpen(false);
          }}
          onCreate={() => {
            void handleNewFolder();
          }}
          onRename={(collection) => {
            void handleRenameFolder(collection.id, collection.name);
          }}
          onDelete={(collection) => {
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

      {textPrompt && <TextPromptDialog config={textPrompt} onClose={() => setTextPrompt(null)} />}

      {moveDialogOpen && (
        <MoveToCollectionDialog
          collections={collections}
          selectedCount={selectedIds.size}
          onClose={() => setMoveDialogOpen(false)}
          onMove={async (collectionId, collectionName) => {
            const moved = await moveSelectedToCollection(collectionId, collectionName);
            if (moved) setMoveDialogOpen(false);
            return moved;
          }}
        />
      )}

      {confirmDialog}

      {advancedFilterOpen && (
        <AdvancedFilterDialog
          active={extraFilter}
          onClose={() => setAdvancedFilterOpen(false)}
          onApply={(filter) => {
            setExtraFilter(filter);
            setAdvancedFilterOpen(false);
          }}
        />
      )}

      {importPreview && (
        <ImportPreviewDialog
          count={importPreview.count}
          fileName={importPreview.fileName}
          importing={importing}
          onClose={() => setImportPreview(null)}
          onConfirm={() => void confirmImport()}
        />
      )}
    </div>
  );
}

function ImportPreviewDialog({
  count,
  fileName,
  importing,
  onClose,
  onConfirm,
}: {
  count: number;
  fileName?: string;
  importing: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const requestClose = useCallback(() => {
    if (!importing) onClose();
  }, [importing, onClose]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: requestClose,
  });

  return (
    <div className="library-modal-overlay" role="presentation" onMouseDown={requestClose}>
      <section
        ref={dialogRef}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-busy={importing}
        aria-modal="true"
        className="library-modal reference-import-preview"
        data-modal-root="true"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="library-modal__head">
          <div>
            <Badge variant="accent">待确认</Badge>
            <h2 id={titleId}>导入文献库</h2>
          </div>
          <button
            type="button"
            className="library-modal__close"
            onClick={requestClose}
            aria-label="关闭"
            disabled={importing}
          >
            ×
          </button>
        </div>
        <p className="au-text-muted" id={descriptionId} style={{ fontSize: 13 }}>
          已解析出 <strong>{count}</strong> 条文献。导入时会按 DOI
          与标题自动去重,已存在的不会重复入库。
        </p>
        {fileName && (
          <div className="reference-import-preview__file">
            <span>文件</span>
            <strong>{fileName}</strong>
          </div>
        )}
        {importing && (
          <p className="reference-import-preview__status" role="status" aria-live="polite">
            正在导入文献库...
          </p>
        )}
        <div className="library-modal-actions reference-import-preview__actions">
          <Button
            data-autofocus="true"
            onClick={onConfirm}
            disabled={importing}
            aria-busy={importing}
          >
            {importing ? "导入中…" : `导入 ${count} 条`}
          </Button>
          <Button variant="secondary" onClick={requestClose} disabled={importing}>
            取消
          </Button>
        </div>
      </section>
    </div>
  );
}

function LibraryOnboardingEmpty({
  busy,
  previewMode,
  onImportPdf,
  onImportRefs,
  onTryExample,
  onOpenSettings,
  onOpenFlashcards,
}: {
  busy: boolean;
  previewMode: boolean;
  onImportPdf: () => void;
  onImportRefs: () => void;
  onTryExample: () => void;
  onOpenSettings: () => void;
  onOpenFlashcards: () => void;
}) {
  return (
    <section className="library-empty library-empty--onboarding au-surface">
      <div className="library-onboarding-copy">
        <Badge variant={previewMode ? "warning" : "neutral"}>
          {previewMode ? "Preview" : "Start here"}
        </Badge>
        <h3>把第一篇论文放进工作台</h3>
        <p>
          从 PDF、DOI、arXiv 或 BibTeX/RIS/NBIB/ENW 文献库开始；入库后可以直接进入阅读、生成重点和闪卡。
        </p>
        <div className="library-onboarding-actions">
          <Button onClick={onImportPdf} disabled={busy}>
            导入 PDF
          </Button>
          <Button variant="secondary" onClick={onImportRefs} disabled={busy}>
            导入文献库
          </Button>
          <Button variant="secondary" onClick={onTryExample} disabled={busy}>
            填入 arXiv 示例
          </Button>
        </div>
        {previewMode && (
          <p className="library-onboarding-note">
            当前是浏览器预览，真实数据库、PDF 附件和 AI 生成需要在桌面应用中完成。
          </p>
        )}
      </div>

      <div className="library-onboarding-steps" aria-label="首条研究流">
        <OnboardingStep index="01" title="入库" text="识别题名、作者、DOI 与 PDF 附件。" />
        <OnboardingStep index="02" title="阅读" text="打开 PDF，沉淀批注、摘录和状态。" />
        <OnboardingStep index="03" title="AI 重点" text="提炼贡献、方法、局限并生成闪卡。" />
        <OnboardingStep index="04" title="复习" text="用 FSRS 队列把论文记成长期知识。" />
      </div>

      <div className="library-onboarding-side">
        <strong>首轮配置</strong>
        <p>先配置 AI 服务，导入 PDF 后就能自动生成重点和闪卡。</p>
        <div>
          <Button variant="secondary" onClick={onOpenSettings}>
            配置 AI
          </Button>
          <Button variant="secondary" onClick={onOpenFlashcards}>
            复习队列
          </Button>
        </div>
      </div>
    </section>
  );
}

function OnboardingStep({ index, title, text }: { index: string; title: string; text: string }) {
  return (
    <span>
      <small>{index}</small>
      <strong>{title}</strong>
      <em>{text}</em>
    </span>
  );
}

function TextPromptDialog({ config, onClose }: { config: TextPromptConfig; onClose: () => void }) {
  const [value, setValue] = useState(config.initialValue ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const titleId = useId();
  const trimmed = value.trim();
  const canSubmit = config.allowEmpty || Boolean(trimmed);

  const requestClose = useCallback(() => {
    if (!submitting) onClose();
  }, [onClose, submitting]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: requestClose,
  });

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
    <div className="library-modal-overlay" role="presentation" onMouseDown={requestClose}>
      <form
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-busy={submitting}
        aria-modal="true"
        className="library-modal library-prompt-modal"
        data-modal-root="true"
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="library-modal__head">
          <h2 id={titleId}>{config.title}</h2>
          <button
            type="button"
            className="library-modal__close"
            onClick={requestClose}
            aria-label="关闭"
            disabled={submitting}
          >
            ×
          </button>
        </div>
        {config.description && (
          <p className="library-prompt-modal__description">{config.description}</p>
        )}
        {submitting && (
          <p className="library-prompt-modal__status" role="status" aria-live="polite">
            {config.pendingLabel ?? "处理中..."}
          </p>
        )}
        <label className="library-prompt-field">
          <span>{config.label}</span>
          <Input
            autoFocus
            data-autofocus="true"
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
          <Button type="submit" disabled={submitting || !canSubmit} aria-busy={submitting}>
            {submitting ? (config.pendingLabel ?? "处理中...") : config.confirmLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={requestClose} disabled={submitting}>
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
  onMove: (collectionId: string | null, collectionName: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [movingTo, setMovingTo] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const moving = movingTo !== null;

  const requestClose = useCallback(() => {
    if (!moving) onClose();
  }, [moving, onClose]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: requestClose,
  });

  const move = async (collectionId: string | null, collectionName: string) => {
    if (moving) return;
    const label = collectionId ? `「${collectionName}」` : "全部文献";
    setMovingTo(collectionId ?? "__none__");
    setStatus(`正在移动 ${selectedCount} 篇文献到${label}...`);
    setError(null);
    try {
      const moved = await onMove(collectionId, collectionName);
      if (!moved) {
        setError("移动失败，请稍后重试。");
        setStatus(null);
      }
    } finally {
      setMovingTo(null);
    }
  };

  return (
    <div className="library-modal-overlay" role="presentation" onMouseDown={requestClose}>
      <section
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-busy={moving}
        aria-modal="true"
        className="library-modal library-move-modal"
        data-modal-root="true"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="library-modal__head">
          <h2 id={titleId}>移动到文件夹</h2>
          <button
            type="button"
            className="library-modal__close"
            onClick={requestClose}
            aria-label="关闭"
            disabled={moving}
          >
            ×
          </button>
        </div>
        <p className="library-prompt-modal__description">
          为已选的 {selectedCount} 篇文献选择目标文件夹。
        </p>
        {status && (
          <p className="library-move-modal__status" role="status" aria-live="polite">
            {status}
          </p>
        )}
        {error && (
          <p className="library-move-modal__error" role="alert">
            {error}
          </p>
        )}
        <div className="library-move-options">
          <button
            type="button"
            className="library-move-option"
            data-autofocus="true"
            onClick={() => void move(null, "全部文献")}
            disabled={moving}
            aria-busy={movingTo === "__none__" ? "true" : undefined}
          >
            <span>移出所有文件夹</span>
            <small>{movingTo === "__none__" ? "移动中..." : "保留在全部文献中"}</small>
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
                disabled={moving}
                aria-busy={movingTo === collection.id ? "true" : undefined}
              >
                <span>{collection.name}</span>
                <small>
                  {movingTo === collection.id
                    ? "移动中..."
                    : `${collection.count.toLocaleString("zh-CN")} 篇`}
                </small>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function AdvancedFilterDialog({
  active,
  onApply,
  onClose,
}: {
  active: ExtraFilter | null;
  onApply: (filter: ExtraFilter | null) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: onClose,
  });

  const options: Array<{ value: ExtraFilter | null; title: string; description: string }> = [
    { value: null, title: "不过滤", description: "显示当前视图中的全部文献。" },
    { value: "with-pdf", title: "已有 PDF", description: "只看已经挂载全文附件的文献。" },
    { value: "without-pdf", title: "缺 PDF", description: "找出需要补充全文的文献。" },
    { value: "ai-done", title: "AI 已生成", description: "只看已经完成重点/闪卡生成的文献。" },
    { value: "ai-needed", title: "需要生成 AI", description: "已有 PDF 但还没有生成 AI 重点。" },
    { value: "sentinel-on", title: "哨兵监控中", description: "只看正在跟踪出版/收录状态的文献。" },
    { value: "sentinel-off", title: "未开哨兵", description: "找出尚未加入检索哨兵的文献。" },
  ];
  return (
    <div className="library-modal-overlay" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-modal="true"
        className="library-modal library-filter-modal"
        data-modal-root="true"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="library-modal__head">
          <h2 id={titleId}>更多筛选</h2>
          <button
            type="button"
            className="library-modal__close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="library-move-options">
          {options.map((option) => (
            <button
              key={option.value ?? "none"}
              type="button"
              className={`library-move-option ${
                active === option.value ? "library-move-option--active" : ""
              }`}
              data-autofocus={active === option.value ? "true" : undefined}
              onClick={() => onApply(option.value)}
            >
              <span>{option.title}</span>
              <small>{option.description}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function CollectionManager({
  collections,
  activeCollection,
  action,
  status,
  error,
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
  action: { id: string; kind: "create" | "delete" | "rename" } | null;
  status: string | null;
  error: string | null;
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
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const busy = action !== null;
  const requestClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: requestClose,
  });

  return (
    <div className="library-modal-overlay" role="presentation" onMouseDown={requestClose}>
      <section
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-busy={busy}
        aria-modal="true"
        className="library-modal library-collection-modal"
        data-modal-root="true"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="library-modal__head">
          <div>
            <h2 id={titleId}>管理分组</h2>
            <p className="library-modal__subhead">选择当前视图，或整理自定义文件夹。</p>
          </div>
          <button
            type="button"
            className="library-modal__close"
            onClick={requestClose}
            aria-label="关闭"
            disabled={busy}
          >
            ×
          </button>
        </div>

        {status && (
          <p className="library-collection-manager__status" role="status" aria-live="polite">
            {status}
          </p>
        )}
        {error && (
          <p className="library-collection-manager__error" role="alert">
            {error}
          </p>
        )}

        <div className="library-collection-manager__section">
          <button
            type="button"
            className={`library-collection-manager__system ${
              !activeCollection && !isTrashView ? "library-collection-manager__system--active" : ""
            }`}
            data-autofocus={!activeCollection && !isTrashView ? "true" : undefined}
            onClick={onSelectAll}
            disabled={busy}
          >
            <span>全部文献</span>
            <small>主视图</small>
          </button>
          <button
            type="button"
            className={`library-collection-manager__system ${
              isTrashView ? "library-collection-manager__system--active" : ""
            }`}
            data-autofocus={isTrashView ? "true" : undefined}
            onClick={onSelectTrash}
            disabled={busy}
          >
            <span>回收站</span>
            <small>{trashCount.toLocaleString("zh-CN")} 篇</small>
          </button>
        </div>

        <div className="library-collection-manager__head">
          <span>自定义文件夹</span>
          <button
            type="button"
            onClick={onCreate}
            disabled={busy}
            aria-busy={action?.kind === "create" ? "true" : undefined}
          >
            {action?.kind === "create" ? "创建中..." : "新建"}
          </button>
        </div>

        {collections.length === 0 ? (
          <p className="library-panel-empty">还没有文件夹。新建后会同时出现在左侧分组里。</p>
        ) : (
          <ul className="library-collection-manager">
            {collections.map((collection) => {
              const activeAction = action?.id === collection.id ? action.kind : null;
              return (
                <li
                  key={collection.id}
                  className={`library-collection-manager__row ${
                    activeCollection === collection.id
                      ? "library-collection-manager__row--active"
                      : ""
                  }`}
                  aria-busy={activeAction ? "true" : undefined}
                >
                  <button
                    type="button"
                    className="library-collection-manager__select"
                    data-autofocus={activeCollection === collection.id ? "true" : undefined}
                    onClick={() => onSelectCollection(collection.id)}
                    disabled={busy}
                  >
                    <span>{collection.name}</span>
                    <small>{collection.count.toLocaleString("zh-CN")} 篇</small>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRename(collection)}
                    disabled={busy}
                    aria-busy={activeAction === "rename" ? "true" : undefined}
                  >
                    {activeAction === "rename" ? "保存中..." : "重命名"}
                  </button>
                  <button
                    type="button"
                    className="library-collection-manager__delete"
                    onClick={() => onDelete(collection)}
                    disabled={busy}
                    aria-busy={activeAction === "delete" ? "true" : undefined}
                  >
                    {activeAction === "delete" ? "删除中..." : "删除"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function TagManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagPrompt, setTagPrompt] = useState<TextPromptConfig | null>(null);
  const [tagAction, setTagAction] = useState<{
    id: string;
    kind: "color" | "delete" | "rename";
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const tagBusy = tagAction !== null;
  const requestClose = useCallback(() => {
    if (!tagBusy) onClose();
  }, [onClose, tagBusy]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: requestClose,
  });

  const load = useCallback(async () => {
    if (!isTauriRuntime()) {
      setTags([]);
      setLoading(false);
      return;
    }
    const db = await getDb();
    const { TagsRepo } = await import("@aurascholar/db/repos/tags");
    setTags(await new TagsRepo(db).list());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const repo = useCallback(async () => {
    const { TagsRepo } = await import("@aurascholar/db/repos/tags");
    return new TagsRepo(await getDb());
  }, []);

  const rename = useCallback(
    async (tag: TagRow) => {
      if (tagBusy) return;
      setTagPrompt({
        title: "重命名标签",
        label: "标签名称",
        initialValue: tag.name,
        confirmLabel: "保存",
        onSubmit: async (value) => {
          const next = value.trim();
          if (next === tag.name) return;
          const startedAt = Date.now();
          setTagAction({ id: tag.id, kind: "rename" });
          setStatus(`正在重命名标签「${tag.name}」...`);
          setError(null);
          try {
            await (await repo()).rename(tag.id, next);
            await waitForMinimumElapsed(startedAt, MIN_TAG_ACTION_BUSY_MS);
            await load();
            setStatus(`已重命名为「${next}」`);
            onChanged();
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            setError(`重命名标签失败:${message}`);
            throw e;
          } finally {
            setTagAction(null);
          }
        },
      });
    },
    [tagBusy, repo, load, onChanged],
  );

  const recolor = useCallback(
    async (tag: TagRow) => {
      if (tagBusy) return;
      setTagPrompt({
        title: "设置标签颜色",
        label: "CSS 颜色值",
        initialValue: tag.color ?? "",
        placeholder: "#4f8f86 或 teal",
        confirmLabel: "保存",
        description: "留空会清除自定义颜色。",
        allowEmpty: true,
        onSubmit: async (value) => {
          const next = value.trim();
          const startedAt = Date.now();
          setTagAction({ id: tag.id, kind: "color" });
          setStatus(`正在更新标签「${tag.name}」的颜色...`);
          setError(null);
          try {
            await (await repo()).setColor(tag.id, next || null);
            await waitForMinimumElapsed(startedAt, MIN_TAG_ACTION_BUSY_MS);
            await load();
            setStatus(next ? `已更新标签「${tag.name}」的颜色` : `已清除标签「${tag.name}」的颜色`);
            onChanged();
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            setError(`更新标签颜色失败:${message}`);
            throw e;
          } finally {
            setTagAction(null);
          }
        },
      });
    },
    [tagBusy, repo, load, onChanged],
  );

  const remove = useCallback(
    async (tag: TagRow) => {
      if (tagBusy) return;
      const confirmed = await confirm({
        title: "删除标签？",
        description: `「${tag.name}」会从 ${tag.count} 篇文献上移除。`,
        details: ["文献本身不会被删除。", "后续可重新创建同名标签并重新标注。"],
        confirmLabel: "删除标签",
        tone: "warning",
      });
      if (!confirmed) return;
      const startedAt = Date.now();
      setTagAction({ id: tag.id, kind: "delete" });
      setStatus(`正在删除标签「${tag.name}」...`);
      setError(null);
      try {
        await (await repo()).softDelete(tag.id);
        await waitForMinimumElapsed(startedAt, MIN_TAG_ACTION_BUSY_MS);
        await load();
        setStatus(`已删除标签「${tag.name}」`);
        onChanged();
      } catch (e) {
        setError(`删除标签失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setTagAction(null);
      }
    },
    [tagBusy, confirm, repo, load, onChanged],
  );

  return (
    <>
      <div className="library-modal-overlay" role="presentation" onMouseDown={requestClose}>
        <section
          ref={dialogRef}
          aria-labelledby={titleId}
          aria-busy={tagBusy}
          aria-modal="true"
          className="library-modal"
          data-modal-root="true"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          tabIndex={-1}
        >
          <div className="library-modal__head">
            <h2 id={titleId}>管理标签</h2>
            <button
              type="button"
              className="library-modal__close"
              data-autofocus={loading || tags.length === 0 ? "true" : undefined}
              onClick={requestClose}
              aria-label="关闭"
              disabled={tagBusy}
            >
              ×
            </button>
          </div>
          {status && (
            <p className="library-tag-manager__status" role="status" aria-live="polite">
              {status}
            </p>
          )}
          {error && (
            <p className="library-tag-manager__error" role="alert">
              {error}
            </p>
          )}
          {loading ? (
            <p className="au-text-muted">读取中…</p>
          ) : tags.length === 0 ? (
            <p className="au-text-muted">还没有标签。在文献上添加标签后会显示在这里。</p>
          ) : (
            <ul className="library-tag-manager">
              {tags.map((tag) => {
                const activeAction = tagAction?.id === tag.id ? tagAction.kind : null;
                return (
                  <li
                    key={tag.id}
                    className="library-tag-manager__row"
                    aria-busy={activeAction ? "true" : undefined}
                  >
                    <span
                      className="library-tag-manager__dot"
                      style={tag.color ? { background: tag.color } : undefined}
                    />
                    <span className="library-tag-manager__name">{tag.name}</span>
                    <small className="library-tag-manager__count">{tag.count}</small>
                    <button
                      type="button"
                      data-autofocus={tag === tags[0] ? "true" : undefined}
                      onClick={() => void rename(tag)}
                      disabled={tagBusy}
                      aria-busy={activeAction === "rename" ? "true" : undefined}
                    >
                      {activeAction === "rename" ? "保存中..." : "重命名"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void recolor(tag)}
                      disabled={tagBusy}
                      aria-busy={activeAction === "color" ? "true" : undefined}
                    >
                      {activeAction === "color" ? "保存中..." : "颜色"}
                    </button>
                    <button
                      type="button"
                      className="library-tag-manager__delete"
                      onClick={() => void remove(tag)}
                      disabled={tagBusy}
                      aria-busy={activeAction === "delete" ? "true" : undefined}
                    >
                      {activeAction === "delete" ? "删除中..." : "删除"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {tagPrompt && <TextPromptDialog config={tagPrompt} onClose={() => setTagPrompt(null)} />}
        </section>
      </div>
      {confirmDialog}
    </>
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

function readingStatusLabel(status: ReadingStatus | string) {
  if (status === "reading") return "阅读中";
  if (status === "read") return "已读";
  return "未读";
}

function extraFilterLabel(filter: ExtraFilter) {
  switch (filter) {
    case "with-pdf":
      return "已有 PDF";
    case "without-pdf":
      return "缺 PDF";
    case "ai-done":
      return "AI 已生成";
    case "ai-needed":
      return "需要生成 AI";
    case "sentinel-on":
      return "哨兵监控中";
    case "sentinel-off":
      return "未开哨兵";
  }
}

function sentinelStatusLabel(status: string | null, state: string | null) {
  if (status === "done") return "监控完成";
  if (status === "paused") return "已暂停";
  if (state === "accepted") return "已接收";
  if (state === "registered") return "已注册";
  if (state === "online") return "在线发布";
  if (state === "in_issue") return "正式出版";
  if (state === "indexed_wos") return "WoS 收录";
  if (state === "indexed_scopus") return "Scopus 收录";
  if (state === "indexed_pubmed") return "PubMed 收录";
  return status ?? "监控中";
}

function librarySentinelCreateMessage(status: "created" | "existing" | "restored"): string {
  if (status === "existing") return "这篇文献已经在哨兵列表中";
  if (status === "restored") return "已恢复这篇文献的哨兵监控";
  return "已加入检索哨兵，首次检查会尽快执行";
}

function sentinelStatusVariant(
  taskCount: number | null | undefined,
  status: string | null | undefined,
): "accent" | "neutral" | "success" | "warning" {
  if (!taskCount) return "neutral";
  if (status === "done") return "success";
  if (status === "error" || status === "paused") return "warning";
  return "accent";
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
  workActionBusy,
  starActionBusyTarget,
  readingStatusBusyTarget,
  sentinelActionBusy,
  onOpenReader,
  onRestoreWork,
  onPurgeWork,
  onDeleteWork,
  onToggleStar,
  onSetReadingStatus,
  onUploadPdf,
  onFindFulltext,
  findingFulltext,
  onGenerateFlashcards,
  onOpenFlashcards,
  onOpenSentinel,
  onCreateSentinel,
  onOpenGraph,
  onEditMetadata,
}: {
  work: WorkWithAuthors | null;
  meta: WorkRuntimeMeta | null;
  tableMeta?: WorkTableMeta;
  isTrashView: boolean;
  generating: boolean;
  attachingPdf: boolean;
  workActionBusy: "merge" | "purge" | "restore" | "trash" | null;
  starActionBusyTarget?: boolean;
  readingStatusBusyTarget?: ReadingStatus;
  sentinelActionBusy: boolean;
  onOpenReader: () => void;
  onRestoreWork: () => void;
  onPurgeWork: () => void;
  onDeleteWork: () => void;
  onToggleStar: () => void;
  onSetReadingStatus: (status: ReadingStatus) => void;
  onUploadPdf: () => void;
  onFindFulltext: () => void;
  findingFulltext: boolean;
  onGenerateFlashcards: () => void;
  onOpenFlashcards: () => void;
  onOpenSentinel: () => void;
  onCreateSentinel: () => void;
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
  const starActionBusy = typeof starActionBusyTarget === "boolean";
  const readingStatusBusy = Boolean(readingStatusBusyTarget);

  if (isTrashView) {
    return (
      <>
        <div className="library-detail au-panel library-detail--selected library-detail--trash">
          <div className="library-panel-heading">
            <span className="library-panel-kicker">Recycle bin</span>
            <button type="button" onClick={onRestoreWork} disabled={Boolean(workActionBusy)}>
              {workActionBusy === "restore" ? "恢复中..." : "恢复 ›"}
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
          <Button className="library-detail__read" onClick={onRestoreWork} disabled={Boolean(workActionBusy)}>
            {workActionBusy === "restore" ? "恢复中..." : "恢复到文献库"}
          </Button>
          <button
            type="button"
            className="library-danger-button"
            onClick={onPurgeWork}
            disabled={Boolean(workActionBusy)}
          >
            {workActionBusy === "purge" ? "删除中..." : "永久删除"}
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
          aria-busy={generating ? "true" : undefined}
          title="生成闪卡"
        >
          +
        </button>
      </div>
      <div className="library-detail au-panel library-detail--selected">
        <div className="library-panel-heading">
          <span className="library-panel-kicker">Selected paper</span>
          <div className="library-panel-actions">
            <button
              type="button"
              onClick={onToggleStar}
              disabled={starActionBusy}
              aria-busy={starActionBusy ? "true" : undefined}
            >
              {starActionBusy
                ? starActionBusyTarget
                  ? "标记中..."
                  : "取消中..."
                : work.starred
                  ? "取消重点"
                  : "标为重点"}
            </button>
            <button type="button" onClick={onOpenReader}>
              阅读 ›
            </button>
          </div>
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
        <div className="library-reading-toggle" aria-label="阅读状态">
          {(["unread", "reading", "read"] as const).map((status) => {
            const statusBusy = readingStatusBusyTarget === status;
            return (
              <button
                key={status}
                type="button"
                className={work.reading_status === status ? "library-reading-toggle__active" : ""}
                onClick={() => onSetReadingStatus(status)}
                disabled={readingStatusBusy}
                aria-busy={statusBusy ? "true" : undefined}
              >
                {statusBusy ? "更新中..." : readingStatusLabel(status)}
              </button>
            );
          })}
        </div>
        <Button className="library-detail__read" onClick={onOpenReader}>
          打开阅读器
        </Button>
        <button
          type="button"
          className="library-detail__secondary-danger"
          onClick={onDeleteWork}
          disabled={Boolean(workActionBusy)}
        >
          {workActionBusy === "trash" ? "移入中..." : "移入回收站"}
        </button>
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
            <button
              type="button"
              onClick={onUploadPdf}
              disabled={attachingPdf}
              aria-busy={attachingPdf ? "true" : undefined}
            >
              {attachingPdf ? "上传中..." : meta?.pdfCount ? "添加 PDF" : "上传 PDF"}
            </button>
            {!isTrashView && meta && !meta.pdfCount && (
              <button
                type="button"
                onClick={onFindFulltext}
                disabled={findingFulltext}
                aria-busy={findingFulltext ? "true" : undefined}
              >
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
          aria-busy={generating ? "true" : undefined}
        >
          {generating ? "生成中..." : meta?.flashcardCount ? "重新生成闪卡" : "生成闪卡"}
        </Button>
      </div>
      <div className="library-automation au-panel">
        <div className="library-panel-heading">
          <h3>哨兵状态</h3>
          <div className="library-panel-actions">
            {meta && meta.sentinelTaskCount === 0 && work.doi && (
              <button
                type="button"
                onClick={onCreateSentinel}
                disabled={sentinelActionBusy}
                aria-busy={sentinelActionBusy ? "true" : undefined}
              >
                {sentinelActionBusy ? "加入中..." : "开始监控"}
              </button>
            )}
            <button type="button" onClick={onOpenSentinel}>
              管理哨兵 ›
            </button>
          </div>
        </div>
        <StatusLine
          label={work.venue_name ?? "出版状态"}
          value={
            !meta
              ? "读取中"
              : meta.sentinelTaskCount > 0
                ? sentinelStatusLabel(meta.sentinelStatus, meta.sentinelState)
                : "未监控"
          }
          variant={sentinelStatusVariant(meta?.sentinelTaskCount, meta?.sentinelStatus)}
        />
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
  const [openError, setOpenError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    requestRef.current += 1;
    setState("idle");
    setData(null);
    setOpenError(null);
  }, [doi]);

  const load = useCallback(() => {
    if (!doi || !isTauriRuntime() || state === "loading") return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState("loading");
    setData(null);
    void import("../services/scholar")
      .then(({ fetchScholarEnrichment }) => fetchScholarEnrichment(doi))
      .then((d) => {
        if (requestRef.current !== requestId) return;
        if (!d) {
          setState("missing");
        } else {
          setData(d);
          setState("done");
        }
      })
      .catch(() => {
        if (requestRef.current === requestId) setState("error");
      });
  }, [doi, state]);

  if (!doi) return null;

  return (
    <div className="library-automation au-panel">
      <div className="library-panel-heading">
        <h3>Semantic Scholar</h3>
        {data?.url ? (
          <button
            type="button"
            onClick={() => {
              setOpenError(null);
              void openExternalUrl(data.url!).catch((error) =>
                setOpenError(error instanceof Error ? error.message : String(error)),
              );
            }}
          >
            查看 ›
          </button>
        ) : (
          <button type="button" onClick={load} disabled={state === "loading"}>
            {state === "loading" ? "读取中..." : "读取 ›"}
          </button>
        )}
      </div>
      {state === "idle" && <p className="library-panel-empty">按需读取 S2 摘要和引用指标。</p>}
      {state === "loading" && <p className="library-panel-empty">读取中…</p>}
      {state === "missing" && <p className="library-panel-empty">S2 暂无这篇文献的记录。</p>}
      {state === "error" && <p className="library-panel-empty">读取失败,稍后重试。</p>}
      {openError && <p className="library-panel-error">打开外链失败:{openError}</p>}
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
