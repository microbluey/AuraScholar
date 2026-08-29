import { Buffer } from "node:buffer";
import type {
  LibraryGetPageCommandInput,
  LibraryGetWorkRuntimeMetaCommandInput,
  LibraryPageExtraFilter,
  LibraryPageFilter,
  LibraryPageSort,
} from "../data-command-contract";
import { isRecord, requireRecordId } from "./data-command-runtime";

const MAX_ANNOTATION_COUNT = 1_000_000_000;
// Tags accept up to 256 UTF-16 code units elsewhere in the Library. Four
// bytes per code point preserves every valid tag while still bounding IPC.
export const MAX_LIBRARY_PAGE_FACET_VALUE_BYTES = 1_024;
const MAX_PAGE_LIMIT = 200;
const MAX_PAGE_OFFSET = 1_000_000_000;
const MAX_SEARCH_LENGTH = 512;

export function parseLibraryGetPageInput(
  value: unknown,
): Required<Pick<LibraryGetPageCommandInput, "limit" | "offset" | "showTrash" | "sort">> &
  Omit<LibraryGetPageCommandInput, "limit" | "offset" | "showTrash" | "sort"> {
  if (!isRecord(value)) throw new Error("Invalid library.getPage input");
  const filter = requireOptionalPageFilter(value.filter);
  const showTrash = requireOptionalBoolean(value.showTrash, "Show trash") ?? false;
  return {
    collectionId: requireOptionalRecordId(value.collectionId, "Collection id"),
    extraFilter: requireOptionalExtraFilter(value.extraFilter),
    filter,
    focusWorkId: requireOptionalRecordId(value.focusWorkId, "Focused work id"),
    limit: requirePageInteger(value.limit, "Page size", 1, MAX_PAGE_LIMIT),
    offset: requirePageInteger(value.offset, "Page offset", 0, MAX_PAGE_OFFSET, 0),
    search: requireOptionalText(value.search, "Search", MAX_SEARCH_LENGTH),
    showTrash,
    sort: requireOptionalPageSort(value.sort) ?? "added",
    source: requireOptionalNullableFacetText(value.source, "Source"),
    status: requireOptionalReadingStatus(value.status),
    tag: requireOptionalNullableFacetText(value.tag, "Tag"),
  };
}

export function parseLibraryGetWorkRuntimeMetaInput(
  value: unknown,
): LibraryGetWorkRuntimeMetaCommandInput {
  if (!isRecord(value)) throw new Error("Invalid library.getWorkRuntimeMeta input");
  return {
    annotationCount: requirePageInteger(
      value.annotationCount,
      "Annotation count",
      0,
      MAX_ANNOTATION_COUNT,
    ),
    workId: requireRecordId(value.workId, "Work id"),
  };
}

function requireOptionalRecordId(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requireRecordId(value, label);
}

function requireOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} is invalid`);
  return value;
}

function requirePageInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  fallback?: number,
): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

function requireOptionalText(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.trim();
  if (normalized.length > maximum) throw new Error(`${label} is too long`);
  return normalized || undefined;
}

function requireOptionalNullableText(
  value: unknown,
  label: string,
  maximum: number,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  return requireOptionalText(value, label, maximum) ?? null;
}

function requireOptionalNullableFacetText(
  value: unknown,
  label: string,
): string | null | undefined {
  const text = requireOptionalNullableText(value, label, MAX_LIBRARY_PAGE_FACET_VALUE_BYTES);
  if (
    text !== null &&
    text !== undefined &&
    Buffer.byteLength(text, "utf8") > MAX_LIBRARY_PAGE_FACET_VALUE_BYTES
  ) {
    throw new Error(`${label} is too long`);
  }
  return text;
}

function requireOptionalPageFilter(value: unknown): LibraryPageFilter | undefined {
  if (value === undefined) return undefined;
  if (
    value === "all" ||
    value === "reading" ||
    value === "unread" ||
    value === "noted" ||
    value === "starred" ||
    value === "trash"
  ) {
    return value;
  }
  throw new Error("Library filter is invalid");
}

function requireOptionalExtraFilter(value: unknown): LibraryPageExtraFilter | null | undefined {
  if (value === undefined || value === null) return value;
  if (value === "with-pdf" || value === "without-pdf") return value;
  throw new Error("Library PDF filter is invalid");
}

function requireOptionalPageSort(value: unknown): LibraryPageSort | undefined {
  if (value === undefined) return undefined;
  if (value === "added" || value === "year") return value;
  throw new Error("Library sort is invalid");
}

function requireOptionalReadingStatus(value: unknown): "unread" | "reading" | "read" | undefined {
  if (value === undefined) return undefined;
  if (value === "unread" || value === "reading" || value === "read") return value;
  throw new Error("Reading status is invalid");
}
