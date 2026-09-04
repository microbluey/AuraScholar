import { parseSourceAnchor, type SourceAnchor } from "@aurascholar/anchors";
import { CONTENT_UNIT_SOURCE_TYPES, type ContentUnit } from "./content-unit.js";
import { createCorpusScopeSnapshot, type CorpusScopeSnapshot } from "./corpus-scope.js";
import { canonicalJson, isSha256 } from "./hash.js";
import { MAX_STRUCTURAL_CONTENT_UNIT_CHARS } from "./profiles.js";

export type ContentUnitWithLifecycle = ContentUnit & { readonly deletedAt?: number | null };
export type RevisionBoundSourceAnchor = Extract<SourceAnchor, { revisionId: string }>;

export function assertGroundingUnitShape(
  unit: ContentUnitWithLifecycle,
  libraryId: string,
  scope: CorpusScopeSnapshot,
): string {
  if (!record(unit)) throw new Error("Grounding ContentUnit is invalid");
  assertExactKeys(
    unit,
    [
      "id",
      "libraryId",
      "sourceType",
      "sourceId",
      "workId",
      "assetId",
      "revisionId",
      "parentUnitId",
      "ordinal",
      "headingPath",
      "anchor",
      "text",
      "language",
      "tokenCount",
      "contentHash",
      "extractorProfile",
      "chunkProfile",
      "state",
    ],
    "Grounding ContentUnit",
    ["deletedAt"],
    true,
  );
  const id = normalizeId(unit.id, "ContentUnit id");
  if (unit.id !== id) throw new Error(`ContentUnit ${id} id is not canonical`);
  if (unit.libraryId !== libraryId) throw new Error(`ContentUnit ${id} belongs to another Library`);
  if (!CONTENT_UNIT_SOURCE_TYPES.includes(unit.sourceType))
    throw new Error(`ContentUnit ${id} source type is invalid`);
  const sourceId = normalizeId(unit.sourceId, `ContentUnit ${id} source id`);
  if (sourceId !== unit.sourceId) throw new Error(`ContentUnit ${id} source id is not canonical`);
  if (!scope.allowedSourceIds.includes(sourceId))
    throw new Error(`ContentUnit ${id} is outside the captured corpus scope`);
  if (unit.state !== "ready" && unit.state !== "context-only")
    throw new Error(`ContentUnit ${id} state is invalid`);
  if (!Number.isSafeInteger(unit.ordinal) || unit.ordinal < 0)
    throw new Error(`ContentUnit ${id} ordinal is invalid`);
  if (
    typeof unit.text !== "string" ||
    !unit.text.trim() ||
    unit.text.length > MAX_STRUCTURAL_CONTENT_UNIT_CHARS ||
    containsControl(unit.text)
  )
    throw new Error(`ContentUnit ${id} text is invalid`);
  if (unit.deletedAt !== undefined && unit.deletedAt !== null)
    throw new Error(`ContentUnit ${id} is deleted and cannot be grounded`);
  const anchor = parseSourceAnchor(unit.anchor);
  if (canonicalJson(anchor) !== canonicalJson(unit.anchor))
    throw new Error(`ContentUnit ${id} source anchor is not canonical`);
  if (unit.revisionId !== null) {
    const revisionId = normalizeId(unit.revisionId, `ContentUnit ${id} revision id`);
    if (revisionId !== unit.revisionId)
      throw new Error(`ContentUnit ${id} revision id is not canonical`);
    if ("revisionId" in anchor && anchor.revisionId !== revisionId)
      throw new Error(`ContentUnit ${id} revision does not match its source anchor`);
    if (unit.sourceType === "pdf" && (anchor.kind !== "pdf" || sourceId !== revisionId))
      throw new Error(`PDF ContentUnit ${id} is not bound to its revision anchor`);
  } else if (unit.state === "ready") {
    throw new Error(`ContentUnit ${id} must bind to a document revision`);
  }
  const workId = normalizeNullableId(unit.workId, `ContentUnit ${id} Work id`);
  const assetId = normalizeNullableId(unit.assetId, `ContentUnit ${id} Asset id`);
  const parentUnitId = normalizeNullableId(unit.parentUnitId, `ContentUnit ${id} parent id`);
  if (workId !== unit.workId || assetId !== unit.assetId || parentUnitId !== unit.parentUnitId)
    throw new Error(`ContentUnit ${id} related ids are not canonical`);
  if (
    unit.headingPath !== null &&
    unit.headingPath !== undefined &&
    (!Array.isArray(unit.headingPath) ||
      !unit.headingPath.every((part) => typeof part === "string" && !containsControl(part)))
  )
    throw new Error(`ContentUnit ${id} heading path is invalid`);
  if (
    unit.language !== null &&
    unit.language !== undefined &&
    (typeof unit.language !== "string" || containsControl(unit.language))
  )
    throw new Error(`ContentUnit ${id} language is invalid`);
  if (
    unit.tokenCount !== null &&
    unit.tokenCount !== undefined &&
    (!Number.isSafeInteger(unit.tokenCount) || unit.tokenCount < 0)
  )
    throw new Error(`ContentUnit ${id} token count is invalid`);
  if (typeof unit.contentHash !== "string" || !isSha256(unit.contentHash))
    throw new Error(`ContentUnit ${id} content hash is invalid`);
  return canonicalJson({
    anchor,
    assetId,
    chunkProfile: normalizeProfile(unit.chunkProfile, id, "chunk"),
    contentHash: unit.contentHash,
    extractorProfile: normalizeProfile(unit.extractorProfile, id, "extractor"),
    id,
    libraryId,
    parentUnitId,
    revisionId: unit.revisionId,
    sourceId,
    sourceType: unit.sourceType,
    state: unit.state,
    text: unit.text,
    workId,
  });
}

