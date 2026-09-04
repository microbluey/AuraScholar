import { type ContentUnitSourceType } from "./content-unit.js";
import { canonicalJson, isSha256 } from "./hash.js";
import {
  boundedInteger,
  compareText,
  deepFreeze,
  normalizeId,
  normalizeOptional,
  normalizeRank,
  parseRevisionBoundAnchor,
  record,
} from "./grounding-pack-support.js";
import {
  DEFAULT_GROUNDING_MAX_CHARS_PER_ITEM,
  DEFAULT_GROUNDING_MAX_ITEMS,
  DEFAULT_GROUNDING_MAX_TOTAL_CHARS,
  GROUNDING_AUTHORITIES,
  GROUNDING_REVISION_STATES,
  MAX_GROUNDING_CHARS_PER_ITEM,
  MAX_GROUNDING_ITEMS,
  MAX_GROUNDING_SOURCE_TITLE_LENGTH,
  MAX_GROUNDING_TOTAL_CHARS,
  type BuildGroundingPackInput,
  type GroundingAuthority,
  type GroundingPackCandidate,
  type GroundingPackExclusion,
  type GroundingPackExclusionReason,
  type GroundingPackItem,
  type GroundingRevisionState,
  type RevisionBoundSourceAnchor,
} from "./grounding-pack.js";

export interface GroundingPackLimits {
  readonly maxItems: number;
  readonly maxCharsPerItem: number;
  readonly maxTotalChars: number;
}

export interface NormalizedGroundingCandidate {
  readonly item: GroundingPackItem;
  readonly fingerprint: string;
  readonly exclusion?: undefined;
}

export interface ExcludedGroundingCandidate {
  readonly exclusion: GroundingPackExclusion;
  readonly item?: undefined;
  readonly fingerprint?: undefined;
}

export type NormalizedGroundingCandidateResult =
  | NormalizedGroundingCandidate
  | ExcludedGroundingCandidate;

export interface MutableGroundingPackItem {
  citationId: string;
  contentUnitId: string;
  contentUnitIds: string[];
  libraryId: string;
  sourceType: ContentUnitSourceType;
  sourceTypes: ContentUnitSourceType[];
  sourceId: string;
  sourceIds: string[];
  workId: string | null;
  assetId: string | null;
  revisionId: string;
  anchor: RevisionBoundSourceAnchor;
  text: string;
  quotedText: string;
  contentHash: string;
  sourceContentHash: string | null;
  extractorProfile: string;
  chunkProfile: string;
  authority: GroundingAuthority;
  authorities: GroundingAuthority[];
  revisionState: GroundingRevisionState;
  rank: number;
  sourceTitle: string | null;
  citationEligible: true;
}

