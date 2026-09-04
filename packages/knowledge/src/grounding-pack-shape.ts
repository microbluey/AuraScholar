import { parseSourceAnchor, type SourceAnchor } from "@aurascholar/anchors";
import {
  CORPUS_SCOPE_KINDS,
  MAX_CORPUS_SCOPE_WORK_IDS,
  type CorpusScopeSnapshot,
} from "./corpus-scope.js";
import { CONTENT_UNIT_SOURCE_TYPES, type ContentUnitSourceType } from "./content-unit.js";
import { canonicalJson, isSha256 } from "./hash.js";
import {
  GROUNDING_AUTHORITIES,
  GROUNDING_CITATION_PREFIX,
  GROUNDING_PACK_VERSION,
  GROUNDING_REVISION_STATES,
  MAX_GROUNDING_CHARS_PER_ITEM,
  MAX_GROUNDING_ITEMS,
  MAX_GROUNDING_RUN_ID_LENGTH,
  MAX_GROUNDING_SOURCE_TITLE_LENGTH,
  MAX_GROUNDING_TOTAL_CHARS,
  type GroundingAuthority,
  type GroundingPack,
  type GroundingPackExclusion,
  type GroundingPackExclusionReason,
  type GroundingPackItem,
  type GroundingRevisionState,
  type RevisionBoundSourceAnchor,
} from "./grounding-pack.js";
import {
  assertDenseArray,
  authorityMatchesSourceTypes,
  boundedWireId,
  hasDuplicateValues,
  isSortedValues,
  record,
} from "./grounding-pack-support.js";

/** Synchronous, fail-closed guard for values crossing IPC/provider boundaries. */
export function assertGroundingPackShape(value: unknown): asserts value is GroundingPack {
  if (!record(value)) throw new Error("Grounding pack is invalid");
  assertExactKeys(value, [
    "version",
    "runId",
    "retrievalRunId",
    "libraryId",
    "corpusScope",
    "scopeHash",
    "items",
    "citations",
    "truncated",
    "excluded",
    "hash",
  ]);
  if (value.version !== GROUNDING_PACK_VERSION)
    throw new Error("Grounding pack version is unsupported");
  boundedWireId(value.runId, "Grounding pack run id", MAX_GROUNDING_RUN_ID_LENGTH);
  boundedWireId(
    value.retrievalRunId,
    "Grounding pack retrieval run id",
    MAX_GROUNDING_RUN_ID_LENGTH,
  );
  const libraryId = boundedWireId(value.libraryId, "Grounding pack Library id");
  if (
    typeof value.scopeHash !== "string" ||
    typeof value.hash !== "string" ||
    !isSha256(value.scopeHash) ||
    !isSha256(value.hash)
  )
    throw new Error("Grounding pack hash is invalid");
  if (typeof value.truncated !== "boolean")
    throw new Error("Grounding pack truncated flag is invalid");
  assertCorpusScopeShape(value.corpusScope, libraryId);
  if (value.scopeHash !== value.corpusScope.hash)
    throw new Error("Grounding pack scope hash differs from its corpus scope");
  const allowedSourceIds = new Set(value.corpusScope.allowedSourceIds);
  const items = value.items;
  const citations = value.citations;
  if (!Array.isArray(items) || !Array.isArray(citations))
    throw new Error("Grounding pack citations must be arrays");
  assertDenseArray(items, "Grounding pack items");
  assertDenseArray(citations, "Grounding pack citations");
  if (items.length > MAX_GROUNDING_ITEMS) throw new Error("Grounding pack contains too many items");
  if (items.length !== citations.length)
    throw new Error("Grounding pack citation aliases differ in length");
  const itemIds = new Set<string>();
  let totalChars = 0;
  items.forEach((rawItem, index) => {
    assertGroundingPackItemShape(rawItem, index, libraryId, itemIds, allowedSourceIds);
    if (
      index > 0 &&
      compareItemOrder(items[index - 1] as GroundingPackItem, rawItem as GroundingPackItem) > 0
    )
      throw new Error("Grounding pack items are not deterministically ordered");
    totalChars += rawItem.text.length;
    if (totalChars > MAX_GROUNDING_TOTAL_CHARS)
      throw new Error("Grounding pack text exceeds its total limit");
    if (rawItem.citationId !== `${GROUNDING_CITATION_PREFIX}${index + 1}`)
      throw new Error("Grounding pack citation IDs must be contiguous");
    if (canonicalJson(citations[index]) !== canonicalJson(rawItem))
      throw new Error("Grounding pack citation alias differs from items");
  });
  const excluded = value.excluded;
  if (!Array.isArray(excluded)) throw new Error("Grounding pack exclusions must be an array");
  assertDenseArray(excluded, "Grounding pack exclusions");
  if (excluded.length > MAX_GROUNDING_ITEMS * 4)
    throw new Error("Grounding pack has too many exclusions");
  const excludedIds = new Set<string>();
  excluded.forEach((exclusion, index) => {
    assertExclusionShape(exclusion, index);
    if (itemIds.has(exclusion.contentUnitId))
      throw new Error(
        `Grounding pack ContentUnit ${exclusion.contentUnitId} is both selected and excluded`,
      );
    if (excludedIds.has(exclusion.contentUnitId))
      throw new Error(`Grounding pack exclusion ${exclusion.contentUnitId} is duplicated`);
    excludedIds.add(exclusion.contentUnitId);
    if (
      index > 0 &&
      compareExclusionOrder(
        excluded[index - 1] as GroundingPackExclusion,
        exclusion as GroundingPackExclusion,
      ) > 0
    )
      throw new Error("Grounding pack exclusions are not deterministically ordered");
  });
}

