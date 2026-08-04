import { parseSourceAnchor, type SourceAnchor } from "@aurascholar/anchors";
import { createContentUnit, type ContentUnit } from "./content-unit.js";
import { isSha256, sha256Text } from "./hash.js";
import {
  EVIDENCE_CHUNK_PROFILE_V1,
  EVIDENCE_EXTRACTOR_PROFILE_V1,
  MAX_SHORT_CONTENT_UNIT_CHARS,
} from "./profiles.js";

export interface TextEvidenceContentUnitInput {
  libraryId: string;
  evidenceId: string;
  revisionId: string;
  workId?: string | null;
  assetId?: string | null;
  anchor: unknown;
  text: string;
  /** Must be the EvidenceItem text hash, not an unchecked caller hint. */
  sourceContentHash: string;
  ordinal?: number;
  extractorProfile?: string;
}

export async function buildEvidenceContentUnit(
  input: TextEvidenceContentUnitInput,
): Promise<ContentUnit> {
  assertId(input.evidenceId, "Evidence id");
  assertId(input.revisionId, "Revision id");
  if (!input.text.trim()) throw new Error("Evidence ContentUnit text must not be empty");
  if (input.text.length > MAX_SHORT_CONTENT_UNIT_CHARS) {
    throw new Error("Evidence ContentUnit text exceeds the short-unit limit");
  }
  if (!isSha256(input.sourceContentHash)) {
    throw new Error("Evidence source content hash must be a lowercase SHA-256 value");
  }
  const contentHash = await sha256Text(input.text);
  if (contentHash !== input.sourceContentHash) {
    throw new Error("Evidence source content hash does not match the Evidence text");
  }

  const anchor = parseSourceAnchor(input.anchor);
  assertRevision(anchor, input.revisionId);
  if ("quote" in anchor && anchor.quote && anchor.quote.exact !== input.text) {
    throw new Error("Evidence anchor quote does not exactly match the Evidence text");
  }
  return createContentUnit({
    libraryId: input.libraryId,
    sourceType: "evidence",
    sourceId: input.evidenceId,
    workId: input.workId,
    assetId: input.assetId,
    revisionId: input.revisionId,
    ordinal: input.ordinal ?? 0,
    headingPath: null,
    anchor,
    text: input.text,
    extractorProfile: input.extractorProfile ?? EVIDENCE_EXTRACTOR_PROFILE_V1,
    chunkProfile: EVIDENCE_CHUNK_PROFILE_V1,
    state: "ready",
  });
}

function assertRevision(anchor: SourceAnchor, revisionId: string): void {
  if (!("revisionId" in anchor) || anchor.revisionId !== revisionId) {
    throw new Error("Evidence anchor is not bound to the requested document revision");
  }
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must be a non-empty string`);
}
