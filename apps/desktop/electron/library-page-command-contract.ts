import type { AttachmentRow, CollectionRow, WorkWithAuthors } from "@aurascholar/db";
import type { WorkPageBrowseSummary } from "@aurascholar/db/work-page";
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
  works: WorkWithAuthors[];
}

/** Runtime details are loaded on demand for the currently selected work. */
export interface LibraryGetWorkRuntimeMetaCommandInput {
  annotationCount: number;
  workId: string;
}

export interface LibraryGetWorkRuntimeMetaCommandResult {
  annotationCount: number;
  notePreviews: LibraryWorkNotePreview[];
  pdfCount: number;
  pdfPreview: AttachmentRow | null;
  sentinelState: string | null;
  sentinelStatus: string | null;
  sentinelTaskCount: number;
}