export function assertGroundingPackItemShape(
  value: unknown,
  index: number,
  libraryId: string,
  seenIds: Set<string>,
  allowedSourceIds?: ReadonlySet<string>,
): asserts value is GroundingPackItem {
  if (!record(value)) throw new Error(`Grounding pack item ${index} is invalid`);
  assertExactKeys(value, [
    "citationId",
    "contentUnitId",
    "contentUnitIds",
    "libraryId",
    "sourceType",
    "sourceTypes",
    "sourceId",
    "sourceIds",
    "workId",
    "assetId",
    "revisionId",
    "anchor",
    "text",
    "quotedText",
    "contentHash",
    "sourceContentHash",
    "extractorProfile",
    "chunkProfile",
    "authority",
    "authorities",
    "revisionState",
    "rank",
    "sourceTitle",
    "citationEligible",
  ]);
  const id = boundedWireId(value.contentUnitId, `Grounding pack item ${index} ContentUnit id`);
  if (seenIds.has(id)) throw new Error(`Grounding pack ContentUnit ${id} is duplicated`);
  seenIds.add(id);
  if (value.libraryId !== libraryId)
    throw new Error(`Grounding pack item ${id} belongs to another Library`);
  const citationId = normalizeGroundingCitationId(
    value.citationId,
    `Grounding pack item ${id} citation id`,
  );
  if (!CONTENT_UNIT_SOURCE_TYPES.includes(value.sourceType as ContentUnitSourceType))
    throw new Error(`Grounding pack item ${id} source type is invalid`);
  const sourceId = boundedWireId(value.sourceId, `Grounding pack item ${id} source id`);
  if (allowedSourceIds && !allowedSourceIds.has(sourceId))
    throw new Error(`Grounding pack item ${id} is outside the captured corpus scope`);
  if (
    typeof value.contentHash !== "string" ||
    !isSha256(value.contentHash) ||
    (value.sourceContentHash !== null &&
      (typeof value.sourceContentHash !== "string" || !isSha256(value.sourceContentHash)))
  )
    throw new Error(`Grounding pack item ${id} hash is invalid`);
  const text = boundedText(
    value.text,
    `Grounding pack item ${id} text`,
    MAX_GROUNDING_CHARS_PER_ITEM,
  );
  const quotedText = boundedText(
    value.quotedText,
    `Grounding pack item ${id} quote`,
    MAX_GROUNDING_CHARS_PER_ITEM,
  );
  if (!text.includes(quotedText)) throw new Error(`Grounding pack item ${id} quote is invalid`);
  if (value.workId !== null) boundedWireId(value.workId, `Grounding pack item ${id} Work id`);
  if (value.assetId !== null) boundedWireId(value.assetId, `Grounding pack item ${id} Asset id`);
  const anchor = parseRevisionBoundGroundingAnchor(value.anchor, id);
  const revisionId = boundedWireId(value.revisionId, `Grounding pack item ${id} revision id`);
  if (
    anchor.revisionId !== revisionId ||
    (anchor.quote?.exact && anchor.quote.exact !== quotedText)
  )
    throw new Error(`Grounding pack item ${id} anchor differs`);
  if (value.sourceType === "pdf" && (anchor.kind !== "pdf" || sourceId !== revisionId))
    throw new Error(`Grounding pack item ${id} PDF anchor is not revision-bound`);
  const { contentUnitIds, sourceIds, sourceTypes, authorities } = value;
  assertStringList(contentUnitIds, `Grounding pack item ${id} ContentUnit ids`);
  assertStringList(sourceIds, `Grounding pack item ${id} source ids`);
  assertStringList(sourceTypes, `Grounding pack item ${id} source types`);
  assertStringList(authorities, `Grounding pack item ${id} authorities`);
  if (!contentUnitIds.includes(id))
    throw new Error(`Grounding pack item ${id} ContentUnit ids are invalid`);
  contentUnitIds.forEach((unitId) => {
    if (seenIds.has(unitId) && unitId !== id)
      throw new Error(`Grounding pack ContentUnit ${unitId} is claimed by multiple items`);
    seenIds.add(unitId);
  });
  if (
    !sourceIds.includes(sourceId) ||
    sourceIds.some(
      (candidate) =>
        candidate.length > 512 ||
        (allowedSourceIds !== undefined && !allowedSourceIds.has(candidate)),
    )
  )
    throw new Error(`Grounding pack item ${id} source ids are invalid`);
  const sourceType = value.sourceType as ContentUnitSourceType;
  const authority = value.authority as GroundingAuthority;
  if (
    !sourceTypes.includes(sourceType) ||
    sourceTypes.some((type) => !CONTENT_UNIT_SOURCE_TYPES.includes(type as ContentUnitSourceType))
  )
    throw new Error(`Grounding pack item ${id} source types are invalid`);
  if (!GROUNDING_AUTHORITIES.includes(authority) || !authorities.includes(authority))
    throw new Error(`Grounding pack item ${id} authorities are invalid`);
  authorities.forEach((authority) => {
    if (
      !GROUNDING_AUTHORITIES.includes(authority as GroundingAuthority) ||
      !authorityMatchesSourceTypes(authority, sourceTypes)
    )
      throw new Error(`Grounding pack item ${id} authority does not match its source types`);
  });
  if (!authorityMatchesSourceTypes(value.authority as string, [value.sourceType as string]))
    throw new Error(`Grounding pack item ${id} primary authority does not match its source type`);
  if (sourceTypes.includes("evidence") && value.sourceContentHash !== value.contentHash)
    throw new Error(`Grounding pack item ${id} Evidence hash is invalid`);
  if (!GROUNDING_REVISION_STATES.includes(value.revisionState as GroundingRevisionState))
    throw new Error(`Grounding pack item ${id} revision state is invalid`);
  if (typeof value.rank !== "number" || !Number.isSafeInteger(value.rank) || value.rank < 1)
    throw new Error(`Grounding pack item ${id} rank is invalid`);
  if (value.sourceTitle !== null)
    boundedWireId(
      value.sourceTitle,
      `Grounding pack item ${id} source title`,
      MAX_GROUNDING_SOURCE_TITLE_LENGTH,
    );
  if (value.citationEligible !== true)
    throw new Error(`Grounding pack item ${id} is not citation eligible`);
  boundedWireId(value.extractorProfile, `Grounding pack item ${id} extractor profile`);
  boundedWireId(value.chunkProfile, `Grounding pack item ${id} chunk profile`);
  if (citationId !== value.citationId)
    throw new Error(`Grounding pack item ${id} citation ID is not canonical`);
}

