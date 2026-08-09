import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Button } from "@aurascholar/ui";
import {
  formatBibliography,
  toBibTeX,
  toCslItem,
  toCslJson,
  toRIS,
  type WorkLike,
} from "@aurascholar/cite";
import type {
  AttachmentRow,
  CollectionRow,
  ReadingStatus,
  WorkPatch,
  WorkWithAuthors,
} from "@aurascholar/db";
import type { IngestDraft, PendingPdf } from "../services/library-types";
import type { ExportFormat } from "../services/cite";
import type { ImportDecision } from "../components/ImportConfirmDialog";
import type { Draft as MetadataDraft } from "../components/MetadataEditor";
import { useConfirmDialog } from "../components/ConfirmDialog";
import { InlineNotice } from "../components/InlineNotice";
import { useModalFocusTrap } from "../components/useModalFocusTrap";
import { writeClipboardText } from "../clipboard";
import { downloadBlob } from "../download";
import { isImeComposing } from "../keyboard";
import { isPlatformShortcut, shortcutLabel } from "../shortcut-labels";
import { blobPath, sha256Hex, auraFs, isDesktopRuntime } from "../services/aura-platform";
import { fulltextWorkHandoffPath } from "../services/fulltext";
import { waitForMinimumElapsed } from "../services/minimum-busy";
import {
  PREVIEW_LIBRARY_WORK_SEEDS,
  type PreviewLibraryWorkSeed,
} from "../services/preview-library";
import type { KnowledgeContentSearchResult } from "../services/knowledge-search";
import { resolveKnowledgeSearchReaderPath } from "../services/knowledge-search-navigation";
import { describeSafeError } from "../services/sensitive-text";
import { useCanvasIngress } from "../features/canvas/useCanvasIngress";
import { useProjectIngress } from "../features/projects/useProjectIngress";
import {
  LibraryBulkActionBar,
  type LibraryBulkWorkAction as LibraryWorkAction,
} from "../features/library/LibraryBulkActionBar";
import { LibraryCollectionManagement } from "../features/library/LibraryCollectionManagement";
import { LibraryActionIconButton } from "../features/library/LibraryActionIconButton";
import { KnowledgeIndexPlanner } from "../features/library/KnowledgeIndexPlanner";
import { KnowledgeSearchPanel } from "../features/library/KnowledgeSearchPanel";
import { LocalSemanticIndexControl } from "../features/library/LocalSemanticIndexControl";
import { LibrarySelectedWorkPanel } from "../features/library/LibrarySelectedWorkPanel";
import {
  hasDraggedFiles,
  isPdfFile,
  isSupportedImportFile,
} from "../features/library/library-import-files";
import { TagManager } from "../features/library/TagManager";
import { TextPromptDialog, type TextPromptConfig } from "../features/library/TextPromptDialog";
import { libraryTagTone, readingStatusLabel } from "../features/library/library-work-display";
import {
  createLibraryRouteRequest,
  filterLibraryWorkspaceItems,
  hasLibraryBrowseViewChanged,
  libraryDeepLinkView,
  libraryRouteRefreshDisposition,
  ownsLibraryRouteRequest,
  resolveLibraryVisiblePage,
  withoutLibraryRouteParams,
  type LibraryExtraFilter as ExtraFilter,
  type LibraryFilter,
  type LibrarySortMode as SortMode,
} from "../features/library/library-workspace-state";
import { useLibraryBrowseState } from "../features/library/useLibraryBrowseState";
import { useLibraryNoticeLifecycle } from "../features/library/useLibraryNoticeLifecycle";
import { reduceLibraryNoticeState } from "../features/library/library-notice-lifecycle";
import { useLibraryRefreshController } from "../features/library/useLibraryRefreshController";
import { useSelectedWorkRuntimeMeta } from "../features/library/useSelectedWorkRuntimeMeta";
import type {
  CollectionActivationReason,
  CollectionManagerViewTarget,
} from "../features/library/useLibraryCollectionController";
import {
  moveCollectionRows,
  type MoveCollectionEventDetail,
} from "../features/library/library-collection-model";
import {
  MutationLease,
  reconcileTrashUndo,
  scopeSelectedIds,
  type LibraryTrashUndoState,
  type MutationLeaseGrant,
} from "../features/library/library-work-lifecycle-model";
import { addLibraryTagToWorks, setWorksLibraryCollection } from "../services/library-organization";
import {
  emptyWorkMeta,
  loadLibraryPageData,
  loadLibraryWorkRuntimeMeta,
  type WorkRuntimeMeta,
  type WorkTableMeta,
} from "../services/library-page-data";
import {
  mergeLibraryWorks,
  purgeLibraryWorks,
  restoreLibraryWorks,
  setLibraryWorkReadingStatus,
  setLibraryWorkStarred,
  trashLibraryWorks,
} from "../services/library-work-actions";

const MetadataEditor = lazy(() =>
  import("../components/MetadataEditor").then((m) => ({ default: m.MetadataEditor })),
);
const ImportConfirmDialog = lazy(() =>
  import("../components/ImportConfirmDialog").then((m) => ({ default: m.ImportConfirmDialog })),
);

type ImportMethod = "identifier" | "pdf" | "references";
interface LibrarySmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_IMPORT_PDF__?: (file: File) => Promise<void>;
  __AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_DELAY_MS__?: number;
  __AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_COUNT__?: number;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_BULK_TAG_AFTER_FIRST__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_MOVE_AFTER_FIRST__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READ__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READING_STATUS__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_STAR__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH_RESTORE__?: string;
}

// How many works to show per page. The DB list() caps at a higher hard limit
// (works.ts:list default 200); paging is a client-side window over that set.
const PAGE_SIZE = 30;
const LIST_HARD_LIMIT = 1000;
const MIN_CITATION_BUSY_MS = 350;
const MIN_BULK_TAG_BUSY_MS = 250;
const MIN_MOVE_ACTION_BUSY_MS = 250;
const MIN_REFERENCE_IMPORT_BUSY_MS = 250;
const MIN_WORK_ACTION_BUSY_MS = 350;
const REFERENCE_IMPORT_ACCEPT = ".bib,.ris,.nbib,.enw,.json,application/json,text/plain";
const REFERENCE_IMPORT_FORMAT_LABEL = "BibTeX、RIS、PubMed NBIB、EndNote ENW 或 CSL-JSON";
const PREVIEW_LIBRARY_SCOPE_MESSAGE =
  "浏览器预览使用可重置的示例文献；星标、标签、阅读状态等整理操作只在本页生效，真实数据库、PDF 附件和 AI 合成需要在桌面应用中完成。";

interface LibraryViewDetail {
  filter?: LibraryFilter;
  collectionId?: string | null;
  tag?: string | null;
}

interface LibraryRefreshQuery {
  activeCollection: string | null;
  activeFilter: LibraryFilter;
  desktopRuntime: boolean;
  previewItems: WorkWithAuthors[];
  previewTrashItems: WorkWithAuthors[];
  previewWorkMeta: Record<string, WorkTableMeta>;
  routeKey: string | null;
  routeWorkId: string | null;
  search: string;
}

type LibraryRefreshData = Awaited<ReturnType<typeof loadLibraryPageData>> & {
  previewMode: boolean;
};

function isSameLibraryRefreshQuery(left: LibraryRefreshQuery, right: LibraryRefreshQuery): boolean {
  return (
    left.activeCollection === right.activeCollection &&
    left.activeFilter === right.activeFilter &&
    left.desktopRuntime === right.desktopRuntime &&
    left.previewItems === right.previewItems &&
    left.previewTrashItems === right.previewTrashItems &&
    left.previewWorkMeta === right.previewWorkMeta &&
    left.routeKey === right.routeKey &&
    left.routeWorkId === right.routeWorkId &&
    left.search === right.search
  );
}

const PREVIEW_TIMESTAMP = Date.UTC(2026, 6, 1);
const PREVIEW_LIBRARY_ID = "library:preview";

function previewWork(input: PreviewLibraryWorkSeed): WorkWithAuthors {
  return {
    id: input.id,
    library_id: PREVIEW_LIBRARY_ID,
    doi: input.doi ?? null,
    title: input.title,
    abstract: input.abstract,
    year: input.year,
    publication_date: `${input.year}-01-01`,
    venue_name: input.venue,
    venue_type: "journal",
    type: input.type ?? "article-journal",
    arxiv_id: input.arxivId ?? null,
    openalex_id: null,
    s2_id: null,
    pmid: null,
    fingerprint: null,
    volume: null,
    issue: null,
    pages: null,
    number_of_volumes: null,
    edition: null,
    section: null,
    publisher: null,
    place_published: null,
    series_title: null,
    short_title: null,
    original_title: null,
    issn: null,
    isbn: null,
    url: input.doi ? `https://doi.org/${input.doi}` : null,
    accessed_date: null,
    language: "en",
    call_number: null,
    accession_number: null,
    label: null,
    database_name: "AuraScholar Preview",
    keywords_json: null,
    notes_md: null,
    reading_status: input.readingStatus,
    starred: input.starred ? 1 : 0,
    created_at: PREVIEW_TIMESTAMP - input.createdOffset,
    updated_at: PREVIEW_TIMESTAMP - input.createdOffset / 2,
    deleted_at: null,
    authorNames: input.authors,
  };
}

const PREVIEW_LIBRARY_WORKS: WorkWithAuthors[] = PREVIEW_LIBRARY_WORK_SEEDS.map(previewWork);

const PREVIEW_LIBRARY_COLLECTIONS: CollectionRow[] = [
  {
    id: "preview-projects",
    library_id: PREVIEW_LIBRARY_ID,
    name: "研究项目",
    parent_id: null,
    sort_order: 0,
    count: 1,
  },
  {
    id: "preview-transformer",
    library_id: PREVIEW_LIBRARY_ID,
    name: "Transformer 综述",
    parent_id: "preview-projects",
    sort_order: 0,
    count: 2,
  },
  {
    id: "preview-life-science",
    library_id: PREVIEW_LIBRARY_ID,
    name: "生命科学",
    parent_id: null,
    sort_order: 1,
    count: 1,
  },
];

const PREVIEW_WORK_COLLECTIONS: Record<string, string> = {
  "preview-attention": "preview-transformer",
  "preview-alphafold": "preview-life-science",
  "preview-sam": "preview-projects",
  "preview-scaling-laws": "preview-transformer",
};

const PREVIEW_LIBRARY_META: Record<string, WorkTableMeta> = {
  "preview-attention": {
    ...emptyWorkMeta(),
    tags: ["Transformer", "必读", "方法"],
    references: 42,
    citedBy: 128000,
    annotations: 6,
    pdfs: 1,
    sentinelTaskCount: 1,
    sentinelStatus: "active",
    sentinelState: "indexed_openalex",
  },
  "preview-alphafold": {
    ...emptyWorkMeta(),
    tags: ["结构生物学", "深度学习"],
    references: 78,
    citedBy: 31000,
    annotations: 4,
    pdfs: 1,
    sentinelTaskCount: 1,
    sentinelStatus: "done",
    sentinelState: "indexed_pubmed",
  },
  "preview-sam": {
    ...emptyWorkMeta(),
    tags: ["计算机视觉", "待阅读"],
    references: 57,
    citedBy: 21000,
    annotations: 0,
    pdfs: 0,
    sentinelTaskCount: 0,
    sentinelStatus: null,
    sentinelState: null,
  },
  "preview-scaling-laws": {
    ...emptyWorkMeta(),
    tags: ["LLM", "实验设计"],
    references: 35,
    citedBy: 18000,
    annotations: 3,
    pdfs: 1,
    sentinelTaskCount: 0,
    sentinelStatus: null,
    sentinelState: null,
  },
};

function previewAttachment(workId: string, fileName: string, pages: number): AttachmentRow {
  return {
    id: `${workId}-pdf`,
    work_id: workId,
    kind: "pdf",
    sha256: `${workId}-preview-sha`,
    byte_size: 1024 * 1024 * 2.4,
    original_filename: fileName,
    fetched_via: "preview",
    page_count: pages,
    created_at: PREVIEW_TIMESTAMP,
  };
}

const PREVIEW_RUNTIME_META: Record<string, WorkRuntimeMeta> = {
  "preview-attention": {
    pdfCount: 1,
    annotationCount: 6,
    pdfPreview: previewAttachment("preview-attention", "attention-is-all-you-need.pdf", 15),
    notePreviews: [
      {
        id: "preview-note-attention-1",
        type: "highlight",
        page_index: 2,
        content_md: "核心贡献是把序列建模里的循环结构替换为多头注意力。",
        updated_at: PREVIEW_TIMESTAMP - 1000 * 60 * 18,
      },
      {
        id: "preview-note-attention-2",
        type: "note",
        page_index: 6,
        content_md: "复现时重点看 positional encoding 与 residual path 的消融。",
        updated_at: PREVIEW_TIMESTAMP - 1000 * 60 * 46,
      },
    ],
    sentinelTaskCount: 1,
    sentinelStatus: "active",
    sentinelState: "indexed_openalex",
  },
  "preview-alphafold": {
    pdfCount: 1,
    annotationCount: 4,
    pdfPreview: previewAttachment("preview-alphafold", "alphafold-nature-2021.pdf", 27),
    notePreviews: [
      {
        id: "preview-note-alphafold-1",
        type: "highlight",
        page_index: 3,
        content_md: "端到端结构预测把同源建模、MSA 表征和几何约束放到同一模型里。",
        updated_at: PREVIEW_TIMESTAMP - 1000 * 60 * 90,
      },
    ],
    sentinelTaskCount: 1,
    sentinelStatus: "done",
    sentinelState: "indexed_pubmed",
  },
  "preview-sam": {
    pdfCount: 0,
    annotationCount: 0,
    pdfPreview: null,
    notePreviews: [],
    sentinelTaskCount: 0,
    sentinelStatus: null,
    sentinelState: null,
  },
  "preview-scaling-laws": {
    pdfCount: 1,
    annotationCount: 3,
    pdfPreview: previewAttachment("preview-scaling-laws", "scaling-laws-language-models.pdf", 30),
    notePreviews: [
      {
        id: "preview-note-scaling-1",
        type: "note",
        page_index: 4,
        content_md: "适合放进方法章节，解释为什么预算分配会影响最终 loss。",
        updated_at: PREVIEW_TIMESTAMP - 1000 * 60 * 130,
      },
    ],
    sentinelTaskCount: 0,
    sentinelStatus: null,
    sentinelState: null,
  },
};

