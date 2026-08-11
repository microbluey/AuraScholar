import type {
  ReaderCreateAnnotationCommandInput,
  ReaderCreateAnnotationCommandResult,
  ReaderDeleteAnnotationCommandInput,
  ReaderDeleteAnnotationCommandResult,
  ReaderGetAttachmentCommandResult,
  ReaderGetWorkPdfCandidatesCommandResult,
  ReaderListAnnotationsCommandResult,
  ReaderMarkWorkReadingStartedCommandInput,
  ReaderMarkWorkReadingStartedCommandResult,
  ReaderRestoreAnnotationCommandInput,
  ReaderRestoreAnnotationCommandResult,
  ReaderUpdateAnnotationContentCommandInput,
  ReaderUpdateAnnotationContentCommandResult,
} from "../../electron/data-command-contract";

/**
 * Renderer-facing Reader data facade. These commands intentionally derive the
 * active Library in the main process, rather than exposing database access to
 * the Reader surface.
 */
export type ReaderWorkPdfCandidates = ReaderGetWorkPdfCandidatesCommandResult;
export type ReaderAttachment = ReaderGetAttachmentCommandResult;
export type ReaderAnnotations = ReaderListAnnotationsCommandResult;
export type ReaderCreatedAnnotation = ReaderCreateAnnotationCommandResult;
export type ReaderDeletedAnnotation = ReaderDeleteAnnotationCommandResult;
export type ReaderRestoredAnnotation = ReaderRestoreAnnotationCommandResult;
export type ReaderUpdatedAnnotationContent = ReaderUpdateAnnotationContentCommandResult;
export type ReaderWorkReadingStarted = ReaderMarkWorkReadingStartedCommandResult;

export function loadReaderWorkPdfCandidates(workId: string): Promise<ReaderWorkPdfCandidates> {
  return window.aura.data.command("reader.getWorkPdfCandidates", { workId });
}

export function loadReaderAttachment(
  workId: string,
  attachmentId: string,
): Promise<ReaderAttachment> {
  return window.aura.data.command("reader.getAttachment", { attachmentId, workId });
}

export function loadReaderAnnotations(
  workId: string,
  attachmentId: string,
): Promise<ReaderAnnotations> {
  return window.aura.data.command("reader.listAnnotations", { attachmentId, workId });
}

/**
 * Persists a Reader annotation under a main-process-derived local Library
 * scope. The input deliberately has no renderer-supplied Library identity.
 */
export function createReaderAnnotation(
  input: ReaderCreateAnnotationCommandInput,
): Promise<ReaderCreatedAnnotation> {
  return window.aura.data.command("reader.createAnnotation", input);
}

export function deleteReaderAnnotation(
  input: ReaderDeleteAnnotationCommandInput,
): Promise<ReaderDeletedAnnotation> {
  return window.aura.data.command("reader.deleteAnnotation", input);
}

export function restoreReaderAnnotation(
  input: ReaderRestoreAnnotationCommandInput,
): Promise<ReaderRestoredAnnotation> {
  return window.aura.data.command("reader.restoreAnnotation", input);
}

export function updateReaderAnnotationContent(
  input: ReaderUpdateAnnotationContentCommandInput,
): Promise<ReaderUpdatedAnnotationContent> {
  return window.aura.data.command("reader.updateAnnotationContent", input);
}

export function markReaderWorkReadingStarted(
  input: ReaderMarkWorkReadingStartedCommandInput,
): Promise<ReaderWorkReadingStarted> {
  return window.aura.data.command("reader.markWorkReadingStarted", input);
}
