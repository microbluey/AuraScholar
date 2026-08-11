import { Buffer } from "node:buffer";
import { normalizeDoi } from "@aurascholar/db/ids";
import type {
  CitationGraphBuildCommandInput,
  LibraryResolveClueCommandInput,
  ScholarEnrichByDoiCommandInput,
  ScholarlyCancelRunCommandInput,
  ScholarlyDataCommandName,
  ScholarlyResolvableClue,
  ScholarlySearchDiscoveryCommandInput,
} from "../scholarly-command-contract";
import { isRecord } from "./data-command-runtime";

const MAX_ARXIV_ID_LENGTH = 32;
const MAX_DISCOVERY_AUTHOR_BYTES = 2 * 1024;
const MAX_DISCOVERY_INPUT_BYTES = 128 * 1024;
const MAX_DISCOVERY_LIMIT = 50;
const MAX_DISCOVERY_PAGE = 10_000;
const MAX_DISCOVERY_QUERY_TEXT_BYTES = 8 * 1024;
const MAX_DISCOVERY_VENUE_BYTES = 2 * 1024;
const MAX_DOI_BYTES = 2 * 1024;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_TITLE_BYTES = 8 * 1024;

const DISCOVERY_QUERY_FIELDS = ["author", "text", "venue", "yearFrom", "yearTo"] as const;
const DISCOVERY_SOURCES = ["crossref", "openalex", "s2", "arxiv"] as const;

type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

export function parseCitationGraphBuildInput(value: unknown): CitationGraphBuildCommandInput {
  const input = requireExactInput(value, "citationGraph.build", ["doi", "requestId"]);
  return {
    doi: requireDoi(input.doi),
    requestId: requireRequestId(input.requestId),
  };
}

export function parseScholarEnrichByDoiInput(value: unknown): ScholarEnrichByDoiCommandInput {
  const input = requireExactInput(value, "scholar.enrichByDoi", ["doi", "requestId"]);
  return {
    doi: requireDoi(input.doi),
    requestId: requireRequestId(input.requestId),
  };
}

export function parseLibraryResolveClueInput(value: unknown): LibraryResolveClueCommandInput {
  const input = requireExactInput(value, "library.resolveClue", ["clue", "requestId"]);
  const parsed = {
    clue: parseResolvableClue(input.clue),
    requestId: requireRequestId(input.requestId),
  } satisfies LibraryResolveClueCommandInput;
  requireBoundedBytes(parsed, MAX_DISCOVERY_INPUT_BYTES, "Library clue resolution input");
  return parsed;
}

export function parseScholarlyCancelRunInput(value: unknown): ScholarlyCancelRunCommandInput {
  const input = requireExactInput(value, "scholarly.cancelRun", ["requestId"]);
  return { requestId: requireRequestId(input.requestId) };
}

export function parseScholarlySearchDiscoveryInput(
  value: unknown,
): ScholarlySearchDiscoveryCommandInput {
  const input = requireInputWithOptionalFields(
    value,
    "discovery.searchOpenSources",
    ["query", "requestId"],
    ["cursors", "limit", "page", "sources", "sort"],
  );
  const query = parseDiscoveryQuery(input.query);
  const sources = optionalSources(input.sources);
  const cursors = optionalCursors(input.cursors);
  const page = optionalBoundedInteger(input.page, "Discovery page", 1, MAX_DISCOVERY_PAGE);
  const limit = optionalBoundedInteger(input.limit, "Discovery limit", 1, MAX_DISCOVERY_LIMIT);
  const sort = optionalSort(input.sort);
  const parsed = {
    ...(cursors === undefined ? {} : { cursors }),
    ...(limit === undefined ? {} : { limit }),
    ...(page === undefined ? {} : { page }),
    query,
    requestId: requireRequestId(input.requestId),
    ...(sources === undefined ? {} : { sources }),
    ...(sort === undefined ? {} : { sort }),
  } satisfies ScholarlySearchDiscoveryCommandInput;
  requireBoundedBytes(parsed, MAX_DISCOVERY_INPUT_BYTES, "Discovery search input");
  return parsed;
}

function parseDiscoveryQuery(value: unknown): ScholarlySearchDiscoveryCommandInput["query"] {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (field) => !DISCOVERY_QUERY_FIELDS.includes(field as (typeof DISCOVERY_QUERY_FIELDS)[number]),
    ) ||
    !Object.hasOwn(value, "text")
  ) {
    throw new Error("Discovery query is invalid");
  }
  const text = requireBoundedText(
    value.text,
    "Discovery query text",
    MAX_DISCOVERY_QUERY_TEXT_BYTES,
  );
  const author = optionalBoundedText(
    value.author,
    "Discovery query author",
    MAX_DISCOVERY_AUTHOR_BYTES,
  );
  const venue = optionalBoundedText(
    value.venue,
    "Discovery query venue",
    MAX_DISCOVERY_VENUE_BYTES,
  );
  const yearFrom = optionalBoundedInteger(value.yearFrom, "Discovery query start year", 1000, 3000);
  const yearTo = optionalBoundedInteger(value.yearTo, "Discovery query end year", 1000, 3000);
  if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) {
    throw new Error("Discovery query year range is invalid");
  }
  return {
    ...(author === undefined ? {} : { author }),
    text,
    ...(venue === undefined ? {} : { venue }),
    ...(yearFrom === undefined ? {} : { yearFrom }),
    ...(yearTo === undefined ? {} : { yearTo }),
  };
}

