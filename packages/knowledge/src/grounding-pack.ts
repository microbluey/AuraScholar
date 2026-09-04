import type { SourceAnchor } from "@aurascholar/anchors";
import { type ContentUnit, type ContentUnitSourceType } from "./content-unit.js";
import type { CorpusScopeSnapshot } from "./corpus-scope.js";
import { canonicalJson, sha256Text } from "./hash.js";
import {
  assertGroundingCandidateEnvelope,
  compareGroundingItems,
  excludeGroundingItems,
  freezeGroundingItem,
  mergeGroundingItem,
  mutableGroundingItem,
  normalizeGroundingCandidate,
  normalizeGroundingPackLimits,
  type MutableGroundingPackItem,
} from "./grounding-pack-candidate.js";
import {
  assertExactKeys,
  assertGroundingUnitShape,
  compareText,
  count,
  deepFreeze,
  normalizeId,
  normalizeRunIdentities,
  record,
  validateRevisionMap,
  validateGroundingScope,
} from "./grounding-pack-support.js";

/** Versioned, model-independent contract for one bounded RAG source pack. */
export const GROUNDING_PACK_VERSION = 1 as const;
export const GROUNDING_PROMPT_PAYLOAD_VERSION = 1 as const;
export const GROUNDING_CITATION_PREFIX = "cite:" as const;

export const GROUNDING_REVISION_STATES = ["current", "historical"] as const;
export type GroundingRevisionState = (typeof GROUNDING_REVISION_STATES)[number];
export const GROUNDING_AUTHORITIES = [
  "published-source",
  "captured-source",
  "user-annotation",
  "user-evidence",
] as const;
export type GroundingAuthority = (typeof GROUNDING_AUTHORITIES)[number];

/** Coverage describes the selected corpus, never academic truth. */
export const GROUNDING_COVERAGE_STATES = [
  "multiple-supporting-sources",
  "partial-support",
  "conflicting-sources",
  "insufficient-evidence",
] as const;
export type GroundingCoverageState = (typeof GROUNDING_COVERAGE_STATES)[number];

export const DEFAULT_GROUNDING_MAX_ITEMS = 32;
export const DEFAULT_GROUNDING_MAX_CHARS_PER_ITEM = 12_000;
export const DEFAULT_GROUNDING_MAX_TOTAL_CHARS = 96_000;
export const MAX_GROUNDING_ITEMS = 128;
export const MAX_GROUNDING_CHARS_PER_ITEM = 64 * 1024;
export const MAX_GROUNDING_TOTAL_CHARS = 512 * 1024;
export const MAX_GROUNDING_RUN_ID_LENGTH = 512;
export const MAX_GROUNDING_SOURCE_TITLE_LENGTH = 1_024;
export const MAX_GROUNDING_CANDIDATES = 4_096;

export type RevisionBoundSourceAnchor = Extract<SourceAnchor, { revisionId: string }>;
export type ContentUnitWithLifecycle = ContentUnit & { readonly deletedAt?: number | null };

/** A hydrated retrieval result plus resolver-owned provenance metadata. */
export interface GroundingPackCandidate {
  readonly contentUnit: ContentUnitWithLifecycle;
  readonly rank?: number;
  readonly authority?: GroundingAuthority;
  readonly revisionState?: GroundingRevisionState;
  /** Historical Evidence is eligible only after explicit re-verification. */
  readonly reverified?: boolean;
  /** Canonical current-revision proof for the unit's Asset, when applicable. */
  readonly currentRevisionId?: string | null;
  readonly sourceTitle?: string | null;
  /** Captured text hash is not a document blob hash; a resolver may provide it separately. */
  readonly sourceContentHash?: string | null;
}
export type GroundingCandidateInput = GroundingPackCandidate;

export interface BuildGroundingPackInput {
  readonly runId?: string;
  readonly retrievalRunId?: string;
  readonly libraryId?: string;
  readonly corpusScope: CorpusScopeSnapshot;
  readonly candidates: readonly GroundingPackCandidate[];
  readonly includeHistoricalEvidence?: boolean;
  readonly allowHistoricalEvidence?: boolean;
  readonly currentRevisionIds?: Readonly<Record<string, string | null>>;
  readonly currentRevisionByAssetId?: Readonly<Record<string, string | null>>;
  readonly maxItems?: number;
  readonly maxCharsPerItem?: number;
  readonly maxTotalChars?: number;
}

const BUILD_INPUT_KEYS = [
  "runId",
  "retrievalRunId",
  "libraryId",
  "corpusScope",
  "candidates",
  "includeHistoricalEvidence",
  "allowHistoricalEvidence",
  "currentRevisionIds",
  "currentRevisionByAssetId",
  "maxItems",
  "maxCharsPerItem",
  "maxTotalChars",
] as const;