function cloneWorkMetaMap(source: Record<string, WorkTableMeta>): Record<string, WorkTableMeta> {
  return Object.fromEntries(
    Object.entries(source).map(([workId, meta]) => [workId, { ...meta, tags: [...meta.tags] }]),
  ) as Record<string, WorkTableMeta>;
}

function filterPreviewWorksFrom(works: WorkWithAuthors[], query: string): WorkWithAuthors[] {
  const text = query.trim().toLowerCase();
  if (!text) return works;
  return works.filter((work) => {
    const meta = PREVIEW_LIBRARY_META[work.id];
    return [
      work.title,
      work.abstract,
      work.doi,
      work.arxiv_id,
      work.venue_name,
      work.year?.toString(),
      ...work.authorNames,
      ...(meta?.tags ?? []),
    ]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(text));
  });
}

function normalizePreviewLookup(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/^doi\.org\//, "")
    .replace(/^arxiv\.org\/(?:abs|pdf)\//, "")
    .replace(/\.pdf$/, "")
    .replace(/\s+/g, " ");
}

function findPreviewImportWork(value: string): WorkWithAuthors | null {
  const text = normalizePreviewLookup(value);
  if (!text) return null;
  return (
    PREVIEW_LIBRARY_WORKS.find((work) =>
      [work.title, work.doi, work.arxiv_id, work.url, work.venue_name, ...work.authorNames].some(
        (candidate) => {
          const normalized = normalizePreviewLookup(candidate);
          if (!normalized) return false;
          return normalized === text || normalized.includes(text) || text.includes(normalized);
        },
      ),
    ) ?? null
  );
}

function workToMetadataDraft(work: WorkWithAuthors): MetadataDraft {
  return {
    title: work.title ?? "",
    type: work.type ?? "article",
    doi: work.doi ?? "",
    year: work.year != null ? String(work.year) : "",
    publicationDate: work.publication_date ?? "",
    venueName: work.venue_name ?? "",
    volume: work.volume ?? "",
    issue: work.issue ?? "",
    pages: work.pages ?? "",
    edition: work.edition ?? "",
    numberOfVolumes: work.number_of_volumes ?? "",
    section: work.section ?? "",
    publisher: work.publisher ?? "",
    placePublished: work.place_published ?? "",
    seriesTitle: work.series_title ?? "",
    shortTitle: work.short_title ?? "",
    originalTitle: work.original_title ?? "",
    issn: work.issn ?? "",
    isbn: work.isbn ?? "",
    url: work.url ?? "",
    accessedDate: work.accessed_date ?? "",
    language: work.language ?? "",
    callNumber: work.call_number ?? "",
    accessionNumber: work.accession_number ?? "",
    label: work.label ?? "",
    databaseName: work.database_name ?? "",
    abstract: work.abstract ?? "",
    keywords: "",
    authors: work.authorNames.map((displayName) => ({ displayName, role: "author" })),
  };
}

function applyMetadataPatchToWork(work: WorkWithAuthors, patch: WorkPatch): WorkWithAuthors {
  return {
    ...work,
    title: patch.title ?? work.title,
    type: patch.type ?? work.type,
    doi: patch.doi === undefined ? work.doi : patch.doi,
    year: patch.year === undefined ? work.year : patch.year,
    publication_date:
      patch.publicationDate === undefined ? work.publication_date : patch.publicationDate,
    venue_name: patch.venueName === undefined ? work.venue_name : patch.venueName,
    volume: patch.volume === undefined ? work.volume : patch.volume,
    issue: patch.issue === undefined ? work.issue : patch.issue,
    pages: patch.pages === undefined ? work.pages : patch.pages,
    edition: patch.edition === undefined ? work.edition : patch.edition,
    number_of_volumes:
      patch.numberOfVolumes === undefined ? work.number_of_volumes : patch.numberOfVolumes,
    section: patch.section === undefined ? work.section : patch.section,
    publisher: patch.publisher === undefined ? work.publisher : patch.publisher,
    place_published:
      patch.placePublished === undefined ? work.place_published : patch.placePublished,
    series_title: patch.seriesTitle === undefined ? work.series_title : patch.seriesTitle,
    short_title: patch.shortTitle === undefined ? work.short_title : patch.shortTitle,
    original_title: patch.originalTitle === undefined ? work.original_title : patch.originalTitle,
    issn: patch.issn === undefined ? work.issn : patch.issn,
    isbn: patch.isbn === undefined ? work.isbn : patch.isbn,
    url: patch.url === undefined ? work.url : patch.url,
    accessed_date: patch.accessedDate === undefined ? work.accessed_date : patch.accessedDate,
    language: patch.language === undefined ? work.language : patch.language,
    call_number: patch.callNumber === undefined ? work.call_number : patch.callNumber,
    accession_number:
      patch.accessionNumber === undefined ? work.accession_number : patch.accessionNumber,
    label: patch.label === undefined ? work.label : patch.label,
    database_name: patch.databaseName === undefined ? work.database_name : patch.databaseName,
    abstract: patch.abstract === undefined ? work.abstract : patch.abstract,
    authorNames: patch.authors?.map((author) => author.displayName) ?? work.authorNames,
    updated_at: Date.now(),
  };
}

function workToCiteWork(work: WorkWithAuthors): WorkLike {
  return {
    id: work.id,
    title: work.title,
    doi: work.doi,
    pmid: work.pmid,
    year: work.year,
    publicationDate: work.publication_date,
    venueName: work.venue_name,
    type: work.type,
    authorNames: work.authorNames,
    authorsDetail: work.authorNames.map((displayName) => ({ displayName, role: "author" })),
    volume: work.volume,
    issue: work.issue,
    pages: work.pages,
    publisher: work.publisher,
    placePublished: work.place_published,
    issn: work.issn,
    isbn: work.isbn,
    url: work.url,
    edition: work.edition,
    language: work.language,
  };
}

function previewCitationContent(works: WorkWithAuthors[], format: ExportFormat): string {
  const items = works.map(workToCiteWork).map(toCslItem);
  if (format === "bibtex") return toBibTeX(items);
  if (format === "ris") return toRIS(items);
  return toCslJson(items);
}

function previewCitationFilename(format: ExportFormat): string {
  const extension = format === "bibtex" ? "bib" : format === "ris" ? "ris" : "json";
  return `aurascholar-preview-references.${extension}`;
}

function previewBibliographyText(works: WorkWithAuthors[], styleId: string): string {
  return formatBibliography(works.map(workToCiteWork).map(toCslItem), styleId).join("\n");
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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

async function waitForLibrarySmokeAfterReadDelay(): Promise<void> {
  const smokeWindow = window as LibrarySmokeWindow;
  const delayMs = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_DELAY_MS__;
  if (typeof delayMs !== "number" || delayMs <= 0) return;
  smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_COUNT__ =
    (smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_COUNT__ ?? 0) + 1;
  await new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function consumeLibrarySmokeReadFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READ__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READ__;
  return new Error(message);
}

function consumeLibrarySmokeBulkTagAfterFirstFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_BULK_TAG_AFTER_FIRST__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_BULK_TAG_AFTER_FIRST__;
  return new Error(message);
}

function consumeLibrarySmokeMoveAfterFirstFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_MOVE_AFTER_FIRST__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_MOVE_AFTER_FIRST__;
  return new Error(message);
}

function consumeLibrarySmokeReadingStatusFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READING_STATUS__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READING_STATUS__;
  return new Error(message);
}

function consumeLibrarySmokeStarFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_STAR__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_STAR__;
  return new Error(message);
}

function consumeLibrarySmokeTrashFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH__;
  return new Error(message);
}

function consumeLibrarySmokeTrashRestoreFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH_RESTORE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH_RESTORE__;
  return new Error(message);
}

