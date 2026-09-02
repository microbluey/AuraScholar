import type { ContentUnitSourceType } from "@aurascholar/db/repos/knowledge";
import type { EvidenceKind, EvidenceRecord } from "@aurascholar/db/repos/evidence";

/** A Shelf is deliberately Project-local; a Library-wide Shelf is not valid. */
export interface EvidenceShelfScope {
  kind: "project";
  projectId: string;
}

export type EvidenceShelfStatus = "staged" | "stale";

/**
 * Renderer-safe preview data captured with a staged result. It is not an
 * authority record and must never be fed back into retrieval as canonical
 * source content.
 */
export interface EvidenceShelfPreviewPayload {
  contentUnitId: string;
  excerpt: string;
  headingPath: string[] | null;
  language: string | null;
  ordinal: number;
  sourceId: string;
  sourceType: ContentUnitSourceType;
  text: string;
  tokenCount: number | null;
  workTitle: string | null;
}

/** Durable, project-scoped staging row projected by the main process. */
export interface EvidenceShelfItem {
  anchorSnapshot: unknown;
  assetId: string | null;
  createdAt: number;
  deletedAt: number | null;
  id: string;
  libraryId: string;
  previewPayload: EvidenceShelfPreviewPayload;
  projectId: string;
  revisionId: string | null;
  sourceContentHash: string;
  status: EvidenceShelfStatus;
  updatedAt: number;
  workId: string | null;
  /** Current canonical source identity, exposed so the UI can explain staleness. */
  currentRevisionId: string | null;
  currentSourceContentHash: string | null;
  isStale: boolean;
}

export interface ListEvidenceShelfCommandInput {
  libraryId: string;
  projectId: string;
}

export interface ListEvidenceShelfCommandResult {
  items: EvidenceShelfItem[];
}

/** Main resolves contentUnitId and its canonical revision/hash before staging. */
export interface StageEvidenceShelfCommandInput {
  anchorSnapshot: unknown;
  contentUnitId: string;
  libraryId: string;
  previewPayload: EvidenceShelfPreviewPayload;
  projectId: string;
}

export interface StageEvidenceShelfCommandResult {
  created: boolean;
  item: EvidenceShelfItem;
}

export interface RemoveEvidenceShelfCommandInput {
  expectedUpdatedAt: number;
  itemId: string;
  libraryId: string;
  projectId: string;
}

export interface RemoveEvidenceShelfCommandResult {
  removed: boolean;
}

export interface ClearEvidenceShelfCommandInput {
  libraryId: string;
  projectId: string;
}

export interface ClearEvidenceShelfCommandResult {
  removed: number;
}

export interface ResolveEvidenceShelfForSaveCommandInput {
  expectedRevisionId: string | null;
  expectedSourceContentHash: string;
  itemId: string;
  libraryId: string;
  projectId: string;
}

export interface ResolveEvidenceShelfForSaveCommandResult {
  item: EvidenceShelfItem | null;
  stale: boolean;
}

export interface PromoteEvidenceShelfCommandInput {
  expectedUpdatedAt: number;
  evidenceKind: EvidenceKind;
  itemId: string;
  libraryId: string;
  noteMd?: string | null;
  projectId: string;
  tags?: string[];
  title?: string | null;
}

export interface PromoteEvidenceShelfCommandResult {
  created: boolean;
  evidence: EvidenceRecord;
  projectMembershipAdded: boolean;
  removedFromShelf: true;
}

export interface EvidenceShelfDataCommandMap {
  "evidenceShelf.clear": {
    input: ClearEvidenceShelfCommandInput;
    output: ClearEvidenceShelfCommandResult;
  };
  "evidenceShelf.list": {
    input: ListEvidenceShelfCommandInput;
    output: ListEvidenceShelfCommandResult;
  };
  "evidenceShelf.remove": {
    input: RemoveEvidenceShelfCommandInput;
    output: RemoveEvidenceShelfCommandResult;
  };
  "evidenceShelf.resolveForSave": {
    input: ResolveEvidenceShelfForSaveCommandInput;
    output: ResolveEvidenceShelfForSaveCommandResult;
  };
  "evidenceShelf.promote": {
    input: PromoteEvidenceShelfCommandInput;
    output: PromoteEvidenceShelfCommandResult;
  };
  "evidenceShelf.stage": {
    input: StageEvidenceShelfCommandInput;
    output: StageEvidenceShelfCommandResult;
  };
}
