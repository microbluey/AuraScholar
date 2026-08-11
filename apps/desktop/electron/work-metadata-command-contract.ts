import type { WorkAuthorDetail, WorkPatch, WorkRow } from "@aurascholar/db/repos/works";

/** Complete metadata needed by the existing detail editor. */
export interface WorkMetadataSnapshot {
  authors: WorkAuthorDetail[];
  keywords: string[];
  work: WorkRow;
}

/** Main resolves the active local Library; callers submit only a work id. */
export interface LibraryGetWorkMetadataCommandInput {
  workId: string;
}

export interface LibraryGetWorkMetadataCommandResult {
  metadata: WorkMetadataSnapshot | null;
}

/** Main resolves the active local Library before applying this partial patch. */
export interface LibraryUpdateWorkMetadataCommandInput {
  patch: WorkPatch;
  workId: string;
}

export interface LibraryUpdateWorkMetadataCommandResult {
  updated: 1;
}

/**
 * Metadata commands deliberately have no renderer-supplied Library identity.
 * The main process derives it from the durable local-first state for every
 * read and mutation.
 */
export interface WorkMetadataDataCommandMap {
  "library.getWorkMetadata": {
    input: LibraryGetWorkMetadataCommandInput;
    output: LibraryGetWorkMetadataCommandResult;
  };
  "library.updateWorkMetadata": {
    input: LibraryUpdateWorkMetadataCommandInput;
    output: LibraryUpdateWorkMetadataCommandResult;
  };
}
