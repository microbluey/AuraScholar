import { assertGroundingPackShape, resolveGroundingCitation } from "./grounding-pack-validation.js";
import type { GroundingPack } from "./grounding-pack.js";
import {
  GROUNDING_ANSWER_STATUSES,
  GROUNDING_ANSWER_VERSION,
  GROUNDING_CLAIM_KINDS,
  MAX_GROUNDING_ANSWER_CHARS,
  MAX_GROUNDING_CITATIONS_PER_ANSWER,
  MAX_GROUNDING_CITATIONS_PER_CLAIM,
  MAX_GROUNDING_CLAIM_CHARS,
  MAX_GROUNDING_CLAIM_KEY_CHARS,
  MAX_GROUNDING_CLAIMS,
  type GroundedAnswerInput,
  type GroundedAnswerPreparationOptions,
  type GroundedClaimInput,
  type GroundingAnswerStatus,
  type GroundingClaimKind,
} from "./grounding-output-contract.js";

/**
 * Parses and bounds untrusted provider output before a trusted relation
 * resolver receives it. This intentionally does not infer whether a citation
 * supports a claim; that determination remains outside model-controlled data.
 */
export function prepareGroundedAnswer(
  pack: GroundingPack,
  value: unknown,
  options: GroundedAnswerPreparationOptions = {},
): GroundedAnswerInput {
  assertPreparationOptions(options);
  assertGroundingPackShape(pack);
  const answer = parseAnswer(value);
  const answerMarkdown = normalizeCitationMarkers(answer.answerMarkdown);
  assertSafeGroundedMarkdown(answerMarkdown);
  const claimKeys = new Set<string>();
  let citedTotal = 0;
  const claims = answer.claims.map((rawClaim, index) => {
    const claim = parseClaim(rawClaim, index, options.maxCitationsPerClaim);
    citedTotal += claim.citationIds.length;
    if (citedTotal > MAX_GROUNDING_CITATIONS_PER_ANSWER) {
      throw new Error(
        `Grounded answer citations are limited to ${MAX_GROUNDING_CITATIONS_PER_ANSWER}`,
      );
    }
    if (claimKeys.has(claim.claimKey)) {
      throw new Error(`Grounded claim key ${claim.claimKey} is duplicated`);
    }
    claimKeys.add(claim.claimKey);
    for (const citationId of claim.citationIds) resolveGroundingCitation(pack, citationId);
    if (
      (claim.kind === "factual" || claim.kind === "interpretive") &&
      claim.citationIds.length === 0
    ) {
      throw new Error(
        `${capitalize(claim.kind)} grounded claim ${claim.claimKey} requires a citation`,
      );
    }
    return Object.freeze({ ...claim, citationIds: Object.freeze([...claim.citationIds]) });
  });
  return deepFreeze({
    version: GROUNDING_ANSWER_VERSION,
    answerMarkdown,
    claims: Object.freeze(claims),
    ...(answer.status === undefined ? {} : { status: answer.status }),
  });
}

function assertPreparationOptions(options: GroundedAnswerPreparationOptions): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Grounded answer preparation options are invalid");
  }
  const keys = Object.keys(options as Record<string, unknown>);
  if (keys.some((key) => key !== "maxCitationsPerClaim")) {
    throw new Error("Grounded answer preparation options are invalid");
  }
}

function parseAnswer(value: unknown): GroundedAnswerInput {
  if (!isRecord(value)) throw new Error("Grounded answer output is invalid");
  if (!Object.hasOwn(value, "version")) throw new Error("Grounded answer version is required");
  assertExactKeys(value, ["version", "answerMarkdown", "claims"], ["status"]);
  if (value.version !== GROUNDING_ANSWER_VERSION) {
    throw new Error("Grounded answer version is unsupported");
  }
  const answerMarkdown = requireText(
    value.answerMarkdown,
    "Grounded answer markdown",
    MAX_GROUNDING_ANSWER_CHARS,
    false,
  );
  if (!Array.isArray(value.claims) || value.claims.length > MAX_GROUNDING_CLAIMS) {
    throw new Error(`Grounded answer claims are limited to ${MAX_GROUNDING_CLAIMS}`);
  }
  dense(value.claims, "Grounded answer claims");
  if (
    value.status !== undefined &&
    !GROUNDING_ANSWER_STATUSES.includes(value.status as GroundingAnswerStatus)
  ) {
    throw new Error("Grounded answer status is invalid");
  }
  return {
    version: GROUNDING_ANSWER_VERSION,
    answerMarkdown,
    claims: value.claims as readonly GroundedClaimInput[],
    ...(value.status === undefined ? {} : { status: value.status as GroundingAnswerStatus }),
  };
}

