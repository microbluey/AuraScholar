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
  TagRow,
  WorkPatch,
  WorkWithAuthors,
} from "@aurascholar/db";
import { citationCountsForWorks } from "@aurascholar/db/work-list";
import { getDb } from "../services/aura-db";
import { listDeletedWorks, listWorks } from "../services/library-list";
import type { IngestDraft, PendingPdf } from "../services/library-types";
import type { ExportFormat } from "../services/cite";
import type { ImportDecision } from "../components/ImportConfirmDialog";
import type { Draft as MetadataDraft } from "../components/MetadataEditor";
import { useConfirmDialog } from "../components/ConfirmDialog";
import { inferNoticeTone, InlineNotice } from "../components/InlineNotice";
import { useModalFocusTrap } from "../components/useModalFocusTrap";
import { writeClipboardText } from "../clipboard";
import { downloadBlob } from "../download";
import { isImeComposing } from "../keyboard";
import { isPlatformShortcut, shortcutLabel } from "../shortcut-labels";
import { blobPath, sha256Hex, auraFs, isDesktopRuntime } from "../services/aura-platform";
import { fulltextHandoffPath } from "../services/fulltext";
import { describeSafeError } from "../services/sensitive-text";

const MetadataEditor = lazy(() =>
  import("../components/MetadataEditor").then((m) => ({ default: m.MetadataEditor })),
);
const ImportConfirmDialog = lazy(() =>
  import("../components/ImportConfirmDialog").then((m) => ({ default: m.ImportConfirmDialog })),
);

type LibraryFilter = "all" | "reading" | "unread" | "noted" | "starred" | "trash";
type SortMode = "added" | "year";
type DetailPanelTab = "overview" | "notes" | "related";
type ExtraFilter = "with-pdf" | "without-pdf" | "ai-done" | "ai-needed";
type ImportMethod = "identifier" | "pdf" | "references";

interface LibrarySmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_IMPORT_PDF__?: (file: File) => Promise<void>;
  __AURASCHOLAR_SMOKE_LIBRARY_GENERATE_FLASHCARDS__?: (
    workId: string,
    title: string,
  ) => Promise<{ created: number }>;
  __AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_DELAY_MS__?: number;
  __AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_COUNT__?: number;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_CREATE__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_DELETE__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RENAME__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RESTORE__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_BULK_TAG_AFTER_FIRST__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_BULK_TRASH_AFTER_FIRST__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_MOVE_AFTER_FIRST__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READ__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READING_STATUS__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_STAR__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_DELETE__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RENAME__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RESTORE__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH_RESTORE_AFTER_FIRST__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH_RESTORE__?: string;
}

const LIBRARY_FILTERS = new Set<LibraryFilter>([
  "all",
  "reading",
  "unread",
  "noted",
  "starred",
  "trash",
]);

function normalizeLibraryFilter(value: string | null): LibraryFilter | null {
  return value && LIBRARY_FILTERS.has(value as LibraryFilter) ? (value as LibraryFilter) : null;
}

// How many works to show per page. The DB list() caps at a higher hard limit
// (works.ts:list default 200); paging is a client-side window over that set.
const PAGE_SIZE = 30;
const LIST_HARD_LIMIT = 1000;
const MIN_CITATION_BUSY_MS = 350;
const MIN_FLASHCARD_GENERATION_BUSY_MS = 350;
const MIN_COLLECTION_ACTION_BUSY_MS = 250;
const MIN_BULK_TAG_BUSY_MS = 250;
const MIN_MOVE_ACTION_BUSY_MS = 250;
const MIN_REFERENCE_IMPORT_BUSY_MS = 250;
const MIN_TAG_ACTION_BUSY_MS = 450;
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

const AI_CONFIGURATION_ERROR_RE = /配置 AI 服务|配置.*AI|API Key|模型/;
const PREVIEW_LIBRARY_SCOPE_MESSAGE =
  "浏览器预览使用可重置的示例文献；星标、标签、阅读状态等整理操作只在本页生效，真实数据库、PDF 附件和 AI 生成需要在桌面应用中完成。";

function isAiConfigurationError(message: string | null | undefined): boolean {
  return Boolean(message && AI_CONFIGURATION_ERROR_RE.test(message));
}

interface LibraryViewDetail {
  filter?: LibraryFilter;
  collectionId?: string | null;
  tag?: string | null;
}

interface MoveCollectionEventDetail {
  id: string;
  parentId: string | null;
  position: number;
}

interface CollectionContextActionEventDetail {
  id: string;
  name: string;
}

interface CreateCollectionEventDetail {
  parentId?: string | null;
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
  inputKind?: "text" | "color";
  onSubmit: (value: string) => Promise<void>;
}

const TAG_COLOR_OPTIONS = [
  { label: "紫罗兰", value: "#7566f0" },
  { label: "薄荷绿", value: "#25bfae" },
  { label: "湖水蓝", value: "#42a5d5" },
  { label: "珊瑚橙", value: "#ff8a5b" },
  { label: "莓果红", value: "#df5d83" },
  { label: "琥珀黄", value: "#d89b38" },
] as const;

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

interface TrashUndoState {
  count: number;
  ids: string[];
  message: string;
}

interface CollectionDeleteUndoState {
  id: string;
  name: string;
  workIds: string[];
  wasActive: boolean;
  message: string;
}

interface TagDeleteUndoState {
  id: string;
  name: string;
  workIds: string[];
  message: string;
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

const PREVIEW_TIMESTAMP = Date.UTC(2026, 6, 1);

function previewWork(input: {
  abstract: string;
  arxivId?: string | null;
  authors: string[];
  createdOffset: number;
  doi?: string | null;
  id: string;
  readingStatus: ReadingStatus;
  starred?: boolean;
  title: string;
  type?: string;
  venue: string;
  year: number;
}): WorkWithAuthors {
  return {
    id: input.id,
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

const PREVIEW_LIBRARY_WORKS: WorkWithAuthors[] = [
  previewWork({
    id: "preview-attention",
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"],
    year: 2017,
    venue: "NeurIPS",
    doi: "10.48550/arXiv.1706.03762",
    arxivId: "1706.03762",
    readingStatus: "reading",
    starred: true,
    createdOffset: 1000 * 60 * 60 * 6,
    abstract:
      "The Transformer replaces recurrent sequence models with attention-only blocks, creating a faster and more parallelizable architecture for machine translation and later foundation models.",
  }),
  previewWork({
    id: "preview-alphafold",
    title: "Highly accurate protein structure prediction with AlphaFold",
    authors: ["John Jumper", "Richard Evans", "Alexander Pritzel", "Tim Green"],
    year: 2021,
    venue: "Nature",
    doi: "10.1038/s41586-021-03819-2",
    readingStatus: "read",
    createdOffset: 1000 * 60 * 60 * 28,
    abstract:
      "AlphaFold demonstrates near-experimental accuracy for protein structure prediction and shows how deep learning can change structural biology workflows.",
  }),
  previewWork({
    id: "preview-sam",
    title: "Segment Anything",
    authors: ["Alexander Kirillov", "Eric Mintun", "Nikhila Ravi", "Hanzi Mao"],
    year: 2023,
    venue: "ICCV",
    arxivId: "2304.02643",
    readingStatus: "unread",
    createdOffset: 1000 * 60 * 60 * 52,
    abstract:
      "Segment Anything introduces a promptable segmentation model and a large-scale dataset for broad zero-shot image segmentation use cases.",
  }),
  previewWork({
    id: "preview-scaling-laws",
    title: "Scaling Laws for Neural Language Models",
    authors: ["Jared Kaplan", "Sam McCandlish", "Tom Henighan", "Tom B. Brown"],
    year: 2020,
    venue: "arXiv",
    arxivId: "2001.08361",
    readingStatus: "reading",
    createdOffset: 1000 * 60 * 60 * 80,
    abstract:
      "This work studies predictable power-law relationships between model size, dataset size, compute, and language-model performance.",
  }),
];

const PREVIEW_LIBRARY_COLLECTIONS: CollectionRow[] = [
  {
    id: "preview-projects",
    name: "研究项目",
    parent_id: null,
    sort_order: 0,
    count: 1,
  },
  {
    id: "preview-transformer",
    name: "Transformer 综述",
    parent_id: "preview-projects",
    sort_order: 0,
    count: 2,
  },
  {
    id: "preview-life-science",
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
    flashcards: 14,
    latestAiJobStatus: "done",
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
    flashcards: 9,
    latestAiJobStatus: "done",
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
    flashcards: 0,
    latestAiJobStatus: null,
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
    flashcards: 7,
    latestAiJobStatus: "done",
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
    flashcardCount: 14,
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
    latestAiJobStatus: "done",
    latestAiJobError: null,
    sentinelTaskCount: 1,
    sentinelStatus: "active",
    sentinelState: "indexed_openalex",
  },
  "preview-alphafold": {
    pdfCount: 1,
    flashcardCount: 9,
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
    latestAiJobStatus: "done",
    latestAiJobError: null,
    sentinelTaskCount: 1,
    sentinelStatus: "done",
    sentinelState: "indexed_pubmed",
  },
  "preview-sam": {
    pdfCount: 0,
    flashcardCount: 0,
    annotationCount: 0,
    pdfPreview: null,
    notePreviews: [],
    latestAiJobStatus: null,
    latestAiJobError: null,
    sentinelTaskCount: 0,
    sentinelStatus: null,
    sentinelState: null,
  },
  "preview-scaling-laws": {
    pdfCount: 1,
    flashcardCount: 7,
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
    latestAiJobStatus: "done",
    latestAiJobError: null,
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

function consumeLibrarySmokeCollectionCreateFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_CREATE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_CREATE__;
  return new Error(message);
}

function consumeLibrarySmokeCollectionRenameFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RENAME__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RENAME__;
  return new Error(message);
}

function consumeLibrarySmokeCollectionDeleteFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_DELETE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_DELETE__;
  return new Error(message);
}

function consumeLibrarySmokeCollectionRestoreFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RESTORE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RESTORE__;
  return new Error(message);
}

function consumeLibrarySmokeBulkTagAfterFirstFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_BULK_TAG_AFTER_FIRST__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_BULK_TAG_AFTER_FIRST__;
  return new Error(message);
}

function consumeLibrarySmokeBulkTrashAfterFirstFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_BULK_TRASH_AFTER_FIRST__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_BULK_TRASH_AFTER_FIRST__;
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

function consumeLibrarySmokeTagRenameFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RENAME__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RENAME__;
  return new Error(message);
}

function consumeLibrarySmokeTagDeleteFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_DELETE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_DELETE__;
  return new Error(message);
}

function consumeLibrarySmokeTagRestoreFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RESTORE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RESTORE__;
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

function consumeLibrarySmokeTrashRestoreAfterFirstFailure(): Error | null {
  const smokeWindow = window as LibrarySmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH_RESTORE_AFTER_FIRST__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH_RESTORE_AFTER_FIRST__;
  return new Error(message);
}