export function parseRevisionBoundGroundingAnchor(
  value: unknown,
  id: string,
): RevisionBoundSourceAnchor {
  let parsed: SourceAnchor;
  try {
    parsed = parseSourceAnchor(value);
  } catch {
    throw new Error(`Grounding citation ${id} anchor is invalid`);
  }
  if (!("revisionId" in parsed))
    throw new Error(`Grounding citation ${id} anchor is not revision-bound`);
  if (canonicalJson(value) !== canonicalJson(parsed))
    throw new Error(`Grounding citation ${id} anchor contains unsupported fields`);
  return parsed as RevisionBoundSourceAnchor;
}

export function normalizeGroundingCitationId(
  value: unknown,
  label = "Grounding citation id",
): string {
  const id = boundedWireId(value, label, 64);
  if (!/^cite:[1-9][0-9]*$/.test(id)) throw new Error(`${label} is invalid`);
  return id;
}

function assertCorpusScopeShape(
  value: unknown,
  libraryId: string,
): asserts value is CorpusScopeSnapshot {
  if (!record(value)) throw new Error("Grounding corpus scope is invalid");
  assertExactKeys(value, [
    "version",
    "libraryId",
    "scope",
    "allowedSourceIds",
    "capturedAt",
    "hash",
  ]);
  if (
    value.version !== 1 ||
    typeof value.libraryId !== "string" ||
    value.libraryId !== libraryId ||
    value.libraryId !== value.libraryId.trim() ||
    typeof value.hash !== "string" ||
    !isSha256(value.hash)
  )
    throw new Error("Grounding corpus scope is invalid");
  assertStringList(value.allowedSourceIds, "Grounding corpus scope source allowlist");
  if (
    typeof value.capturedAt !== "number" ||
    !Number.isSafeInteger(value.capturedAt) ||
    value.capturedAt < 0
  )
    throw new Error("Grounding corpus scope capture time is invalid");
  assertScopeSelectionShape(value.scope);
}

