import { CONTENT_UNIT_SOURCE_TYPES, type ContentUnitSourceType } from "./content-unit.js";
import { isSha256 } from "./hash.js";
import {
  GROUNDING_AUTHORITIES,
  GROUNDING_PROMPT_PAYLOAD_VERSION,
  GROUNDING_REVISION_STATES,
  MAX_GROUNDING_CHARS_PER_ITEM,
  MAX_GROUNDING_ITEMS,
  MAX_GROUNDING_RUN_ID_LENGTH,
  MAX_GROUNDING_SOURCE_TITLE_LENGTH,
  type GroundingAuthority,
  type GroundingRevisionState,
} from "./grounding-pack.js";
import {
  assertDenseArray,
  assertExactKeys,
  authorityMatchesSourceTypes,
  boundedWireId,
  boundedWireText,
  hasDuplicateValues,
  isSortedValues,
  record,
} from "./grounding-pack-support.js";
import {
  normalizeGroundingCitationId,
  parseRevisionBoundGroundingAnchor,
} from "./grounding-pack-shape.js";
import type { GroundingPromptPayload } from "./grounding-pack-validation.js";

export const MAX_GROUNDING_PROMPT_QUERY_CHARS = 16 * 1024;

/** Fail-closed wire guard for source text sent to a generation provider. */
export function assertGroundingPromptPayloadShape(
  value: unknown,
): asserts value is GroundingPromptPayload {
  if (!record(value)) throw new Error("Grounding prompt payload is invalid");
  assertPromptKeys(value, [
    "version",
    "packHash",
    "runId",
    "retrievalRunId",
    "libraryId",
    "scopeHash",
    "query",
    "citations",
  ]);
  if (value.version !== GROUNDING_PROMPT_PAYLOAD_VERSION)
    throw new Error("Grounding prompt payload version is unsupported");
  if (typeof value.packHash !== "string" || !isSha256(value.packHash))
    throw new Error("Grounding prompt pack hash is invalid");
  boundedWireId(value.runId, "Grounding prompt run id", MAX_GROUNDING_RUN_ID_LENGTH);
  boundedWireId(
    value.retrievalRunId,
    "Grounding prompt retrieval run id",
    MAX_GROUNDING_RUN_ID_LENGTH,
  );
  boundedWireId(value.libraryId, "Grounding prompt Library id");
  if (typeof value.scopeHash !== "string" || !isSha256(value.scopeHash))
    throw new Error("Grounding prompt scope hash is invalid");
  boundedWireText(value.query, "Grounding prompt query", MAX_GROUNDING_PROMPT_QUERY_CHARS, false);
  const citations = value.citations;
  if (!Array.isArray(citations) || citations.length > MAX_GROUNDING_ITEMS)
    throw new Error("Grounding prompt citations are invalid");
  assertDenseArray(citations, "Grounding prompt citations");
  const ids = new Set<string>();
  citations.forEach((citation, index) => {
    assertPromptCitation(citation, index, ids);
  });
}

