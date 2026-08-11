import type { ImportFormat } from "@aurascholar/cite";

/**
 * The renderer submits only the original reference export. Main parses it,
 * resolves the durable local Library, and creates the work inputs itself.
 */
export interface LibraryImportReferencesCommandInput {
  format?: ImportFormat;
  text: string;
}

export interface LibraryImportReferencesCommandResult {
  deduped: number;
  imported: number;
  total: number;
}

export interface ReferenceImportDataCommandMap {
  "library.importReferences": {
    input: LibraryImportReferencesCommandInput;
    output: LibraryImportReferencesCommandResult;
  };
}
