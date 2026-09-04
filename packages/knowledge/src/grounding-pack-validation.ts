import { createCorpusScopeSnapshot } from "./corpus-scope.js";
import { type ContentUnitSourceType } from "./content-unit.js";
import { canonicalJson } from "./hash.js";
import {
  GROUNDING_PROMPT_PAYLOAD_VERSION,
  MAX_GROUNDING_ITEMS,
  type GroundingAuthority,
  type GroundingPack,
  type GroundingPackItem,
  type GroundingRevisionState,
  type RevisionBoundSourceAnchor,
  hashGroundingPack,
} from "./grounding-pack.js";
import { assertDenseArray as dense, deepFreeze as freezeDeep } from "./grounding-pack-support.js";
import {
  assertGroundingPromptPayloadShape as assertPromptPayloadShape,
  MAX_GROUNDING_PROMPT_QUERY_CHARS as MAX_PROMPT_QUERY_CHARS,
} from "./grounding-prompt-shape.js";
import {
  assertGroundingPackItemShape,
  assertGroundingPackShape as assertPackShape,
  normalizeGroundingCitationId as normalizeCitationId,
} from "./grounding-pack-shape.js";

export { assertGroundingPackShape } from "./grounding-pack-shape.js";
export {
  assertGroundingPromptPayloadShape,
  MAX_GROUNDING_PROMPT_QUERY_CHARS,
} from "./grounding-prompt-shape.js";
/** RFC §7.7's durable, source-bound citation identity. */
export interface GroundingCitationProjection {
  readonly citationId: string;
  readonly assetId: string | null;
  readonly revisionId: string;
  readonly workId: string | null;
  readonly anchorSnapshot: RevisionBoundSourceAnchor;
  readonly quotedText: string;
  readonly sourceContentHash: string | null;
  /** Optional because ContentUnits are rebuildable diagnostics, not identity. */
  readonly contentUnitId?: string;
}
export interface GroundingCitationReference {
  readonly citationId: string;
  readonly assetId?: string | null;
  readonly revisionId?: string;
  readonly workId?: string | null;
  readonly anchorSnapshot?: unknown;
  readonly quotedText?: string;
  readonly sourceContentHash?: string | null;
  readonly contentUnitId?: string | null;
}
export interface ValidatedGroundingCitationReference {
  readonly citationId: string;
  readonly projection: GroundingCitationProjection;
  readonly item: GroundingPackItem;
}
export interface GroundingPromptCitation {
  readonly citationId: string;
  readonly sourceType: ContentUnitSourceType;
  readonly sourceTypes: readonly ContentUnitSourceType[];
  readonly sourceTitle: string | null;
  readonly authority: GroundingAuthority;
  readonly authorities: readonly GroundingAuthority[];
  readonly revisionState: GroundingRevisionState;
  readonly workId: string | null;
  readonly assetId: string | null;
  readonly revisionId: string;
  readonly anchorSnapshot: RevisionBoundSourceAnchor;
  readonly quotedText: string;
  readonly contentHash: string;
  readonly sourceContentHash: string | null;
  /** Explicitly marks source text as opaque, untrusted data. */
  readonly trust: "untrusted";
  readonly contentType: "text/plain";
  readonly text: string;
}
export interface GroundingPromptPayload {
  readonly version: typeof GROUNDING_PROMPT_PAYLOAD_VERSION;
  /** Binds the transport payload to the exact, immutable source pack. */
  readonly packHash: string;
  readonly runId: string;
  readonly retrievalRunId: string;
  readonly libraryId: string;
  readonly scopeHash: string;
  readonly query: string;
  readonly citations: readonly GroundingPromptCitation[];
}
export interface GroundingPromptPayloadInput {
  readonly pack: GroundingPack;
  readonly query: string;
  readonly citationIds?: readonly string[];
}

