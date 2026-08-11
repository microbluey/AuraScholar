import type {
  LibraryGetPageCommandInput,
  LibraryGetPageCommandResult,
  LibraryGetWorkRuntimeMetaCommandInput,
  LibraryGetWorkRuntimeMetaCommandResult,
} from "./library-page-command-contract";
import type { CslItem } from "@aurascholar/cite";
import type { ReadingStatus } from "@aurascholar/db/repos/works";

/** A deliberately empty request: the main process resolves the local Library. */
export type LibraryScopeCommandInput = Record<string, never>;

export interface LibraryGetScopeCommandResult {
  libraryId: string;
}

export interface LibraryShellCollection {
  count: number;
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
}

/** Counts and sidebar data rendered by the desktop application shell. */
export interface LibraryGetShellStatsCommandResult {
  annotations: number;
  canvasNodes: number;
  collections: LibraryShellCollection[];
  snippets: number;
  total: number;
  trash: number;
}

/** Tag data rendered by the Library manager, without an owning Library id. */
export interface LibraryTagSummary {
  color: string | null;
  count: number;
  id: string;
  name: string;
}

export interface LibraryListTagsCommandResult {
  tags: LibraryTagSummary[];
}

/** A narrow renderer DTO for lightweight active-Library work lists. */
export interface LibraryListWork {
  abstract: string | null;
  authorNames: string[];
  createdAt: number;
  doi: string | null;
  id: string;
  readingStatus: ReadingStatus;
  starred: boolean;
  title: string;
  venueName: string | null;
  year: number | null;
}

/** A bounded recent-work list; the main process always derives Library scope. */
export interface LibraryListWorksCommandInput {
  limit?: number;
}

export interface LibraryListWorksCommandResult {
  works: LibraryListWork[];
}

/** Metadata search extends the lightweight list DTO with active tag names. */
export interface LibraryMetadataSearchWork extends LibraryListWork {
  tagNames: string[];
}

export interface LibrarySearchWorksByMetadataCommandInput {
  limit?: number;
  search: string;
}

export interface LibrarySearchWorksByMetadataCommandResult {
  works: LibraryMetadataSearchWork[];
}

/**
 * Requests are ordered deliberately: bibliography exports retain the user's
 * selected order, while missing, deleted, and foreign work ids are omitted.
 */
export interface LibraryGetCslItemsCommandInput {
  workIds: string[];
}

/**
 * A formatting-only projection. Raw work rows and their owning Library id
 * remain in main; this is the complete data shape the renderer needs to
 * generate bibliographies and export files.
 */
export interface LibraryGetCslItemsCommandResult {
  items: CslItem[];
}

/**
 * Main-process reads that deliberately derive their Library scope rather than
 * accepting a renderer-supplied Library id.
 */
export interface LibraryReadDataCommandMap {
  "library.getCslItems": {
    input: LibraryGetCslItemsCommandInput;
    output: LibraryGetCslItemsCommandResult;
  };
  "library.getPage": {
    input: LibraryGetPageCommandInput;
    output: LibraryGetPageCommandResult;
  };
  "library.getScope": {
    input: LibraryScopeCommandInput;
    output: LibraryGetScopeCommandResult;
  };
  "library.getShellStats": {
    input: LibraryScopeCommandInput;
    output: LibraryGetShellStatsCommandResult;
  };
  "library.listTags": {
    input: LibraryScopeCommandInput;
    output: LibraryListTagsCommandResult;
  };
  "library.listWorks": {
    input: LibraryListWorksCommandInput;
    output: LibraryListWorksCommandResult;
  };
  "library.searchWorksByMetadata": {
    input: LibrarySearchWorksByMetadataCommandInput;
    output: LibrarySearchWorksByMetadataCommandResult;
  };
  "library.getWorkRuntimeMeta": {
    input: LibraryGetWorkRuntimeMetaCommandInput;
    output: LibraryGetWorkRuntimeMetaCommandResult;
  };
}
