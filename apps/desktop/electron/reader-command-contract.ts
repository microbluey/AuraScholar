/**
 * Reader-owned work metadata. This is intentionally narrower than the
 * persisted Work row: the Reader only needs enough context to render the
 * document session and its recovery state.
 */
export interface ReaderWork {
  arxiv_id: string | null;
  authorNames: string[];
  deleted_at: number | null;
  doi: string | null;
  id: string;
  title: string;
  year: number | null;
}

/**
 * Reader-owned attachment metadata. Blob bytes are read through their own
 * bounded command and no storage- or ingestion-specific fields cross IPC.
 */
export interface ReaderAttachment {
  byte_size: number;
  id: string;
  kind: string;
  original_filename: string | null;
  sha256: string;
  work_id: string;
}

/**
 * Reader-owned annotation metadata. Ink paths and persistence bookkeeping
 * never leave the main process on the Reader session path.
 */
export interface ReaderAnnotation {
  anchor_json: string | null;
  color: string | null;
  content_md: string | null;
  id: string;
  orphaned: number;
  page_index: number;
  type: string;
}

/** Reader metadata request scoped by the main process to the local Library. */
export interface ReaderGetWorkPdfCandidatesCommandInput {
  workId: string;
}

/**
 * A missing work is represented explicitly. Archived local works retain their
 * context but deliberately have no readable PDF candidates.
 */
export interface ReaderGetWorkPdfCandidatesCommandResult {
  pdfAttachments: ReaderAttachment[];
  work: ReaderWork | null;
}

/** A selected attachment must be asserted against its parent work. */
export interface ReaderGetAttachmentCommandInput {
  attachmentId: string;
  workId: string;
}

export interface ReaderGetAttachmentCommandResult {
  attachment: ReaderAttachment | null;
}

/** Reads one active PDF attachment through a main-owned canonical BlobStore path. */
export interface ReaderReadAttachmentPdfCommandInput {
  attachmentId: string;
  workId: string;
}

export interface ReaderReadAttachmentPdfCommandResult {
  data: Uint8Array;
}

/** Annotation reads are scoped to one active work and active attachment. */
export interface ReaderListAnnotationsCommandInput {
  attachmentId: string;
  workId: string;
}

export interface ReaderListAnnotationsCommandResult {
  annotations: ReaderAnnotation[];
}

/**
 * Create an annotation for an active attachment on an active work. The
 * renderer names both parent records, but the main process derives the
 * Library and verifies that relationship before the write is committed.
 */
export interface ReaderCreateAnnotationCommandInput {
  attachmentId: string;
  anchor?: unknown;
  color?: string;
  contentMd?: string;
  inkPaths?: unknown;
  pageIndex: number;
  type: string;
  workId: string;
}

export interface ReaderCreateAnnotationCommandResult {
  annotationId: string;
}

/** Annotation mutation requests never accept a renderer-selected Library. */
export interface ReaderDeleteAnnotationCommandInput {
  annotationId: string;
}

export interface ReaderDeleteAnnotationCommandResult {
  updated: 1;
}

export interface ReaderRestoreAnnotationCommandInput {
  annotationId: string;
}

export interface ReaderRestoreAnnotationCommandResult {
  updated: 1;
}

export interface ReaderUpdateAnnotationContentCommandInput {
  annotationId: string;
  contentMd: string;
}

export interface ReaderUpdateAnnotationContentCommandResult {
  updated: 1;
}

export interface ReaderMarkWorkReadingStartedCommandInput {
  workId: string;
}

export interface ReaderMarkWorkReadingStartedCommandResult {
  /** False when the work is already reading/read, missing, removed, or foreign. */
  started: boolean;
}

/**
 * Reader-only main-process operations. No renderer command may select a
 * Library identity; every handler derives it from the durable local-first
 * state.
 */
export interface ReaderDataCommandMap {
  "reader.createAnnotation": {
    input: ReaderCreateAnnotationCommandInput;
    output: ReaderCreateAnnotationCommandResult;
  };
  "reader.deleteAnnotation": {
    input: ReaderDeleteAnnotationCommandInput;
    output: ReaderDeleteAnnotationCommandResult;
  };
  "reader.getAttachment": {
    input: ReaderGetAttachmentCommandInput;
    output: ReaderGetAttachmentCommandResult;
  };
  "reader.getWorkPdfCandidates": {
    input: ReaderGetWorkPdfCandidatesCommandInput;
    output: ReaderGetWorkPdfCandidatesCommandResult;
  };
  "reader.readAttachmentPdf": {
    input: ReaderReadAttachmentPdfCommandInput;
    output: ReaderReadAttachmentPdfCommandResult;
  };
  "reader.listAnnotations": {
    input: ReaderListAnnotationsCommandInput;
    output: ReaderListAnnotationsCommandResult;
  };
  "reader.markWorkReadingStarted": {
    input: ReaderMarkWorkReadingStartedCommandInput;
    output: ReaderMarkWorkReadingStartedCommandResult;
  };
  "reader.restoreAnnotation": {
    input: ReaderRestoreAnnotationCommandInput;
    output: ReaderRestoreAnnotationCommandResult;
  };
  "reader.updateAnnotationContent": {
    input: ReaderUpdateAnnotationContentCommandInput;
    output: ReaderUpdateAnnotationContentCommandResult;
  };
}
