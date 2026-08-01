import type { SourceAnchor } from "./source-anchor.js";

export const EVIDENCE_KINDS = ["method", "data", "limitation", "definition", "context"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_PAYLOAD_KINDS = [
  "text",
  "region",
  "figure",
  "table",
  "formula",
  "code-output",
] as const;
export type EvidencePayloadKind = (typeof EVIDENCE_PAYLOAD_KINDS)[number];

export type EvidenceSourceKind = "document" | "annotation";

export interface EvidenceTextPayload {
  kind: "text";
  text: string;
}

export type EvidencePayload = EvidenceTextPayload;

export interface EvidenceProvenance {
  capturedAt: number;
  capturedBy: "user";
  sourceAuthority: "published-source" | "captured-source" | "user-annotation";
  captureMethod?: "reader-selection" | "annotation";
  annotationId?: string;
}

export interface EvidenceItem {
  id: string;
  libraryId: string;
  workId: string | null;
  assetId: string | null;
  revisionId: string | null;
  sourceKind: EvidenceSourceKind;
  evidenceKind: EvidenceKind;
  anchor: SourceAnchor;
  payload: EvidencePayload;
  title: string | null;
  noteMd: string | null;
  tags: string[];
  sourceContentHash: string;
  provenance: EvidenceProvenance;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export type EvidenceRevisionState = "current" | "historical" | "removed" | "unavailable";
