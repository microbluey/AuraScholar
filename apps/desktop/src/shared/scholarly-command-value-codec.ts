import type { NormalizedAuthor, NormalizedWork, S2Enrichment } from "@aurascholar/connectors";
import {
  MAX_SCHOLARLY_AUTHOR_COUNT,
  MAX_SCHOLARLY_AUTHOR_TEXT_BYTES,
  MAX_SCHOLARLY_COUNT,
  MAX_SCHOLARLY_CSL_JSON_BYTES,
  MAX_SCHOLARLY_CSL_JSON_DEPTH,
  MAX_SCHOLARLY_CSL_JSON_ENTRIES,
  MAX_SCHOLARLY_KEYWORDS,
  MAX_SCHOLARLY_OUTPUT_BYTES,
  MAX_SCHOLARLY_TITLE_BYTES,
  MAX_SCHOLARLY_URL_BYTES,
  MAX_SCHOLARLY_WORK_LONG_TEXT_BYTES,
  MAX_SCHOLARLY_WORK_SHORT_TEXT_BYTES,
  MAX_SCHOLARLY_YEAR,
  scholarlyUtf8ByteLength,
} from "./scholarly-command-limits";

const WORK_SOURCES: readonly NormalizedWork["source"][] = [
  "crossref",
  "openalex",
  "s2",
  "arxiv",
  "unpaywall",
  "datacite",
];

export function decodeEnrichment(value: unknown): S2Enrichment {
  const enrichment = requireExactObject(
    value,
    "Semantic Scholar enrichment",
    [],
    [
      "s2Id",
      "tldr",
      "citationCount",
      "influentialCitationCount",
      "referenceCount",
      "openAccessPdfUrl",
      "url",
    ],
  );
  const output: Record<string, unknown> = {};
  addOptionalCount(output, enrichment, "citationCount", "Semantic Scholar citation count");
  addOptionalCount(
    output,
    enrichment,
    "influentialCitationCount",
    "Semantic Scholar influential citation count",
  );
  addOptionalCount(output, enrichment, "referenceCount", "Semantic Scholar reference count");
  addOptionalText(
    output,
    enrichment,
    "s2Id",
    MAX_SCHOLARLY_WORK_SHORT_TEXT_BYTES,
    "Semantic Scholar id",
  );
  addOptionalText(
    output,
    enrichment,
    "tldr",
    MAX_SCHOLARLY_WORK_LONG_TEXT_BYTES,
    "Semantic Scholar tldr",
  );
  addOptionalUrl(output, enrichment, "openAccessPdfUrl", "Semantic Scholar OA URL");
  addOptionalUrl(output, enrichment, "url", "Semantic Scholar URL");
  return output as S2Enrichment;
}