export interface GroundingPackItem {
  readonly citationId: string;
  readonly contentUnitId: string;
  readonly contentUnitIds: readonly string[];
  readonly libraryId: string;
  readonly sourceType: ContentUnitSourceType;
  readonly sourceTypes: readonly ContentUnitSourceType[];
  readonly sourceId: string;
  readonly sourceIds: readonly string[];
  readonly workId: string | null;
  readonly assetId: string | null;
  readonly revisionId: string;
  readonly anchor: RevisionBoundSourceAnchor;
  /** Bounded source payload; it remains opaque untrusted data. */
  readonly text: string;
  /** Exact quote resolved against the original unit before truncation. */
  readonly quotedText: string;
  /** SHA-256 of the complete captured ContentUnit text. */
  readonly contentHash: string;
  /** Optional canonical captured-source hash supplied by a resolver. */
  readonly sourceContentHash: string | null;
  readonly extractorProfile: string;
  readonly chunkProfile: string;
  readonly authority: GroundingAuthority;
  readonly authorities: readonly GroundingAuthority[];
  readonly revisionState: GroundingRevisionState;
  readonly rank: number;
  readonly sourceTitle: string | null;
  readonly citationEligible: true;
}

export type GroundingPackExclusionReason =
  | "context-only"
  | "historical-source"
  | "historical-evidence"
  | "item-limit"
  | "payload-limit";
export interface GroundingPackExclusion {
  readonly contentUnitId: string;
  readonly sourceType: ContentUnitSourceType;
  readonly reason: GroundingPackExclusionReason;
}

export interface GroundingPack {
  readonly version: typeof GROUNDING_PACK_VERSION;
  readonly runId: string;
  readonly retrievalRunId: string;
  readonly libraryId: string;
  readonly corpusScope: CorpusScopeSnapshot;
  readonly scopeHash: string;
  readonly items: readonly GroundingPackItem[];
  readonly citations: readonly GroundingPackItem[];
  readonly truncated: boolean;
  readonly excluded: readonly GroundingPackExclusion[];
  readonly hash: string;
}

/** The canonical fields covered by `GroundingPack.hash`. */
export interface GroundingPackHashInput {
  readonly excluded: readonly GroundingPackExclusion[];
  readonly items: readonly GroundingPackItem[];
  readonly libraryId: string;
  readonly runId: string;
  readonly retrievalRunId: string;
  readonly scopeHash: string;
  readonly truncated: boolean;
}

export interface GroundingCoverageAssessment {
  readonly supportingCitationCount: number;
  readonly contradictingCitationCount?: number;
  readonly materialCitationCount?: number;
  readonly requiredSupportingSources?: number;
}

/** Conservative classification; rank and backend scores never imply support. */
export function classifyGroundingCoverage(
  input: GroundingCoverageAssessment,
): GroundingCoverageState {
  const supporting = count(
    input.supportingCitationCount,
    MAX_GROUNDING_ITEMS,
    "Supporting citation count",
  );
  const contradicting = count(
    input.contradictingCitationCount ?? 0,
    MAX_GROUNDING_ITEMS,
    "Contradicting citation count",
  );
  const material = count(
    input.materialCitationCount ?? supporting + contradicting,
    MAX_GROUNDING_ITEMS,
    "Material citation count",
  );
  const required = input.requiredSupportingSources ?? 1;
  if (!Number.isSafeInteger(required) || required < 1 || required > MAX_GROUNDING_ITEMS) {
    throw new Error("Required supporting source count is invalid");
  }
  if (material === 0 || (supporting === 0 && contradicting === 0)) return "insufficient-evidence";
  if (contradicting > 0) return "conflicting-sources";
  if (supporting < required || supporting < 2) return "partial-support";
  return "multiple-supporting-sources";
}