function assertPromptCitation(value: unknown, index: number, ids: Set<string>): void {
  if (!record(value)) throw new Error(`Grounding prompt citation ${index} is invalid`);
  assertPromptKeys(value, [
    "citationId",
    "sourceType",
    "sourceTypes",
    "sourceTitle",
    "authority",
    "authorities",
    "revisionState",
    "workId",
    "assetId",
    "revisionId",
    "anchorSnapshot",
    "quotedText",
    "contentHash",
    "sourceContentHash",
    "trust",
    "contentType",
    "text",
  ]);
  const id = normalizeGroundingCitationId(value.citationId);
  if (ids.has(id)) throw new Error(`Grounding prompt citation ${id} is duplicated`);
  ids.add(id);
  if (value.sourceTitle !== null)
    boundedWireId(
      value.sourceTitle,
      `Grounding prompt citation ${id} title`,
      MAX_GROUNDING_SOURCE_TITLE_LENGTH,
    );
  const authority = value.authority as GroundingAuthority;
  const sourceType = value.sourceType as ContentUnitSourceType;
  const authorities = value.authorities;
  const sourceTypes = value.sourceTypes;
  if (!GROUNDING_AUTHORITIES.includes(authority) || !Array.isArray(authorities))
    throw new Error(`Grounding prompt citation ${id} authority is invalid`);
  if (
    hasDuplicateValues(authorities) ||
    !isSortedValues(authorities) ||
    !authorities.includes(authority)
  )
    throw new Error(`Grounding prompt citation ${id} authority list is invalid`);
  if (!GROUNDING_REVISION_STATES.includes(value.revisionState as GroundingRevisionState))
    throw new Error(`Grounding prompt citation ${id} revision state is invalid`);
  if (!CONTENT_UNIT_SOURCE_TYPES.includes(sourceType))
    throw new Error(`Grounding prompt citation ${id} source type is invalid`);
  if (
    !Array.isArray(sourceTypes) ||
    !sourceTypes.includes(sourceType) ||
    hasDuplicateValues(sourceTypes) ||
    !isSortedValues(sourceTypes) ||
    sourceTypes.some((type) => !CONTENT_UNIT_SOURCE_TYPES.includes(type as ContentUnitSourceType))
  )
    throw new Error(`Grounding prompt citation ${id} source type list is invalid`);
  assertDenseArray(sourceTypes, `Grounding prompt citation ${id} source types`);
  assertDenseArray(authorities, `Grounding prompt citation ${id} authorities`);
  authorities.forEach((candidate) => {
    if (
      !GROUNDING_AUTHORITIES.includes(candidate as GroundingAuthority) ||
      !authorityMatchesSourceTypes(candidate as GroundingAuthority, sourceTypes)
    )
      throw new Error(`Grounding prompt citation ${id} authority is invalid`);
  });
  if (!authorityMatchesSourceTypes(authority, [sourceType]))
    throw new Error(`Grounding prompt citation ${id} primary authority is invalid`);
  if (value.workId !== null) boundedWireId(value.workId, `Grounding prompt citation ${id} Work id`);
  if (value.assetId !== null)
    boundedWireId(value.assetId, `Grounding prompt citation ${id} Asset id`);
  const revisionId = boundedWireId(value.revisionId, `Grounding prompt citation ${id} revision id`);
  const anchor = parseRevisionBoundGroundingAnchor(value.anchorSnapshot, id);
  if (anchor.revisionId !== revisionId || (sourceType === "pdf" && anchor.kind !== "pdf"))
    throw new Error(`Grounding prompt citation ${id} anchor does not match its revision`);
  if (anchor.quote?.exact && anchor.quote.exact !== value.quotedText)
    throw new Error(`Grounding prompt citation ${id} quote differs from its anchor`);
  const quote = boundedWireText(
    value.quotedText,
    `Grounding prompt citation ${id} quote`,
    MAX_GROUNDING_CHARS_PER_ITEM,
    false,
  );
  if (
    typeof value.contentHash !== "string" ||
    !isSha256(value.contentHash) ||
    (value.sourceContentHash !== null &&
      (typeof value.sourceContentHash !== "string" || !isSha256(value.sourceContentHash)))
  )
    throw new Error(`Grounding prompt citation ${id} hash is invalid`);
  if (sourceTypes.includes("evidence") && value.sourceContentHash !== value.contentHash)
    throw new Error(`Grounding prompt citation ${id} Evidence hash is invalid`);
  if (value.trust !== "untrusted" || value.contentType !== "text/plain")
    throw new Error(`Grounding prompt citation ${id} trust boundary is invalid`);
  const text = boundedWireText(
    value.text,
    `Grounding prompt citation ${id} text`,
    MAX_GROUNDING_CHARS_PER_ITEM,
    false,
  );
  if (!text.includes(quote))
    throw new Error(`Grounding prompt citation ${id} quote is not in its text`);
}

function assertPromptKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  assertExactKeys(value, keys, "Grounding prompt value", [], true);
}