export function decodeNormalizedWork(value: unknown, label: string): NormalizedWork {
  const work = requireExactObject(
    value,
    label,
    ["title", "authors", "source"],
    [
      "doi",
      "abstract",
      "year",
      "publicationDate",
      "venueName",
      "venueType",
      "type",
      "arxivId",
      "openalexId",
      "s2Id",
      "pmid",
      "volume",
      "issue",
      "pages",
      "publisher",
      "placePublished",
      "issn",
      "isbn",
      "language",
      "url",
      "keywords",
      "citedByCount",
      "oaPdfUrl",
      "cslJson",
    ],
  );
  if (!isWorkSource(work.source)) throw new Error(`${label} source is invalid`);
  const authors = requireDenseArray(
    work.authors,
    MAX_SCHOLARLY_AUTHOR_COUNT,
    `${label} authors`,
  ).map((author, index) => decodeAuthor(author, `${label} author at index ${index}`));
  const keywords = optionalStringArray(
    work,
    "keywords",
    `${label} keywords`,
    MAX_SCHOLARLY_KEYWORDS,
  );
  const cslJson = Object.hasOwn(work, "cslJson")
    ? decodeCslJson(work.cslJson, `${label} CSL JSON`)
    : undefined;
  const output: Record<string, unknown> = {
    authors,
    source: work.source,
    title: requireText(work.title, `${label} title`, MAX_SCHOLARLY_TITLE_BYTES, true),
  };
  for (const field of ["doi", "publicationDate", "venueName"] as const) {
    addOptionalText(output, work, field, MAX_SCHOLARLY_WORK_SHORT_TEXT_BYTES, `${label} ${field}`);
  }
  addOptionalText(
    output,
    work,
    "abstract",
    MAX_SCHOLARLY_WORK_LONG_TEXT_BYTES,
    `${label} abstract`,
  );
  addOptionalInteger(output, work, "year", `${label} year`, 0, MAX_SCHOLARLY_YEAR);
  if (Object.hasOwn(work, "venueType")) {
    if (
      work.venueType !== "journal" &&
      work.venueType !== "conference" &&
      work.venueType !== "repository" &&
      work.venueType !== "book"
    ) {
      throw new Error(`${label} venue type is invalid`);
    }
    output.venueType = work.venueType;
  }
  for (const field of [
    "type",
    "arxivId",
    "openalexId",
    "s2Id",
    "pmid",
    "volume",
    "issue",
    "pages",
    "publisher",
    "placePublished",
    "issn",
    "isbn",
    "language",
  ] as const) {
    addOptionalText(output, work, field, MAX_SCHOLARLY_WORK_SHORT_TEXT_BYTES, `${label} ${field}`);
  }
  addOptionalUrl(output, work, "url", `${label} URL`);
  addOptionalUrl(output, work, "oaPdfUrl", `${label} OA PDF URL`);
  addOptionalCount(output, work, "citedByCount", `${label} cited-by count`);
  if (keywords !== undefined) output.keywords = keywords;
  if (cslJson !== undefined) output.cslJson = cslJson;
  return output as unknown as NormalizedWork;
}

function decodeAuthor(value: unknown, label: string): NormalizedAuthor {
  const author = requireExactObject(
    value,
    label,
    ["displayName", "position"],
    ["family", "given", "orcid", "isCorresponding", "role"],
  );
  const output: Record<string, unknown> = {
    displayName: requireText(
      author.displayName,
      `${label} display name`,
      MAX_SCHOLARLY_AUTHOR_TEXT_BYTES,
      true,
    ),
    position: requireCount(author.position, `${label} position`),
  };
  for (const field of ["family", "given", "orcid"] as const) {
    addOptionalText(output, author, field, MAX_SCHOLARLY_AUTHOR_TEXT_BYTES, `${label} ${field}`);
  }
  if (Object.hasOwn(author, "isCorresponding")) {
    if (typeof author.isCorresponding !== "boolean") {
      throw new Error(`${label} correspondence flag is invalid`);
    }
    output.isCorresponding = author.isCorresponding;
  }
  if (Object.hasOwn(author, "role")) {
    if (author.role !== "author" && author.role !== "editor" && author.role !== "translator") {
      throw new Error(`${label} role is invalid`);
    }
    output.role = author.role;
  }
  return output as unknown as NormalizedAuthor;
}

function optionalStringArray(
  record: Record<string, unknown>,
  field: string,
  label: string,
  maximumItems: number,
): string[] | undefined {
  if (!Object.hasOwn(record, field)) return undefined;
  return requireDenseArray(record[field], maximumItems, label).map((value, index) =>
    requireText(
      value,
      `${label} item at index ${index}`,
      MAX_SCHOLARLY_WORK_SHORT_TEXT_BYTES,
      true,
    ),
  );
}

function addOptionalText(
  output: Record<string, unknown>,
  record: Record<string, unknown>,
  field: string,
  maximumBytes: number,
  label: string,
): void {
  if (!Object.hasOwn(record, field)) return;
  output[field] = requireText(record[field], label, maximumBytes, true);
}