export function LibraryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedWorkId = searchParams.get("work");
  const urlRouteRequest = createLibraryRouteRequest({
    filter: searchParams.get("filter"),
    locationKey: location.key,
    workId: requestedWorkId,
  });
  const clearLibraryRouteParams = useCallback(() => {
    setSearchParams((current) => withoutLibraryRouteParams(current), { replace: true });
  }, [setSearchParams]);
  const {
    activeCollection,
    activeCollectionRef,
    activeFilter,
    activeFilterRef,
    activeSource,
    activeTag,
    appliedRouteKeyRef,
    applyRouteView,
    cancelCurrentRouteRequest,
    currentRouteKey,
    currentRouteRequest,
    extraFilter,
    search,
    searchRef,
    setActiveCollection,
    setActiveFilter,
    setActiveSource,
    setActiveTag,
    setExtraFilter,
    setSearch,
  } = useLibraryBrowseState({
    onCancelRoute: clearLibraryRouteParams,
    urlRouteRequest,
  });
  const [input, setInput] = useState("");
  const [items, setItems] = useState<WorkWithAuthors[]>([]);
  const [previewItems, setPreviewItems] = useState<WorkWithAuthors[]>(() => PREVIEW_LIBRARY_WORKS);
  const [previewTrashItems, setPreviewTrashItems] = useState<WorkWithAuthors[]>([]);
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [trashCount, setTrashCount] = useState(0);
  const [workMeta, setWorkMeta] = useState<Record<string, WorkTableMeta>>({});
  const [librarySnapshotRevision, setLibrarySnapshotRevision] = useState(0);
  const [previewWorkMeta, setPreviewWorkMeta] = useState<Record<string, WorkTableMeta>>(() =>
    cloneWorkMetaMap(PREVIEW_LIBRARY_META),
  );
  const [libraryLoadError, setLibraryLoadError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("added");
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attachingPdf, setAttachingPdf] = useState(false);
  const [noticeState, setMessage] = useReducer(reduceLibraryNoticeState, {
    instance: 0,
    message: null,
  });
  const { instance: messageInstance, message } = noticeState;
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [trashUndo, setTrashUndo] = useState<LibraryTrashUndoState | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(0);
  const [tagManagerIntent, setTagManagerIntent] = useState<"create" | "manage" | null>(null);
  const [advancedFilterOpen, setAdvancedFilterOpen] = useState(false);
  const [textPrompt, setTextPrompt] = useState<TextPromptConfig | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [citationBusy, setCitationBusy] = useState<"copy" | "export" | null>(null);
  const [workActionBusy, setWorkActionBusy] = useState<LibraryWorkAction | null>(null);
  const [starActionBusyById, setStarActionBusyById] = useState<Record<string, boolean>>({});
  const [readingStatusBusy, setReadingStatusBusy] = useState<{
    status: ReadingStatus;
    workId: string;
  } | null>(null);
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
  const pageSelectCheckboxRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contextPanelRef = useRef<HTMLElement | null>(null);
  const importingRef = useRef(false);
  const workMutationLeaseRef = useRef(new MutationLease<LibraryWorkAction>());
  const starActionBusyRef = useRef<Record<string, boolean>>({});
  const readingStatusBusyRef = useRef<{ status: ReadingStatus; workId: string } | null>(null);
  const quickDropDepthRef = useRef(0);
  const pendingKeyboardFocusIndexRef = useRef<number | null>(null);
  const skipNextPageResetRef = useRef(false);
  const { confirm, confirmDialog } = useConfirmDialog();
  const reportCanvasIngressError = useCallback((error: string) => setMessage(error), []);
  const { openInCanvas, targetPicker } = useCanvasIngress(reportCanvasIngressError);
  const reportProjectIngressError = useCallback(
    (error: Error) => setMessage(`加入研究项目失败:${describeSafeError(error)}`),
    [],
  );
  const reportProjectIngressAdded = useCallback(
    ({ updated }: { updated: number }) =>
      setMessage(updated > 0 ? `已将 ${updated} 篇文献加入研究项目` : "所选文献已在目标项目中"),
    [],
  );
  const {
    openProjectIngress,
    pending: projectIngressBusy,
    projectTargetPicker,
  } = useProjectIngress({
    onAdded: reportProjectIngressAdded,
    onError: reportProjectIngressError,
  });
  const addWorksToProject = useCallback(
    (workIds: readonly string[], sourceLabel?: string) => {
      void openProjectIngress({ sourceLabel, workIds }).catch(() => undefined);
    },
    [openProjectIngress],
  );
  const findShortcut = useMemo(() => shortcutLabel("F"), []);
  const acquireWorkMutation = useCallback(
    (action: LibraryWorkAction): MutationLeaseGrant<LibraryWorkAction> | null => {
      const grant = workMutationLeaseRef.current.tryAcquire(action);
      if (grant) setWorkActionBusy(action);
      return grant;
    },
    [],
  );
  const releaseWorkMutation = useCallback((grant: MutationLeaseGrant<LibraryWorkAction>) => {
    if (workMutationLeaseRef.current.release(grant)) setWorkActionBusy(null);
  }, []);
  const dismissMessage = useCallback((expectedMessage: string) => {
    setMessage((current) => (current === expectedMessage ? null : current));
  }, []);
  const messageLeaving = useLibraryNoticeLifecycle({
    instance: messageInstance,
    message,
    onDismiss: dismissMessage,
    persistent: Boolean(trashUndo && message === trashUndo.message),
  });

  const fillExamplePaper = useCallback(() => {
    setInput("1706.03762");
    setImportDialogOpen(true);
  }, []);

  const coordinatedRefresh = useLibraryRefreshController<LibraryRefreshQuery, LibraryRefreshData>({
    getQuery: () => {
      const routeView = currentRouteRequest ? libraryDeepLinkView(currentRouteRequest) : null;
      return {
        activeCollection: routeView?.activeCollection ?? activeCollectionRef.current,
        activeFilter: routeView?.activeFilter ?? activeFilterRef.current,
        desktopRuntime: isDesktopRuntime(),
        previewItems,
        previewTrashItems,
        previewWorkMeta,
        routeKey: currentRouteRequest?.key ?? null,
        routeWorkId: currentRouteRequest?.workId ?? null,
        search: routeView?.search ?? searchRef.current,
      };
    },
    isSameQuery: isSameLibraryRefreshQuery,
    load: async (query) => {
      if (!query.desktopRuntime) {
        const previewSource =
          query.activeFilter === "trash" ? query.previewTrashItems : query.previewItems;
        const scopedPreviewItems =
          query.activeFilter !== "trash" && query.activeCollection
            ? previewSource.filter(
                (work) => PREVIEW_WORK_COLLECTIONS[work.id] === query.activeCollection,
              )
            : previewSource;
        return {
          collections: PREVIEW_LIBRARY_COLLECTIONS,
          previewMode: true,
          trashCount: query.previewTrashItems.length,
          works: filterPreviewWorksFrom(scopedPreviewItems, query.search),
          workMeta: query.previewWorkMeta,
        };
      }
      const smokeFailure = consumeLibrarySmokeReadFailure();
      if (smokeFailure) throw smokeFailure;
      const snapshot = await loadLibraryPageData({
        collectionId: query.activeCollection ?? undefined,
        limit: LIST_HARD_LIMIT,
        search: query.search || undefined,
        showTrash: query.activeFilter === "trash",
      });
      await waitForLibrarySmokeAfterReadDelay();
      return { ...snapshot, previewMode: false };
    },
    apply: (snapshot, query) => {
      if (!ownsLibraryRouteRequest(query.routeKey, currentRouteRequest)) return;
      setCollections(snapshot.collections);
      setTrashCount(snapshot.trashCount);
      setItems(snapshot.works);
      setWorkMeta(snapshot.workMeta);
      setLibrarySnapshotRevision((current) => current + 1);
      if (currentRouteRequest && query.routeWorkId === currentRouteRequest.workId) {
        const routeView = libraryDeepLinkView(currentRouteRequest);
        const routeRows = filterLibraryWorkspaceItems({
          activeFilter: routeView.activeFilter,
          activeSource: routeView.activeSource,
          activeTag: routeView.activeTag,
          extraFilter: routeView.extraFilter,
          items: snapshot.works,
          sortMode,
          workMeta: snapshot.workMeta,
        });
        const targetIndex = routeRows.findIndex((work) => work.id === currentRouteRequest.workId);
        skipNextPageResetRef.current = hasLibraryBrowseViewChanged(
          {
            activeCollection,
            activeFilter,
            activeSource,
            activeTag,
            extraFilter,
            search,
          },
          routeView,
        );
        applyRouteView(routeView);
        setSelectedIds(new Set());
        setSelectedWorkId(targetIndex >= 0 ? routeView.selectedWorkId : null);
        setPage(targetIndex >= 0 ? Math.floor(targetIndex / PAGE_SIZE) : 0);
        if (targetIndex < 0) {
          setMessage("没有找到要定位的文献，可能已被删除或来自另一个资料库");
        }
        appliedRouteKeyRef.current = query.routeKey;
        clearLibraryRouteParams();
      } else {
        const refreshedRows = filterLibraryWorkspaceItems({
          activeFilter,
          activeSource,
          activeTag,
          extraFilter,
          items: snapshot.works,
          sortMode,
          workMeta: snapshot.workMeta,
        });
        if (selectedWorkId && !refreshedRows.some((work) => work.id === selectedWorkId)) {
          setSelectedWorkId(null);
        }
        if (refreshedRows.length === 0) setPage(0);
      }
      setLibraryLoadError(null);
      setMessage((current) => {
        if (snapshot.previewMode) {
          return current && !current.startsWith("浏览器预览无法读取本地文献库")
            ? current
            : PREVIEW_LIBRARY_SCOPE_MESSAGE;
        }
        return current?.startsWith("读取文献库失败") ? null : current;
      });
      if (!snapshot.previewMode) {
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      }
    },
    reportFailure: (error) => {
      const detail = describeSafeError(error);
      setLibraryLoadError(detail);
      setMessage(`读取文献库失败：${detail}`);
    },
  });
  const refresh = useCallback(async (): Promise<Error | undefined> => {
    const result = await coordinatedRefresh();
    return result.status === "failed" ? result.error : undefined;
  }, [coordinatedRefresh]);

  useEffect(() => {
    const disposition = libraryRouteRefreshDisposition(currentRouteKey, appliedRouteKeyRef.current);
    if (disposition === "load-route") {
      void refresh();
      return;
    }
    if (disposition === "skip-applied-route") return;
    if (disposition === "skip-route-consumption") {
      appliedRouteKeyRef.current = null;
      return;
    }
    const t = setTimeout(() => void refresh(), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [
    activeCollection,
    activeFilter,
    appliedRouteKeyRef,
    currentRouteKey,
    previewItems,
    previewTrashItems,
    previewWorkMeta,
    refresh,
    search,
  ]);

  useEffect(() => {
    const onDerivedDataUpdated = () => void refresh();
    window.addEventListener("aurascholar:sentinel-updated", onDerivedDataUpdated);
    return () => {
      window.removeEventListener("aurascholar:sentinel-updated", onDerivedDataUpdated);
    };
  }, [refresh]);

  useEffect(() => {
    const onFindShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !isPlatformShortcut(event, "f")) return;
      if (document.querySelector("[data-modal-root]")) return;
      if (isEditableTarget(event.target) && event.target !== searchInputRef.current) return;
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", onFindShortcut);
    return () => window.removeEventListener("keydown", onFindShortcut);
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
          pdfMessage = `PDF 挂载失败:${describeSafeError(e)}`;
        }
      }
      setMessage(`已在库中:${draft.dedup.title}${pdfMessage ? `，${pdfMessage}` : ""}`);
      await refresh();
      return true;
    },
    [refresh],
  );

  const handleAdd = useCallback(
    async (rawInput = input) => {
      const normalizedInput = rawInput.trim();
      if (!normalizedInput || busy) return;
      if (!isDesktopRuntime()) {
        const startedAt = Date.now();
        setBusy(true);
        setMessage("正在演示快速入库...");
        try {
          const matched = findPreviewImportWork(normalizedInput);
          await waitForMinimumElapsed(startedAt, MIN_REFERENCE_IMPORT_BUSY_MS);
          if (!matched) {
            setMessage(
              "浏览器预览支持样例 DOI、arXiv、标题或作者定位；真实解析请在桌面应用中完成。",
            );
            return;
          }
          setInput("");
          setSearch("");
          setActiveFilter("all");
          setActiveCollection(null);
          setActiveTag(null);
          setActiveSource(null);
          setExtraFilter(null);
          setItems(PREVIEW_LIBRARY_WORKS);
          setWorkMeta(PREVIEW_LIBRARY_META);
          setTrashCount(0);
          setSelectedIds(new Set());
          setSelectedWorkId(matched.id);
          const matchedIndex = PREVIEW_LIBRARY_WORKS.findIndex((work) => work.id === matched.id);
          setPage(Math.max(0, Math.floor(matchedIndex / PAGE_SIZE)));
          setMessage(`已在预览文献库中定位《${matched.title}》，可继续打开阅读器或补全文。`);
        } finally {
          setBusy(false);
        }
        return;
      }
      setBusy(true);
      setMessage("正在识别…");
      try {
        const { analyzeInput } = await import("../services/library");
        const draft = await analyzeInput(normalizedInput);
        if (!draft) {
          setMessage("无法识别输入 — 请提供 DOI、arXiv ID、论文链接或标题");
        } else if (await surfaceDedup(draft)) {
          setInput("");
        } else {
          setConfirmDraft(draft);
          setInput("");
        }
      } catch (e) {
        setMessage(`解析失败:${describeSafeError(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [
      input,
      busy,
      setActiveCollection,
      setActiveFilter,
      setActiveSource,
      setActiveTag,
      setExtraFilter,
      setSearch,
      surfaceDedup,
    ],
  );

  const handleUpload = useCallback(
    async (file: File) => {
      if (!isDesktopRuntime()) {
        setMessage("浏览器预览不会解析或写入 PDF；当前示例文献仍可试用整理、阅读入口和导出。");
        return;
      }
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
        setMessage(`解析失败:${describeSafeError(e)}`);
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
        await auraFs.writeFile(blobPath(sha), data);
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
        setMessage(`解析失败:${describeSafeError(e)}`);
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
      const { attachStagedPdf, commitIngest, restoreDedup } =
        await import("../services/library-actions");
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
      }
      setConfirmDraft(null);
      window.dispatchEvent(new Event("aurascholar:library-updated"));
      await refresh();
    },
    [confirmDraft, refresh],
  );

  const handleCancelImport = useCallback(() => {
    const draft = confirmDraft;
    setConfirmDraft(null);
    setMessage("已取消入库");
    void import("../services/library-actions")
      .then(({ discardStagedPdf }) => discardStagedPdf(draft?.pdf))
      .catch(() => {});
  }, [confirmDraft]);

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
    const onCreateTag = () => setTagManagerIntent("create");
    const onManageTags = () => setTagManagerIntent("manage");
    window.addEventListener("aurascholar:library-view", onLibraryView);
    window.addEventListener("aurascholar:create-tag", onCreateTag);
    window.addEventListener("aurascholar:manage-tags", onManageTags);
    return () => {
      window.removeEventListener("aurascholar:library-view", onLibraryView);
      window.removeEventListener("aurascholar:create-tag", onCreateTag);
      window.removeEventListener("aurascholar:manage-tags", onManageTags);
    };
  }, [setActiveCollection, setActiveFilter, setActiveSource, setActiveTag, setExtraFilter]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("aurascholar:library-view-state", {
        detail: { filter: activeFilter, collectionId: activeCollection, tag: activeTag },
      }),
    );
  }, [activeCollection, activeFilter, activeTag]);

  const availableTags = useMemo(
    () =>
      Array.from(new Set(items.flatMap((work) => workMeta[work.id]?.tags ?? []))).sort((a, b) =>
        a.localeCompare(b, "zh-CN"),
      ),
    [items, workMeta],
  );
  const availableSources = useMemo(
    () =>
      Array.from(
        new Set(
          items
            .flatMap((work) => [work.venue_name, work.type, work.arxiv_id ? "arXiv" : null])
            .filter((value): value is string => Boolean(value?.trim())),
        ),
      ).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [items],
  );

  const isTrashView = activeFilter === "trash";
  const hasSearchQuery = search.trim().length > 0;
  const hasActiveLibraryFilter = Boolean(
    activeCollection || activeTag || activeSource || extraFilter || activeFilter !== "all",
  );
  const advancedFacetCount = [activeSource, extraFilter].filter(Boolean).length;
  const filteredItems = useMemo(() => {
    return filterLibraryWorkspaceItems({
      activeFilter,
      activeSource,
      activeTag,
      extraFilter,
      items,
      sortMode,
      workMeta,
    });
  }, [activeFilter, activeSource, activeTag, extraFilter, items, sortMode, workMeta]);
  const countBaseItems = isTrashView ? [] : items;
  const totalDisplay = countBaseItems.length.toLocaleString("zh-CN");
  const tableRows = filteredItems;
  const actionableSelectedIds = useMemo(
    () =>
      scopeSelectedIds(
        selectedIds,
        tableRows.map((work) => work.id),
      ),
    [selectedIds, tableRows],
  );
  const pageCount = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE));
  const safePage = resolveLibraryVisiblePage({
    page,
    pageCount,
    pageSize: PAGE_SIZE,
    selectedWorkId,
    workIds: tableRows.map((work) => work.id),
  });
  const pagedRows = useMemo(
    () => tableRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [tableRows, safePage],
  );
  const pageSelectedCount = useMemo(
    () => pagedRows.filter((work) => selectedIds.has(work.id)).length,
    [pagedRows, selectedIds],
  );
  const pageAllSelected = pagedRows.length > 0 && pageSelectedCount === pagedRows.length;
  const pageSomeSelected = pageSelectedCount > 0 && !pageAllSelected;
  const readingCount = countBaseItems.filter((w) => w.reading_status === "reading").length;
  const unreadCount = countBaseItems.filter((w) => w.reading_status === "unread").length;
  const notedCount = countBaseItems.filter((w) => (workMeta[w.id]?.annotations ?? 0) > 0).length;
  const starredCount = countBaseItems.filter((w) => w.starred === 1).length;
  const activeCollectionRow =
    collections.find((collection) => collection.id === activeCollection) ?? null;
  const activeCollectionPath = useMemo(
    () => collectionPath(collections, activeCollection),
    [activeCollection, collections],
  );
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
  const plainEmptyTitle = hasSearchQuery
    ? "当前筛选无结果"
    : isTrashView
      ? "回收站为空"
      : items.length > 0
        ? "当前筛选无结果"
        : activeCollection
          ? "这个文件夹是空的"
          : "还没有文献";
  const plainEmptyDescription = hasSearchQuery
    ? "换一个关键词，或清除搜索查看当前结果。"
    : isTrashView
      ? "移入回收站的文献会显示在这里，可以恢复或永久删除。"
      : items.length > 0
        ? "换一个筛选条件，或在上方搜索框里缩小/清除关键词。"
        : activeCollection
          ? "这个文件夹是空的。"
          : "从 DOI、arXiv、论文链接或 PDF 开始建立你的研究工作台。";

  useEffect(() => {
    if (pageSelectCheckboxRef.current) {
      pageSelectCheckboxRef.current.indeterminate = pageSomeSelected;
    }
  }, [pageSomeSelected]);

  const selectedWork = useMemo(
    () => tableRows.find((w) => w.id === selectedWorkId) ?? null,
    [tableRows, selectedWorkId],
  );
  if (selectedWorkId && !selectedWork && !currentRouteRequest) {
    setSelectedWorkId(null);
  }
  const selectedTableMeta = selectedWork ? workMeta[selectedWork.id] : undefined;
  const selectedRuntimeMetaVersion = selectedTableMeta
    ? [
        librarySnapshotRevision,
        selectedTableMeta.annotations,
        selectedTableMeta.pdfs,
        selectedTableMeta.sentinelTaskCount,
        selectedTableMeta.sentinelStatus ?? "",
        selectedTableMeta.sentinelState ?? "",
      ].join("\u0000")
    : `${librarySnapshotRevision}\u0000missing`;
  const selectedRuntimeMeta = useSelectedWorkRuntimeMeta({
    annotationCount: selectedTableMeta?.annotations ?? 0,
    desktopRuntime: isDesktopRuntime(),
    load: loadLibraryWorkRuntimeMeta,
    previewMeta: selectedWork ? (PREVIEW_RUNTIME_META[selectedWork.id] ?? null) : null,
    runtimeVersion: selectedRuntimeMetaVersion,
    tableMeta: selectedTableMeta,
    workId: selectedWork?.id ?? null,
  });
  const selectedMeta = selectedRuntimeMeta.meta;
  const editingPreviewWork = useMemo(() => {
    if (!editingMetaId || isDesktopRuntime()) return null;
    return (
      previewItems.find((work) => work.id === editingMetaId) ??
      previewTrashItems.find((work) => work.id === editingMetaId) ??
      null
    );
  }, [editingMetaId, previewItems, previewTrashItems]);
  const previewWorksById = useMemo(
    () => new Map([...previewItems, ...previewTrashItems].map((work) => [work.id, work])),
    [previewItems, previewTrashItems],
  );

  const updatePreviewWork = useCallback(
    (workId: string, updater: (work: WorkWithAuthors) => WorkWithAuthors) => {
      setPreviewItems((current) =>
        current.map((work) => (work.id === workId ? updater(work) : work)),
      );
      setPreviewTrashItems((current) =>
        current.map((work) => (work.id === workId ? updater(work) : work)),
      );
      setItems((current) => current.map((work) => (work.id === workId ? updater(work) : work)));
      setSelectedWorkId(workId);
    },
    [],
  );

  const commitPreviewMetadata = useCallback(
    (workId: string, patch: WorkPatch) => {
      updatePreviewWork(workId, (work) => applyMetadataPatchToWork(work, patch));
      setEditingMetaId(null);
      setMessage("已在预览中保存元数据修改");
    },
    [updatePreviewWork],
  );

  const handleAttachPdf = useCallback(
    async (file: File) => {
      if (!selectedWork) return;
      if (!isDesktopRuntime()) {
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
        const annotationMessage =
          result.restoredAnnotationCount > 0
            ? `，已恢复 ${result.restoredAnnotationCount} 条备份批注`
            : "";
        setMessage(
          result.deduped
            ? `这份 PDF 已经附加在《${selectedWork.title}》上${annotationMessage}`
            : `已为《${selectedWork.title}》上传 PDF(${result.pageCount} 页)${annotationMessage}`,
        );
        await refresh();
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (e) {
        setMessage(`上传 PDF 失败:${describeSafeError(e)}`);
      } finally {
        setAttachingPdf(false);
      }
    },
    [refresh, selectedWork],
  );

  // "Find full text" for a work missing a PDF: try OA first (still confirmed via
  // the card, defaulting to attach); otherwise open the browser at its landing
  // page carrying the work id so the eventual download attaches to this work.
  const handleFindFulltext = useCallback(async () => {
    if (!selectedWork) return;
    if (!isDesktopRuntime()) {
      navigate(
        fulltextWorkHandoffPath(
          {
            arxivId: selectedWork.arxiv_id,
            doi: selectedWork.doi,
            id: selectedWork.id,
            title: selectedWork.title,
            url: selectedWork.url,
          },
          "library",
        ),
      );
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
      navigate(
        fulltextWorkHandoffPath(
          {
            arxivId: selectedWork.arxiv_id,
            doi: selectedWork.doi,
            id: selectedWork.id,
            title: selectedWork.title,
            url: selectedWork.url,
          },
          "library",
        ),
      );
    } catch (e) {
      setMessage(`查找全文失败:${describeSafeError(e)}`);
    } finally {
      setFindingFulltext(false);
    }
  }, [selectedWork, navigate]);

  const updateWorkStarred = useCallback(
    async (work: WorkWithAuthors, starred: boolean) => {
      if (Object.prototype.hasOwnProperty.call(starActionBusyRef.current, work.id)) return;
      const successMessage = starred
        ? `已标记重点:《${work.title}》`
        : `已取消重点:《${work.title}》`;
      if (!isDesktopRuntime()) {
        updatePreviewWork(work.id, (current) => ({
          ...current,
          starred: starred ? 1 : 0,
          updated_at: Date.now(),
        }));
        setMessage(
          starred ? `已在预览中标记重点:《${work.title}》` : `已在预览中取消重点:《${work.title}》`,
        );
        return;
      }
      const startedAt = Date.now();
      const nextBusy = { ...starActionBusyRef.current, [work.id]: starred };
      starActionBusyRef.current = nextBusy;
      setStarActionBusyById(nextBusy);
      setMessage(
        starred ? `正在标记重点:《${work.title}》...` : `正在取消重点:《${work.title}》...`,
      );
      try {
        const smokeFailure = consumeLibrarySmokeStarFailure();
        if (smokeFailure) {
          await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
          throw smokeFailure;
        }
        await setLibraryWorkStarred(work.id, starred);
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        setMessage(successMessage);
        try {
          const refreshFailure = await refresh();
          if (refreshFailure) throw refreshFailure;
        } catch (e) {
          setMessage(`${successMessage}，但列表刷新失败，可稍后刷新:${describeSafeError(e)}`);
        }
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        setMessage(`更新重点状态失败，重点状态仍保留，可重新切换:${describeSafeError(e)}`);
      } finally {
        const restBusy = { ...starActionBusyRef.current };
        delete restBusy[work.id];
        starActionBusyRef.current = restBusy;
        setStarActionBusyById(restBusy);
      }
    },
    [refresh, updatePreviewWork],
  );

  const updateSelectedReadingStatus = useCallback(
    async (status: ReadingStatus) => {
      if (!selectedWork) return;
      if (readingStatusBusyRef.current) return;
      const successMessage = `已更新阅读状态:${readingStatusLabel(status)}`;
      if (!isDesktopRuntime()) {
        updatePreviewWork(selectedWork.id, (current) => ({
          ...current,
          reading_status: status,
          updated_at: Date.now(),
        }));
        setMessage(`已在预览中更新阅读状态:${readingStatusLabel(status)}`);
        return;
      }
      const startedAt = Date.now();
      const busyTarget = { workId: selectedWork.id, status };
      readingStatusBusyRef.current = busyTarget;
      setReadingStatusBusy(busyTarget);
      setMessage(`正在更新阅读状态:${readingStatusLabel(status)}...`);
      try {
        const smokeFailure = consumeLibrarySmokeReadingStatusFailure();
        if (smokeFailure) {
          await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
          throw smokeFailure;
        }
        await setLibraryWorkReadingStatus(selectedWork.id, status);
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        setMessage(successMessage);
        try {
          const refreshFailure = await refresh();
          if (refreshFailure) throw refreshFailure;
        } catch (e) {
          setMessage(`${successMessage}，但列表刷新失败，可稍后刷新:${describeSafeError(e)}`);
        }
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        setMessage(`更新阅读状态失败，阅读状态仍保留，可重新更新:${describeSafeError(e)}`);
      } finally {
        readingStatusBusyRef.current = null;
        setReadingStatusBusy(null);
      }
    },
    [refresh, selectedWork, updatePreviewWork],
  );

  const deleteSelectedWork = useCallback(async () => {
    if (!selectedWork) return;
    const mutationGrant = acquireWorkMutation("trash");
    if (!mutationGrant) return;
    const workId = selectedWork.id;
    const title = selectedWork.title;
    try {
      const confirmed = await confirm({
        title: "移入回收站？",
        description: `《${title}》会从当前列表移到回收站。`,
        details: ["你可以在回收站恢复它。", "永久删除前，PDF、批注、标签和关联数据都会保留。"],
        confirmLabel: "移入回收站",
        tone: "warning",
      });
      if (!confirmed) return;
      if (!isDesktopRuntime()) {
        const deletedAt = Date.now();
        const deletedWork = { ...selectedWork, deleted_at: deletedAt, updated_at: deletedAt };
        const undoMessage = `已将《${title}》移入预览回收站`;
        setPreviewItems((current) => current.filter((work) => work.id !== workId));
        setPreviewTrashItems((current) => [
          deletedWork,
          ...current.filter((work) => work.id !== workId),
        ]);
        setItems((current) => current.filter((work) => work.id !== workId));
        setTrashCount((current) => current + 1);
        setTrashUndo({ count: 1, ids: [workId], message: undoMessage });
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(workId);
          return next;
        });
        setMessage(undoMessage);
        return;
      }
      const startedAt = Date.now();
      setMessage(`正在将《${title}》移入回收站...`);
      const undoMessage = `已将《${title}》移入回收站`;
      let trashCommitted = false;
      try {
        const smokeFailure = consumeLibrarySmokeTrashFailure();
        if (smokeFailure) {
          await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
          throw smokeFailure;
        }
        await trashLibraryWorks([workId]);
        trashCommitted = true;
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        const refreshFailure = await refresh();
        if (refreshFailure) throw refreshFailure;
        setMessage(undoMessage);
        setTrashUndo({ count: 1, ids: [workId], message: undoMessage });
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(workId);
          return next;
        });
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        if (trashCommitted) {
          setMessage(
            `${undoMessage}，但列表刷新失败，可点击撤销或稍后刷新:${describeSafeError(e)}`,
          );
          setTrashUndo({ count: 1, ids: [workId], message: undoMessage });
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(workId);
            return next;
          });
          window.dispatchEvent(new Event("aurascholar:library-updated"));
        } else {
          setMessage(`移入回收站失败，文献仍保留，可重新移入回收站:${describeSafeError(e)}`);
        }
      }
    } finally {
      releaseWorkMutation(mutationGrant);
    }
  }, [acquireWorkMutation, confirm, refresh, releaseWorkMutation, selectedWork]);

  const undoTrash = useCallback(async () => {
    if (!trashUndo) return;
    const mutationGrant = acquireWorkMutation("restore");
    if (!mutationGrant) return;
    const { count, ids } = trashUndo;
    try {
      if (!isDesktopRuntime()) {
        const restoreIds = new Set(ids);
        const restored = previewTrashItems
          .filter((work) => restoreIds.has(work.id))
          .map((work) => ({ ...work, deleted_at: null, updated_at: Date.now() }));
        setPreviewTrashItems((current) => current.filter((work) => !restoreIds.has(work.id)));
        setPreviewItems((current) => [...restored, ...current]);
        setItems((current) =>
          activeFilter === "trash"
            ? current.filter((work) => !restoreIds.has(work.id))
            : [...restored, ...current],
        );
        setTrashCount((current) => Math.max(0, current - restored.length));
        setTrashUndo(null);
        setSelectedIds(new Set());
        if (restored[0]) setPage(0);
        setSelectedWorkId(restored[0]?.id ?? selectedWorkId);
        setMessage(
          count === 1 ? "已撤销移入预览回收站" : `已撤销移入预览回收站:${count} 篇文献已恢复`,
        );
        return;
      }
      const startedAt = Date.now();
      setMessage(`正在撤销移入回收站:${count} 篇文献...`);
      const successMessage =
        count === 1 ? "已撤销移入回收站" : `已撤销移入回收站:${count} 篇文献已恢复`;
      let restoreCommitted = false;
      try {
        const smokeFailure = consumeLibrarySmokeTrashRestoreFailure();
        if (smokeFailure) {
          await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
          throw smokeFailure;
        }
        await restoreLibraryWorks(ids);
        restoreCommitted = true;
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        const refreshFailure = await refresh();
        if (refreshFailure) throw refreshFailure;
        setTrashUndo(null);
        setSelectedIds(new Set());
        setMessage(successMessage);
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        if (restoreCommitted) {
          setTrashUndo(null);
          setSelectedIds(new Set());
          setMessage(`${successMessage}，但列表刷新失败，可稍后刷新:${describeSafeError(e)}`);
          window.dispatchEvent(new Event("aurascholar:library-updated"));
        } else {
          setMessage(`撤销移入回收站失败，撤销入口仍保留，可重新撤销:${describeSafeError(e)}`);
        }
      }
    } finally {
      releaseWorkMutation(mutationGrant);
    }
  }, [
    acquireWorkMutation,
    activeFilter,
    previewTrashItems,
    refresh,
    releaseWorkMutation,
    selectedWorkId,
    trashUndo,
  ]);

  // Reset to first page whenever the filtered set changes shape.
  useEffect(() => {
    if (skipNextPageResetRef.current) {
      skipNextPageResetRef.current = false;
      return;
    }
    setPage(0);
  }, [activeFilter, activeSource, activeTag, activeCollection, extraFilter, search, sortMode]);

  const selectWork = useCallback(
    (work: WorkWithAuthors) => {
      cancelCurrentRouteRequest();
      setSelectedWorkId(work.id);
      if (window.matchMedia("(max-width: 760px)").matches) {
        requestAnimationFrame(() => {
          contextPanelRef.current?.scrollIntoView({
            block: "start",
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
          });
        });
      }
    },
    [cancelCurrentRouteRequest],
  );

  const closeSelectedWork = useCallback(() => {
    cancelCurrentRouteRequest();
    const closingWorkId = selectedWorkId;
    setPage(safePage);
    setSelectedWorkId(null);
    if (!closingWorkId) return;
    requestAnimationFrame(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>("[data-library-row-id]")).find(
        (candidate) => candidate.dataset.libraryRowId === closingWorkId,
      );
      row?.focus({ preventScroll: true });
    });
  }, [cancelCurrentRouteRequest, safePage, selectedWorkId, setPage, setSelectedWorkId]);

  const openReader = useCallback(
    (work: WorkWithAuthors) => {
      setSelectedWorkId(work.id);
      navigate(`/reader?work=${encodeURIComponent(work.id)}`);
    },
    [navigate],
  );

  const openKnowledgeSearchResult = useCallback(
    async (result: KnowledgeContentSearchResult) => {
      const workId = result.workId?.trim();
      if (!workId) {
        setMessage("该检索结果没有可打开的文献来源。");
        return;
      }
      try {
        const readerPath = await resolveKnowledgeSearchReaderPath(result);
        if (!readerPath) {
          setMessage("该检索结果的原始 PDF 修订不可用，未跳转到其他版本。");
          return;
        }
        setSelectedWorkId(workId);
        navigate(readerPath);
      } catch (cause) {
        setMessage(`打开检索来源失败:${describeSafeError(cause)}`);
      }
    },
    [navigate],
  );

  const focusPagedRow = useCallback((index: number) => {
    pendingKeyboardFocusIndexRef.current = index;
    const focusRow = () => {
      const row = document.querySelector<HTMLElement>(`[data-library-row-index="${index}"]`);
      if (!row) return false;
      row.focus();
      return document.activeElement === row;
    };
    focusRow();
    requestAnimationFrame(() => {
      if (!focusRow()) requestAnimationFrame(focusRow);
    });
    window.setTimeout(focusRow, 0);
    window.setTimeout(focusRow, 80);
  }, []);

  useEffect(() => {
    const index = pendingKeyboardFocusIndexRef.current;
    if (index === null) return;
    const focusRow = () => {
      const row = document.querySelector<HTMLElement>(`[data-library-row-index="${index}"]`);
      if (!row) return false;
      row.focus();
      return document.activeElement === row;
    };
    if (focusRow()) {
      pendingKeyboardFocusIndexRef.current = null;
      return;
    }
    const timeout = window.setTimeout(() => {
      if (focusRow()) pendingKeyboardFocusIndexRef.current = null;
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pagedRows, safePage, selectedWorkId]);

  const moveKeyboardSelection = useCallback(
    (index: number, nextIndex: number) => {
      if (pagedRows.length === 0) return;
      const clamped = Math.min(Math.max(nextIndex, 0), pagedRows.length - 1);
      const next = pagedRows[clamped];
      if (!next || clamped === index) return;
      cancelCurrentRouteRequest();
      setSelectedWorkId(next.id);
      focusPagedRow(clamped);
    },
    [cancelCurrentRouteRequest, focusPagedRow, pagedRows],
  );

  // --- Multi-select & bulk operations -------------------------------------
  const toggleRowSelected = useCallback(
    (workId: string) => {
      cancelCurrentRouteRequest();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(workId)) next.delete(workId);
        else next.add(workId);
        return next;
      });
    },
    [cancelCurrentRouteRequest],
  );

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, work: WorkWithAuthors, index: number) => {
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
      if (event.target !== event.currentTarget) return;
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
    if (actionableSelectedIds.length === 0) {
      setMessage("请先勾选要添加标签的文献");
      return;
    }
    const workIds = [...actionableSelectedIds];
    setTextPrompt({
      title: "添加标签",
      label: "标签名称",
      placeholder: "例如：必读 / 方法 / 综述",
      confirmLabel: "添加",
      pendingLabel: "添加中...",
      description: `将标签添加到已选的 ${workIds.length} 篇文献。`,
      onSubmit: async (value) => {
        const name = value.trim();
        if (!isDesktopRuntime()) {
          setPreviewWorkMeta((current) => {
            const next = { ...current };
            for (const workId of workIds) {
              const previous = current[workId] ?? emptyWorkMeta();
              next[workId] = {
                ...previous,
                tags: previous.tags.includes(name) ? previous.tags : [...previous.tags, name],
              };
            }
            return next;
          });
          setWorkMeta((current) => {
            const next = { ...current };
            for (const workId of workIds) {
              const previous = current[workId] ?? emptyWorkMeta();
              next[workId] = {
                ...previous,
                tags: previous.tags.includes(name) ? previous.tags : [...previous.tags, name],
              };
            }
            return next;
          });
          setSelectedIds(new Set());
          setMessage(`已在预览中为 ${workIds.length} 篇文献添加标签「${name}」`);
          return;
        }
        const startedAt = Date.now();
        const successMessage = `已为 ${workIds.length} 篇文献添加标签「${name}」`;
        let tagCommitted = false;
        try {
          const smokeFailureAfterFirst = consumeLibrarySmokeBulkTagAfterFirstFailure();
          if (smokeFailureAfterFirst) throw smokeFailureAfterFirst;
          await addLibraryTagToWorks(workIds, name);
          tagCommitted = true;
          await waitForMinimumElapsed(startedAt, MIN_BULK_TAG_BUSY_MS);
          setMessage(successMessage);
          setSelectedIds(new Set());
          const refreshFailure = await refresh();
          if (refreshFailure) throw refreshFailure;
        } catch (e) {
          await waitForMinimumElapsed(startedAt, MIN_BULK_TAG_BUSY_MS);
          if (tagCommitted) {
            setMessage(`${successMessage}，但列表刷新失败，可稍后刷新:${describeSafeError(e)}`);
            setSelectedIds(new Set());
            window.dispatchEvent(new Event("aurascholar:library-updated"));
            return;
          }
          const message = `添加标签失败，所选文献和标签仍保持原状，可重新添加:${describeSafeError(e)}`;
          setMessage(message);
          throw new Error(message, { cause: e });
        }
      },
    });
  }, [actionableSelectedIds, refresh]);

  const bulkMoveToCollection = useCallback(async () => {
    if (actionableSelectedIds.length === 0) {
      setMessage("请先勾选要移动的文献");
      return;
    }
    if (!isDesktopRuntime()) {
      setMessage("预览模式下不会写入本地数据库");
      return;
    }
    setMoveDialogOpen(true);
  }, [actionableSelectedIds.length]);

  const moveSelectedToCollection = useCallback(
    async (target: string | null, targetName: string): Promise<boolean> => {
      if (actionableSelectedIds.length === 0 || !isDesktopRuntime()) return false;
      const workIds = [...actionableSelectedIds];
      const startedAt = Date.now();
      const successMessage = target
        ? `已移动 ${workIds.length} 篇文献到「${targetName}」`
        : `已将 ${workIds.length} 篇文献移出所有文件夹`;
      let moveCommitted = false;
      try {
        const smokeFailureAfterFirst = consumeLibrarySmokeMoveAfterFirstFailure();
        if (smokeFailureAfterFirst) throw smokeFailureAfterFirst;
        await setWorksLibraryCollection(workIds, target);
        moveCommitted = true;
        await waitForMinimumElapsed(startedAt, MIN_MOVE_ACTION_BUSY_MS);
        setMessage(successMessage);
        setSelectedIds(new Set());
        const refreshFailure = await refresh();
        if (refreshFailure) throw refreshFailure;
        return true;
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_MOVE_ACTION_BUSY_MS);
        if (moveCommitted) {
          setMessage(`${successMessage}，但列表刷新失败，可稍后刷新:${describeSafeError(e)}`);
          setSelectedIds(new Set());
          window.dispatchEvent(new Event("aurascholar:library-updated"));
          return true;
        }
        setMessage(`移动文件夹失败，所选文献仍保留在原文件夹，可重新移动:${describeSafeError(e)}`);
        return false;
      }
    },
    [actionableSelectedIds, refresh],
  );

  const bulkDelete = useCallback(async () => {
    if (actionableSelectedIds.length === 0) return;
    const mutationGrant = acquireWorkMutation("trash");
    if (!mutationGrant) return;
    const workIds = [...actionableSelectedIds];
    try {
      const confirmed = await confirm({
        title: "批量移入回收站？",
        description: `将选中的 ${workIds.length} 篇文献移入回收站。`,
        details: [
          "这些文献之后可以从回收站恢复。",
          "永久删除前，关联 PDF、批注、标签和其他研究数据都会保留。",
        ],
        confirmLabel: `移入 ${workIds.length} 篇`,
        tone: "warning",
      });
      if (!confirmed) return;
      if (!isDesktopRuntime()) {
        const deleteIds = new Set(workIds);
        const deletedAt = Date.now();
        const movedWorks = previewItems
          .filter((work) => deleteIds.has(work.id))
          .map((work) => ({ ...work, deleted_at: deletedAt, updated_at: deletedAt }));
        const undoMessage = `已将 ${movedWorks.length} 篇文献移入预览回收站`;
        setPreviewItems((current) => current.filter((work) => !deleteIds.has(work.id)));
        setPreviewTrashItems((current) => [
          ...movedWorks,
          ...current.filter((work) => !deleteIds.has(work.id)),
        ]);
        setItems((current) => current.filter((work) => !deleteIds.has(work.id)));
        setTrashCount((current) => current + movedWorks.length);
        setTrashUndo({
          count: movedWorks.length,
          ids: movedWorks.map((work) => work.id),
          message: undoMessage,
        });
        setSelectedIds(new Set());
        setMessage(undoMessage);
        return;
      }
      const startedAt = Date.now();
      setMessage(`正在将 ${workIds.length} 篇文献移入回收站...`);
      const undoMessage = `已将 ${workIds.length} 篇文献移入回收站`;
      let trashCommitted = false;
      try {
        await trashLibraryWorks(workIds);
        trashCommitted = true;
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        const refreshFailure = await refresh();
        if (refreshFailure) throw refreshFailure;
        setMessage(undoMessage);
        setTrashUndo({ count: workIds.length, ids: workIds, message: undoMessage });
        setSelectedIds(new Set());
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        if (trashCommitted) {
          setMessage(
            `${undoMessage}，但列表刷新失败，可点击撤销或稍后刷新:${describeSafeError(e)}`,
          );
          setTrashUndo({ count: workIds.length, ids: workIds, message: undoMessage });
          setSelectedIds(new Set());
          window.dispatchEvent(new Event("aurascholar:library-updated"));
        } else {
          setMessage(
            `批量移入回收站失败，所选文献仍保留，可重新移入回收站:${describeSafeError(e)}`,
          );
        }
      }
    } finally {
      releaseWorkMutation(mutationGrant);
    }
  }, [
    acquireWorkMutation,
    actionableSelectedIds,
    confirm,
    previewItems,
    refresh,
    releaseWorkMutation,
  ]);

  const restoreWorks = useCallback(
    async (workIds: string[]) => {
      if (workIds.length === 0) return;
      const mutationGrant = acquireWorkMutation("restore");
      if (!mutationGrant) return;
      try {
        if (!isDesktopRuntime()) {
          const restoreIds = new Set(workIds);
          const restored = previewTrashItems
            .filter((work) => restoreIds.has(work.id))
            .map((work) => ({ ...work, deleted_at: null, updated_at: Date.now() }));
          setPreviewTrashItems((current) => current.filter((work) => !restoreIds.has(work.id)));
          setPreviewItems((current) => [...restored, ...current]);
          setItems((current) =>
            activeFilter === "trash"
              ? current.filter((work) => !restoreIds.has(work.id))
              : [...restored, ...current],
          );
          setTrashCount((current) => Math.max(0, current - restored.length));
          setTrashUndo((current) => reconcileTrashUndo(current, workIds));
          setSelectedIds(new Set());
          if (restored[0]) setPage(0);
          setSelectedWorkId(restored[0]?.id ?? selectedWorkId);
          setMessage(`已从预览回收站恢复 ${restored.length} 篇文献`);
          return;
        }
        const startedAt = Date.now();
        setMessage(`正在恢复 ${workIds.length} 篇文献...`);
        const successMessage = `已恢复 ${workIds.length} 篇文献`;
        let restoreCommitted = false;
        try {
          await restoreLibraryWorks(workIds);
          restoreCommitted = true;
          await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
          const refreshFailure = await refresh();
          if (refreshFailure) throw refreshFailure;
          setTrashUndo((current) => reconcileTrashUndo(current, workIds));
          setMessage(successMessage);
          setSelectedIds(new Set());
          window.dispatchEvent(new Event("aurascholar:library-updated"));
        } catch (e) {
          await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
          if (restoreCommitted) {
            setTrashUndo((current) => reconcileTrashUndo(current, workIds));
            setMessage(`${successMessage}，但列表刷新失败，可稍后刷新:${describeSafeError(e)}`);
            setSelectedIds(new Set());
            window.dispatchEvent(new Event("aurascholar:library-updated"));
          } else {
            setMessage(`恢复文献失败，所选文献仍保留在回收站，可重新恢复:${describeSafeError(e)}`);
          }
        }
      } finally {
        releaseWorkMutation(mutationGrant);
      }
    },
    [
      acquireWorkMutation,
      activeFilter,
      previewTrashItems,
      refresh,
      releaseWorkMutation,
      selectedWorkId,
    ],
  );

  const purgeWorks = useCallback(
    async (workIds: string[]) => {
      if (workIds.length === 0) return;
      const mutationGrant = acquireWorkMutation("purge");
      if (!mutationGrant) return;
      try {
        if (!isDesktopRuntime()) {
          setMessage("浏览器预览不会永久删除文献；可以恢复回收站文献，或刷新页面重置演示数据。");
          return;
        }
        const confirmed = await confirm({
          title: "永久删除文献？",
          description: `将永久删除 ${workIds.length} 篇回收站文献。`,
          details: [
            "这会移除文献库记录、PDF 关联、批注、标签、笔记和引用关联。",
            "内容寻址的本地文件当前不会立即从磁盘回收。",
            "该操作不能撤销。",
          ],
          confirmationHelp: "输入“永久删除”后才会启用确认按钮。",
          confirmationPhrase: "永久删除",
          confirmLabel: "永久删除",
          tone: "danger",
        });
        if (!confirmed) return;
        const startedAt = Date.now();
        setMessage(`正在永久删除 ${workIds.length} 篇文献...`);
        const successMessage = `已永久删除 ${workIds.length} 篇文献`;
        let purgeCommitted = false;
        try {
          await purgeLibraryWorks(workIds);
          purgeCommitted = true;
          await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
          const refreshFailure = await refresh();
          if (refreshFailure) throw refreshFailure;
          setTrashUndo((current) => reconcileTrashUndo(current, workIds));
          setMessage(successMessage);
          setSelectedIds(new Set());
          window.dispatchEvent(new Event("aurascholar:library-updated"));
        } catch (e) {
          await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
          if (purgeCommitted) {
            setTrashUndo((current) => reconcileTrashUndo(current, workIds));
            setMessage(`${successMessage}，但列表刷新失败，可稍后刷新:${describeSafeError(e)}`);
            setSelectedIds(new Set());
            window.dispatchEvent(new Event("aurascholar:library-updated"));
          } else {
            setMessage(
              `永久删除失败，所选文献仍保留在回收站，可重新永久删除:${describeSafeError(e)}`,
            );
          }
        }
      } finally {
        releaseWorkMutation(mutationGrant);
      }
    },
    [acquireWorkMutation, confirm, refresh, releaseWorkMutation],
  );

  const bulkMerge = useCallback(async () => {
    if (actionableSelectedIds.length < 2 || !isDesktopRuntime()) return;
    if (!selectedWork || !actionableSelectedIds.includes(selectedWork.id)) {
      setMessage("请先在已勾选的文献中点选一篇作为主记录，再执行合并");
      return;
    }
    const mutationGrant = acquireWorkMutation("merge");
    if (!mutationGrant) return;
    const duplicates = actionableSelectedIds.filter((id) => id !== selectedWork.id);
    const titles = items
      .filter((work) => duplicates.includes(work.id))
      .slice(0, 4)
      .map((work) => `《${work.title}》`)
      .join("、");
    try {
      const confirmed = await confirm({
        title: "合并重复文献？",
        description: `将 ${duplicates.length} 篇重复文献合并到主记录《${selectedWork.title}》。`,
        details: [
          "PDF、批注、标签、摘录、文件夹、引文、衍生数据和哨兵任务会迁移到主记录。",
          "主记录的题名与作者优先保留，重复项会移入回收站。",
          titles ? `重复项：${titles}${duplicates.length > 4 ? "…" : ""}` : null,
        ],
        confirmLabel: "确认合并",
        tone: "warning",
      });
      if (!confirmed) return;
      const startedAt = Date.now();
      setMessage(`正在合并 ${duplicates.length} 篇重复文献到《${selectedWork.title}》...`);
      try {
        const result = await mergeLibraryWorks(selectedWork.id, duplicates);
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        const successMessage = `已合并 ${result.merged} 篇重复文献到《${selectedWork.title}》${
          result.movedAttachments ? `，迁移 ${result.movedAttachments} 个附件` : ""
        }`;
        setMessage(successMessage);
        setSelectedIds(new Set());
        try {
          const refreshFailure = await refresh();
          if (refreshFailure) throw refreshFailure;
        } catch (e) {
          setMessage(`${successMessage}，但列表刷新失败，可稍后刷新:${describeSafeError(e)}`);
        }
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        setMessage(`合并失败，主记录和重复文献仍保持原状，可重新合并:${describeSafeError(e)}`);
      }
    } finally {
      releaseWorkMutation(mutationGrant);
    }
  }, [
    acquireWorkMutation,
    actionableSelectedIds,
    confirm,
    items,
    refresh,
    releaseWorkMutation,
    selectedWork,
  ]);

  const handleExportCitations = useCallback(
    async (format: ExportFormat) => {
      if (actionableSelectedIds.length === 0 || citationBusy) return;
      const workIds = [...actionableSelectedIds];
      const startedAt = Date.now();
      setCitationBusy("export");
      if (!isDesktopRuntime()) {
        const works = workIds
          .map((workId) => previewWorksById.get(workId))
          .filter((work): work is WorkWithAuthors => Boolean(work));
        if (works.length === 0) {
          setCitationBusy(null);
          setMessage("没有可导出的预览文献");
          return;
        }
        setMessage(`正在导出 ${works.length} 篇预览文献的引用...`);
        try {
          const content = previewCitationContent(works, format);
          const mime = format === "csljson" ? "application/json" : "text/plain;charset=utf-8";
          downloadBlob(new Blob([content], { type: mime }), previewCitationFilename(format));
          await waitForMinimumElapsed(startedAt, MIN_CITATION_BUSY_MS);
          setMessage(`已导出 ${works.length} 篇预览文献的引用(${format.toUpperCase()})`);
        } catch (e) {
          setMessage(`导出预览引用失败:${describeSafeError(e)}`);
        } finally {
          setCitationBusy(null);
        }
        return;
      }
      const count = workIds.length;
      setMessage(`正在导出 ${count} 篇文献的引用...`);
      try {
        const { exportWorks } = await import("../services/cite");
        await exportWorks(workIds, format);
        await waitForMinimumElapsed(startedAt, MIN_CITATION_BUSY_MS);
        setMessage(`已导出 ${count} 篇文献的引用(${format.toUpperCase()})`);
      } catch (e) {
        setMessage(`导出失败:${describeSafeError(e)}`);
      } finally {
        setCitationBusy(null);
      }
    },
    [actionableSelectedIds, citationBusy, previewWorksById],
  );

  const handleCopyBibliography = useCallback(
    async (styleId: string) => {
      if (actionableSelectedIds.length === 0 || citationBusy) return;
      const workIds = [...actionableSelectedIds];
      const startedAt = Date.now();
      setCitationBusy("copy");
      if (!isDesktopRuntime()) {
        const works = workIds
          .map((workId) => previewWorksById.get(workId))
          .filter((work): work is WorkWithAuthors => Boolean(work));
        if (works.length === 0) {
          setCitationBusy(null);
          setMessage("没有可复制的预览文献");
          return;
        }
        setMessage(`正在复制 ${works.length} 条预览参考文献...`);
        try {
          await writeClipboardText(previewBibliographyText(works, styleId));
          await waitForMinimumElapsed(startedAt, MIN_CITATION_BUSY_MS);
          setMessage(`已复制 ${works.length} 条预览参考文献到剪贴板`);
        } catch (e) {
          setMessage(`复制预览参考文献失败:${describeSafeError(e)}`);
        } finally {
          setCitationBusy(null);
        }
        return;
      }
      const count = workIds.length;
      setMessage(`正在复制 ${count} 条参考文献...`);
      try {
        const { bibliographyText } = await import("../services/cite");
        const text = await bibliographyText(workIds, styleId);
        await writeClipboardText(text);
        await waitForMinimumElapsed(startedAt, MIN_CITATION_BUSY_MS);
        setMessage(`已复制 ${count} 条参考文献到剪贴板`);
      } catch (e) {
        setMessage(`复制失败:${describeSafeError(e)}`);
      } finally {
        setCitationBusy(null);
      }
    },
    [actionableSelectedIds, citationBusy, previewWorksById],
  );

  const handleRefsFile = useCallback(async (file: File) => {
    if (!isDesktopRuntime()) {
      setMessage("浏览器预览不会批量导入题录文件；当前示例文献仍可试用整理、阅读入口和导出。");
      return;
    }
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
      setMessage(`解析失败:${describeSafeError(e)}`);
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
        setMessage("请一次拖入一个 PDF 或一个题录文件，避免误入库");
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

  const handleQuickDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    quickDropDepthRef.current += 1;
    setQuickDropActive(true);
  }, []);

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
    if (!importPreview || !isDesktopRuntime()) {
      setImportPreview(null);
      if (!isDesktopRuntime()) setMessage("预览模式下不会写入本地数据库");
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
      setMessage(`导入失败，当前文献库未写入部分导入，可重新导入:${describeSafeError(e)}`);
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
  }, [setActiveCollection, setActiveFilter, setActiveSource, setActiveTag, setExtraFilter]);

  const openBreadcrumbCollection = useCallback(
    (collectionId: string) => {
      setActiveFilter("all");
      setActiveCollection(collectionId);
      setActiveTag(null);
      setActiveSource(null);
      setExtraFilter(null);
      setSelectedIds(new Set());
    },
    [setActiveCollection, setActiveFilter, setActiveSource, setActiveTag, setExtraFilter],
  );

  const activateManagedCollection = useCallback(
    (collectionId: string, reason: CollectionActivationReason) => {
      setActiveFilter("all");
      setActiveCollection(collectionId);
      setActiveTag(null);
      setActiveSource(null);
      setSelectedIds(new Set());
      if (reason === "restore") {
        setExtraFilter(null);
      }
    },
    [setActiveCollection, setActiveFilter, setActiveSource, setActiveTag, setExtraFilter],
  );

  const clearManagedActiveCollection = useCallback(() => {
    setActiveCollection(null);
    setSelectedIds(new Set());
  }, [setActiveCollection]);

  const previewMoveCollection = useCallback((detail: MoveCollectionEventDetail) => {
    setCollections((current) => moveCollectionRows(current, detail));
  }, []);

  const selectManagedCollectionView = useCallback(
    (target: CollectionManagerViewTarget) => {
      if (target.kind === "all") {
        clearLibraryView();
        return;
      }
      if (target.kind === "collection") {
        openBreadcrumbCollection(target.collectionId);
        return;
      }
      setActiveFilter("trash");
      setActiveCollection(null);
      setActiveTag(null);
      setActiveSource(null);
      setExtraFilter(null);
      setSelectedIds(new Set());
    },
    [
      clearLibraryView,
      openBreadcrumbCollection,
      setActiveCollection,
      setActiveFilter,
      setActiveSource,
      setActiveTag,
      setExtraFilter,
    ],
  );

  const clearInlineSearch = useCallback(() => {
    setSearch("");
    setSelectedIds(new Set());
    searchInputRef.current?.focus();
  }, [setSearch]);

  const requestPdfImport = useCallback(() => {
    if (!isDesktopRuntime()) {
      setMessage("浏览器预览不会导入 PDF；当前示例文献仍可试用整理、阅读入口和导出。");
      return;
    }
    fileInputRef.current?.click();
  }, []);

  const requestReferenceImport = useCallback(() => {
    if (!isDesktopRuntime()) {
      setMessage("浏览器预览不会批量导入题录文件；当前示例文献仍可试用整理、阅读入口和导出。");
      return;
    }
    refsInputRef.current?.click();
  }, []);

  const requestSelectedPdfUpload = useCallback(() => {
    if (!isDesktopRuntime()) {
      setMessage("浏览器预览不会上传 PDF；请在桌面应用中为真实文献补全文。");
      return;
    }
    selectedPdfInputRef.current?.click();
  }, []);
  const visibleNoticeMessage = message ?? trashUndo?.message ?? null;

  return (
    <div
      className="library-page"
      data-library-dropzone="imports"
      onDragEnter={handleQuickDragEnter}
      onDragOver={handleQuickDragOver}
      onDragLeave={handleQuickDragLeave}
      onDragEnd={resetQuickDropState}
      onDrop={handleQuickDrop}
    >
      <h1 className="sr-only">文献库</h1>
      <div
        className={`library-topbar ${
          selectedWork ? "library-topbar--detail-open" : "library-topbar--detail-closed"
        } ${quickDropActive ? "library-topbar--drop-active" : ""}`}
      >
        <div className="library-topbar__main">
          <div className="library-list-header__copy">
            <nav className="library-breadcrumb" aria-label="当前位置">
              {isTrashView ? (
                <span className="library-breadcrumb__current" aria-current="page">
                  回收站
                </span>
              ) : activeCollectionRow ? (
                <>
                  <button type="button" onClick={clearLibraryView}>
                    全部文献
                  </button>
                  {activeCollectionPath.map((collection, index) => {
                    const isCurrent = index === activeCollectionPath.length - 1;
                    return (
                      <span className="library-breadcrumb__item" key={collection.id}>
                        <span className="library-breadcrumb__separator" aria-hidden="true">
                          /
                        </span>
                        {isCurrent ? (
                          <span className="library-breadcrumb__current" aria-current="page">
                            {collection.name}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openBreadcrumbCollection(collection.id)}
                          >
                            {collection.name}
                          </button>
                        )}
                      </span>
                    );
                  })}
                </>
              ) : activeFilter !== "all" ? (
                <>
                  <button type="button" onClick={clearLibraryView}>
                    全部文献
                  </button>
                  <span className="library-breadcrumb__separator" aria-hidden="true">
                    /
                  </span>
                  <span className="library-breadcrumb__current" aria-current="page">
                    阅读状态
                  </span>
                </>
              ) : (
                <span className="library-breadcrumb__current" aria-current="page">
                  全部文献
                </span>
              )}
            </nav>
            <div className="library-view-title-row">
              <h2>{viewTitle}</h2>
              <span>{viewSubtitle}</span>
            </div>
          </div>
          <div className="library-inline-search library-inline-search--header">
            <input
              ref={searchInputRef}
              className="au-input"
              aria-label={isTrashView ? "搜索回收站文献" : "搜索当前文献结果"}
              placeholder={isTrashView ? "搜索回收站" : "在结果中搜索"}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelectedIds(new Set());
              }}
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
                if (e.key === "Escape" && search) {
                  e.preventDefault();
                  clearInlineSearch();
                }
              }}
            />
            {search ? (
              <button
                type="button"
                className="library-inline-search__clear"
                aria-label="清除文献搜索"
                title="清除搜索"
                onClick={clearInlineSearch}
              >
                ×
              </button>
            ) : (
              <span className="au-kbd">{findShortcut}</span>
            )}
          </div>
        </div>
        <div className="library-topbar__actions">
          <Button
            data-library-action="open-import"
            onClick={() => setImportDialogOpen(true)}
            disabled={busy}
            title="通过链接、PDF 或题录文件导入文献"
          >
            导入文献
          </Button>
          <LibraryActionIconButton
            action="refresh"
            label="重新载入本地数据"
            icon="refresh"
            onClick={() => void refresh()}
          />
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
      <KnowledgeSearchPanel enabled={isDesktopRuntime()} onOpenResult={openKnowledgeSearchResult} />
      <LocalSemanticIndexControl enabled={isDesktopRuntime()} />
      <KnowledgeIndexPlanner enabled={isDesktopRuntime()} />
      {trashUndo ? (
        <InlineNotice
          className={`library-command__message ${
            message && messageLeaving ? "library-command__message--leaving" : ""
          }`}
          message={visibleNoticeMessage}
          onDismiss={() => {
            if (!message || message === trashUndo.message) setTrashUndo(null);
            setMessage(null);
          }}
        >
          <span className="library-command__message-text">{visibleNoticeMessage}</span>
          <button
            type="button"
            className="library-command__message-action"
            onClick={() => void undoTrash()}
            disabled={Boolean(workActionBusy)}
            aria-busy={workActionBusy === "restore" ? "true" : undefined}
            aria-label="撤销移入回收站"
          >
            {workActionBusy === "restore" ? "撤销中..." : "撤销"}
          </button>
        </InlineNotice>
      ) : (
        <InlineNotice
          className={`library-command__message ${
            messageLeaving ? "library-command__message--leaving" : ""
          }`}
          message={message}
          onDismiss={() => setMessage(null)}
        />
      )}

      {actionableSelectedIds.length > 0 && (
        <LibraryBulkActionBar
          busy={busy}
          citationBusy={citationBusy}
          isTrashView={isTrashView}
          onAddTag={bulkAddTag}
          onAddToProject={() =>
            addWorksToProject(actionableSelectedIds, `${actionableSelectedIds.length} 篇已选文献`)
          }
          onClear={() => setSelectedIds(new Set())}
          onCopyBibliography={handleCopyBibliography}
          onDelete={bulkDelete}
          onExportCitations={handleExportCitations}
          onMerge={bulkMerge}
          onMoveToCollection={bulkMoveToCollection}
          onPurge={() => purgeWorks(actionableSelectedIds)}
          onRestore={() => restoreWorks(actionableSelectedIds)}
          projectIngressBusy={projectIngressBusy}
          selectedCount={actionableSelectedIds.length}
          workActionBusy={workActionBusy}
        />
      )}

      <div
        className={`app-workspace ${
          selectedWork ? "app-workspace--detail-open" : "app-workspace--detail-closed"
        }`}
      >
        <div className="library-main">
          {isTrashView ? (
            <div className="library-refinebar library-refinebar--trash">
              <span>已删除文献</span>
              <button className="library-filter-button" type="button" onClick={clearLibraryView}>
                返回全部文献
              </button>
            </div>
          ) : (
            <>
              <div className="library-refinebar">
                <div
                  className="library-tabs library-tabs--compact"
                  role="group"
                  aria-label="阅读状态筛选"
                >
                  {(
                    [
                      ["all", "全部", totalDisplay],
                      ["unread", "未读", unreadCount],
                      ["reading", "阅读中", readingCount],
                      ["noted", "有笔记", notedCount],
                      ["starred", "重点", starredCount],
                    ] as const
                  ).map(([filter, label, count]) => (
                    <button
                      key={filter}
                      aria-pressed={activeFilter === filter}
                      className={`library-tab ${
                        activeFilter === filter ? "library-tab--active" : ""
                      }`}
                      type="button"
                      onClick={() => {
                        setActiveFilter(filter);
                        setSelectedIds(new Set());
                      }}
                    >
                      {label} <span>{count}</span>
                    </button>
                  ))}
                </div>
                <div className="library-refinebar__actions">
                  <label className="library-tag-filter">
                    <span>标签</span>
                    <select
                      aria-label="按标签筛选文献"
                      value={activeTag ?? ""}
                      onChange={(event) => {
                        setActiveTag(event.target.value || null);
                        setSelectedIds(new Set());
                      }}
                    >
                      <option value="">全部标签</option>
                      {availableTags.map((tag) => (
                        <option key={tag} value={tag}>
                          {tag}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="library-filter-button library-filter-button--compact"
                    type="button"
                    onClick={() => setTagManagerIntent("manage")}
                    aria-label="管理标签"
                    title="管理标签"
                  >
                    管理
                  </button>
                  <button
                    className={`library-filter-button ${
                      advancedFacetCount > 0 ? "library-filter-button--active" : ""
                    }`}
                    type="button"
                    onClick={() => setAdvancedFilterOpen(true)}
                    aria-label={`更多筛选${advancedFacetCount > 0 ? `，已启用 ${advancedFacetCount} 项` : ""}`}
                  >
                    筛选{advancedFacetCount > 0 ? ` ${advancedFacetCount}` : ""}
                  </button>
                  <span className="library-refinebar__divider" aria-hidden="true" />
                  <button
                    className="library-filter-button library-filter-button--sort"
                    type="button"
                    onClick={() => setSortMode(sortMode === "year" ? "added" : "year")}
                    aria-label={`当前按${sortMode === "year" ? "发表时间" : "添加时间"}排序，点击切换`}
                  >
                    <span>排序</span>
                    {sortMode === "year" ? "发表时间" : "添加时间"}
                  </button>
                  {hasActiveLibraryFilter && (
                    <button
                      className="library-filter-button library-filter-button--compact"
                      type="button"
                      onClick={clearLibraryView}
                      aria-label="清除所有筛选条件"
                    >
                      清除
                    </button>
                  )}
                  <button
                    className="library-filter-button library-filter-button--trash"
                    type="button"
                    onClick={() => {
                      setActiveFilter("trash");
                      setActiveCollection(null);
                      setActiveTag(null);
                      setActiveSource(null);
                      setExtraFilter(null);
                      setSelectedIds(new Set());
                    }}
                    title="查看回收站"
                  >
                    回收站
                  </button>
                </div>
              </div>

              {(activeCollectionRow || activeTag || activeSource || extraFilter) && (
                <div className="library-active-filters" aria-label="当前筛选条件">
                  <span>当前范围</span>
                  {activeCollectionRow && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveCollection(null);
                        setSelectedIds(new Set());
                      }}
                      aria-label={`移除文件夹筛选 ${activeCollectionRow.name}`}
                    >
                      文件夹 · {activeCollectionPath.map((item) => item.name).join(" / ")}
                      <b aria-hidden="true">×</b>
                    </button>
                  )}
                  {activeTag && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTag(null);
                        setSelectedIds(new Set());
                      }}
                      aria-label={`移除标签筛选 ${activeTag}`}
                    >
                      标签 · {activeTag}
                      <b aria-hidden="true">×</b>
                    </button>
                  )}
                  {activeSource && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSource(null);
                        setSelectedIds(new Set());
                      }}
                      aria-label={`移除来源筛选 ${activeSource}`}
                    >
                      来源 · {activeSource}
                      <b aria-hidden="true">×</b>
                    </button>
                  )}
                  {extraFilter && (
                    <button
                      type="button"
                      onClick={() => {
                        setExtraFilter(null);
                        setSelectedIds(new Set());
                      }}
                      aria-label={`移除筛选 ${extraFilterLabel(extraFilter)}`}
                    >
                      {extraFilterLabel(extraFilter)}
                      <b aria-hidden="true">×</b>
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {libraryLoadError && items.length === 0 ? (
            <LibraryLoadErrorState
              error={libraryLoadError}
              onRetry={() => void refresh()}
              onTryExample={fillExamplePaper}
            />
          ) : tableRows.length === 0 ? (
            items.length === 0 && !isTrashView && !activeCollection && !hasSearchQuery ? (
              <LibraryOnboardingEmpty
                busy={busy}
                previewMode={!isDesktopRuntime()}
                onOpenImport={() => setImportDialogOpen(true)}
                onTryExample={fillExamplePaper}
                onOpenSettings={() => navigate("/settings?section=ai")}
                onOpenCanvas={() => navigate("/canvas")}
              />
            ) : (
              <div className="library-empty library-empty--plain au-surface">
                <h3>{plainEmptyTitle}</h3>
                <p className="au-text-muted">{plainEmptyDescription}</p>
                {(hasSearchQuery || hasActiveLibraryFilter) && (
                  <div className="library-empty__actions">
                    {hasSearchQuery && (
                      <Button
                        variant="secondary"
                        type="button"
                        aria-label="清除当前搜索"
                        onClick={clearInlineSearch}
                      >
                        清除搜索
                      </Button>
                    )}
                    {hasActiveLibraryFilter && (
                      <Button
                        variant="secondary"
                        type="button"
                        aria-label="清除当前筛选"
                        onClick={clearLibraryView}
                      >
                        {isTrashView ? "返回全部" : "清除筛选"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="library-table">
              <div className="library-table__head">
                <span>
                  <input
                    ref={pageSelectCheckboxRef}
                    type="checkbox"
                    className="library-checkbox-input"
                    aria-label="全选本页"
                    aria-checked={pageSomeSelected ? "mixed" : pageAllSelected}
                    checked={pageAllSelected}
                    onChange={(e) => {
                      cancelCurrentRouteRequest();
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
                    aria-label={`${selectedWork?.id === w.id ? "当前文献" : "选择文献"}:${w.title}`}
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
                    onClick={() => {
                      cancelCurrentRouteRequest();
                      setSelectedWorkId(null);
                      setPage(Math.max(0, safePage - 1));
                    }}
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
                    onClick={() => {
                      cancelCurrentRouteRequest();
                      setSelectedWorkId(null);
                      setPage(Math.min(pageCount - 1, safePage + 1));
                    }}
                  >
                    下一页
                  </button>
                </div>
                <span className="library-pagination__hint">{PAGE_SIZE} 条 / 页</span>
              </div>
            </div>
          )}
        </div>

        {selectedWork && (
          <aside
            ref={contextPanelRef}
            className="app-context-panel"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              closeSelectedWork();
            }}
          >
            <LibrarySelectedWorkPanel
              key={selectedWork.id}
              work={selectedWork}
              meta={selectedMeta}
              metaStatus={selectedRuntimeMeta.status}
              tableMeta={workMeta[selectedWork.id]}
              isTrashView={isTrashView}
              attachingPdf={attachingPdf}
              workActionBusy={workActionBusy}
              starActionBusyTarget={starActionBusyById[selectedWork.id]}
              readingStatusBusyTarget={
                readingStatusBusy?.workId === selectedWork.id ? readingStatusBusy.status : undefined
              }
              onClose={closeSelectedWork}
              onOpenReader={() => openReader(selectedWork)}
              onRestoreWork={() => void restoreWorks([selectedWork.id])}
              onPurgeWork={() => void purgeWorks([selectedWork.id])}
              onDeleteWork={() => void deleteSelectedWork()}
              onToggleStar={() => void updateWorkStarred(selectedWork, selectedWork.starred !== 1)}
              onSetReadingStatus={(status) => void updateSelectedReadingStatus(status)}
              onUploadPdf={requestSelectedPdfUpload}
              onFindFulltext={() => void handleFindFulltext()}
              findingFulltext={findingFulltext}
              onAddToCanvas={() =>
                void openInCanvas({ workId: selectedWork.id, sourceLabel: selectedWork.title })
              }
              onAddToProject={() => addWorksToProject([selectedWork.id], selectedWork.title)}
              onOpenCanvas={() =>
                void openInCanvas({ workId: selectedWork.id, sourceLabel: selectedWork.title })
              }
              onOpenGraph={() => {
                if (!isDesktopRuntime()) {
                  const graphKey = selectedWork.doi ?? selectedWork.arxiv_id;
                  if (graphKey) {
                    navigate(`/graph?doi=${encodeURIComponent(graphKey)}`);
                  } else {
                    setMessage("这篇文献没有 DOI 或 arXiv ID，暂时无法打开引文图谱");
                  }
                  return;
                }
                if (selectedWork.doi) {
                  navigate(`/graph?doi=${encodeURIComponent(selectedWork.doi)}`);
                } else {
                  setMessage("这篇文献没有 DOI，暂时无法打开引文图谱");
                }
              }}
              onEditMetadata={() => setEditingMetaId(selectedWork.id)}
              projectIngressBusy={projectIngressBusy}
            />
          </aside>
        )}
      </div>

      {editingMetaId && (
        <Suspense fallback={<DialogLoading label="元数据编辑器" />}>
          <MetadataEditor
            workId={isDesktopRuntime() ? editingMetaId : undefined}
            initialDraft={editingPreviewWork ? workToMetadataDraft(editingPreviewWork) : undefined}
            onClose={() => setEditingMetaId(null)}
            onSaved={() => void refresh()}
            onCommit={(patch) => commitPreviewMetadata(editingMetaId, patch)}
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

      {importDialogOpen && (
        <LibraryImportDialog
          value={input}
          busy={busy}
          onValueChange={setInput}
          onClose={() => setImportDialogOpen(false)}
          onImportIdentifier={(value) => {
            setImportDialogOpen(false);
            void handleAdd(value);
          }}
          onImportPdf={() => {
            setImportDialogOpen(false);
            requestPdfImport();
          }}
          onImportReferences={() => {
            setImportDialogOpen(false);
            requestReferenceImport();
          }}
        />
      )}

      <LibraryCollectionManagement
        activeCollection={activeCollection}
        collections={collections}
        confirm={confirm}
        isTrashView={isTrashView}
        trashCount={trashCount}
        activateCollection={activateManagedCollection}
        clearActiveCollection={clearManagedActiveCollection}
        previewMoveCollection={previewMoveCollection}
        refreshLibrary={refresh}
        selectManagerView={selectManagedCollectionView}
        setMessage={setMessage}
      />

      {tagManagerIntent && (
        <TagManager
          initialCreate={tagManagerIntent === "create"}
          onClose={() => setTagManagerIntent(null)}
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
          selectedCount={actionableSelectedIds.length}
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
          activeExtra={extraFilter}
          activeSource={activeSource}
          activeTag={activeTag}
          sources={availableSources}
          tags={availableTags}
          onClose={() => setAdvancedFilterOpen(false)}
          onApply={(filter) => {
            setActiveTag(filter.tag);
            setActiveSource(filter.source);
            setExtraFilter(filter.extra);
            setSelectedIds(new Set());
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

      {targetPicker}
      {projectTargetPicker}
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
        data-library-dialog="reference-import-preview"
        data-modal-root="true"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="library-modal__head">
          <div>
            <Badge variant="accent">待确认</Badge>
            <h2 id={titleId}>批量导入题录</h2>
          </div>
          <button
            type="button"
            className="library-modal__close"
            data-library-action="cancel-reference-import"
            onClick={requestClose}
            aria-label="关闭批量导入题录"
            title="关闭批量导入题录"
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
            正在导入题录...
          </p>
        )}
        <div className="library-modal-actions reference-import-preview__actions">
          <Button
            data-autofocus="true"
            data-library-action="confirm-reference-import"
            onClick={onConfirm}
            disabled={importing}
            aria-busy={importing}
          >
            {importing ? "导入中…" : `导入 ${count} 条`}
          </Button>
          <Button
            variant="secondary"
            data-library-action="cancel-reference-import"
            onClick={requestClose}
            disabled={importing}
          >
            取消
          </Button>
        </div>
      </section>
    </div>
  );
}

function LibraryLoadErrorState({
  error,
  onRetry,
  onTryExample,
}: {
  error: string;
  onRetry: () => void;
  onTryExample: () => void;
}) {
  return (
    <section className="library-empty library-empty--load-error au-surface" role="alert">
      <Badge variant="danger">读取失败</Badge>
      <h3>文献库暂时不可用</h3>
      <p className="au-text-muted">{error}</p>
      <small>已有文献和附件不会被清空，恢复后可以继续检索、阅读和整理。</small>
      <div className="library-empty__actions">
        <Button type="button" onClick={onRetry} aria-label="重试读取文献库">
          重试读取
        </Button>
        <Button type="button" variant="secondary" onClick={onTryExample}>
          填入 arXiv 示例
        </Button>
      </div>
    </section>
  );
}

function LibraryOnboardingEmpty({
  busy,
  previewMode,
  onOpenImport,
  onTryExample,
  onOpenSettings,
  onOpenCanvas,
}: {
  busy: boolean;
  previewMode: boolean;
  onOpenImport: () => void;
  onTryExample: () => void;
  onOpenSettings: () => void;
  onOpenCanvas: () => void;
}) {
  return (
    <section className="library-empty library-empty--onboarding au-surface">
      <div className="library-onboarding-copy">
        <Badge variant={previewMode ? "warning" : "neutral"}>
          {previewMode ? "Preview" : "Start here"}
        </Badge>
        <h3>把第一篇论文放进工作台</h3>
        <p>
          从 PDF、DOI、arXiv 或 BibTeX/RIS/NBIB/ENW
          题录文件开始；入库后可以直接阅读、提取摘录并放到空间白板中重组。
        </p>
        <div className="library-onboarding-actions">
          <Button onClick={onOpenImport} disabled={busy}>
            导入文献
          </Button>
          <Button variant="secondary" onClick={onTryExample} disabled={busy}>
            填入 arXiv 示例
          </Button>
        </div>
        {previewMode && (
          <p className="library-onboarding-note">
            当前是浏览器预览，整理操作只在本页生效；真实数据库、PDF 附件和 AI
            生成需要在桌面应用中完成。
          </p>
        )}
      </div>

      <div className="library-onboarding-steps" aria-label="首条研究流">
        <OnboardingStep index="01" title="入库" text="识别题名、作者、DOI 与 PDF 附件。" />
        <OnboardingStep index="02" title="阅读" text="打开 PDF，沉淀批注、摘录和状态。" />
        <OnboardingStep index="03" title="关联" text="把文献、摘录和研究想法放进空间白板。" />
        <OnboardingStep index="04" title="综合" text="重组证据链，并用 AI 提炼分歧与研究空白。" />
      </div>

      <div className="library-onboarding-side">
        <strong>开始研究</strong>
        <p>先把文献加入白板；需要合成观点时再启用 AI 服务。</p>
        <div>
          <Button variant="secondary" onClick={onOpenSettings}>
            配置 AI
          </Button>
          <Button variant="secondary" onClick={onOpenCanvas}>
            打开空间白板
          </Button>
        </div>
      </div>
    </section>
  );
}

function LibraryImportDialog({
  value,
  busy,
  onValueChange,
  onClose,
  onImportIdentifier,
  onImportPdf,
  onImportReferences,
}: {
  value: string;
  busy: boolean;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onImportIdentifier: (value: string) => void;
  onImportPdf: () => void;
  onImportReferences: () => void;
}) {
  const [method, setMethod] = useState<ImportMethod>("identifier");
  const dialogRef = useRef<HTMLElement | null>(null);
  const identifierInputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const canSubmitIdentifier = Boolean(value.trim()) && !busy;

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: onClose,
  });

  const selectMethod = (nextMethod: ImportMethod) => {
    setMethod(nextMethod);
    if (nextMethod === "identifier") {
      window.requestAnimationFrame(() => identifierInputRef.current?.focus());
    }
  };

  return (
    <div className="library-modal-overlay" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="library-modal library-import-modal"
        data-library-dialog="import"
        data-modal-root="true"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="library-modal__head">
          <div>
            <Badge variant="accent">Add to library</Badge>
            <h2 id={titleId}>导入文献</h2>
            <p className="library-modal__subhead" id={descriptionId}>
              选择一种来源；识别完成后仍会进入确认流程，不会直接写入文献库。
            </p>
          </div>
          <button
            type="button"
            className="library-modal__close"
            data-library-action="close-import"
            onClick={onClose}
            aria-label="关闭导入文献"
            title="关闭导入文献"
          >
            ×
          </button>
        </div>

        <div className="library-import-methods" role="group" aria-label="选择导入方式">
          {(
            [
              ["identifier", "标识符或链接", "DOI、arXiv、标题或网页"],
              ["pdf", "本地 PDF", "识别元数据并保存全文"],
              ["references", "题录文件", "从 Zotero、EndNote 批量导入"],
            ] as const
          ).map(([methodId, label, description]) => (
            <button
              key={methodId}
              type="button"
              className={method === methodId ? "library-import-method--active" : ""}
              data-library-import-method={methodId}
              aria-pressed={method === methodId}
              onClick={() => selectMethod(methodId)}
            >
              <strong>{label}</strong>
              <span>{description}</span>
            </button>
          ))}
        </div>

        <div className="library-import-panel">
          {method === "identifier" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (canSubmitIdentifier) onImportIdentifier(value.trim());
              }}
            >
              <label htmlFor="library-import-identifier">DOI、arXiv、标题或出版商链接</label>
              <div className="library-import-panel__input-row">
                <input
                  ref={identifierInputRef}
                  id="library-import-identifier"
                  className="au-input"
                  data-autofocus="true"
                  placeholder="例如 10.1038/s41586-021-03819-2"
                  value={value}
                  onChange={(event) => onValueChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && isImeComposing(event)) event.preventDefault();
                  }}
                  disabled={busy}
                />
                <Button
                  type="submit"
                  data-library-action="submit-identifier-import"
                  disabled={!canSubmitIdentifier}
                  aria-busy={busy}
                >
                  {busy ? "识别中…" : "识别并继续"}
                </Button>
              </div>
              <p>适合单篇文献；系统会自动识别来源并补全元数据。</p>
            </form>
          )}

          {method === "pdf" && (
            <div className="library-import-panel__file">
              <div>
                <strong>选择一篇 PDF</strong>
                <span>解析标题、作者和 DOI，并将原文件作为全文附件保存。</span>
              </div>
              <Button type="button" onClick={onImportPdf} data-autofocus="true">
                选择 PDF 文件
              </Button>
            </div>
          )}

          {method === "references" && (
            <div className="library-import-panel__file">
              <div>
                <strong>选择题录文件</strong>
                <span>支持 {REFERENCE_IMPORT_FORMAT_LABEL}，导入前会预览数量并自动去重。</span>
              </div>
              <Button type="button" onClick={onImportReferences} data-autofocus="true">
                选择题录文件
              </Button>
            </div>
          )}
        </div>

        <p className="library-import-modal__drop-note">
          也可以关闭弹窗，直接把文件拖到文献库窗口中。
        </p>
      </section>
    </div>
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
        setError("移动失败，所选文献仍保留，可重新移动。");
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
            aria-label="关闭移动到文件夹"
            title="关闭移动到文件夹"
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
                aria-label={`移动 ${selectedCount} 篇文献到 ${collection.name}，${collection.count.toLocaleString("zh-CN")} 篇`}
                title={collection.name}
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
  activeExtra,
  activeSource,
  activeTag,
  sources,
  tags,
  onApply,
  onClose,
}: {
  activeExtra: ExtraFilter | null;
  activeSource: string | null;
  activeTag: string | null;
  sources: string[];
  tags: string[];
  onApply: (filter: {
    extra: ExtraFilter | null;
    source: string | null;
    tag: string | null;
  }) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [draftTag, setDraftTag] = useState(activeTag ?? "");
  const [draftSource, setDraftSource] = useState(activeSource ?? "");
  const [draftExtra, setDraftExtra] = useState<ExtraFilter | "">(activeExtra ?? "");

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: onClose,
  });

  const extraOptions: Array<{ value: ExtraFilter | ""; title: string }> = [
    { value: "", title: "不限" },
    { value: "with-pdf", title: "已有 PDF" },
    { value: "without-pdf", title: "缺 PDF" },
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
          <div>
            <h2 id={titleId}>筛选当前范围</h2>
            <p className="library-modal__subhead">标签、来源和全文状态可以组合使用。</p>
          </div>
          <button
            type="button"
            className="library-modal__close"
            onClick={onClose}
            aria-label="关闭更多筛选"
            title="关闭更多筛选"
          >
            ×
          </button>
        </div>
        <div className="library-filter-modal__fields">
          <label>
            <span>标签</span>
            <select
              className="au-input"
              data-autofocus="true"
              value={draftTag}
              onChange={(event) => setDraftTag(event.target.value)}
            >
              <option value="">全部标签</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>来源</span>
            <select
              className="au-input"
              value={draftSource}
              onChange={(event) => setDraftSource(event.target.value)}
            >
              <option value="">全部来源</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>全文状态</span>
            <select
              className="au-input"
              value={draftExtra}
              onChange={(event) => setDraftExtra(event.target.value as ExtraFilter | "")}
            >
              {extraOptions.map((option) => (
                <option key={option.value || "none"} value={option.value}>
                  {option.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="library-modal-actions">
          <Button
            type="button"
            onClick={() =>
              onApply({
                tag: draftTag || null,
                source: draftSource || null,
                extra: draftExtra || null,
              })
            }
          >
            应用筛选
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onApply({ tag: null, source: null, extra: null })}
          >
            清空筛选
          </Button>
        </div>
      </section>
    </div>
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
          className={`library-research-tag library-research-tag--${libraryTagTone(
            label,
            index + offset,
          )}`}
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

function citationLabel(meta?: WorkTableMeta) {
  const references = meta?.references ?? 0;
  const citedBy = meta?.citedBy ?? 0;
  if (references === 0 && citedBy === 0) return "—";
  if (references > 0 && citedBy > 0) return `参${references} / 引${citedBy}`;
  if (references > 0) return `参${references}`;
  return `引${citedBy}`;
}

function extraFilterLabel(filter: ExtraFilter) {
  switch (filter) {
    case "with-pdf":
      return "已有 PDF";
    case "without-pdf":
      return "缺 PDF";
  }
}

function collectionPath(
  collections: CollectionRow[],
  collectionId: string | null,
): CollectionRow[] {
  if (!collectionId) return [];
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const path: CollectionRow[] = [];
  const seen = new Set<string>();
  let current = byId.get(collectionId) ?? null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parent_id ? (byId.get(current.parent_id) ?? null) : null;
  }
  return path;
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
