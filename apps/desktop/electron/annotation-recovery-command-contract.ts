/**
 * Rebind active annotations from historical, soft-deleted PDF attachments to
 * the freshly active PDF attachment for the same work. Library scope is
 * intentionally absent: main resolves the durable local Library itself.
 */
export interface LibraryRestoreAnnotationsForAttachmentCommandInput {
  attachmentId: string;
  workId: string;
}

export interface LibraryRestoreAnnotationsForAttachmentCommandResult {
  restoredAnnotationCount: number;
}

export interface AnnotationRecoveryDataCommandMap {
  "library.restoreAnnotationsForAttachment": {
    input: LibraryRestoreAnnotationsForAttachmentCommandInput;
    output: LibraryRestoreAnnotationsForAttachmentCommandResult;
  };
}