function optionalSources(value: unknown): DiscoverySource[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > DISCOVERY_SOURCES.length) {
    throw new Error("Discovery sources are invalid");
  }
  const sources = value.map((source) => requireDiscoverySource(source));
  if (new Set(sources).size !== sources.length) {
    throw new Error("Discovery sources must be unique");
  }
  return sources;
}

function optionalCursors(
  value: unknown,
): ScholarlySearchDiscoveryCommandInput["cursors"] | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    Object.keys(value).some((source) => !DISCOVERY_SOURCES.includes(source as DiscoverySource))
  ) {
    throw new Error("Discovery cursors are invalid");
  }
  const cursors: NonNullable<ScholarlySearchDiscoveryCommandInput["cursors"]> = {};
  for (const source of DISCOVERY_SOURCES) {
    if (!Object.hasOwn(value, source)) continue;
    const cursor = value[source];
    if (
      !isRecord(cursor) ||
      Object.keys(cursor).length !== 2 ||
      !Object.hasOwn(cursor, "hasMore") ||
      !Object.hasOwn(cursor, "page") ||
      typeof cursor.hasMore !== "boolean"
    ) {
      throw new Error(`Discovery cursor for ${source} is invalid`);
    }
    cursors[source] = {
      hasMore: cursor.hasMore,
      page: requireBoundedInteger(
        cursor.page,
        `Discovery cursor page for ${source}`,
        1,
        MAX_DISCOVERY_PAGE,
      ),
    };
  }
  return cursors;
}

function optionalSort(value: unknown): ScholarlySearchDiscoveryCommandInput["sort"] | undefined {
  if (value === undefined) return undefined;
  if (value === "relevance" || value === "year" || value === "citations") return value;
  throw new Error("Discovery sort is invalid");
}

function parseResolvableClue(value: unknown): ScholarlyResolvableClue {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("Library clue is invalid");
  }
  switch (value.kind) {
    case "doi":
      requireExactRecordFields(value, "Library DOI clue", ["doi", "kind"]);
      return { doi: requireDoi(value.doi), kind: "doi" };
    case "arxiv":
      requireExactRecordFields(value, "Library arXiv clue", ["arxivId", "kind"]);
      return { arxivId: requireArxivId(value.arxivId), kind: "arxiv" };
    case "title":
      requireExactRecordFields(value, "Library title clue", ["kind", "title"]);
      return {
        kind: "title",
        title: requireBoundedText(value.title, "Library clue title", MAX_TITLE_BYTES),
      };
    default:
      throw new Error("Library clue kind is unsupported");
  }
}

function requireExactInput(
  value: unknown,
  commandName: ScholarlyDataCommandName,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((field) => !fields.includes(field)) ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`Invalid ${commandName} input`);
  }
  return value;
}

function requireInputWithOptionalFields(
  value: unknown,
  commandName: ScholarlyDataCommandName,
  requiredFields: readonly string[],
  optionalFields: readonly string[],
): Record<string, unknown> {
  const allowed = new Set([...requiredFields, ...optionalFields]);
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !allowed.has(field)) ||
    requiredFields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`Invalid ${commandName} input`);
  }
  return value;
}

function requireExactRecordFields(
  value: Record<string, unknown>,
  label: string,
  fields: readonly string[],
): void {
  if (
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((field) => !fields.includes(field)) ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function requireRequestId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_REQUEST_ID_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    throw new Error("Scholarly request id is invalid");
  }
  return value;
}

function requireDoi(value: unknown): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_DOI_BYTES) {
    throw new Error("DOI is invalid");
  }
  const doi = normalizeDoi(value);
  if (!doi) throw new Error("DOI is invalid");
  return doi;
}

function requireArxivId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ARXIV_ID_LENGTH ||
    !/^\d{4}\.\d{4,5}$/.test(value)
  ) {
    throw new Error("arXiv id is invalid");
  }
  return value;
}

function requireDiscoverySource(value: unknown): DiscoverySource {
  if (typeof value === "string" && DISCOVERY_SOURCES.includes(value as DiscoverySource)) {
    return value as DiscoverySource;
  }
  throw new Error("Discovery source is invalid");
}

function requireBoundedText(value: unknown, label: string, maximumBytes: number): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.trim();
  if (
    !normalized ||
    Buffer.byteLength(normalized, "utf8") > maximumBytes ||
    hasForbiddenControlCharacter(normalized)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

/** Reject C0 controls except whitespace that can appear in a text query. */
function hasForbiddenControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint <= 0x1f && ![0x09, 0x0a, 0x0d].includes(codePoint)) {
      return true;
    }
  }
  return false;
}

function optionalBoundedText(
  value: unknown,
  label: string,
  maximumBytes: number,
): string | undefined {
  if (value === undefined) return undefined;
  return requireBoundedText(value, label, maximumBytes);
}

function optionalBoundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

function requireBoundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = optionalBoundedInteger(value, label, minimum, maximum);
  if (parsed === undefined) throw new Error(`${label} is invalid`);
  return parsed;
}

function requireBoundedBytes(value: unknown, maximum: number, label: string): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} cannot be serialized`);
  }
  if (Buffer.byteLength(serialized, "utf8") > maximum) {
    throw new Error(`${label} is limited to ${maximum} bytes`);
  }
}