export async function normalizeGroundingCandidate(
  candidate: GroundingPackCandidate,
  index: number,
  libraryId: string,
  revisionMap: Readonly<Record<string, string | null>>,
  historicalAllowed: boolean,
  maxCharsPerItem: number,
): Promise<NormalizedGroundingCandidateResult> {
  const unit = candidate.contentUnit;
  if (typeof unit.revisionId !== "string" || !unit.revisionId.trim()) {
    throw new Error(`ContentUnit ${unit.id} must bind to a document revision`);
  }
  const revisionId = normalizeId(unit.revisionId, `ContentUnit ${unit.id} revision id`);
  const anchor = parseRevisionBoundAnchor(unit.anchor);
  if (anchor.revisionId !== revisionId)
    throw new Error(`ContentUnit ${unit.id} revision does not match its source anchor`);
  if (unit.sourceType === "pdf" && (anchor.kind !== "pdf" || unit.sourceId !== revisionId))
    throw new Error(`PDF ContentUnit ${unit.id} is not bound to its revision anchor`);

  const suppliedProof = candidate.currentRevisionId;
  if (suppliedProof !== undefined && suppliedProof !== null) {
    normalizeId(suppliedProof, `ContentUnit ${unit.id} current revision id`);
  }
  if (
    unit.assetId !== null &&
    Object.hasOwn(revisionMap, unit.assetId) &&
    suppliedProof !== undefined &&
    suppliedProof !== revisionMap[unit.assetId]
  ) {
    throw new Error(
      `ContentUnit ${unit.id} current-revision proof does not match the captured map`,
    );
  }
  const proof =
    suppliedProof !== undefined
      ? suppliedProof
      : unit.assetId === null
        ? undefined
        : revisionMap[unit.assetId];
  if (unit.assetId !== null && proof === undefined)
    throw new Error(`ContentUnit ${unit.id} is missing current-revision proof`);
  let revisionState = candidate.revisionState ?? "current";
  if (!GROUNDING_REVISION_STATES.includes(revisionState))
    throw new Error(`ContentUnit ${unit.id} revision state is invalid`);
  if (proof !== undefined) {
    const current = proof !== null && proof === revisionId;
    if (candidate.revisionState === "historical" && current)
      throw new Error(
        `ContentUnit ${unit.id} claims historical state but matches the current revision`,
      );
    revisionState = current ? "current" : "historical";
  }
  if (revisionState === "historical") {
    const reason = unit.sourceType === "evidence" ? "historical-evidence" : "historical-source";
    if (unit.sourceType !== "evidence" || !historicalAllowed || candidate.reverified !== true) {
      return { exclusion: { contentUnitId: unit.id, sourceType: unit.sourceType, reason } };
    }
  }

  const quote = quoteForUnit(anchor, unit.text, maxCharsPerItem);
  const authority = normalizeAuthority(
    candidate.authority ?? defaultAuthority(unit.sourceType),
    unit.sourceType,
    unit.id,
  );
  const sourceTitle = normalizeOptional(
    candidate.sourceTitle,
    MAX_GROUNDING_SOURCE_TITLE_LENGTH,
    "Grounding source title",
  );
  const sourceContentHash =
    candidate.sourceContentHash ?? (unit.sourceType === "evidence" ? unit.contentHash : null);
  if (sourceContentHash !== null && !isSha256(sourceContentHash))
    throw new Error(`ContentUnit ${unit.id} source content hash is invalid`);
  if (unit.sourceType === "evidence" && sourceContentHash !== unit.contentHash) {
    throw new Error(`Evidence ContentUnit ${unit.id} source content hash does not match its text`);
  }
  const rank = normalizeRank(candidate.rank ?? index + 1, unit.id);
  const fingerprint = canonicalJson({
    assetId: unit.assetId,
    anchor,
    contentHash: unit.contentHash,
    libraryId,
    quotedText: quote,
    revisionId,
    sourceContentHash,
    workId: unit.workId,
  });
  return {
    fingerprint,
    item: {
      citationId: "",
      contentUnitId: unit.id,
      contentUnitIds: [unit.id],
      libraryId,
      sourceType: unit.sourceType,
      sourceTypes: [unit.sourceType],
      sourceId: unit.sourceId,
      sourceIds: [unit.sourceId],
      workId: unit.workId,
      assetId: unit.assetId,
      revisionId,
      anchor,
      text: boundedText(unit.text, quote, maxCharsPerItem),
      quotedText: quote,
      contentHash: unit.contentHash,
      sourceContentHash,
      extractorProfile: unit.extractorProfile,
      chunkProfile: unit.chunkProfile,
      authority,
      authorities: [authority],
      revisionState,
      rank,
      sourceTitle,
      citationEligible: true,
    },
  };
}

export function assertGroundingCandidateEnvelope(value: unknown, index: number): void {
  if (!record(value) || !record(value.contentUnit))
    throw new Error(`Grounding candidate at index ${index} is invalid`);
  const allowed = [
    "contentUnit",
    "rank",
    "authority",
    "revisionState",
    "reverified",
    "currentRevisionId",
    "sourceTitle",
    "sourceContentHash",
  ];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(`Grounding candidate at index ${index} contains unsupported fields`);
  if (value.reverified !== undefined && typeof value.reverified !== "boolean")
    throw new Error(`Grounding candidate at index ${index} reverified flag is invalid`);
}

export function normalizeGroundingPackLimits(input: BuildGroundingPackInput): GroundingPackLimits {
  return {
    maxItems: boundedInteger(
      input.maxItems ?? DEFAULT_GROUNDING_MAX_ITEMS,
      1,
      MAX_GROUNDING_ITEMS,
      "Grounding item limit",
    ),
    maxCharsPerItem: boundedInteger(
      input.maxCharsPerItem ?? DEFAULT_GROUNDING_MAX_CHARS_PER_ITEM,
      1,
      MAX_GROUNDING_CHARS_PER_ITEM,
      "Grounding item character limit",
    ),
    maxTotalChars: boundedInteger(
      input.maxTotalChars ?? DEFAULT_GROUNDING_MAX_TOTAL_CHARS,
      1,
      MAX_GROUNDING_TOTAL_CHARS,
      "Grounding payload character limit",
    ),
  };
}