function assertExclusionShape(
  value: unknown,
  index: number,
): asserts value is GroundingPackExclusion {
  if (!record(value)) throw new Error(`Grounding pack exclusion ${index} is invalid`);
  assertExactKeys(value, ["contentUnitId", "sourceType", "reason"]);
  boundedWireId(value.contentUnitId, `Grounding exclusion ${index} ContentUnit id`);
  if (!CONTENT_UNIT_SOURCE_TYPES.includes(value.sourceType as ContentUnitSourceType))
    throw new Error(`Grounding exclusion ${index} source type is invalid`);
  const reasons: readonly GroundingPackExclusionReason[] = [
    "context-only",
    "historical-source",
    "historical-evidence",
    "item-limit",
    "payload-limit",
  ];
  if (!reasons.includes(value.reason as GroundingPackExclusionReason))
    throw new Error(`Grounding exclusion ${index} reason is invalid`);
}

function assertScopeSelectionShape(value: unknown): void {
  if (
    !record(value) ||
    typeof value.kind !== "string" ||
    !CORPUS_SCOPE_KINDS.includes(value.kind as (typeof CORPUS_SCOPE_KINDS)[number])
  )
    throw new Error("Grounding corpus scope selection is invalid");
  if (value.kind === "library") return assertExactKeys(value, ["kind"]);
  if (value.kind === "project") return assertIdSelection(value, "projectId", "Project");
  if (value.kind === "asset") return assertIdSelection(value, "assetId", "Asset");
  assertExactKeys(value, ["kind", "workIds"]);
  if (!Array.isArray(value.workIds) || value.workIds.length > MAX_CORPUS_SCOPE_WORK_IDS)
    throw new Error("Grounding corpus Work ids are invalid");
  assertStringList(value.workIds, "Grounding corpus Work ids");
}

function assertIdSelection(
  value: Record<string, unknown>,
  key: "projectId" | "assetId",
  label: string,
): void {
  assertExactKeys(value, ["kind", key]);
  boundedWireId(value[key], `Grounding corpus ${label} id`);
}

function assertStringList(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid`);
  assertDenseArray(value, label);
  if (
    hasDuplicateValues(value) ||
    !isSortedValues(value) ||
    value.some(
      (entry) =>
        typeof entry !== "string" ||
        !entry.trim() ||
        entry !== entry.trim() ||
        containsControl(entry),
    )
  )
    throw new Error(`${label} is invalid`);
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    containsControl(value)
  )
    throw new Error(`${label} is invalid`);
  return value;
}

function assertExactKeys(value: Record<string, unknown>, required: readonly string[]): void {
  if (
    Object.keys(value).some((key) => !required.includes(key)) ||
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

function compareItemOrder(left: GroundingPackItem, right: GroundingPackItem): number {
  return left.rank !== right.rank
    ? left.rank - right.rank
    : left.contentUnitId < right.contentUnitId
      ? -1
      : left.contentUnitId > right.contentUnitId
        ? 1
        : 0;
}

function compareExclusionOrder(
  left: GroundingPackExclusion,
  right: GroundingPackExclusion,
): number {
  if (left.contentUnitId !== right.contentUnitId)
    return left.contentUnitId < right.contentUnitId ? -1 : 1;
  if (left.sourceType !== right.sourceType) return left.sourceType < right.sourceType ? -1 : 1;
  return left.reason < right.reason ? -1 : left.reason > right.reason ? 1 : 0;
}
