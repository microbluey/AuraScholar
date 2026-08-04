/** Stable profile identifiers are part of ContentUnit identity. */
export const PDF_TEXT_EXTRACTOR_PROFILE_V1 = "pdf-text-v1";
export const ANNOTATION_EXTRACTOR_PROFILE_V1 = "annotation-v1";
export const EVIDENCE_EXTRACTOR_PROFILE_V1 = "evidence-v1";

export const PDF_PAGE_CHUNK_PROFILE_V1 = "pdf-page-v1";
export const PDF_PAGE_CONTEXT_CHUNK_PROFILE_V1 = "pdf-page-context-v1";
export const PDF_WINDOW_CHUNK_PROFILE_V1 = "pdf-window-v1";
export const ANNOTATION_CHUNK_PROFILE_V1 = "annotation-short-v1";
export const EVIDENCE_CHUNK_PROFILE_V1 = "evidence-short-v1";

/** The normal case is one structural unit per PDF page. */
export const DEFAULT_PDF_MAX_UNIT_CHARS = 12_000;
/** Overlap is only used by the bounded fallback for oversized pages. */
export const DEFAULT_PDF_OVERLAP_CHARS = 200;
/** The reader's frozen quote context window. */
export const CONTENT_UNIT_CONTEXT_CHARS = 32;

/** Prevent annotation/Evidence adapters from turning into arbitrary blobs. */
export const MAX_SHORT_CONTENT_UNIT_CHARS = 256 * 1024;
/** A structural parent may be larger than a child window, but remains bounded. */
export const MAX_STRUCTURAL_CONTENT_UNIT_CHARS = 4 * 1024 * 1024;