export function mergeGroundingItem(
  target: MutableGroundingPackItem,
  item: GroundingPackItem,
): void {
  const preferred = compareRepresentatives(item, target) < 0 ? item : target;
  target.contentUnitIds = [...new Set([...target.contentUnitIds, ...item.contentUnitIds])];
  target.sourceTypes = [...new Set([...target.sourceTypes, ...item.sourceTypes])];
  target.sourceIds = [...new Set([...target.sourceIds, ...item.sourceIds])];
  target.authorities = [...new Set([...target.authorities, ...item.authorities])];
  target.contentUnitId = preferred.contentUnitId;
  target.sourceType = preferred.sourceType;
  target.sourceId = preferred.sourceId;
  target.workId = preferred.workId;
  target.assetId = preferred.assetId;
  target.anchor = preferred.anchor;
  target.text = preferred.text;
  target.quotedText = preferred.quotedText;
  target.contentHash = preferred.contentHash;
  target.sourceContentHash = preferred.sourceContentHash;
  target.extractorProfile = preferred.extractorProfile;
  target.chunkProfile = preferred.chunkProfile;
  target.authority = preferred.authority;
  target.revisionState =
    target.revisionState === "historical" || item.revisionState === "historical"
      ? "historical"
      : preferred.revisionState;
  target.rank = preferred.rank;
  target.sourceTitle = chooseSourceTitle(target.sourceTitle, item.sourceTitle);
}

export function mutableGroundingItem(item: GroundingPackItem): MutableGroundingPackItem {
  return {
    ...item,
    contentUnitIds: [...item.contentUnitIds],
    sourceTypes: [...item.sourceTypes],
    sourceIds: [...item.sourceIds],
    authorities: [...item.authorities],
  };
}

export function freezeGroundingItem(item: MutableGroundingPackItem): GroundingPackItem {
  return deepFreeze({
    ...item,
    contentUnitIds: [...item.contentUnitIds],
    sourceTypes: [...item.sourceTypes],
    sourceIds: [...item.sourceIds],
    authorities: [...item.authorities],
  });
}

export function compareGroundingItems(
  left: MutableGroundingPackItem,
  right: MutableGroundingPackItem,
): number {
  return left.rank !== right.rank
    ? left.rank - right.rank
    : compareText(left.contentUnitId, right.contentUnitId);
}

export function excludeGroundingItems(
  target: GroundingPackExclusion[],
  item: MutableGroundingPackItem,
  reason: GroundingPackExclusionReason,
): void {
  for (const id of item.contentUnitIds)
    target.push({ contentUnitId: id, sourceType: item.sourceType, reason });
}

function quoteForUnit(anchor: RevisionBoundSourceAnchor, text: string, maxChars: number): string {
  const quote = "quote" in anchor ? (anchor.quote?.exact ?? "") : "";
  if (quote && !text.includes(quote))
    throw new Error("Grounding source anchor quote cannot be resolved in its ContentUnit text");
  if (!quote && text.length > maxChars)
    throw new Error("Oversized grounding text requires an exact source quote");
  const result = quote || text;
  if (!result.trim() || result.length > maxChars)
    throw new Error("Grounding citation quote is invalid or too large");
  return result;
}

function boundedText(text: string, quote: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const offset = text.indexOf(quote);
  if (offset < 0) throw new Error("Grounding quote is outside the bounded payload");
  const context = Math.max(0, Math.floor((maxChars - quote.length) / 2));
  const start = Math.max(0, Math.min(offset - context, text.length - maxChars));
  const bounded = text.slice(start, start + maxChars);
  if (!bounded.includes(quote)) throw new Error("Grounding quote is outside the bounded payload");
  return bounded;
}

function normalizeAuthority(
  authority: GroundingAuthority,
  sourceType: ContentUnitSourceType,
  id: string,
): GroundingAuthority {
  if (!GROUNDING_AUTHORITIES.includes(authority))
    throw new Error(`ContentUnit ${id} authority is invalid`);
  const valid =
    sourceType === "pdf"
      ? ["published-source", "captured-source"]
      : sourceType === "annotation"
        ? ["user-annotation"]
        : ["user-evidence"];
  if (!valid.includes(authority))
    throw new Error(`ContentUnit ${id} authority does not match its source type`);
  return authority;
}

function defaultAuthority(sourceType: ContentUnitSourceType): GroundingAuthority {
  return sourceType === "pdf"
    ? "captured-source"
    : sourceType === "annotation"
      ? "user-annotation"
      : "user-evidence";
}

function compareRepresentatives(
  left: Pick<GroundingPackItem, "rank" | "contentUnitId" | "sourceType" | "sourceId" | "authority">,
  right: Pick<
    GroundingPackItem,
    "rank" | "contentUnitId" | "sourceType" | "sourceId" | "authority"
  >,
): number {
  if (left.rank !== right.rank) return left.rank - right.rank;
  for (const [leftValue, rightValue] of [
    [left.contentUnitId, right.contentUnitId],
    [left.sourceType, right.sourceType],
    [left.sourceId, right.sourceId],
    [left.authority, right.authority],
  ] as const) {
    const result = compareText(leftValue, rightValue);
    if (result !== 0) return result;
  }
  return 0;
}

function chooseSourceTitle(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return compareText(left, right) <= 0 ? left : right;
}
