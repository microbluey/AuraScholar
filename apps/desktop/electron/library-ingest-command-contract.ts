import type { WorkInput } from "@aurascholar/db/repos/works";

/**
 * Renderer metadata attached to a main-owned PDF staging receipt. Hash and
 * byte length deliberately do not cross this boundary: both are derived by
 * the main process when `library.stagePdf` persists the canonical blob.
 */
export interface LibraryFinalizeIngestPdfInput {
  fetchedVia: LibraryFinalizeIngestPdfFetchedVia;
  fileName: string;
  pageCount: number;
  stageId: string;
  /** Canonical HTTP(S) source retained for automatically acquired OA PDFs. */
  sourceUrl?: string;
}

/** Provenance accepted for a staged PDF receipt. */
export type LibraryFinalizeIngestPdfFetchedVia =
  | "arxiv"
  | "manual"
  | "openalex"
  | "research-download"
  | "unpaywall";

/** Raw bytes accepted only by the main-owned content-addressed blob writer. */
export interface LibraryStagePdfCommandInput {
  bytes: Uint8Array;
}

/**
 * Opaque, one-time receipt for a main-owned canonical PDF blob. `stageId` is
 * the capability later consumed by `library.finalizeIngest`; only the main
 * process can resolve it back to the authoritative hash and byte length.
 */
export interface LibraryStagePdfCommandResult {
  byteSize: number;
  sha: string;
  stageId: string;
}

/** Removes an uncommitted staging capability; canonical blobs are never deleted here. */
export interface LibraryReleaseStagedPdfCommandInput {
  stageId: string;
}

/**
 * A deliberately narrow, active-Library-only dedup lookup used while an
 * import is still being analyzed. It is not a general attachment or work
 * query: it exposes only the title, active work id, and an existing PDF page
 * count when the hash branch finds one.
 */
export type LibraryFindIngestDedupCommandInput =
  | { kind: "attachmentSha"; sha256: string }
  | { doi: string; kind: "doi" };

export type LibraryIngestDedupHit =
  | {
      pageCount: number | null;
      reason: "exact-file";
      title: string;
      workId: string;
    }
  | {
      reason: "doi";
      title: string;
      workId: string;
    };

export interface LibraryFindIngestDedupCommandResult {
  hit: LibraryIngestDedupHit | null;
}

/**
 * Commit a user-confirmed ingest decision. Main derives the active local
 * Library and either creates/upserts one work or validates one active work
 * before it creates an optional staged-PDF attachment.
 */
export type LibraryFinalizeIngestCommandInput =
  | {
      mode: "attach";
      pdf: LibraryFinalizeIngestPdfInput | null;
      workId: string;
    }
  | {
      mode: "create";
      pdf: LibraryFinalizeIngestPdfInput | null;
      workInput: WorkInput;
    };

export interface LibraryFinalizeIngestAttachmentResult {
  deduped: boolean;
  id: string;
}

/**
 * Keeps the prior ingest result fields while making attachment deduplication
 * explicit for the former staged-PDF attach call sites.
 */
export interface LibraryFinalizeIngestCommandResult {
  attachment: LibraryFinalizeIngestAttachmentResult | null;
  deduped: boolean;
  pdfFetched: boolean;
  title: string;
  workId: string;
}

export interface LibraryIngestDataCommandMap {
  "library.findIngestDedup": {
    input: LibraryFindIngestDedupCommandInput;
    output: LibraryFindIngestDedupCommandResult;
  };
  "library.releaseStagedPdf": {
    input: LibraryReleaseStagedPdfCommandInput;
    output: { released: boolean };
  };
  "library.stagePdf": {
    input: LibraryStagePdfCommandInput;
    output: LibraryStagePdfCommandResult;
  };
  "library.finalizeIngest": {
    input: LibraryFinalizeIngestCommandInput;
    output: LibraryFinalizeIngestCommandResult;
  };
}