export function LibraryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedWorkId = searchParams.get("work");
  const requestedFilter = normalizeLibraryFilter(searchParams.get("filter"));
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<WorkWithAuthors[]>([]);
  const [previewItems, setPreviewItems] = useState<WorkWithAuthors[]>(() => PREVIEW_LIBRARY_WORKS);
  const [previewTrashItems, setPreviewTrashItems] = useState<WorkWithAuthors[]>([]);
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [trashCount, setTrashCount] = useState(0);
  const [workMeta, setWorkMeta] = useState<Record<string, WorkTableMeta>>({});
  const [previewWorkMeta, setPreviewWorkMeta] = useState<Record<string, WorkTableMeta>>(() =>
    cloneWorkMetaMap(PREVIEW_LIBRARY_META),
  );
  const [libraryLoadError, setLibraryLoadError] = useState<string | null>(null);
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
  const [messageLeaving, setMessageLeaving] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [trashUndo, setTrashUndo] = useState<TrashUndoState | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(0);
  const [tagManagerIntent, setTagManagerIntent] = useState<"create" | "manage" | null>(null);
  const [collectionManagerOpen, setCollectionManagerOpen] = useState(false);
  const [advancedFilterOpen, setAdvancedFilterOpen] = useState(false);
  const [textPrompt, setTextPrompt] = useState<TextPromptConfig | null>(null);
  const [collectionAction, setCollectionAction] = useState<{
    id: string;
    kind: "create" | "delete" | "rename" | "restore";
  } | null>(null);
  const [collectionManagerStatus, setCollectionManagerStatus] = useState<string | null>(null);
  const [collectionManagerError, setCollectionManagerError] = useState<string | null>(null);
  const [collectionDeleteUndo, setCollectionDeleteUndo] =
    useState<CollectionDeleteUndoState | null>(null);
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
  const citeMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const citeMenuRef = useRef<HTMLDivElement>(null);
  const importingRef = useRef(false);
  const starActionBusyRef = useRef<Record<string, boolean>>({});
  const readingStatusBusyRef = useRef<{ status: ReadingStatus; workId: string } | null>(null);
  const quickDropDepthRef = useRef(0);
  const refreshSeqRef = useRef(0);
  const selectedMetaSeqRef = useRef(0);
  const pendingRequestedWorkIdRef = useRef<string | null>(null);
  const pendingRequestedWorkNeedsFreshRowsRef = useRef(false);
  const lastUnavailableRequestedWorkIdRef = useRef<string | null>(null);
  const pendingKeyboardFocusIndexRef = useRef<number | null>(null);
  const skipNextPageResetRef = useRef(false);
  const { confirm, confirmDialog } = useConfirmDialog();
  const findShortcut = useMemo(() => shortcutLabel("F"), []);

  useEffect(() => {
    if (!message) return;
    setMessageLeaving(false);
    const tone = inferNoticeTone(message);
    if (tone === "busy") return;
    const hasUndoAction = Boolean(
      trashUndo &&
      (message === trashUndo.message || message.startsWith("撤销移入回收站失败，撤销入口仍保留")),
    );
    let duration = 4_500;
    if (tone === "warning") duration = 6_500;
    if (tone === "danger") duration = 9_000;
    if (hasUndoAction) duration = 10_000;
    const exitTimeout = window.setTimeout(() => {
      setMessageLeaving(true);
    }, duration - 220);
    const removeTimeout = window.setTimeout(() => {
      setMessage((current) => (current === message ? null : current));
    }, duration);
    return () => {
      window.clearTimeout(exitTimeout);
      window.clearTimeout(removeTimeout);
    };
  }, [message, trashUndo]);

  const fillExamplePaper = useCallback(() => {
    setInput("1706.03762");
    setImportDialogOpen(true);
  }, []);

  const refresh = useCallback(async () => {
    const seq = refreshSeqRef.current + 1;
    refreshSeqRef.current = seq;
    if (!isDesktopRuntime()) {
      if (refreshSeqRef.current !== seq) return;
      const previewSource = activeFilter === "trash" ? previewTrashItems : previewItems;
      const scopedPreviewItems =
        activeFilter !== "trash" && activeCollection
          ? previewSource.filter((work) => PREVIEW_WORK_COLLECTIONS[work.id] === activeCollection)
          : previewSource;
      setCollections(PREVIEW_LIBRARY_COLLECTIONS);
      setItems(filterPreviewWorksFrom(scopedPreviewItems, search));
      setWorkMeta(previewWorkMeta);
      setTrashCount(previewTrashItems.length);
      setLibraryLoadError(null);
      setMessage((current) =>
        current && !current.startsWith("浏览器预览无法读取本地文献库")
          ? current
          : PREVIEW_LIBRARY_SCOPE_MESSAGE,
      );
      return;
    }
    setLibraryLoadError(null);
    try {
      const smokeFailure = consumeLibrarySmokeReadFailure();
      if (smokeFailure) throw smokeFailure;
      const db = await getDb();
      const [collectionRows, trashRows] = await Promise.all([
        db.query<CollectionRow>(
          `SELECT c.id, c.name, c.parent_id, c.sort_order, COUNT(w.id) AS count
           FROM collections c
           LEFT JOIN collection_items ci ON ci.collection_id = c.id
           LEFT JOIN works w ON w.id = ci.work_id AND w.deleted_at IS NULL
           WHERE c.deleted_at IS NULL
           GROUP BY c.id, c.name, c.parent_id, c.sort_order
           ORDER BY c.sort_order, c.name, c.id`,
        ),
        db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM works WHERE deleted_at IS NOT NULL`),
      ]);
      const showTrash = activeFilter === "trash";
      const works = showTrash
        ? await listDeletedWorks(search || undefined, LIST_HARD_LIMIT)
        : await listWorks(search || undefined, activeCollection ?? undefined, LIST_HARD_LIMIT);
      if (works.length === 0) {
        await waitForLibrarySmokeAfterReadDelay();
        if (refreshSeqRef.current !== seq) return;
        setCollections(collectionRows);
        setTrashCount(trashRows[0]?.n ?? 0);
        setItems(works);
        setWorkMeta({});
        if (pendingRequestedWorkIdRef.current) {
          pendingRequestedWorkNeedsFreshRowsRef.current = false;
        }
        setLibraryLoadError(null);
        setMessage((current) => (current?.startsWith("读取文献库失败") ? null : current));
        window.dispatchEvent(new Event("aurascholar:library-updated"));
        return;
      }

      const ids = works.map((work) => work.id);
      const placeholders = ids.map(() => "?").join(",");
      const [
        tagRows,
        citationCounts,
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
        citationCountsForWorks(db, ids),
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
      await waitForLibrarySmokeAfterReadDelay();
      if (refreshSeqRef.current !== seq) return;

      const nextMeta = Object.fromEntries(
        works.map((work) => [work.id, emptyWorkMeta()]),
      ) as Record<string, WorkTableMeta>;
      for (const row of tagRows) {
        nextMeta[row.work_id]?.tags.push(row.name);
      }
      for (const [workId, counts] of citationCounts) {
        const meta = nextMeta[workId];
        if (meta) {
          meta.references = counts.references;
          meta.citedBy = counts.citedBy;
        }
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
      setCollections(collectionRows);
      setTrashCount(trashRows[0]?.n ?? 0);
      setItems(works);
      setWorkMeta(nextMeta);
      if (pendingRequestedWorkIdRef.current) {
        pendingRequestedWorkNeedsFreshRowsRef.current = false;
      }
      setLibraryLoadError(null);
      setMessage((current) => (current?.startsWith("读取文献库失败") ? null : current));
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    } catch (e) {
      if (refreshSeqRef.current !== seq) return;
      const detail = describeSafeError(e);
      setLibraryLoadError(detail);
      setMessage(`读取文献库失败：${detail}`);
    }
  }, [search, activeCollection, activeFilter, previewItems, previewTrashItems, previewWorkMeta]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), search ? 250 : 0);
    return () => {
      clearTimeout(t);
      refreshSeqRef.current += 1;
    };
  }, [refresh, search]);

  useEffect(() => {
    const onDerivedDataUpdated = () => void refresh();
    window.addEventListener("aurascholar:flashcards-updated", onDerivedDataUpdated);
    window.addEventListener("aurascholar:sentinel-updated", onDerivedDataUpdated);
    return () => {
      refreshSeqRef.current += 1;
      window.removeEventListener("aurascholar:flashcards-updated", onDerivedDataUpdated);
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
    [input, busy, surfaceDedup],
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

  const handleNewFolder = useCallback(
    async (parentId?: string | null) => {
      if (collectionAction) return;
      if (!isDesktopRuntime()) {
        setMessage("预览模式下不会写入本地数据库");
        return;
      }
      const parent = parentId ? collections.find((collection) => collection.id === parentId) : null;
      setTextPrompt({
        title: parent ? `在「${parent.name}」中新建文件夹` : "新建文件夹",
        label: "文件夹名称",
        placeholder: "例如：Transformer 综述",
        confirmLabel: "创建",
        description: parent
          ? `新文件夹会显示在「${parent.name}」下。`
          : "新文件夹会显示在文件夹树顶层。",
        onSubmit: async (value) => {
          const name = value.trim();
          const startedAt = Date.now();
          setCollectionAction({ id: "__create__", kind: "create" });
          setCollectionManagerStatus(`正在创建文件夹「${name}」...`);
          setCollectionManagerError(null);
          setCollectionDeleteUndo(null);
          try {
            const smokeFailure = consumeLibrarySmokeCollectionCreateFailure();
            if (smokeFailure) {
              await waitForMinimumElapsed(startedAt, MIN_COLLECTION_ACTION_BUSY_MS);
              throw smokeFailure;
            }
            const db = await getDb();
            const { CollectionsRepo } = await import("@aurascholar/db/repos/collections");
            const id = await new CollectionsRepo(db).create(name, parent?.id);
            await waitForMinimumElapsed(startedAt, MIN_COLLECTION_ACTION_BUSY_MS);
            setActiveFilter("all");
            setActiveCollection(id);
            setActiveTag(null);
            setActiveSource(null);
            const successMessage = parent
              ? `已在「${parent.name}」中新建「${name}」`
              : `已新建文件夹「${name}」`;
            setMessage(successMessage);
            setCollectionManagerStatus(successMessage);
            await refresh();
          } catch (e) {
            const message = describeSafeError(e);
            const error = new Error(`创建文件夹失败，名称仍保留，可重新创建:${message}`);
            setCollectionManagerStatus(null);
            setCollectionManagerError(error.message);
            throw error;
          } finally {
            setCollectionAction(null);
          }
        },
      });
    },
    [collectionAction, collections, refresh],
  );

  const handleRenameFolder = useCallback(
    async (id: string, name: string) => {
      if (collectionAction) return;
      if (!isDesktopRuntime()) {
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
          setCollectionDeleteUndo(null);
          try {
            const smokeFailure = consumeLibrarySmokeCollectionRenameFailure();
            if (smokeFailure) {
              await waitForMinimumElapsed(startedAt, MIN_COLLECTION_ACTION_BUSY_MS);
              throw smokeFailure;
            }
            const db = await getDb();
            const { CollectionsRepo } = await import("@aurascholar/db/repos/collections");
            await new CollectionsRepo(db).rename(id, next);
            await waitForMinimumElapsed(startedAt, MIN_COLLECTION_ACTION_BUSY_MS);
            setMessage(`已重命名为「${next}」`);
            setCollectionManagerStatus(`已重命名为「${next}」`);
            await refresh();
          } catch (e) {
            const message = describeSafeError(e);
            const error = new Error(`重命名文件夹失败，名称仍保留，可重新保存:${message}`);
            setCollectionManagerStatus(null);
            setCollectionManagerError(error.message);
            throw error;
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
      if (!isDesktopRuntime()) {
        setMessage("预览模式下不会写入本地数据库");
        return;
      }
      const confirmed = await confirm({
        title: "删除文件夹？",
        description: `「${name}」会从文件夹树移除，里面的文献会回到“全部文献”。`,
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
        const smokeFailure = consumeLibrarySmokeCollectionDeleteFailure();
        if (smokeFailure) {
          await waitForMinimumElapsed(startedAt, MIN_COLLECTION_ACTION_BUSY_MS);
          throw smokeFailure;
        }
        const db = await getDb();
        const { CollectionsRepo } = await import("@aurascholar/db/repos/collections");
        const repo = new CollectionsRepo(db);
        const workIds = await repo.workIds(id);
        await repo.softDelete(id);
        await waitForMinimumElapsed(startedAt, MIN_COLLECTION_ACTION_BUSY_MS);
        if (activeCollection === id) setActiveCollection(null);
        const undoMessage = `已删除文件夹「${name}」`;
        setCollectionDeleteUndo({
          id,
          name,
          workIds,
          wasActive: activeCollection === id,
          message: undoMessage,
        });
        setMessage(undoMessage);
        setCollectionManagerStatus(undoMessage);
        await refresh();
      } catch (e) {
        const errorMessage = `删除文件夹失败，文件夹仍保留，可重新删除:${describeSafeError(e)}`;
        setMessage(errorMessage);
        setCollectionManagerStatus(null);
        setCollectionManagerError(errorMessage);
      } finally {
        setCollectionAction(null);
      }
    },
    [activeCollection, collectionAction, confirm, refresh],
  );

  const undoCollectionDelete = useCallback(async () => {
    if (!collectionDeleteUndo || collectionAction) return;
    if (!isDesktopRuntime()) {
      setCollectionManagerStatus("预览模式下不会写入本地数据库");
      return;
    }
    const { id, name, wasActive, workIds } = collectionDeleteUndo;
    const startedAt = Date.now();
    setCollectionAction({ id, kind: "restore" });
    setCollectionManagerStatus(`正在恢复文件夹「${name}」...`);
    setCollectionManagerError(null);
    try {
      const smokeFailure = consumeLibrarySmokeCollectionRestoreFailure();
      if (smokeFailure) {
        await waitForMinimumElapsed(startedAt, MIN_COLLECTION_ACTION_BUSY_MS);
        throw smokeFailure;
      }
      const db = await getDb();
      const { CollectionsRepo } = await import("@aurascholar/db/repos/collections");
      await new CollectionsRepo(db).restore(id, workIds);
      await waitForMinimumElapsed(startedAt, MIN_COLLECTION_ACTION_BUSY_MS);
      const restoredMessage = `已恢复文件夹「${name}」`;
      setCollectionDeleteUndo(null);
      setMessage(restoredMessage);
      setCollectionManagerStatus(restoredMessage);
      if (wasActive) {
        setActiveFilter("all");
        setActiveCollection(id);
        setActiveTag(null);
        setActiveSource(null);
        setExtraFilter(null);
        setSelectedIds(new Set());
      }
      await refresh();
    } catch (e) {
      const errorMessage = `恢复文件夹失败，撤销入口仍保留，可重新撤销:${describeSafeError(e)}`;
      setMessage(errorMessage);
      setCollectionManagerStatus(collectionDeleteUndo.message);
      setCollectionManagerError(errorMessage);
    } finally {
      setCollectionAction(null);
    }
  }, [collectionAction, collectionDeleteUndo, refresh]);

  const handleMoveFolder = useCallback(
    async ({ id, parentId, position }: MoveCollectionEventDetail) => {
      const folder = collections.find((collection) => collection.id === id);
      if (!folder) return;
      if (!isDesktopRuntime()) {
        setCollections((current) => moveCollectionRows(current, { id, parentId, position }));
        setMessage(`已移动文件夹「${folder.name}」`);
        return;
      }
      try {
        const db = await getDb();
        const { CollectionsRepo } = await import("@aurascholar/db/repos/collections");
        await new CollectionsRepo(db).move(id, parentId, position);
        setMessage(`已移动文件夹「${folder.name}」`);
        await refresh();
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (error) {
        setMessage(`移动文件夹失败，原有层级未改变:${describeSafeError(error)}`);
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      }
    },
    [collections, refresh],
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
    const onCreateCollection = (event: Event) => {
      const detail = (event as CustomEvent<CreateCollectionEventDetail>).detail;
      void handleNewFolder(detail?.parentId ?? null);
    };
    const onManageCollections = () => {
      setCollectionManagerStatus(null);
      setCollectionManagerError(null);
      setCollectionDeleteUndo(null);
      setCollectionManagerOpen(true);
    };
    const onMoveCollection = (event: Event) => {
      const detail = (event as CustomEvent<MoveCollectionEventDetail>).detail;
      if (!detail?.id) return;
      void handleMoveFolder(detail);
    };
    const onRenameCollection = (event: Event) => {
      const detail = (event as CustomEvent<CollectionContextActionEventDetail>).detail;
      if (!detail?.id) return;
      void handleRenameFolder(detail.id, detail.name);
    };
    const onDeleteCollection = (event: Event) => {
      const detail = (event as CustomEvent<CollectionContextActionEventDetail>).detail;
      if (!detail?.id) return;
      void handleDeleteFolder(detail.id, detail.name);
    };
    const onCreateTag = () => setTagManagerIntent("create");
    const onManageTags = () => setTagManagerIntent("manage");
    window.addEventListener("aurascholar:library-view", onLibraryView);
    window.addEventListener("aurascholar:create-collection", onCreateCollection);
    window.addEventListener("aurascholar:manage-collections", onManageCollections);
    window.addEventListener("aurascholar:move-collection", onMoveCollection);
    window.addEventListener("aurascholar:rename-collection", onRenameCollection);
    window.addEventListener("aurascholar:delete-collection", onDeleteCollection);
    window.addEventListener("aurascholar:create-tag", onCreateTag);
    window.addEventListener("aurascholar:manage-tags", onManageTags);
    return () => {
      window.removeEventListener("aurascholar:library-view", onLibraryView);
      window.removeEventListener("aurascholar:create-collection", onCreateCollection);
      window.removeEventListener("aurascholar:manage-collections", onManageCollections);
      window.removeEventListener("aurascholar:move-collection", onMoveCollection);
      window.removeEventListener("aurascholar:rename-collection", onRenameCollection);
      window.removeEventListener("aurascholar:delete-collection", onDeleteCollection);
      window.removeEventListener("aurascholar:create-tag", onCreateTag);
      window.removeEventListener("aurascholar:manage-tags", onManageTags);
    };
  }, [handleDeleteFolder, handleMoveFolder, handleNewFolder, handleRenameFolder]);

  useEffect(() => {
    if (!requestedWorkId) return;
    const nextFilter = requestedFilter ?? "all";
    pendingRequestedWorkIdRef.current = requestedWorkId;
    lastUnavailableRequestedWorkIdRef.current = null;
    pendingRequestedWorkNeedsFreshRowsRef.current = Boolean(
      items.length === 0 || search.trim() || activeFilter !== nextFilter || activeCollection,
    );
    skipNextPageResetRef.current = true;
    setActiveFilter(nextFilter);
    setActiveCollection(null);
    setActiveTag(null);
    setActiveSource(null);
    setExtraFilter(null);
    setSearch("");
    setSelectedIds(new Set());
    setSelectedWorkId(requestedWorkId);
    const next = new URLSearchParams(searchParams);
    next.delete("work");
    next.delete("filter");
    setSearchParams(next, { replace: true });
  }, [
    activeCollection,
    activeFilter,
    items.length,
    requestedFilter,
    requestedWorkId,
    search,
    searchParams,
    setSearchParams,
  ]);

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
        if (!result.deduped) autoDigest(selectedWork.id, selectedWork.title);
        await refresh();
        setSelectedWorkId(selectedWork.id);
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (e) {
        setMessage(`上传 PDF 失败:${describeSafeError(e)}`);
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
    if (!isDesktopRuntime()) {
      navigate(
        fulltextHandoffPath({
          arxivId: selectedWork.arxiv_id,
          doi: selectedWork.doi,
          id: selectedWork.id,
          title: selectedWork.title,
          url: selectedWork.url,
        }),
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
        fulltextHandoffPath({
          arxivId: selectedWork.arxiv_id,
          doi: selectedWork.doi,
          id: selectedWork.id,
          title: selectedWork.title,
          url: selectedWork.url,
        }),
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
        const db = await getDb();
        const { WorksRepo } = await import("@aurascholar/db/repos/works");
        await new WorksRepo(db).setStarred(work.id, starred);
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        setMessage(successMessage);
        setSelectedWorkId(work.id);
        try {
          await refresh();
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
        const db = await getDb();
        const { WorksRepo } = await import("@aurascholar/db/repos/works");
        await new WorksRepo(db).setReadingStatus(selectedWork.id, status);
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        setMessage(successMessage);
        setSelectedWorkId(selectedWork.id);
        try {
          await refresh();
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
    if (!selectedWork || workActionBusy) return;
    const workId = selectedWork.id;
    const title = selectedWork.title;
    const confirmed = await confirm({
      title: "移入回收站？",
      description: `《${title}》会从当前列表移到回收站。`,
      details: ["你可以在回收站恢复它。", "永久删除前，PDF、批注、标签和闪卡都会保留。"],
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
    setWorkActionBusy("trash");
    setTrashUndo(null);
    setMessage(`正在将《${title}》移入回收站...`);
    try {
      const db = await getDb();
      const { WorksRepo } = await import("@aurascholar/db/repos/works");
      const smokeFailure = consumeLibrarySmokeTrashFailure();
      if (smokeFailure) {
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        throw smokeFailure;
      }
      await new WorksRepo(db).softDelete(workId);
      await refresh();
      await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
      const undoMessage = `已将《${title}》移入回收站`;
      setMessage(undoMessage);
      setTrashUndo({ count: 1, ids: [workId], message: undoMessage });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(workId);
        return next;
      });
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    } catch (e) {
      setMessage(`移入回收站失败，文献仍保留，可重新移入回收站:${describeSafeError(e)}`);
    } finally {
      setWorkActionBusy(null);
    }
  }, [confirm, refresh, selectedWork, workActionBusy]);

  const undoTrash = useCallback(async () => {
    if (!trashUndo || workActionBusy) return;
    const startedAt = Date.now();
    const { count, ids } = trashUndo;
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
      setSelectedWorkId(restored[0]?.id ?? selectedWorkId);
      setMessage(
        count === 1 ? "已撤销移入预览回收站" : `已撤销移入预览回收站:${count} 篇文献已恢复`,
      );
      return;
    }
    setWorkActionBusy("restore");
    setMessage(`正在撤销移入回收站:${count} 篇文献...`);
    try {
      const db = await getDb();
      const { WorksRepo } = await import("@aurascholar/db/repos/works");
      const worksRepo = new WorksRepo(db);
      const smokeFailure = consumeLibrarySmokeTrashRestoreFailure();
      if (smokeFailure) {
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        throw smokeFailure;
      }
      for (const workId of ids) {
        await worksRepo.restore(workId);
      }
      await refresh();
      await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
      setTrashUndo(null);
      setSelectedIds(new Set());
      setMessage(count === 1 ? "已撤销移入回收站" : `已撤销移入回收站:${count} 篇文献已恢复`);
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    } catch (e) {
      setMessage(`撤销移入回收站失败，撤销入口仍保留，可重新撤销:${describeSafeError(e)}`);
    } finally {
      setWorkActionBusy(null);
    }
  }, [activeFilter, previewTrashItems, refresh, selectedWorkId, trashUndo, workActionBusy]);

  useEffect(() => {
    const pendingRequestedWorkId = pendingRequestedWorkIdRef.current;
    if (tableRows.length === 0) {
      if (pendingRequestedWorkId) {
        if (pendingRequestedWorkNeedsFreshRowsRef.current) return;
        pendingRequestedWorkIdRef.current = null;
        if (lastUnavailableRequestedWorkIdRef.current !== pendingRequestedWorkId) {
          lastUnavailableRequestedWorkIdRef.current = pendingRequestedWorkId;
          setMessage("没有找到要定位的文献，可能已被删除或来自另一个资料库");
        }
        setPage(0);
      }
      setSelectedWorkId(null);
      return;
    }
    if (pendingRequestedWorkId) {
      const targetIndex = tableRows.findIndex((w) => w.id === pendingRequestedWorkId);
      if (targetIndex >= 0) {
        setSelectedWorkId(pendingRequestedWorkId);
        setPage(Math.floor(targetIndex / PAGE_SIZE));
        pendingRequestedWorkIdRef.current = null;
        pendingRequestedWorkNeedsFreshRowsRef.current = false;
        lastUnavailableRequestedWorkIdRef.current = null;
        return;
      }
      if (pendingRequestedWorkNeedsFreshRowsRef.current) return;
      pendingRequestedWorkIdRef.current = null;
      if (lastUnavailableRequestedWorkIdRef.current !== pendingRequestedWorkId) {
        lastUnavailableRequestedWorkIdRef.current = pendingRequestedWorkId;
        setMessage("没有找到要定位的文献，可能已被删除或来自另一个资料库");
      }
      setPage(0);
    }
    if (selectedWorkId && !tableRows.some((w) => w.id === selectedWorkId)) {
      setSelectedWorkId(null);
    }
  }, [tableRows, selectedWorkId]);

  useEffect(() => {
    if (!selectedWorkId || tableRows.length === 0) return;
    const selectedIndex = tableRows.findIndex((w) => w.id === selectedWorkId);
    if (selectedIndex < 0) return;
    const selectedPage = Math.floor(selectedIndex / PAGE_SIZE);
    if (selectedPage !== safePage) setPage(selectedPage);
  }, [safePage, selectedWorkId, tableRows]);

  useEffect(() => {
    if (!selectedWork) {
      setSelectedMeta(null);
      return;
    }
    if (!isDesktopRuntime()) {
      const previewMeta = PREVIEW_RUNTIME_META[selectedWork.id] ?? null;
      const tableMeta = workMeta[selectedWork.id];
      setSelectedMeta(
        previewMeta
          ? {
              ...previewMeta,
              sentinelTaskCount: tableMeta?.sentinelTaskCount ?? previewMeta.sentinelTaskCount,
              sentinelStatus: tableMeta?.sentinelStatus ?? previewMeta.sentinelStatus,
              sentinelState: tableMeta?.sentinelState ?? previewMeta.sentinelState,
            }
          : null,
      );
      return;
    }
    const seq = selectedMetaSeqRef.current + 1;
    selectedMetaSeqRef.current = seq;
    let cancelled = false;
    void (async () => {
      const db = await getDb();
      const [attachments, flashcards, jobs, notes, sentinelTasks] = await Promise.all([
        db.query<AttachmentRow>(
          `SELECT * FROM attachments
           WHERE work_id = ? AND deleted_at IS NULL
           ORDER BY created_at DESC`,
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
      if (cancelled || selectedMetaSeqRef.current !== seq) return;
      const pdfPreview = attachments.find((a) => a.kind === "pdf") ?? null;
      setSelectedMeta({
        pdfCount: attachments.filter((a) => a.kind === "pdf").length,
        flashcardCount: flashcards.length,
        annotationCount: workMeta[selectedWork.id]?.annotations ?? 0,
        pdfPreview,
        notePreviews: notes,
        latestAiJobStatus: jobs[0]?.status ?? null,
        latestAiJobError: jobs[0]?.error ? describeSafeError(jobs[0].error) : null,
        sentinelTaskCount: sentinelTasks.length,
        sentinelStatus: sentinelTasks[0]?.status ?? null,
        sentinelState: sentinelTasks[0]?.current_state ?? null,
      });
    })().catch(() => {
      if (!cancelled && selectedMetaSeqRef.current === seq) setSelectedMeta(null);
    });
    return () => {
      cancelled = true;
      selectedMetaSeqRef.current += 1;
    };
  }, [selectedWork, workMeta]);

  // Reset to first page whenever the filtered set changes shape.
  useEffect(() => {
    if (skipNextPageResetRef.current) {
      skipNextPageResetRef.current = false;
      return;
    }
    setPage(0);
  }, [activeFilter, activeSource, activeTag, activeCollection, extraFilter, search, sortMode]);

  const getCiteMenuItems = useCallback(() => {
    return Array.from(
      citeMenuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
  }, []);

  useEffect(() => {
    if (!citeMenuOpen) return;
    const frame = window.requestAnimationFrame(() => {
      getCiteMenuItems()[0]?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [citeMenuOpen, getCiteMenuItems]);

  // Close the cite dropdown on any outside click / Escape.
  useEffect(() => {
    if (!citeMenuOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && (e.target as HTMLElement)?.closest?.(".library-cite-menu")) {
        return;
      }
      setCiteMenuOpen(false);
      if (e instanceof KeyboardEvent) {
        citeMenuTriggerRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [citeMenuOpen]);

  const handleCiteMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const items = getCiteMenuItems();
      if (!items.length) return;
      const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
      let nextIndex: number | null = null;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        nextIndex = (currentIndex + 1) % items.length;
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        nextIndex = (currentIndex - 1 + items.length) % items.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = items.length - 1;
      } else if (event.key === "Escape") {
        event.preventDefault();
        setCiteMenuOpen(false);
        citeMenuTriggerRef.current?.focus({ preventScroll: true });
        return;
      }
      if (nextIndex === null) return;
      event.preventDefault();
      items[nextIndex]?.focus({ preventScroll: true });
    },
    [getCiteMenuItems],
  );

  const selectWork = useCallback((work: WorkWithAuthors) => {
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
  }, []);

  const closeSelectedWork = useCallback(() => {
    const closingWorkId = selectedWorkId;
    setSelectedWorkId(null);
    if (!closingWorkId) return;
    requestAnimationFrame(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>("[data-library-row-id]")).find(
        (candidate) => candidate.dataset.libraryRowId === closingWorkId,
      );
      row?.focus({ preventScroll: true });
    });
  }, [selectedWorkId]);

  const openReader = useCallback(
    (work: WorkWithAuthors) => {
      setSelectedWorkId(work.id);
      navigate(`/reader?work=${encodeURIComponent(work.id)}`);
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
      setSelectedWorkId(next.id);
      focusPagedRow(clamped);
    },
    [focusPagedRow, pagedRows],
  );

  const generateForSelected = useCallback(async () => {
    if (!selectedWork || generating) return;
    if (!isDesktopRuntime()) {
      const params = new URLSearchParams({
        work: selectedWork.id,
        title: selectedWork.title,
      });
      navigate(`/flashcards?${params.toString()}`);
      return;
    }
    const startedAt = Date.now();
    setGenerating(true);
    setMessage(`正在为《${selectedWork.title}》生成闪卡...`);
    try {
      const smokeGenerate = (window as LibrarySmokeWindow)
        .__AURASCHOLAR_SMOKE_LIBRARY_GENERATE_FLASHCARDS__;
      const result = smokeGenerate
        ? await smokeGenerate(selectedWork.id, selectedWork.title)
        : await import("../services/ai").then(({ generateFlashcardsForWork }) =>
            generateFlashcardsForWork(selectedWork.id, selectedWork.title),
          );
      await waitForMinimumElapsed(startedAt, MIN_FLASHCARD_GENERATION_BUSY_MS);
      setMessage(`已为《${selectedWork.title}》生成 ${result.created} 张闪卡`);
      window.dispatchEvent(new Event("aurascholar:flashcards-updated"));
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
      await waitForMinimumElapsed(startedAt, MIN_FLASHCARD_GENERATION_BUSY_MS);
      const detail = describeSafeError(e);
      setMessage(`生成闪卡失败，文献和现有闪卡仍保留，可重新生成:${detail}`);
      setSelectedMeta((prev) => ({
        pdfCount: prev?.pdfCount ?? 0,
        flashcardCount: prev?.flashcardCount ?? 0,
        annotationCount: prev?.annotationCount ?? 0,
        pdfPreview: prev?.pdfPreview ?? null,
        notePreviews: prev?.notePreviews ?? [],
        latestAiJobStatus: "error",
        latestAiJobError: describeSafeError(e),
        sentinelTaskCount: prev?.sentinelTaskCount ?? 0,
        sentinelStatus: prev?.sentinelStatus ?? null,
        sentinelState: prev?.sentinelState ?? null,
      }));
    } finally {
      setGenerating(false);
    }
  }, [generating, navigate, selectedWork]);

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
    if (selectedIds.size === 0) {
      setMessage("请先勾选要添加标签的文献");
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
          const db = await getDb();
          const { TagsRepo } = await import("@aurascholar/db/repos/tags");
          const tagsRepo = new TagsRepo(db);
          const smokeFailureAfterFirst = consumeLibrarySmokeBulkTagAfterFirstFailure();
          await tagsRepo.addToWorks(workIds, name, {
            afterEach: (_workId, index) => {
              if (index === 0 && smokeFailureAfterFirst) throw smokeFailureAfterFirst;
            },
          });
          tagCommitted = true;
          await waitForMinimumElapsed(startedAt, MIN_BULK_TAG_BUSY_MS);
          setMessage(successMessage);
          setSelectedIds(new Set());
          await refresh();
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
  }, [selectedIds, refresh]);

  const bulkMoveToCollection = useCallback(async () => {
    if (selectedIds.size === 0) {
      setMessage("请先勾选要移动的文献");
      return;
    }
    if (!isDesktopRuntime()) {
      setMessage("预览模式下不会写入本地数据库");
      return;
    }
    setMoveDialogOpen(true);
  }, [selectedIds]);

  const moveSelectedToCollection = useCallback(
    async (target: string | null, targetName: string): Promise<boolean> => {
      if (selectedIds.size === 0 || !isDesktopRuntime()) return false;
      const workIds = Array.from(selectedIds);
      const startedAt = Date.now();
      const successMessage = target
        ? `已移动 ${workIds.length} 篇文献到「${targetName}」`
        : `已将 ${workIds.length} 篇文献移出所有文件夹`;
      let moveCommitted = false;
      try {
        const db = await getDb();
        const { CollectionsRepo } = await import("@aurascholar/db/repos/collections");
        const colRepo = new CollectionsRepo(db);
        const smokeFailureAfterFirst = consumeLibrarySmokeMoveAfterFirstFailure();
        await colRepo.setWorksCollection(workIds, target, {
          afterEach: (_workId, index) => {
            if (index === 0 && smokeFailureAfterFirst) throw smokeFailureAfterFirst;
          },
        });
        moveCommitted = true;
        await waitForMinimumElapsed(startedAt, MIN_MOVE_ACTION_BUSY_MS);
        setMessage(successMessage);
        setSelectedIds(new Set());
        await refresh();
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
    [selectedIds, refresh],
  );

  const bulkDelete = useCallback(async () => {
    if (selectedIds.size === 0 || workActionBusy) return;
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
    setWorkActionBusy("trash");
    setTrashUndo(null);
    setMessage(`正在将 ${workIds.length} 篇文献移入回收站...`);
    const undoMessage = `已将 ${workIds.length} 篇文献移入回收站`;
    let trashCommitted = false;
    try {
      const db = await getDb();
      const { WorksRepo } = await import("@aurascholar/db/repos/works");
      const worksRepo = new WorksRepo(db);
      const smokeFailureAfterFirst = consumeLibrarySmokeBulkTrashAfterFirstFailure();
      await worksRepo.softDeleteMany(workIds, {
        afterEach: (_workId, index) => {
          if (index === 0 && smokeFailureAfterFirst) throw smokeFailureAfterFirst;
        },
      });
      trashCommitted = true;
      await refresh();
      await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
      setMessage(undoMessage);
      setTrashUndo({ count: workIds.length, ids: workIds, message: undoMessage });
      setSelectedIds(new Set());
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
      if (trashCommitted) {
        setMessage(`${undoMessage}，但列表刷新失败，可点击撤销或稍后刷新:${describeSafeError(e)}`);
        setTrashUndo({ count: workIds.length, ids: workIds, message: undoMessage });
        setSelectedIds(new Set());
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } else {
        setMessage(`批量移入回收站失败，所选文献仍保留，可重新移入回收站:${describeSafeError(e)}`);
      }
    } finally {
      setWorkActionBusy(null);
    }
  }, [confirm, previewItems, selectedIds, refresh, workActionBusy]);

  const restoreWorks = useCallback(
    async (workIds: string[]) => {
      if (workIds.length === 0 || workActionBusy) return;
      const startedAt = Date.now();
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
        setTrashUndo(null);
        setSelectedIds(new Set());
        setSelectedWorkId(restored[0]?.id ?? selectedWorkId);
        setMessage(`已从预览回收站恢复 ${restored.length} 篇文献`);
        return;
      }
      setWorkActionBusy("restore");
      setTrashUndo(null);
      setMessage(`正在恢复 ${workIds.length} 篇文献...`);
      const successMessage = `已恢复 ${workIds.length} 篇文献`;
      let restoreCommitted = false;
      try {
        const db = await getDb();
        const { WorksRepo } = await import("@aurascholar/db/repos/works");
        const worksRepo = new WorksRepo(db);
        const smokeFailureAfterFirst = consumeLibrarySmokeTrashRestoreAfterFirstFailure();
        await worksRepo.restoreMany(workIds, {
          afterEach: (_workId, index) => {
            if (index === 0 && smokeFailureAfterFirst) throw smokeFailureAfterFirst;
          },
        });
        restoreCommitted = true;
        await refresh();
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        setMessage(successMessage);
        setSelectedIds(new Set());
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        if (restoreCommitted) {
          setMessage(`${successMessage}，但列表刷新失败，可稍后刷新:${describeSafeError(e)}`);
          setSelectedIds(new Set());
          window.dispatchEvent(new Event("aurascholar:library-updated"));
        } else {
          setMessage(`恢复文献失败，所选文献仍保留在回收站，可重新恢复:${describeSafeError(e)}`);
        }
      } finally {
        setWorkActionBusy(null);
      }
    },
    [activeFilter, previewTrashItems, refresh, selectedWorkId, workActionBusy],
  );

  const purgeWorks = useCallback(
    async (workIds: string[]) => {
      if (workIds.length === 0 || workActionBusy) return;
      if (!isDesktopRuntime()) {
        setMessage("浏览器预览不会永久删除文献；可以恢复回收站文献，或刷新页面重置演示数据。");
        return;
      }
      const confirmed = await confirm({
        title: "永久删除文献？",
        description: `将永久删除 ${workIds.length} 篇回收站文献。`,
        details: ["这会移除元数据、PDF、标签、笔记、闪卡和引用关联。", "该操作不能撤销。"],
        confirmationHelp: "输入“永久删除”后才会启用确认按钮。",
        confirmationPhrase: "永久删除",
        confirmLabel: "永久删除",
        tone: "danger",
      });
      if (!confirmed) return;
      const startedAt = Date.now();
      setWorkActionBusy("purge");
      setTrashUndo(null);
      setMessage(`正在永久删除 ${workIds.length} 篇文献...`);
      try {
        const db = await getDb();
        const { WorksRepo } = await import("@aurascholar/db/repos/works");
        await new WorksRepo(db).purgeDeletedMany(workIds);
        await refresh();
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        setMessage(`已永久删除 ${workIds.length} 篇文献`);
        setSelectedIds(new Set());
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
        setMessage(`永久删除失败，所选文献仍保留在回收站，可重新永久删除:${describeSafeError(e)}`);
      } finally {
        setWorkActionBusy(null);
      }
    },
    [confirm, refresh, workActionBusy],
  );

  const bulkMerge = useCallback(async () => {
    if (selectedIds.size < 2 || workActionBusy || !isDesktopRuntime()) return;
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
      const successMessage = `已合并 ${result.merged} 篇重复文献到《${selectedWork.title}》${
        result.movedAttachments ? `，迁移 ${result.movedAttachments} 个附件` : ""
      }`;
      setMessage(successMessage);
      setSelectedIds(new Set());
      setSelectedWorkId(selectedWork.id);
      try {
        await refresh();
      } catch (e) {
        setMessage(`${successMessage}，但列表刷新失败，可稍后刷新:${describeSafeError(e)}`);
      }
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_WORK_ACTION_BUSY_MS);
      setMessage(`合并失败，主记录和重复文献仍保持原状，可重新合并:${describeSafeError(e)}`);
    } finally {
      setWorkActionBusy(null);
    }
  }, [confirm, items, refresh, selectedIds, selectedWork, workActionBusy]);

  const handleExportCitations = useCallback(
    async (format: ExportFormat) => {
      if (selectedIds.size === 0 || citationBusy) return;
      const workIds = Array.from(selectedIds);
      const startedAt = Date.now();
      setCiteMenuOpen(false);
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
    [citationBusy, previewWorksById, selectedIds],
  );

  const handleCopyBibliography = useCallback(
    async (styleId: string) => {
      if (selectedIds.size === 0 || citationBusy) return;
      const workIds = Array.from(selectedIds);
      const startedAt = Date.now();
      setCiteMenuOpen(false);
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
    [citationBusy, previewWorksById, selectedIds],
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
  }, []);

  const openBreadcrumbCollection = useCallback((collectionId: string) => {
    setActiveFilter("all");
    setActiveCollection(collectionId);
    setActiveTag(null);
    setActiveSource(null);
    setExtraFilter(null);
    setSelectedIds(new Set());
  }, []);

  const clearInlineSearch = useCallback(() => {
    setSearch("");
    searchInputRef.current?.focus();
  }, []);

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

  return (
    <div
      className="library-page"
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
              onChange={(e) => setSearch(e.target.value)}
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
            onClick={() => setImportDialogOpen(true)}
            disabled={busy}
            title="通过链接、PDF 或题录文件导入文献"
          >
            导入文献
          </Button>
          <ActionIconButton
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
      {trashUndo &&
      (message === trashUndo.message ||
        workActionBusy === "restore" ||
        message?.startsWith("撤销移入回收站失败，撤销入口仍保留")) ? (
        <InlineNotice
          className={`library-command__message ${
            messageLeaving ? "library-command__message--leaving" : ""
          }`}
          message={message}
          onDismiss={() => {
            setMessageLeaving(false);
            setMessage(null);
          }}
        >
          <span className="library-command__message-text">{message}</span>
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
          onDismiss={() => {
            setMessageLeaving(false);
            setMessage(null);
          }}
        />
      )}

      {selectedIds.size > 0 && (
        <div className="library-bulkbar">
          <span className="library-bulkbar__count">已选 {selectedIds.size} 篇</span>
          {isTrashView ? (
            <>
              <button
                type="button"
                onClick={() => void restoreWorks(Array.from(selectedIds))}
                disabled={Boolean(workActionBusy)}
                aria-busy={workActionBusy === "restore" ? "true" : undefined}
              >
                {workActionBusy === "restore" ? "恢复中..." : "恢复"}
              </button>
              <button
                type="button"
                className="library-bulkbar__danger"
                onClick={() => void purgeWorks(Array.from(selectedIds))}
                disabled={Boolean(workActionBusy)}
                aria-busy={workActionBusy === "purge" ? "true" : undefined}
              >
                {workActionBusy === "purge" ? "删除中..." : "永久删除"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void bulkAddTag()}
                disabled={Boolean(workActionBusy)}
              >
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
                  ref={citeMenuTriggerRef}
                  id="library-cite-menu-trigger"
                  type="button"
                  aria-controls="library-cite-dropdown"
                  aria-expanded={citeMenuOpen}
                  aria-haspopup="menu"
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
                  <div
                    ref={citeMenuRef}
                    className="library-cite-dropdown"
                    id="library-cite-dropdown"
                    role="menu"
                    aria-labelledby="library-cite-menu-trigger"
                    onKeyDown={handleCiteMenuKeyDown}
                  >
                    <div className="library-cite-dropdown__group" id="library-cite-export-heading">
                      导出文件
                    </div>
                    <div role="group" aria-labelledby="library-cite-export-heading">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void handleExportCitations("bibtex")}
                        disabled={Boolean(citationBusy)}
                      >
                        BibTeX (.bib)
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void handleExportCitations("ris")}
                        disabled={Boolean(citationBusy)}
                      >
                        RIS (.ris)
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void handleExportCitations("csljson")}
                        disabled={Boolean(citationBusy)}
                      >
                        CSL-JSON (.json)
                      </button>
                    </div>
                    <div className="library-cite-dropdown__group" id="library-cite-copy-heading">
                      复制参考文献
                    </div>
                    <div role="group" aria-labelledby="library-cite-copy-heading">
                      {CITATION_STYLES.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          role="menuitem"
                          onClick={() => void handleCopyBibliography(s.id)}
                          disabled={Boolean(citationBusy)}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="library-bulkbar__danger"
                onClick={() => void bulkDelete()}
                disabled={Boolean(workActionBusy)}
                aria-busy={workActionBusy === "trash" ? "true" : undefined}
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
                      onClick={() => setActiveCollection(null)}
                      aria-label={`移除文件夹筛选 ${activeCollectionRow.name}`}
                    >
                      文件夹 · {activeCollectionPath.map((item) => item.name).join(" / ")}
                      <b aria-hidden="true">×</b>
                    </button>
                  )}
                  {activeTag && (
                    <button
                      type="button"
                      onClick={() => setActiveTag(null)}
                      aria-label={`移除标签筛选 ${activeTag}`}
                    >
                      标签 · {activeTag}
                      <b aria-hidden="true">×</b>
                    </button>
                  )}
                  {activeSource && (
                    <button
                      type="button"
                      onClick={() => setActiveSource(null)}
                      aria-label={`移除来源筛选 ${activeSource}`}
                    >
                      来源 · {activeSource}
                      <b aria-hidden="true">×</b>
                    </button>
                  )}
                  {extraFilter && (
                    <button
                      type="button"
                      onClick={() => setExtraFilter(null)}
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
                onOpenFlashcards={() => navigate("/flashcards")}
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
            <SelectedWorkPanel
              key={selectedWork.id}
              work={selectedWork}
              meta={selectedMeta}
              tableMeta={workMeta[selectedWork.id]}
              isTrashView={isTrashView}
              generating={generating}
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
              onGenerateFlashcards={() => void generateForSelected()}
              onOpenFlashcards={() => {
                const params = new URLSearchParams({
                  work: selectedWork.id,
                  title: selectedWork.title,
                });
                navigate(`/flashcards?${params.toString()}`);
              }}
              onOpenAiSettings={() => navigate("/settings?section=ai")}
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

      {collectionManagerOpen && (
        <CollectionManager
          collections={collections}
          activeCollection={activeCollection}
          action={collectionAction}
          status={collectionManagerStatus}
          statusAction={
            collectionDeleteUndo &&
            (collectionManagerStatus === collectionDeleteUndo.message ||
              collectionAction?.kind === "restore")
              ? {
                  ariaLabel: "撤销删除文件夹",
                  busy: collectionAction?.kind === "restore",
                  label: collectionAction?.kind === "restore" ? "撤销中..." : "撤销",
                  onClick: () => void undoCollectionDelete(),
                }
              : null
          }
          error={collectionManagerError}
          trashCount={trashCount}
          isTrashView={isTrashView}
          onClose={() => {
            if (collectionAction) return;
            setCollectionManagerOpen(false);
            setCollectionManagerStatus(null);
            setCollectionManagerError(null);
            setCollectionDeleteUndo(null);
          }}
          onSelectAll={() => {
            if (collectionAction) return;
            setCollectionDeleteUndo(null);
            clearLibraryView();
            setCollectionManagerOpen(false);
          }}
          onSelectTrash={() => {
            if (collectionAction) return;
            setCollectionDeleteUndo(null);
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
            setCollectionDeleteUndo(null);
            setActiveFilter("all");
            setActiveCollection(collectionId);
            setActiveTag(null);
            setActiveSource(null);
            setExtraFilter(null);
            setSelectedIds(new Set());
            setCollectionManagerOpen(false);
          }}
          onCreate={(parentId) => {
            void handleNewFolder(parentId);
          }}
          onRename={(collection) => {
            void handleRenameFolder(collection.id, collection.name);
          }}
          onDelete={(collection) => {
            void handleDeleteFolder(collection.id, collection.name);
          }}
        />
      )}

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
            <h2 id={titleId}>批量导入题录</h2>
          </div>
          <button
            type="button"
            className="library-modal__close"
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
  onOpenFlashcards,
}: {
  busy: boolean;
  previewMode: boolean;
  onOpenImport: () => void;
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
          从 PDF、DOI、arXiv 或 BibTeX/RIS/NBIB/ENW
          题录文件开始；入库后可以直接进入阅读、生成重点和闪卡。
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
                <Button type="submit" disabled={!canSubmitIdentifier} aria-busy={busy}>
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

function TextPromptDialog({ config, onClose }: { config: TextPromptConfig; onClose: () => void }) {
  const [value, setValue] = useState(config.initialValue ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const titleId = useId();
  const trimmed = value.trim();
  const canSubmit = config.allowEmpty || Boolean(trimmed);
  const isColorPicker = config.inputKind === "color";
  const nativeColorValue = /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : TAG_COLOR_OPTIONS[0].value;

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
      setError(describeSafeError(e));
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
            aria-label={`关闭${config.title}`}
            title={`关闭${config.title}`}
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
        {isColorPicker ? (
          <fieldset className="library-color-picker" disabled={submitting}>
            <legend>{config.label}</legend>
            <div
              className="library-color-picker__swatches"
              role="radiogroup"
              aria-label={config.label}
            >
              {TAG_COLOR_OPTIONS.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  className={
                    trimmed.toLowerCase() === option.value
                      ? "library-color-picker__swatch--active"
                      : ""
                  }
                  data-autofocus={index === 0 ? "true" : undefined}
                  aria-label={option.label}
                  aria-pressed={trimmed.toLowerCase() === option.value}
                  title={option.label}
                  style={{ background: option.value }}
                  onClick={() => {
                    setValue(option.value);
                    setError(null);
                  }}
                />
              ))}
            </div>
            <div className="library-color-picker__custom">
              <label>
                <span>自定义颜色</span>
                <input
                  type="color"
                  value={nativeColorValue}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setError(null);
                  }}
                />
              </label>
              <button
                type="button"
                className={!trimmed ? "library-color-picker__auto--active" : ""}
                aria-pressed={!trimmed}
                onClick={() => {
                  setValue("");
                  setError(null);
                }}
              >
                使用自动配色
              </button>
            </div>
          </fieldset>
        ) : (
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
        )}
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
    { value: "ai-done", title: "AI 已生成" },
    { value: "ai-needed", title: "需要生成 AI" },
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
            <p className="library-modal__subhead">标签、来源和处理状态可以组合使用。</p>
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
            <span>处理状态</span>
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

function CollectionManager({
  collections,
  activeCollection,
  action,
  status,
  statusAction,
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
  action: { id: string; kind: "create" | "delete" | "rename" | "restore" } | null;
  status: string | null;
  statusAction: {
    ariaLabel: string;
    busy: boolean;
    label: string;
    onClick: () => void;
  } | null;
  error: string | null;
  trashCount: number;
  isTrashView: boolean;
  onClose: () => void;
  onSelectAll: () => void;
  onSelectTrash: () => void;
  onSelectCollection: (collectionId: string) => void;
  onCreate: (parentId?: string) => void;
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
            <h2 id={titleId}>管理文件夹</h2>
            <p className="library-modal__subhead">选择当前视图，或整理自定义文件夹。</p>
          </div>
          <button
            type="button"
            className="library-modal__close"
            onClick={requestClose}
            aria-label="关闭管理文件夹"
            title="关闭管理文件夹"
            disabled={busy}
          >
            ×
          </button>
        </div>

        {status && (
          <p className="library-collection-manager__status" role="status" aria-live="polite">
            <span>{status}</span>
            {statusAction ? (
              <button
                type="button"
                className="library-collection-manager__status-action"
                onClick={statusAction.onClick}
                disabled={busy || statusAction.busy}
                aria-busy={statusAction.busy ? "true" : undefined}
                aria-label={statusAction.ariaLabel}
              >
                {statusAction.label}
              </button>
            ) : null}
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
            aria-current={!activeCollection && !isTrashView ? "page" : undefined}
            aria-label={`全部文献，主视图${!activeCollection && !isTrashView ? "，当前视图" : ""}`}
            aria-pressed={!activeCollection && !isTrashView}
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
            aria-current={isTrashView ? "page" : undefined}
            aria-label={`回收站，${trashCount.toLocaleString("zh-CN")} 篇${isTrashView ? "，当前视图" : ""}`}
            aria-pressed={isTrashView}
          >
            <span>回收站</span>
            <small>{trashCount.toLocaleString("zh-CN")} 篇</small>
          </button>
        </div>

        <div className="library-collection-manager__head">
          <span>自定义文件夹</span>
          <button
            type="button"
            onClick={() => onCreate()}
            disabled={busy}
            aria-busy={action?.kind === "create" ? "true" : undefined}
            aria-label="新建文件夹"
          >
            {action?.kind === "create" ? "创建中..." : "新建"}
          </button>
        </div>

        {collections.length === 0 ? (
          <p className="library-panel-empty">还没有文件夹。新建后会同时出现在左侧文件夹树里。</p>
        ) : (
          <ul className="library-collection-manager">
            {collections.map((collection) => {
              const activeAction = action?.id === collection.id ? action.kind : null;
              const parent = collection.parent_id
                ? collections.find((candidate) => candidate.id === collection.parent_id)
                : null;
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
                    aria-current={activeCollection === collection.id ? "page" : undefined}
                    aria-label={`${collection.name}，${collection.count.toLocaleString("zh-CN")} 篇${
                      activeCollection === collection.id ? "，当前视图" : ""
                    }`}
                    title={collection.name}
                  >
                    <span>{collection.name}</span>
                    <small>
                      {parent ? `${parent.name} / ` : ""}
                      {collection.count.toLocaleString("zh-CN")} 篇
                    </small>
                  </button>
                  <button
                    type="button"
                    onClick={() => onCreate(collection.id)}
                    disabled={busy}
                    aria-label={`在 ${collection.name} 中新建子文件夹`}
                    title={`在 ${collection.name} 中新建子文件夹`}
                  >
                    子文件夹
                  </button>
                  <button
                    type="button"
                    onClick={() => onRename(collection)}
                    disabled={busy}
                    aria-busy={activeAction === "rename" ? "true" : undefined}
                    aria-label={`重命名文件夹 ${collection.name}`}
                    title={`重命名 ${collection.name}`}
                  >
                    {activeAction === "rename" ? "保存中..." : "重命名"}
                  </button>
                  <button
                    type="button"
                    className="library-collection-manager__delete"
                    onClick={() => onDelete(collection)}
                    disabled={busy}
                    aria-busy={activeAction === "delete" ? "true" : undefined}
                    aria-label={`删除文件夹 ${collection.name}`}
                    title={`删除 ${collection.name}`}
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

function TagManager({
  initialCreate,
  onClose,
  onChanged,
}: {
  initialCreate?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagPrompt, setTagPrompt] = useState<TextPromptConfig | null>(null);
  const [tagAction, setTagAction] = useState<{
    id: string;
    kind: "color" | "create" | "delete" | "rename" | "restore";
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tagDeleteUndo, setTagDeleteUndo] = useState<TagDeleteUndoState | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();
  const dialogRef = useRef<HTMLElement | null>(null);
  const initialCreateOpenedRef = useRef(false);
  const titleId = useId();
  const tagBusy = tagAction !== null;
  const requestClose = useCallback(() => {
    if (!tagBusy) onClose();
  }, [onClose, tagBusy]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: requestClose,
  });

  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    if (!isDesktopRuntime()) {
      if (!isCurrent()) return;
      setTags([]);
      setLoading(false);
      return;
    }
    const db = await getDb();
    const { TagsRepo } = await import("@aurascholar/db/repos/tags");
    const nextTags = await new TagsRepo(db).list();
    if (!isCurrent()) return;
    setTags(nextTags);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadId = window.setTimeout(() => {
      void load(() => !cancelled);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(loadId);
    };
  }, [load]);

  const repo = useCallback(async () => {
    const { TagsRepo } = await import("@aurascholar/db/repos/tags");
    return new TagsRepo(await getDb());
  }, []);

  const create = useCallback(() => {
    if (tagBusy) return;
    setTagPrompt({
      title: "新建标签",
      label: "标签名称",
      placeholder: "例如：方法论、待读、实验复现",
      confirmLabel: "创建标签",
      onSubmit: async (value) => {
        const next = value.trim();
        const startedAt = Date.now();
        setTagAction({ id: "new", kind: "create" });
        setStatus(`正在创建标签「${next}」...`);
        setError(null);
        setTagDeleteUndo(null);
        try {
          await (await repo()).ensure(next);
          await waitForMinimumElapsed(startedAt, MIN_TAG_ACTION_BUSY_MS);
          await load();
          setStatus(`已创建标签「${next}」`);
          onChanged();
        } catch (e) {
          const createError = new Error(`创建标签失败:${describeSafeError(e)}`);
          setStatus(null);
          setError(createError.message);
          throw createError;
        } finally {
          setTagAction(null);
        }
      },
    });
  }, [load, onChanged, repo, tagBusy]);

  useEffect(() => {
    if (!initialCreate || loading || initialCreateOpenedRef.current) return;
    initialCreateOpenedRef.current = true;
    create();
  }, [create, initialCreate, loading]);

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
          setTagDeleteUndo(null);
          try {
            const smokeFailure = consumeLibrarySmokeTagRenameFailure();
            if (smokeFailure) {
              await waitForMinimumElapsed(startedAt, MIN_TAG_ACTION_BUSY_MS);
              throw smokeFailure;
            }
            await (await repo()).rename(tag.id, next);
            await waitForMinimumElapsed(startedAt, MIN_TAG_ACTION_BUSY_MS);
            await load();
            setStatus(`已重命名为「${next}」`);
            onChanged();
          } catch (e) {
            const message = describeSafeError(e);
            const error = new Error(`重命名标签失败，名称仍保留，可重新保存:${message}`);
            setStatus(null);
            setError(error.message);
            throw error;
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
        label: "选择标签颜色",
        initialValue: tag.color ?? "",
        confirmLabel: "保存",
        description: "选择一种预设颜色，或使用系统取色器创建自己的颜色。",
        allowEmpty: true,
        inputKind: "color",
        onSubmit: async (value) => {
          const next = value.trim();
          const startedAt = Date.now();
          setTagAction({ id: tag.id, kind: "color" });
          setStatus(`正在更新标签「${tag.name}」的颜色...`);
          setError(null);
          setTagDeleteUndo(null);
          try {
            await (await repo()).setColor(tag.id, next || null);
            await waitForMinimumElapsed(startedAt, MIN_TAG_ACTION_BUSY_MS);
            await load();
            setStatus(next ? `已更新标签「${tag.name}」的颜色` : `已清除标签「${tag.name}」的颜色`);
            onChanged();
          } catch (e) {
            const message = describeSafeError(e);
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
        const smokeFailure = consumeLibrarySmokeTagDeleteFailure();
        if (smokeFailure) {
          await waitForMinimumElapsed(startedAt, MIN_TAG_ACTION_BUSY_MS);
          throw smokeFailure;
        }
        const tagsRepo = await repo();
        const workIds = await tagsRepo.workIds(tag.id);
        await tagsRepo.softDelete(tag.id);
        await waitForMinimumElapsed(startedAt, MIN_TAG_ACTION_BUSY_MS);
        await load();
        const undoMessage = `已删除标签「${tag.name}」`;
        setTagDeleteUndo({ id: tag.id, name: tag.name, workIds, message: undoMessage });
        setStatus(undoMessage);
        onChanged();
      } catch (e) {
        setStatus(null);
        setError(`删除标签失败，标签仍保留，可重新删除:${describeSafeError(e)}`);
      } finally {
        setTagAction(null);
      }
    },
    [tagBusy, confirm, repo, load, onChanged],
  );

  const undoTagDelete = useCallback(async () => {
    if (!tagDeleteUndo || tagBusy) return;
    const { id, name, workIds } = tagDeleteUndo;
    const startedAt = Date.now();
    setTagAction({ id, kind: "restore" });
    setStatus(`正在恢复标签「${name}」...`);
    setError(null);
    try {
      const smokeFailure = consumeLibrarySmokeTagRestoreFailure();
      if (smokeFailure) {
        await waitForMinimumElapsed(startedAt, MIN_TAG_ACTION_BUSY_MS);
        throw smokeFailure;
      }
      await (await repo()).restore(id, workIds);
      await waitForMinimumElapsed(startedAt, MIN_TAG_ACTION_BUSY_MS);
      await load();
      const restoredMessage = `已恢复标签「${name}」`;
      setTagDeleteUndo(null);
      setStatus(restoredMessage);
      onChanged();
    } catch (e) {
      setStatus(tagDeleteUndo.message);
      setError(`恢复标签失败，撤销入口仍保留，可重新撤销:${describeSafeError(e)}`);
    } finally {
      setTagAction(null);
    }
  }, [tagBusy, tagDeleteUndo, load, onChanged, repo]);

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
            <div className="library-modal__head-actions">
              <Button
                variant="secondary"
                onClick={create}
                disabled={tagBusy}
                aria-busy={tagAction?.kind === "create" ? "true" : undefined}
              >
                {tagAction?.kind === "create" ? "创建中..." : "新建标签"}
              </Button>
              <button
                type="button"
                className="library-modal__close"
                data-autofocus={loading || tags.length === 0 ? "true" : undefined}
                onClick={requestClose}
                aria-label="关闭管理标签"
                title="关闭管理标签"
                disabled={tagBusy}
              >
                ×
              </button>
            </div>
          </div>
          {status && (
            <p className="library-tag-manager__status" role="status" aria-live="polite">
              <span>{status}</span>
              {tagDeleteUndo &&
              (status === tagDeleteUndo.message || tagAction?.kind === "restore") ? (
                <button
                  type="button"
                  className="library-tag-manager__status-action"
                  onClick={() => void undoTagDelete()}
                  disabled={tagBusy}
                  aria-busy={tagAction?.kind === "restore" ? "true" : undefined}
                  aria-label="撤销删除标签"
                >
                  {tagAction?.kind === "restore" ? "撤销中..." : "撤销"}
                </button>
              ) : null}
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
            <p className="au-text-muted">还没有标签。点击“新建标签”建立第一套整理规则。</p>
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
                      aria-hidden="true"
                      style={tag.color ? { background: tag.color } : undefined}
                    />
                    <span className="library-tag-manager__name" title={tag.name}>
                      {tag.name}
                    </span>
                    <small
                      className="library-tag-manager__count"
                      aria-label={`${tag.count.toLocaleString("zh-CN")} 篇文献`}
                    >
                      {tag.count}
                    </small>
                    <button
                      type="button"
                      data-autofocus={tag === tags[0] ? "true" : undefined}
                      onClick={() => void rename(tag)}
                      disabled={tagBusy}
                      aria-busy={activeAction === "rename" ? "true" : undefined}
                      aria-label={`重命名标签 ${tag.name}`}
                      title={`重命名 ${tag.name}`}
                    >
                      {activeAction === "rename" ? "保存中..." : "重命名"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void recolor(tag)}
                      disabled={tagBusy}
                      aria-busy={activeAction === "color" ? "true" : undefined}
                      aria-label={`设置标签 ${tag.name} 的颜色`}
                      title={`设置 ${tag.name} 的颜色`}
                    >
                      {activeAction === "color" ? "保存中..." : "颜色"}
                    </button>
                    <button
                      type="button"
                      className="library-tag-manager__delete"
                      onClick={() => void remove(tag)}
                      disabled={tagBusy}
                      aria-busy={activeAction === "delete" ? "true" : undefined}
                      aria-label={`删除标签 ${tag.name}`}
                      title={`删除 ${tag.name}`}
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

function moveCollectionRows(
  collections: CollectionRow[],
  detail: MoveCollectionEventDetail,
): CollectionRow[] {
  const moving = collections.find((collection) => collection.id === detail.id);
  if (!moving) return collections;
  const targetSiblings = collections
    .filter((collection) => collection.id !== detail.id && collection.parent_id === detail.parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-CN"));
  const position = Math.max(0, Math.min(Math.trunc(detail.position), targetSiblings.length));
  targetSiblings.splice(position, 0, { ...moving, parent_id: detail.parentId });
  const targetOrder = new Map(targetSiblings.map((collection, index) => [collection.id, index]));
  const previousSiblings = collections
    .filter(
      (collection) => collection.id !== detail.id && collection.parent_id === moving.parent_id,
    )
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-CN"));
  const previousOrder = new Map(
    previousSiblings.map((collection, index) => [collection.id, index]),
  );
  return collections.map((collection) => {
    if (targetOrder.has(collection.id)) {
      return {
        ...collection,
        parent_id: detail.parentId,
        sort_order: targetOrder.get(collection.id)!,
      };
    }
    if (moving.parent_id !== detail.parentId && previousOrder.has(collection.id)) {
      return { ...collection, sort_order: previousOrder.get(collection.id)! };
    }
    return collection;
  });
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
  onOpenAiSettings,
  onOpenGraph,
  onEditMetadata,
  onClose,
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
  onOpenAiSettings: () => void;
  onOpenGraph: () => void;
  onEditMetadata: () => void;
  onClose: () => void;
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
  const tags = (tableMeta?.tags ?? []).slice(0, 4);
  const starActionBusy = typeof starActionBusyTarget === "boolean";
  const readingStatusBusy = Boolean(readingStatusBusyTarget);
  const aiGenerationError = meta?.latestAiJobStatus === "error" ? meta.latestAiJobError : null;
  const showAiSettingsCta = isAiConfigurationError(aiGenerationError);

  if (isTrashView) {
    return (
      <>
        <div className="library-detail au-panel library-detail--selected library-detail--trash">
          <div className="library-panel-heading">
            <span className="library-panel-kicker">回收站文献</span>
            <div className="library-panel-actions">
              <button
                type="button"
                onClick={onRestoreWork}
                disabled={Boolean(workActionBusy)}
                aria-busy={workActionBusy === "restore" ? "true" : undefined}
              >
                {workActionBusy === "restore" ? "恢复中..." : "恢复 ›"}
              </button>
              <button
                type="button"
                className="library-inspector-close"
                onClick={onClose}
                aria-label="关闭文献详情"
                title="关闭详情"
              >
                ×
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
          <Button
            className="library-detail__read"
            onClick={onRestoreWork}
            disabled={Boolean(workActionBusy)}
            aria-busy={workActionBusy === "restore" ? "true" : undefined}
          >
            {workActionBusy === "restore" ? "恢复中..." : "恢复到文献库"}
          </Button>
          <button
            type="button"
            className="library-danger-button"
            onClick={onPurgeWork}
            disabled={Boolean(workActionBusy)}
            aria-busy={workActionBusy === "purge" ? "true" : undefined}
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
    <div className="library-inspector library-detail--selected au-panel">
      <div className="library-inspector__summary">
        <div className="library-panel-heading">
          <span className="library-panel-kicker">当前文献</span>
          <div className="library-panel-actions">
            <button type="button" onClick={onEditMetadata}>
              编辑
            </button>
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
            <button
              type="button"
              className="library-inspector-close"
              onClick={onClose}
              aria-label="关闭文献详情"
              title="关闭详情"
            >
              ×
            </button>
          </div>
        </div>
        <h2>{work.title}</h2>
        <p>{authorText}</p>
        {tags.length > 0 && (
          <div className="library-detail__chips">
            {tags.map((tag, index) => (
              <span
                key={tag}
                className={`library-research-tag library-research-tag--${tagTone(tag, index)}`}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
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
            <strong>{meta ? (meta.pdfCount ? "可读" : "缺失") : "—"}</strong>
            <small>全文</small>
          </span>
        </div>
        <div className="library-reading-toggle" role="group" aria-label="阅读状态">
          {(["unread", "reading", "read"] as const).map((status) => {
            const statusBusy = readingStatusBusyTarget === status;
            const isCurrentStatus = work.reading_status === status;
            const label = readingStatusLabel(status);
            return (
              <button
                key={status}
                type="button"
                aria-label={isCurrentStatus ? `${label}，当前阅读状态` : label}
                aria-pressed={isCurrentStatus}
                className={isCurrentStatus ? "library-reading-toggle__active" : ""}
                onClick={() => onSetReadingStatus(status)}
                disabled={readingStatusBusy}
                aria-busy={statusBusy ? "true" : undefined}
              >
                {statusBusy ? "更新中..." : label}
              </button>
            );
          })}
        </div>
        <Button className="library-detail__read" onClick={onOpenReader}>
          {meta?.pdfCount ? "继续阅读" : "打开阅读器"}
        </Button>
      </div>

      <div className="library-side-tabs" role="tablist" aria-label="文献详情">
        {(
          [
            ["overview", "概览"],
            ["notes", `笔记 ${meta?.annotationCount ?? 0}`],
            ["related", "脉络"],
          ] as const
        ).map(([panel, label]) => (
          <button
            key={panel}
            id={`library-detail-tab-${panel}`}
            aria-controls={`library-detail-panel-${panel}`}
            aria-selected={activePanelTab === panel}
            className={`library-side-tab ${
              activePanelTab === panel ? "library-side-tab--active" : ""
            }`}
            role="tab"
            type="button"
            onClick={() => setActivePanelTab(panel)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className="library-inspector__body"
        id={`library-detail-panel-${activePanelTab}`}
        role="tabpanel"
        aria-labelledby={`library-detail-tab-${activePanelTab}`}
      >
        {activePanelTab === "overview" && (
          <>
            <section className="library-inspector__section">
              <div className="library-panel-heading">
                <h3>摘要</h3>
              </div>
              <p className="library-preview-copy">{work.abstract || "暂无摘要。"}</p>
            </section>
            <section className="library-inspector__section">
              <div className="library-panel-heading">
                <h3>书目信息</h3>
              </div>
              <BibliographicLines work={work} />
              <StatusLine label="题录来源" value={sourceText} variant="neutral" />
            </section>
            <section className="library-inspector__section">
              <div className="library-panel-heading">
                <h3>全文文件</h3>
                <div className="library-panel-actions">
                  <button
                    type="button"
                    onClick={onUploadPdf}
                    disabled={attachingPdf}
                    aria-busy={attachingPdf ? "true" : undefined}
                  >
                    {attachingPdf ? "上传中..." : meta?.pdfCount ? "上传新版本" : "上传 PDF"}
                  </button>
                  {meta && !meta.pdfCount && (
                    <button
                      type="button"
                      onClick={onFindFulltext}
                      disabled={findingFulltext}
                      aria-busy={findingFulltext ? "true" : undefined}
                    >
                      {findingFulltext ? "查找中..." : "查找全文"}
                    </button>
                  )}
                </div>
              </div>
              {!meta ? (
                <div className="library-fulltext-empty" aria-live="polite">
                  正在读取全文信息...
                </div>
              ) : meta.pdfPreview ? (
                <div className="library-fulltext-file">
                  <div className="library-fulltext-file__header">
                    <span>当前阅读版本</span>
                    <Badge variant="success">{meta.pdfPreview.page_count ?? "?"} 页</Badge>
                  </div>
                  <strong title={meta.pdfPreview.original_filename ?? undefined}>
                    {meta.pdfPreview.original_filename ?? "未命名全文文件"}
                  </strong>
                  <div className="library-fulltext-file__meta">
                    <span>{formatAttachmentSize(meta.pdfPreview.byte_size)}</span>
                    <span>{formatAttachmentSource(meta.pdfPreview.fetched_via)}</span>
                    {meta.pdfCount > 1 && <span>共 {meta.pdfCount} 个版本</span>}
                  </div>
                </div>
              ) : (
                <div className="library-fulltext-empty">尚未添加全文文件</div>
              )}
            </section>
            <section className="library-inspector__section">
              <div className="library-panel-heading">
                <h3>处理状态</h3>
              </div>
              <StatusLine
                label="AI 重点"
                value={
                  !meta
                    ? "读取中"
                    : meta.latestAiJobStatus === "done"
                      ? "已生成"
                      : meta.latestAiJobStatus === "error"
                        ? "生成失败"
                        : "待生成"
                }
                variant={
                  !meta
                    ? "neutral"
                    : meta.latestAiJobStatus === "done"
                      ? "success"
                      : meta.latestAiJobStatus === "error"
                        ? "warning"
                        : "neutral"
                }
              />
              <StatusLine
                label="批注"
                value={meta ? `${meta.annotationCount} 条` : "读取中"}
                variant={meta?.annotationCount ? "success" : "neutral"}
              />
              <StatusLine
                label="闪卡"
                value={meta ? `${meta.flashcardCount} 张` : "读取中"}
                variant={meta?.flashcardCount ? "success" : "neutral"}
              />
              {aiGenerationError && (
                <div className="library-panel-recovery" role="alert">
                  <p>{aiGenerationError}</p>
                  {showAiSettingsCta && (
                    <div className="library-panel-recovery__actions">
                      <Button variant="secondary" onClick={onOpenAiSettings}>
                        配置 AI
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </section>
            <section className="library-inspector__section library-inspector__section--danger">
              <button
                type="button"
                className="library-detail__secondary-danger"
                onClick={onDeleteWork}
                disabled={Boolean(workActionBusy)}
                aria-busy={workActionBusy === "trash" ? "true" : undefined}
              >
                {workActionBusy === "trash" ? "移入中..." : "移入回收站"}
              </button>
            </section>
          </>
        )}

        {activePanelTab === "notes" && (
          <>
            <NotesPanel meta={meta} onOpenReader={onOpenReader} />
            <section className="library-inspector__section">
              <div className="library-panel-heading">
                <h3>闪卡</h3>
                <button type="button" onClick={onOpenFlashcards}>
                  查看全部
                </button>
              </div>
              <StatusLine
                label="当前文献"
                value={meta ? `${meta.flashcardCount} 张` : "读取中"}
                variant={meta?.flashcardCount ? "success" : "neutral"}
              />
              {aiGenerationError && (
                <div className="library-panel-recovery" role="alert">
                  <p>{aiGenerationError}</p>
                  {showAiSettingsCta && (
                    <div className="library-panel-recovery__actions">
                      <Button variant="secondary" onClick={onOpenAiSettings}>
                        去配置 AI
                      </Button>
                    </div>
                  )}
                </div>
              )}
              <Button
                className="library-panel-action"
                variant={meta?.flashcardCount ? "secondary" : "primary"}
                onClick={onGenerateFlashcards}
                disabled={generating}
                aria-busy={generating ? "true" : undefined}
              >
                {generating
                  ? "生成中..."
                  : aiGenerationError
                    ? "重试生成闪卡"
                    : meta?.flashcardCount
                      ? "重新生成闪卡"
                      : "生成闪卡"}
              </Button>
            </section>
          </>
        )}

        {activePanelTab === "related" && (
          <section className="library-inspector__section">
            <div className="library-panel-heading">
              <h3>引用脉络</h3>
              <button type="button" onClick={onOpenGraph}>
                打开图谱
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
          </section>
        )}
      </div>
    </div>
  );
}

function NotesPanel({
  meta,
  onOpenReader,
}: {
  meta: WorkRuntimeMeta | null;
  onOpenReader: () => void;
}) {
  const notes = meta?.notePreviews ?? [];
  return (
    <section className="library-inspector__section">
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
        <div className="library-notes-list library-notes-list--expanded">
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
    </section>
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

function formatAttachmentSource(source: string | null) {
  if (!source) return "来源未知";
  const labels: Record<string, string> = {
    manual: "手动上传",
    preview: "示例文件",
    "research-download": "检索下载",
    unpaywall: "Unpaywall",
    arxiv: "arXiv",
    openalex: "OpenAlex",
  };
  return labels[source] ?? source;
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
