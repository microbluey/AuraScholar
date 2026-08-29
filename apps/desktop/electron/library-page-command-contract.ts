import type { CollectionRow } from "@aurascholar/db";
import type { WorkPageBrowseSummary, WorkPageWork } from "@aurascholar/db/work-page";
import type { ReadingStatus } from "@aurascholar/db/repos/works";

/** Renderer-facing filters for one bounded Library results page. */
export type LibraryPageFilter = "all" | "reading" | "unread" | "noted" | "starred" | "trash";
export type LibraryPageExtraFilter = "with-pdf" | "without-pdf";
export type LibraryPageSort = "added" | "year";

/**
 * A semantic page request deliberately has no Library id. The main process
 * resolves and validates the durable local Library identity itself.
 */
export interface LibraryGetPageCommandInput {
  collectionId?: string;
  extraFilter?: LibraryPageExtraFilter | null;
  filter?: LibraryPageFilter;
  focusWorkId?: string;
  limit: number;
  offset?: number;
  search?: string;
  showTrash?: boolean;
  sort?: LibraryPageSort;
  source?: string | null;
  status?: ReadingStatus;
  tag?: string | null;
}

export interface LibraryWorkNotePreview {
  content_md: string | null;
  id: string;
  page_index: number;
  type: string;
  updated_at: number;
}

export interface LibraryWorkTableMeta {
  annotations: number;
  citedBy: number;
  pdfs: number;
  references: number;
  sentinelState: string | null;
  sentinelStatus: string | null;
  sentinelTaskCount: number;
  tags: string[];
}

export interface LibraryGetPageCommandResult {
  browseSummary: WorkPageBrowseSummary;
  collections: CollectionRow[];
  limit: number;
  offset: number;
  total: number;
  trashCount: number;
  workMeta: Record<string, LibraryWorkTableMeta>;
  works: WorkPageWork[];
}

/** Narrow read-only bibliography shown by the Library inspector. */
export interface LibraryWorkInspectorDetail {
  abstract: string | null;
  doi: string | null;
  edition: string | null;
  isbn: string | null;
  issn: string | null;
  issue: string | null;
  language: string | null;
  pages: string | null;
  place_published: string | null;
  publisher: string | null;
  volume: string | null;
}

/** Main resolves the active local Library and returns a bounded detail DTO. */
export interface LibraryGetWorkInspectorDetailCommandInput {
  workId: string;
}

export interface LibraryGetWorkInspectorDetailCommandResult {
  detail: LibraryWorkInspectorDetail | null;
}

/** Runtime details are loaded on demand for the currently selected work. */
export interface LibraryGetWorkRuntimeMetaCommandInput {
  annotationCount: number;
  workId: string;
}

/** Minimal PDF information rendered in the selected-work inspector. */
export interface LibraryWorkPdfPreview {
  byte_size: number;
  fetched_via: string | null;
  original_filename: string | null;
  page_count: number | null;
}

export interface LibraryGetWorkRuntimeMetaCommandResult {
  annotationCount: number;
  notePreviews: LibraryWorkNotePreview[];
  pdfCount: number;
  pdfPreview: LibraryWorkPdfPreview | null;
  sentinelState: string | null;
  sentinelStatus: string | null;
  sentinelTaskCount: number;
}
