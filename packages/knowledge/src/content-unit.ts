import { parseSourceAnchor, type SourceAnchor } from "@aurascholar/anchors";
import { MAX_STRUCTURAL_CONTENT_UNIT_CHARS } from "./profiles.js";
import { canonicalJson, sha256Text } from "./hash.js";

export const CONTENT_UNIT_SOURCE_TYPES = ["pdf", "annotation", "evidence"] as const;
export type ContentUnitSourceType = (typeof CONTENT_UNIT_SOURCE_TYPES)[number];

export const CONTENT_UNIT_STATES = ["ready", "context-only"] as const;
export type ContentUnitState = (typeof CONTENT_UNIT_STATES)[number];

export interface ContentUnit {
  id: string;
  libraryId: string;
  sourceType: ContentUnitSourceType;
  sourceId: string;
  workId: string | null;
  assetId: string | null;
  revisionId: string | null;
  parentUnitId: string | null;
  ordinal: number;
  headingPath: string[] | null;
  anchor: SourceAnchor;
  text: string;
  language: string | null;
  tokenCount: number | null;
  contentHash: string;
  extractorProfile: string;
  chunkProfile: string;
  state: ContentUnitState;
}

export interface ContentUnitBuildInput {
  libraryId: string;
  sourceType: ContentUnitSourceType;
  sourceId: string;
  workId?: string | null;
  assetId?: string | null;
  revisionId?: string | null;
  parentUnitId?: string | null;
  ordinal: number;
  headingPath?: readonly string[] | null;
  anchor: SourceAnchor;
  text: string;
  language?: string | null;
  tokenCount?: number | null;
  extractorProfile: string;
  chunkProfile: string;
  state?: ContentUnitState;
}

export interface ContentUnitIdentityInput {
  libraryId: string;
  sourceType: ContentUnitSourceType;
  sourceId: string;
  workId: string | null;
  assetId: string | null;
  revisionId: string | null;
  parentUnitId: string | null;
  ordinal: number;
  contentHash: string;
  extractorProfile: string;
  chunkProfile: string;
}

/** IDs remain stable across extraction rebuilds and do not use wall-clock time. */
export async function makeContentUnitId(input: ContentUnitIdentityInput): Promise<string> {
  const digest = await sha256Text(canonicalJson(input));
  return `content-unit:${digest}`;
}

export async function createContentUnit(input: ContentUnitBuildInput): Promise<ContentUnit> {
  assertId(input.libraryId, "Library id");
  assertId(input.sourceId, "ContentUnit source id");
  if (!CONTENT_UNIT_SOURCE_TYPES.includes(input.sourceType)) {
    throw new Error(`Unsupported ContentUnit source type: ${input.sourceType}`);
  }
  assertProfile(input.extractorProfile, "Extractor profile");
  assertProfile(input.chunkProfile, "Chunk profile");
  if (!Number.isInteger(input.ordinal) || input.ordinal < 0) {
    throw new Error("ContentUnit ordinal must be a non-negative integer");
  }
  if (input.parentUnitId !== undefined && input.parentUnitId !== null) {
    assertId(input.parentUnitId, "ContentUnit parent id");
  }
  if (input.workId !== undefined && input.workId !== null) assertId(input.workId, "Work id");
  if (input.assetId !== undefined && input.assetId !== null) assertId(input.assetId, "Asset id");
  if (input.revisionId !== undefined && input.revisionId !== null) {
    assertId(input.revisionId, "Revision id");
  }
  if (!input.text.trim()) throw new Error("ContentUnit text must not be empty");
  if (input.text.length > MAX_STRUCTURAL_CONTENT_UNIT_CHARS) {
    throw new Error("ContentUnit text exceeds the structural unit limit");
  }
  if (input.headingPath !== undefined && input.headingPath !== null) {
    if (!input.headingPath.every((part) => typeof part === "string")) {
      throw new Error("ContentUnit heading path must contain only strings");
    }
  }
  if (input.tokenCount !== undefined && input.tokenCount !== null) {
    if (!Number.isInteger(input.tokenCount) || input.tokenCount < 0) {
      throw new Error("ContentUnit token count must be a non-negative integer or null");
    }
  }
  if (
    input.language !== undefined &&
    input.language !== null &&
    typeof input.language !== "string"
  ) {
    throw new Error("ContentUnit language must be a string or null");
  }

  const anchor = parseSourceAnchor(input.anchor);
  if (input.sourceType === "pdf" && anchor.kind !== "pdf") {
    throw new Error("PDF ContentUnit must use a PDF source anchor");
  }
  if (input.state !== undefined && !CONTENT_UNIT_STATES.includes(input.state)) {
    throw new Error(`Unsupported ContentUnit state: ${input.state}`);
  }
  const revisionId = input.revisionId ?? revisionIdFromAnchor(anchor);
  if (revisionId !== null && revisionIdFromAnchor(anchor) !== null) {
    if (revisionIdFromAnchor(anchor) !== revisionId) {
      throw new Error("ContentUnit revision does not match its source anchor");
    }
  }
  const contentHash = await sha256Text(input.text);
  const identity: ContentUnitIdentityInput = {
    libraryId: input.libraryId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    workId: input.workId ?? null,
    assetId: input.assetId ?? null,
    revisionId,
    parentUnitId: input.parentUnitId ?? null,
    ordinal: input.ordinal,
    contentHash,
    extractorProfile: input.extractorProfile,
    chunkProfile: input.chunkProfile,
  };
  const id = await makeContentUnitId(identity);

  return {
    id,
    libraryId: input.libraryId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    workId: input.workId ?? null,
    assetId: input.assetId ?? null,
    revisionId,
    parentUnitId: input.parentUnitId ?? null,
    ordinal: input.ordinal,
    headingPath: input.headingPath ? [...input.headingPath] : null,
    anchor,
    text: input.text,
    language: input.language ?? null,
    tokenCount: input.tokenCount ?? null,
    contentHash,
    extractorProfile: input.extractorProfile,
    chunkProfile: input.chunkProfile,
    state: input.state ?? "ready",
  };
}

function revisionIdFromAnchor(anchor: SourceAnchor): string | null {
  return "revisionId" in anchor ? anchor.revisionId : null;
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must be a non-empty string`);
}

function assertProfile(value: string, label: string): void {
  if (!value.trim() || value.length > 128)
    throw new Error(`${label} must be a non-empty short string`);
}