/** Builds and fingerprints an immutable, scope-bound pack. */
export async function buildGroundingPack(input: BuildGroundingPackInput): Promise<GroundingPack> {
  if (!record(input)) throw new Error("Grounding pack input is invalid");
  assertExactKeys(input, BUILD_INPUT_KEYS);
  const runIds = normalizeRunIdentities(
    input.runId,
    input.retrievalRunId,
    MAX_GROUNDING_RUN_ID_LENGTH,
  );
  const scope = await validateGroundingScope(input.corpusScope);
  const libraryId =
    input.libraryId === undefined
      ? scope.libraryId
      : normalizeId(input.libraryId, "Grounding Library id");
  if (libraryId !== scope.libraryId)
    throw new Error("Grounding pack Library does not match its corpus scope");
  if (!Array.isArray(input.candidates) || input.candidates.length > MAX_GROUNDING_CANDIDATES)
    throw new Error(`Grounding pack candidates are limited to ${MAX_GROUNDING_CANDIDATES}`);
  const limits = normalizeGroundingPackLimits(input);
  const historicalAllowed =
    input.includeHistoricalEvidence === true || input.allowHistoricalEvidence === true;
  if (
    input.currentRevisionIds !== undefined &&
    input.currentRevisionByAssetId !== undefined &&
    canonicalJson(input.currentRevisionIds) !== canonicalJson(input.currentRevisionByAssetId)
  ) {
    throw new Error("Grounding current-revision maps do not match");
  }
  const revisionMap = input.currentRevisionIds ?? input.currentRevisionByAssetId ?? {};
  if (!record(revisionMap)) throw new Error("Grounding current-revision map is invalid");
  validateRevisionMap(revisionMap);

  const exclusions: GroundingPackExclusion[] = [];
  const groups = new Map<string, MutableGroundingPackItem>();
  const unitFingerprints = new Map<string, string>();
  for (const [index, rawCandidate] of input.candidates.entries()) {
    assertGroundingCandidateEnvelope(rawCandidate, index);
    const candidate = rawCandidate as GroundingPackCandidate;
    const unit = candidate.contentUnit;
    const unitFingerprint = assertGroundingUnitShape(unit, libraryId, scope);
    if ((await sha256Text(unit.text)) !== unit.contentHash) {
      throw new Error(`ContentUnit ${unit.id} content hash does not match its text`);
    }
    const priorUnit = unitFingerprints.get(unit.id);
    if (priorUnit !== undefined && priorUnit !== unitFingerprint) {
      throw new Error(`ContentUnit ${unit.id} has conflicting grounding data`);
    }
    unitFingerprints.set(unit.id, unitFingerprint);
    if (unit.state === "context-only") {
      exclusions.push({
        contentUnitId: unit.id,
        sourceType: unit.sourceType,
        reason: "context-only",
      });
      continue;
    }
    if (unit.state !== "ready") throw new Error(`ContentUnit ${unit.id} state is invalid`);
    const normalized = await normalizeGroundingCandidate(
      candidate,
      index,
      libraryId,
      revisionMap,
      historicalAllowed,
      limits.maxCharsPerItem,
    );
    if (normalized.exclusion) {
      exclusions.push(normalized.exclusion);
      continue;
    }
    const existing = groups.get(normalized.fingerprint);
    if (existing) mergeGroundingItem(existing, normalized.item);
    else groups.set(normalized.fingerprint, mutableGroundingItem(normalized.item));
  }

  const selected: GroundingPackItem[] = [];
  let totalChars = 0;
  let truncated = false;
  for (const candidate of [...groups.values()].sort(compareGroundingItems)) {
    if (selected.length >= limits.maxItems) {
      truncated = true;
      excludeGroundingItems(exclusions, candidate, "item-limit");
      continue;
    }
    if (totalChars + candidate.text.length > limits.maxTotalChars) {
      truncated = true;
      excludeGroundingItems(exclusions, candidate, "payload-limit");
      continue;
    }
    selected.push(
      freezeGroundingItem({
        ...candidate,
        citationId: `${GROUNDING_CITATION_PREFIX}${selected.length + 1}`,
        contentUnitIds: [...candidate.contentUnitIds].sort(compareText),
        sourceTypes: [...candidate.sourceTypes].sort(compareText),
        sourceIds: [...candidate.sourceIds].sort(compareText),
        authorities: [...candidate.authorities].sort(compareText),
      }),
    );
    totalChars += candidate.text.length;
  }
  exclusions.sort((left, right) => {
    const id = compareText(left.contentUnitId, right.contentUnitId);
    if (id !== 0) return id;
    const type = compareText(left.sourceType, right.sourceType);
    return type !== 0 ? type : compareText(left.reason, right.reason);
  });
  const hash = await hashGroundingPack({
    excluded: exclusions,
    items: selected,
    libraryId,
    runId: runIds.runId,
    retrievalRunId: runIds.retrievalRunId,
    scopeHash: scope.hash,
    truncated,
  });
  return deepFreeze({
    version: GROUNDING_PACK_VERSION,
    runId: runIds.runId,
    retrievalRunId: runIds.retrievalRunId,
    libraryId,
    corpusScope: scope,
    scopeHash: scope.hash,
    items: selected,
    citations: selected,
    truncated,
    excluded: exclusions,
    hash,
  });
}

export function groundingPackHashInput(input: GroundingPackHashInput): object {
  return { ...input, version: GROUNDING_PACK_VERSION };
}
export async function hashGroundingPack(input: GroundingPackHashInput): Promise<string> {
  return sha256Text(canonicalJson(groundingPackHashInput(input)));
}
