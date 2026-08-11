import type {
  LibraryGetPageCommandInput,
  LibraryGetPageCommandResult,
  LibraryGetWorkRuntimeMetaCommandResult,
  LibraryWorkNotePreview,
  LibraryWorkTableMeta,
} from "../../electron/data-command-contract";

export type WorkNotePreview = LibraryWorkNotePreview;
export type WorkTableMeta = LibraryWorkTableMeta;
export type WorkRuntimeMeta = LibraryGetWorkRuntimeMetaCommandResult;
export type LibraryPageDataInput = LibraryGetPageCommandInput;
export type LibraryPageBrowseSummary = LibraryGetPageCommandResult["browseSummary"];
export type LibraryPageData = LibraryGetPageCommandResult;

export function emptyWorkMeta(): WorkTableMeta {
  return {
    annotations: 0,
    citedBy: 0,
    pdfs: 0,
    references: 0,
    sentinelState: null,
    sentinelStatus: null,
    sentinelTaskCount: 0,
    tags: [],
  };
}

/**
 * Renderer facade for the bounded Library page DTO. Its implementation stays
 * intentionally free of database and SQL capabilities; the main process owns
 * pagination, scope validation, and all snapshot reads.
 */
export function loadLibraryPageData(input: LibraryPageDataInput): Promise<LibraryPageData> {
  return window.aura.data.command("library.getPage", input);
}

/** Loads inspector-only details without re-exposing the generic SQL bridge. */
export function loadLibraryWorkRuntimeMeta(
  workId: string,
  annotationCount: number,
): Promise<WorkRuntimeMeta> {
  return window.aura.data.command("library.getWorkRuntimeMeta", { annotationCount, workId });
}
