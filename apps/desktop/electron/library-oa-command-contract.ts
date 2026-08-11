/**
 * Ask main to find and attach a legal OA PDF for one existing local work.
 * The renderer supplies neither an endpoint nor file bytes: main derives the
 * active Library, work identifiers, OA candidates, and attachment provenance.
 */
export interface LibraryEnsureOaPdfAttachmentCommandInput {
  workId: string;
}

/** `attached` is false for missing, unreadable, unavailable, or rejected OA PDFs. */
export interface LibraryEnsureOaPdfAttachmentCommandResult {
  attached: boolean;
}

export interface LibraryOaDataCommandMap {
  "library.ensureOaPdfAttachment": {
    input: LibraryEnsureOaPdfAttachmentCommandInput;
    output: LibraryEnsureOaPdfAttachmentCommandResult;
  };
}