function parseClaim(
  value: unknown,
  index: number,
  requestedLimit: number | undefined,
): GroundedClaimInput {
  if (!isRecord(value)) throw new Error(`Grounded claim ${index} is invalid`);
  assertExactKeys(value, ["claimKey", "text", "kind", "citationIds"]);
  const claimKey = requireText(
    value.claimKey,
    `Grounded claim ${index} key`,
    MAX_GROUNDING_CLAIM_KEY_CHARS,
    false,
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(claimKey)) {
    throw new Error(`Grounded claim ${index} key is invalid`);
  }
  const text = requireText(
    value.text,
    `Grounded claim ${claimKey} text`,
    MAX_GROUNDING_CLAIM_CHARS,
    false,
  );
  assertSafeGroundedMarkdown(text);
  if (!GROUNDING_CLAIM_KINDS.includes(value.kind as GroundingClaimKind)) {
    throw new Error(`Grounded claim ${claimKey} kind is invalid`);
  }
  if (!Array.isArray(value.citationIds)) {
    throw new Error(`Grounded claim ${claimKey} citations are invalid`);
  }
  dense(value.citationIds, `Grounded claim ${claimKey} citations`);
  const limit = requestedLimit ?? MAX_GROUNDING_CITATIONS_PER_CLAIM;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_GROUNDING_CITATIONS_PER_CLAIM ||
    value.citationIds.length > limit
  ) {
    throw new Error(`Grounded claim ${claimKey} has too many citations`);
  }
  const citationIds = value.citationIds.map((id, citationIndex) =>
    normalizeCitationId(id, `Grounded claim ${claimKey} citation ${citationIndex}`),
  );
  if (new Set(citationIds).size !== citationIds.length) {
    throw new Error(`Grounded claim ${claimKey} citations must be unique`);
  }
  return { claimKey, text, kind: value.kind as GroundingClaimKind, citationIds };
}

function normalizeCitationMarkers(markdown: string): string {
  return markdown.replace(/\b(?:citation|cite):([1-9][0-9]*)\b/gi, "cite:$1");
}

function assertSafeGroundedMarkdown(value: string): void {
  const lower = value.toLowerCase();
  const unsafePatterns = [
    /<!--[\s\S]*?-->/,
    /<\s*\/?\s*[a-z][^>]*>/,
    /\bon[a-z][\w-]*\s*=/,
    /(?:java|vb)script\s*:/,
    /(?:data|file|blob)\s*:/,
    /!\[[^\]]*\]\(\s*(?:https?:|\/\/|data:)/,
    /\]\(\s*(?:javascript:|vbscript:|data:|file:|blob:)/,
    /\[[^\]]*\]\(\s*[^)]*\)/,
    /^\s*\[[^\]]+\]:\s*\S+/m,
    /<\s*(?:https?:|\/\/|data:|file:|blob:)/,
    /\b(?:src|srcset|href)\s*=\s*["']?\s*(?:https?:|\/\/|data:|file:|blob:|javascript:|vbscript:)/,
    /\b(?:https?|ftp):\/\/[^\s<>()]+/,
    /(?:\u200b|\u200c|\u200d|\ufeff|[\u202a-\u202e])/,
    /&(?:#x?[0-9a-f]+|[a-z][a-z0-9]+);/,
  ];
  if (unsafePatterns.some((pattern) => pattern.test(lower))) {
    throw new Error("Grounded answer contains unsafe executable or external content");
  }
}

function normalizeCitationId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^cite:[1-9][0-9]*$/.test(value) ||
    value.length > 64 ||
    containsControl(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireText(value: unknown, label: string, maximum: number, allowEmpty: boolean): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    containsControl(value) ||
    (!allowEmpty && !value.trim())
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error("Grounded output contains unsupported or missing fields");
  }
}

function dense(value: readonly unknown[], label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new Error(`${label} must be a dense array`);
  }
}

function containsControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
