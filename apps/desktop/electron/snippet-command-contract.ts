import type { SnippetWithWork } from "@aurascholar/db/repos/snippets";

export type { SnippetWithWork } from "@aurascholar/db/repos/snippets";

/** A snippet is always created beneath the active local Library in main. */
export interface SnippetCreateCommandInput {
  noteMd?: string | null;
  pageIndex?: number | null;
  quote: string;
  tag?: string | null;
  workId: string;
}

export interface SnippetCreateCommandResult {
  snippetId: string;
}

/** The renderer never supplies a Library identity for snippet queries. */
export type SnippetListAllCommandInput = Record<string, never>;

export interface SnippetListAllCommandResult {
  snippets: SnippetWithWork[];
}

export interface SnippetUpdateNoteCommandInput {
  noteMd: string | null;
  snippetId: string;
}

export interface SnippetMutationCommandInput {
  snippetId: string;
}

export interface SnippetMutationCommandResult {
  updated: 1;
}

/**
 * Typed snippet commands. Main resolves the durable local Library for every
 * read and mutation, so record ids cannot select another Library's rows.
 */
export interface SnippetDataCommandMap {
  "snippet.create": {
    input: SnippetCreateCommandInput;
    output: SnippetCreateCommandResult;
  };
  "snippet.delete": {
    input: SnippetMutationCommandInput;
    output: SnippetMutationCommandResult;
  };
  "snippet.listAll": {
    input: SnippetListAllCommandInput;
    output: SnippetListAllCommandResult;
  };
  "snippet.restore": {
    input: SnippetMutationCommandInput;
    output: SnippetMutationCommandResult;
  };
  "snippet.updateNote": {
    input: SnippetUpdateNoteCommandInput;
    output: SnippetMutationCommandResult;
  };
}