function addOptionalUrl(
  output: Record<string, unknown>,
  record: Record<string, unknown>,
  field: string,
  label: string,
): void {
  if (!Object.hasOwn(record, field)) return;
  const value = requireText(record[field], label, MAX_SCHOLARLY_URL_BYTES, true);
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      scholarlyUtf8ByteLength(url.toString()) > MAX_SCHOLARLY_URL_BYTES
    ) {
      throw new Error("unsafe URL");
    }
  } catch {
    throw new Error(`${label} is invalid`);
  }
  output[field] = value;
}

function addOptionalInteger(
  output: Record<string, unknown>,
  record: Record<string, unknown>,
  field: string,
  label: string,
  minimum: number,
  maximum: number,
): void {
  if (!Object.hasOwn(record, field)) return;
  output[field] = requireInteger(record[field], label, minimum, maximum);
}

function addOptionalCount(
  output: Record<string, unknown>,
  record: Record<string, unknown>,
  field: string,
  label: string,
): void {
  if (!Object.hasOwn(record, field)) return;
  output[field] = requireCount(record[field], label);
}

export function requireExactObject(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const allowed = new Set([...required, ...optional]);
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function requireDenseArray(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum || !isDenseArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function requireText(
  value: unknown,
  label: string,
  maximumBytes: number,
  nonEmpty: boolean,
): string {
  if (
    typeof value !== "string" ||
    scholarlyUtf8ByteLength(value) > maximumBytes ||
    (nonEmpty && !value.trim()) ||
    hasForbiddenControlCharacter(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function requireCount(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > MAX_SCHOLARLY_COUNT
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

export function requireInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

export function decodeCslJson(value: unknown, label: string): Record<string, unknown> {
  const decoded = decodeJsonValue(value, label, 0, new WeakSet<object>());
  if (!isRecord(decoded)) throw new Error(`${label} must be an object`);
  let serialized: string;
  try {
    serialized = JSON.stringify(decoded);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (scholarlyUtf8ByteLength(serialized) > MAX_SCHOLARLY_CSL_JSON_BYTES) {
    throw new Error(`${label} is too large`);
  }
  return decoded;
}

function decodeJsonValue(
  value: unknown,
  label: string,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return requireText(value, label, MAX_SCHOLARLY_WORK_SHORT_TEXT_BYTES, false);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} is invalid`);
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) throw new Error(`${label} is invalid`);
  if (depth >= MAX_SCHOLARLY_CSL_JSON_DEPTH) throw new Error(`${label} is too deep`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return requireDenseArray(value, MAX_SCHOLARLY_CSL_JSON_ENTRIES, label).map((entry, index) =>
        decodeJsonValue(entry, `${label}[${index}]`, depth + 1, seen),
      );
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > MAX_SCHOLARLY_CSL_JSON_ENTRIES)
      throw new Error(`${label} has too many entries`);
    const output: Record<string, unknown> = {};
    for (const key of keys) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new Error(`${label} has an unsafe key`);
      }
      if (scholarlyUtf8ByteLength(key) > 256) throw new Error(`${label} key is too long`);
      output[key] = decodeJsonValue(record[key], `${label}.${key}`, depth + 1, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

export function assertOutputSize(value: unknown, label: string): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} cannot be serialized`);
  }
  if (typeof serialized !== "string") throw new Error(`${label} cannot be serialized`);
  if (scholarlyUtf8ByteLength(serialized) > MAX_SCHOLARLY_OUTPUT_BYTES) {
    throw new Error(`${label} is too large`);
  }
}

export function isWorkSource(value: unknown): value is NormalizedWork["source"] {
  return typeof value === "string" && WORK_SOURCES.includes(value as NormalizedWork["source"]);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDenseArray(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function hasForbiddenControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint <= 0x1f && ![0x09, 0x0a, 0x0d].includes(codePoint))
      return true;
  }
  return false;
}
