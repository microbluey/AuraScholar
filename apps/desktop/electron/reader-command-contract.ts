import type { AnnotationRow } from "@aurascholar/db/repos/annotations";
import type { AttachmentRow } from "@aurascholar/db/repos/attachments";
import type { WorkWithAuthors } from "@aurascholar/db/repos/works";

/** Reader metadata request scoped by the main process to the local Library. */
export interface ReaderGetWorkPdfCandidatesCommandInput {
  workId: string;
}

/**
 * A missing work is represented explicitly. Archived local works retain their
 * context but deliberately have no readable PDF candidates.
 */
export interface ReaderGetWorkPdfCandidatesCommandResult {
  pdfAttachments: AttachmentRow[];
  work: WorkWithAuthors | null;
}

/** A selected attachment must be asserted against its parent work. */
export interface ReaderGetAttachmentCommandInput {
  attachmentId: string;
  workId: string;
}

export interface ReaderGetAttachmentCommandResult {
  attachment: AttachmentRow | null;
}

/** Annotation reads are scoped to one active work and active attachment. */
export interface ReaderListAnnotationsCommandInput {
  attachmentId: string;
  workId: string;
}

export interface ReaderListAnnotationsCommandResult {
  annotations: AnnotationRow[];
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
