import { parseSourceAnchor, type SourceAnchor } from "@aurascholar/anchors";
import { createContentUnit, type ContentUnit } from "./content-unit.js";
import {
  ANNOTATION_CHUNK_PROFILE_V1,
  ANNOTATION_EXTRACTOR_PROFILE_V1,
  MAX_SHORT_CONTENT_UNIT_CHARS,
} from "./profiles.js";

export interface AnnotationContentUnitInput {
  libraryId: string;
  annotationId: string;
  revisionId: string;
  workId?: string | null;
  assetId?: string | null;
  /** Accepts both a legacy reader PDF anchor and a revision-bound SourceAnchor. */
  anchor: unknown;
  /** Explicit annotation text wins; otherwise quote text or note markdown is used. */
  text?: string | null;
  contentMd?: string | null;
  ordinal?: number;
  extractorProfile?: string;
}

export async function buildAnnotationContentUnit(
  input: AnnotationContentUnitInput,
): Promise<ContentUnit> {
  assertId(input.annotationId, "Annotation id");
  assertId(input.revisionId, "Revision id");
  const anchor = normalizeAnnotationAnchor(input.anchor, input.revisionId);
  const text = chooseAnnotationText(input, anchor);
  if (!text.trim()) throw new Error("Annotation ContentUnit text must not be empty");
  if (text.length > MAX_SHORT_CONTENT_UNIT_CHARS) {
    throw new Error("Annotation ContentUnit text exceeds the short-unit limit");
  }
  return createContentUnit({
    libraryId: input.libraryId,
    sourceType: "annotation",
    sourceId: input.annotationId,
    workId: input.workId,
    assetId: input.assetId,
    revisionId: input.revisionId,
    ordinal: input.ordinal ?? 0,
    headingPath: null,
    anchor,
    text,
    extractorProfile: input.extractorProfile ?? ANNOTATION_EXTRACTOR_PROFILE_V1,
    chunkProfile: ANNOTATION_CHUNK_PROFILE_V1,
    state: "ready",
  });
}

function normalizeAnnotationAnchor(value: unknown, revisionId: string): SourceAnchor {
  if (!isRecord(value)) throw new Error("Annotation anchor must be an object");
  const candidate =
    typeof value.kind === "string" && value.revisionId !== undefined
      ? value
      : {
          ...value,
          kind: "pdf",
          revisionId,
        };
  const anchor = parseSourceAnchor(candidate);
  assertRevision(anchor, revisionId);
  return anchor;
}

function chooseAnnotationText(input: AnnotationContentUnitInput, anchor: SourceAnchor): string {
  if (input.text !== undefined && input.text !== null) return input.text;
  const quoteText = "quote" in anchor ? (anchor.quote?.exact ?? "") : "";
  const noteText = input.contentMd?.trim() ?? "";
  if (quoteText && noteText) return `${quoteText}\n\n${noteText}`;
  return quoteText || noteText;
}

function assertRevision(anchor: SourceAnchor, revisionId: string): void {
  if (!("revisionId" in anchor) || anchor.revisionId !== revisionId) {
    throw new Error("Annotation anchor is not bound to the requested document revision");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must be a non-empty string`);
}
