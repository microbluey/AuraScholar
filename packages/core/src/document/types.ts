export const DOCUMENT_ASSET_KINDS = [
  "pdf",
  "html",
  "docx",
  "markdown",
  "epub",
  "notebook",
  "supplement",
  "other",
] as const;

export type DocumentAssetKind = (typeof DOCUMENT_ASSET_KINDS)[number];

export const DOCUMENT_EXTRACTION_STATUSES = [
  "pending",
  "running",
  "ready",
  "failed",
  "unsupported",
] as const;

export type DocumentExtractionStatus = (typeof DOCUMENT_EXTRACTION_STATUSES)[number];

export const DOCUMENT_AVAILABILITY_STATUSES = [
  "unchecked",
  "available",
  "missing",
  "relink-required",
] as const;

export type DocumentAvailabilityStatus = (typeof DOCUMENT_AVAILABILITY_STATUSES)[number];

/** Stable logical identity shared by every immutable version of one document. */
export interface DocumentAsset {
  id: string;
  libraryId: string;
  workId: string | null;
  kind: DocumentAssetKind;
  title: string;
  currentRevisionId: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** Immutable source bytes plus mutable extraction/availability observations. */
export interface DocumentRevision {
  id: string;
  assetId: string;
  attachmentId: string | null;
  /** Local display ordinal. Concurrent offline revisions may share this value. */
  revisionNo: number;
  mimeType: string;
  blobSha256: string;
  byteSize: number;
  sourceUrl: string | null;
  extractorProfile: string | null;
  extractionStatus: DocumentExtractionStatus;
  availabilityStatus: DocumentAvailabilityStatus;
  availabilityCheckedAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export type DocumentRevisionPosition = "current" | "historical" | "removed";

export interface ResolvedDocumentRevision {
  asset: DocumentAsset;
  revision: DocumentRevision;
  position: DocumentRevisionPosition;
}