export const MAX_GROUNDING_PROMPT_BYTES = 1024 * 1024;
/** Recomputes the scope and pack fingerprints asynchronously. */
export async function validateGroundingPack(value: unknown): Promise<GroundingPack> {
  assertPackShape(value);
  const pack = value;
  const scope = await createCorpusScopeSnapshot({
    libraryId: pack.corpusScope.libraryId,
    scope: pack.corpusScope.scope,
    allowedSourceIds: pack.corpusScope.allowedSourceIds,
    capturedAt: pack.corpusScope.capturedAt,
  });
  if (scope.hash !== pack.scopeHash || scope.hash !== pack.corpusScope.hash) {
    throw new Error("Grounding corpus scope integrity hash does not match");
  }
  const expectedHash = await hashGroundingPack({
    excluded: pack.excluded,
    items: pack.items,
    libraryId: pack.libraryId,
    runId: pack.runId,
    retrievalRunId: pack.retrievalRunId,
    scopeHash: pack.scopeHash,
    truncated: pack.truncated,
  });
  if (expectedHash !== pack.hash) throw new Error("Grounding pack integrity hash does not match");
  return freezeDeep(pack);
}
/** Async assertion alias useful at provider and persistence boundaries. */
export async function assertGroundingPack(value: unknown): Promise<GroundingPack> {
  return validateGroundingPack(value);
}
export const assertGroundingPackIntegrity = assertGroundingPack;
/** Resolves only IDs issued by the current pack; never accepts source text IDs. */
export function resolveGroundingCitation(
  pack: GroundingPack,
  citationId: unknown,
): GroundingPackItem {
  assertPackShape(pack);
  const id = normalizeCitationId(citationId);
  const item = pack.citations.find((candidate) => candidate.citationId === id);
  if (!item || item.citationEligible !== true) throw new Error(`Unknown grounding citation ${id}`);
  return item;
}
export async function resolveGroundingCitationAsync(
  pack: GroundingPack,
  citationId: unknown,
): Promise<GroundingPackItem> {
  await validateGroundingPack(pack);
  return resolveGroundingCitation(pack, citationId);
}
/** Converts a pack item into the minimal durable citation identity. */
export function toGroundingCitationProjection(
  item: GroundingPackItem,
): GroundingCitationProjection {
  assertGroundingPackItemShape(item, 0, item.libraryId, new Set());
  const projection: GroundingCitationProjection = {
    citationId: item.citationId,
    assetId: item.assetId,
    revisionId: item.revisionId,
    workId: item.workId,
    anchorSnapshot: cloneFrozen(item.anchor),
    quotedText: item.quotedText,
    sourceContentHash: item.sourceContentHash,
    contentUnitId: item.contentUnitId,
  };
  return Object.freeze(projection);
}
/** Validates optional persisted citation fields against the current pack item. */
export function validateGroundingCitationReference(
  pack: GroundingPack,
  value: unknown,
): ValidatedGroundingCitationReference {
  const item = resolveGroundingCitation(pack, isRecord(value) ? value.citationId : value);
  if (typeof value === "string") {
    return Object.freeze({
      citationId: item.citationId,
      item,
      projection: toGroundingCitationProjection(item),
    });
  }
  if (!isRecord(value)) throw new Error("Grounding citation reference is invalid");
  assertExactKeys(
    value,
    ["citationId"],
    [
      "assetId",
      "revisionId",
      "workId",
      "anchorSnapshot",
      "quotedText",
      "sourceContentHash",
      "contentUnitId",
    ],
  );
  compareOptional(value.assetId, item.assetId, "assetId");
  compareOptional(value.revisionId, item.revisionId, "revisionId");
  compareOptional(value.workId, item.workId, "workId");
  compareOptional(value.quotedText, item.quotedText, "quotedText");
  compareOptional(value.sourceContentHash, item.sourceContentHash, "sourceContentHash");
  compareOptional(value.contentUnitId, item.contentUnitId, "contentUnitId");
  if (
    value.anchorSnapshot !== undefined &&
    canonicalJson(value.anchorSnapshot) !== canonicalJson(item.anchor)
  ) {
    throw new Error("Grounding citation anchor snapshot does not match the pack");
  }
  return Object.freeze({
    citationId: item.citationId,
    item,
    projection: toGroundingCitationProjection(item),
  });
}
export function validateGroundingCitation(
  pack: GroundingPack,
  value: unknown,
): GroundingCitationProjection {
  return validateGroundingCitationReference(pack, value).projection;
}
export function validateGroundingCitationReferences(
  pack: GroundingPack,
  values: readonly unknown[],
): readonly GroundingCitationProjection[] {
  if (!Array.isArray(values)) throw new Error("Grounding citation references must be an array");
  dense(values, "Grounding citation references");
  const seen = new Set<string>();
  const result = values.map((value) => {
    const validated = validateGroundingCitationReference(pack, value);
    if (seen.has(validated.citationId))
      throw new Error(`Grounding citation ${validated.citationId} is duplicated`);
    seen.add(validated.citationId);
    return validated.projection;
  });
  return Object.freeze(result);
}
/** Builds a provider payload where source text is explicitly opaque data. */
export function toGroundingPromptPayload(
  input: GroundingPromptPayloadInput,
): GroundingPromptPayload;
export function toGroundingPromptPayload(
  pack: GroundingPack,
  query: string,
  citationIds?: readonly string[],
): GroundingPromptPayload;
export function toGroundingPromptPayload(
  inputOrPack: GroundingPromptPayloadInput | GroundingPack,
  query?: string,
  citationIds?: readonly string[],
): GroundingPromptPayload {
  if (!isRecord(inputOrPack)) throw new Error("Grounding prompt input is invalid");
  if (Object.hasOwn(inputOrPack, "pack")) {
    assertExactKeys(inputOrPack, ["pack", "query"], ["citationIds"]);
  }
  const input: GroundingPromptPayloadInput = Object.hasOwn(inputOrPack, "pack")
    ? (inputOrPack as unknown as GroundingPromptPayloadInput)
    : { pack: inputOrPack as unknown as GroundingPack, query: query ?? "", citationIds };
  assertPackShape(input.pack);
  const normalizedQuery = boundedText(
    input.query,
    "Grounding prompt query",
    MAX_PROMPT_QUERY_CHARS,
    false,
  );
  const selectedIds =
    input.citationIds === undefined
      ? input.pack.citations.map((item) => item.citationId)
      : normalizeCitationIds(input.citationIds);
  const citations = selectedIds.map((id) =>
    promptCitation(resolveGroundingCitation(input.pack, id)),
  );
  const payload: GroundingPromptPayload = {
    version: GROUNDING_PROMPT_PAYLOAD_VERSION,
    packHash: input.pack.hash,
    runId: input.pack.runId,
    retrievalRunId: input.pack.retrievalRunId,
    libraryId: input.pack.libraryId,
    scopeHash: input.pack.scopeHash,
    query: normalizedQuery,
    citations: Object.freeze(citations),
  };
  assertPromptPayloadShape(payload);
  return Object.freeze(payload);
}
export async function toGroundingPromptPayloadAsync(
  input: GroundingPromptPayloadInput,
): Promise<GroundingPromptPayload> {
  await validateGroundingPack(input.pack);
  return toGroundingPromptPayload(input);
}
/** Canonical serialization keeps hashes and provider requests deterministic. */
export function serializeGroundingPromptPayload(
  payload: GroundingPromptPayload,
  maximumBytes = MAX_GROUNDING_PROMPT_BYTES,
): string {
  assertPromptPayloadShape(payload);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
    throw new Error("Prompt payload byte limit is invalid");
  const serialized = canonicalJson(payload);
  if (new TextEncoder().encode(serialized).byteLength > maximumBytes) {
    throw new Error("Grounding prompt payload exceeds its byte limit");
  }
  return serialized;
}
function promptCitation(item: GroundingPackItem): GroundingPromptCitation {
  return Object.freeze({
    citationId: item.citationId,
    sourceType: item.sourceType,
    sourceTypes: Object.freeze([...item.sourceTypes]),
    sourceTitle: item.sourceTitle,
    authority: item.authority,
    authorities: Object.freeze([...item.authorities]),
    revisionState: item.revisionState,
    workId: item.workId,
    assetId: item.assetId,
    revisionId: item.revisionId,
    anchorSnapshot: cloneFrozen(item.anchor),
    quotedText: item.quotedText,
    contentHash: item.contentHash,
    sourceContentHash: item.sourceContentHash,
    trust: "untrusted" as const,
    contentType: "text/plain" as const,
    text: item.text,
  });
}
function compareOptional(value: unknown, expected: string | null, field: string): void {
  if (value === undefined) return;
  if (value !== expected) throw new Error(`Grounding citation ${field} does not match the pack`);
}
function normalizeCitationIds(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length > MAX_GROUNDING_ITEMS)
    throw new Error("Grounding citation IDs are invalid");
  dense(value, "Grounding citation IDs");
  const ids = value.map((id) => normalizeCitationId(id));
  if (new Set(ids).size !== ids.length) throw new Error("Grounding citation IDs must be unique");
  return ids;
}
function boundedText(value: unknown, label: string, maximum: number, allowEmpty: boolean): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    containsControl(value) ||
    (!allowEmpty && !value.trim())
  )
    throw new Error(`${label} is invalid`);
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
  )
    throw new Error("Grounding value contains unsupported or missing fields");
}
function containsControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f)
      return true;
  }
  return false;
}
function cloneFrozen<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  const clone = Array.isArray(value)
    ? value.map((child) => cloneFrozen(child))
    : Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => [
          key,
          cloneFrozen(child),
        ]),
      );
  return freezeDeep(clone) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