export function parseRevisionBoundAnchor(value: unknown): RevisionBoundSourceAnchor {
  const anchor = parseSourceAnchor(value);
  if (!("revisionId" in anchor))
    throw new Error("Grounding source anchor must be bound to a document revision");
  return anchor;
}

export function normalizeId(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || containsControl(normalized))
    throw new Error(`${label} is invalid`);
  return normalized;
}

export function normalizeNullableId(value: unknown, label: string, maximum = 512): string | null {
  if (value === undefined || value === null) return null;
  return normalizeId(value, label, maximum);
}

export function normalizeOptional(
  value: string | null | undefined,
  maximum: number,
  label: string,
): string | null {
  return value === undefined || value === null ? null : normalizeId(value, label, maximum);
}

export function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${label} is invalid`);
  return value;
}

export function count(value: number, maximum: number, label: string): number {
  return boundedInteger(value, 0, maximum, label);
}

export function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label = "Grounding value",
  optional: readonly string[] = [],
  requireAll = false,
): void {
  const allowed = new Set([...expected, ...optional]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    (requireAll && expected.some((key) => !Object.hasOwn(value, key)))
  ) {
    throw new Error(`${label} contains unsupported or missing fields`);
  }
}

/** Strict wire-boundary helpers shared by pack and generated-output guards. */
export function boundedWireId(value: unknown, label: string, maximum = 512): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > maximum ||
    containsControl(value)
  )
    throw new Error(`${label} is invalid`);
  return value;
}
export function boundedWireText(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty: boolean,
): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    containsControl(value) ||
    (!allowEmpty && !value.trim())
  )
    throw new Error(`${label} is invalid`);
  return value;
}
export function hasDuplicateValues(value: readonly unknown[]): boolean {
  return new Set(value).size !== value.length;
}
export function assertDenseArray(value: readonly unknown[], label: string): void {
  for (let index = 0; index < value.length; index += 1)
    if (!Object.hasOwn(value, index)) throw new Error(`${label} must be a dense array`);
}
export function isSortedValues(value: readonly unknown[]): boolean {
  for (let index = 1; index < value.length; index += 1) {
    if (
      typeof value[index - 1] !== "string" ||
      typeof value[index] !== "string" ||
      value[index - 1]! > value[index]!
    )
      return false;
  }
  return true;
}
export function authorityMatchesSourceTypes(
  authority: string,
  sourceTypes: readonly string[],
): boolean {
  if (authority === "published-source" || authority === "captured-source")
    return sourceTypes.includes("pdf");
  if (authority === "user-annotation") return sourceTypes.includes("annotation");
  return authority === "user-evidence" && sourceTypes.includes("evidence");
}

export async function validateGroundingScope(
  scope: CorpusScopeSnapshot,
): Promise<CorpusScopeSnapshot> {
  if (!record(scope)) throw new Error("Grounding corpus scope is invalid");
  assertExactKeys(
    scope,
    ["version", "libraryId", "scope", "allowedSourceIds", "capturedAt", "hash"],
    "Grounding corpus scope",
    [],
    true,
  );
  const canonical = await createCorpusScopeSnapshot({
    libraryId: scope.libraryId,
    scope: scope.scope,
    allowedSourceIds: scope.allowedSourceIds,
    capturedAt: scope.capturedAt,
  });
  if (canonicalJson(canonical) !== canonicalJson(scope))
    throw new Error("Grounding corpus scope integrity hash does not match");
  return canonical;
}

export function normalizeRunIdentities(
  runId: string | undefined,
  retrievalRunId: string | undefined,
  maximum: number,
): { runId: string; retrievalRunId: string } {
  return {
    runId: normalizeId(runId ?? retrievalRunId, "Grounding run id", maximum),
    retrievalRunId: normalizeId(retrievalRunId ?? runId, "Grounding retrieval run id", maximum),
  };
}

export function normalizeRank(value: number, id: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`ContentUnit ${id} rank is invalid`);
  return value;
}

export function validateRevisionMap(value: Readonly<Record<string, string | null>>): void {
  for (const [assetId, revisionId] of Object.entries(value)) {
    if (normalizeId(assetId, "Grounding current-revision Asset id") !== assetId)
      throw new Error("Grounding current-revision Asset id is not canonical");
    if (
      revisionId !== null &&
      normalizeId(revisionId, "Grounding current-revision id") !== revisionId
    )
      throw new Error("Grounding current-revision id is not canonical");
  }
}

function normalizeProfile(value: unknown, id: string, kind: string): string {
  const profile = normalizeId(value, `ContentUnit ${id} ${kind} profile`, 128);
  if (value !== profile) throw new Error(`ContentUnit ${id} profiles are not canonical`);
  return profile;
}

function containsControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f)
      return true;
  }
  return false;
}
