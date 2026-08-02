import type {
  EvidenceKind,
  EvidenceRecord,
  PdfTextEvidenceAnchorInput,
} from "@aurascholar/db/repos/evidence";

export interface DocumentRevisionCommandInput {
  attachmentId: string;
  expectedBlobSha256?: string;
  libraryId: string;
  workId: string;
}

export interface ResolvedDocumentRevisionDto {
  assetId: string;
  attachmentId: string | null;
  availabilityStatus: "unchecked" | "available" | "missing" | "relink-required";
  blobSha256: string;
  currentRevisionId: string | null;
  pageCount: number | null;
  revisionId: string;
  revisionNo: number;
  workId: string;
}

export interface SaveTextEvidenceCommandInput {
  anchor: PdfTextEvidenceAnchorInput;
  annotationId?: string | null;
  attachmentId: string;
  captureMethod?: "reader-selection" | "annotation";
  evidenceId: string;
  evidenceKind: EvidenceKind;
  expectedBlobSha256: string;
  libraryId: string;
  noteMd?: string | null;
  projectId?: string | null;
  tags?: string[];
  text: string;
  title?: string | null;
  workId: string;
}

export interface SaveTextEvidenceCommandResult {
  created: boolean;
  evidence: EvidenceRecord;
  projectMembershipAdded: boolean;
  sourceMembershipAdded: boolean;
}

export interface EvidenceCommandInput {
  evidenceId: string;
  libraryId: string;
}

export interface ListEvidenceCommandInput {
  libraryId: string;
  limit?: number;
  offset?: number;
  scope: { kind: "library" | "inbox" } | { kind: "project"; projectId: string };
}
