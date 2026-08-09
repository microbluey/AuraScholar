import type {
  EvidenceKind,
  EvidenceRecord,
  PdfTextEvidenceAnchorInput,
} from "@aurascholar/db/repos/evidence";
import type {
  EvidenceAvailabilityStatus,
  EvidenceCanonicalStatus,
  EvidenceInboxItemDto,
  EvidenceRevisionStatus,
  EvidenceSearchScope,
} from "@aurascholar/db/repos/evidence-inbox";

export type { EvidenceInboxItemDto } from "@aurascholar/db/repos/evidence-inbox";

export interface DocumentRevisionCommandInput {
  attachmentId: string;
  expectedBlobSha256?: string;
  libraryId: string;
  workId: string;
}

/** Resolves the exact attachment behind an immutable document revision. */
export interface ResolveDocumentRevisionCommandInput {
  libraryId: string;
  revisionId: string;
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

export interface SearchEvidenceCommandInput {
  libraryId: string;
  scope: EvidenceSearchScope;
  query?: string;
  evidenceKinds?: EvidenceKind[];
  revisionStatuses?: EvidenceRevisionStatus[];
  canonicalStatuses?: EvidenceCanonicalStatus[];
  availabilityStatuses?: EvidenceAvailabilityStatus[];
  limit?: number;
  offset?: number;
}

export interface EvidenceProjectCommandInput extends EvidenceCommandInput {
  projectId: string;
}

export interface EvidenceTombstoneCommandInput extends EvidenceCommandInput {
  expectedUpdatedAt: number;
}

export interface EvidenceDataCommandMap {
  "document.resolveAttachmentRevision": {
    input: DocumentRevisionCommandInput;
    output: { revision: ResolvedDocumentRevisionDto | null };
  };
  "document.resolveRevision": {
    input: ResolveDocumentRevisionCommandInput;
    output: { revision: ResolvedDocumentRevisionDto | null };
  };
  "evidence.get": {
    input: EvidenceCommandInput;
    output: { evidence: EvidenceRecord | null };
  };
  "evidence.list": {
    input: ListEvidenceCommandInput;
    output: { evidence: EvidenceRecord[] };
  };
  "evidence.search": {
    input: SearchEvidenceCommandInput;
    output: { evidence: EvidenceInboxItemDto[]; total: number };
  };
  "evidence.saveText": {
    input: SaveTextEvidenceCommandInput;
    output: SaveTextEvidenceCommandResult;
  };
  "evidence.addToProject": {
    input: EvidenceProjectCommandInput;
    output: { projectMembershipAdded: boolean; sourceMembershipAdded: boolean };
  };
  "evidence.removeFromProject": {
    input: EvidenceProjectCommandInput;
    output: { projectMembershipRemoved: boolean };
  };
  "evidence.softDelete": {
    input: EvidenceTombstoneCommandInput;
    output: { evidence: EvidenceRecord };
  };
  "evidence.restore": {
    input: EvidenceTombstoneCommandInput;
    output: { evidence: EvidenceRecord };
  };
}
