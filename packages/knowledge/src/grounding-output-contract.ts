/** Versioned structured output accepted from an optional generation provider. */
export const GROUNDING_ANSWER_VERSION = 1 as const;
export const GROUNDING_CLAIM_KINDS = ["factual", "interpretive", "uncertain"] as const;
export type GroundingClaimKind = (typeof GROUNDING_CLAIM_KINDS)[number];
export const GROUNDING_ANSWER_STATUSES = ["answer", "insufficient", "conflicting"] as const;
export type GroundingAnswerStatus = (typeof GROUNDING_ANSWER_STATUSES)[number];

/** Relations are resolver-owned metadata, never fields supplied by a model. */
export const GROUNDING_CLAIM_RELATIONS = [
  "supports",
  "qualifies",
  "contradicts",
  "background",
] as const;
export type GroundingClaimRelation = (typeof GROUNDING_CLAIM_RELATIONS)[number];

export const MAX_GROUNDING_ANSWER_CHARS = 64 * 1024;
export const MAX_GROUNDING_CLAIMS = 64;
export const MAX_GROUNDING_CLAIM_CHARS = 8 * 1024;
export const MAX_GROUNDING_CLAIM_KEY_CHARS = 256;
export const MAX_GROUNDING_CITATIONS_PER_CLAIM = 64;
export const MAX_GROUNDING_CITATIONS_PER_ANSWER = 256;

export interface GroundedClaimInput {
  readonly claimKey: string;
  readonly text: string;
  readonly kind: GroundingClaimKind;
  readonly citationIds: readonly string[];
}

export interface GroundedAnswerInput {
  readonly version: typeof GROUNDING_ANSWER_VERSION;
  readonly answerMarkdown: string;
  readonly claims: readonly GroundedClaimInput[];
  readonly status?: GroundingAnswerStatus;
}

export interface GroundedAnswerPreparationOptions {
  readonly maxCitationsPerClaim?: number;
}

export type GroundingClaimRelationMap = Readonly<Record<string, GroundingClaimRelation>>;
export type GroundingClaimRelations = Readonly<
  Record<string, GroundingClaimRelationMap | readonly GroundingClaimRelationInput[]>
>;

export interface GroundingClaimRelationInput {
  readonly citationId: string;
  readonly relation: GroundingClaimRelation;
}
