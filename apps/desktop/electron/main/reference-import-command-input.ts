import { Buffer } from "node:buffer";
import type { CslItem, ImportFormat } from "@aurascholar/cite";
import type { WorkInput } from "@aurascholar/db/repos/works";
import type { LibraryImportReferencesCommandInput } from "../reference-import-command-contract";
import { isRecord } from "./data-command-runtime";
import { MAX_REFERENCE_IMPORT_INPUT_BYTES } from "./reference-import-limits";

export { MAX_REFERENCE_IMPORT_INPUT_BYTES };
export const MAX_REFERENCE_IMPORT_ITEMS = 10_000;

const MAX_REFERENCE_IMPORT_AUTHOR_TEXT_BYTES = 16 * 1024;
const MAX_REFERENCE_IMPORT_AUTHORS_PER_ITEM = 1_000;
const MAX_REFERENCE_IMPORT_CSL_ITEM_BYTES = 2 * 1024 * 1024;
const MAX_REFERENCE_IMPORT_CSL_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_REFERENCE_IMPORT_TEXT_FIELD_BYTES = 256 * 1024;

const IMPORT_FORMATS = new Set<ImportFormat>(["bibtex", "ris", "nbib", "enw", "csljson"]);
const WORK_TEXT_FIELDS = [
  "abstract",
  "accessedDate",
  "accessionNumber",
  "arxivId",
  "callNumber",
  "databaseName",
  "doi",
  "edition",
  "isbn",
  "issn",
  "issue",
  "label",
  "language",
  "numberOfVolumes",
  "openalexId",
  "originalTitle",
  "pages",
  "placePublished",
  "pmid",
  "publicationDate",
  "publisher",
  "s2Id",
  "section",
  "seriesTitle",
  "shortTitle",
  "title",
  "type",
  "url",
  "venueName",
  "venueType",
  "volume",
] as const satisfies readonly (keyof WorkInput)[];

export function parseReferenceImportCommandInput(
  value: unknown,
): LibraryImportReferencesCommandInput {
  const input = requireExactReferenceImportInput(value);
  const text = requireReferenceImportText(input.text);
  const format = optionalReferenceImportFormat(input.format);
  return format === undefined ? { text } : { format, text };
}

/**
 * Parser output is still untrusted file content. Bound it before acquiring the
 * Library transaction so malformed exports cannot hold the writer lease.
 */
export function validateReferenceImportPayload(
  items: readonly CslItem[],
  workInputs: readonly WorkInput[],
): void {
  if (items.length !== workInputs.length) {
    throw new Error("Reference import parser output is inconsistent");
  }
  if (items.length > MAX_REFERENCE_IMPORT_ITEMS) {
    throw new Error(`Reference imports are limited to ${MAX_REFERENCE_IMPORT_ITEMS} items`);
  }

  let totalCslBytes = 0;
  for (const [index, work] of workInputs.entries()) {
    const item = items[index];
    if (!item) throw new Error("Reference import parser output is inconsistent");
    totalCslBytes += assertReferenceImportCslItem(item, index);
    if (totalCslBytes > MAX_REFERENCE_IMPORT_CSL_TOTAL_BYTES) {
      throw new Error("Reference import CSL payload is too large");
    }
    assertReferenceImportWorkInput(work, index);
  }
}

function requireExactReferenceImportInput(value: unknown): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => field !== "text" && field !== "format") ||
    !Object.hasOwn(value, "text")
  ) {
    throw new Error("Invalid library.importReferences input");
  }
  return value;
}

function requireReferenceImportText(value: unknown): string {
  if (typeof value !== "string") throw new Error("Reference import text is required");
  if (Buffer.byteLength(value, "utf8") > MAX_REFERENCE_IMPORT_INPUT_BYTES) {
    throw new Error(
      `Reference import text is limited to ${MAX_REFERENCE_IMPORT_INPUT_BYTES} bytes`,
    );
  }
  return value;
}

function optionalReferenceImportFormat(value: unknown): ImportFormat | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !IMPORT_FORMATS.has(value as ImportFormat)) {
    throw new Error("Reference import format is invalid");
  }
  return value as ImportFormat;
}

function assertReferenceImportCslItem(item: CslItem, index: number): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(item);
  } catch {
    throw new Error(`Reference CSL item at index ${index} is invalid`);
  }
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAX_REFERENCE_IMPORT_CSL_ITEM_BYTES) {
    throw new Error(`Reference CSL item at index ${index} is too large`);
  }
  return bytes;
}

function assertReferenceImportWorkInput(work: WorkInput, index: number): void {
  for (const field of WORK_TEXT_FIELDS) {
    assertOptionalReferenceImportText(
      work[field],
      `Reference ${field} at index ${index}`,
      MAX_REFERENCE_IMPORT_TEXT_FIELD_BYTES,
    );
  }
  if (
    work.year !== undefined &&
    work.year !== null &&
    (!Number.isSafeInteger(work.year) || work.year < -10_000 || work.year > 10_000)
  ) {
    throw new Error(`Reference year at index ${index} is invalid`);
  }
  if (!Array.isArray(work.authors) || work.authors.length > MAX_REFERENCE_IMPORT_AUTHORS_PER_ITEM) {
    throw new Error(`Reference authors at index ${index} are invalid`);
  }
  for (const [authorIndex, author] of work.authors.entries()) {
    assertReferenceImportAuthor(author, index, authorIndex);
  }
}

function assertOptionalReferenceImportText(
  value: unknown,
  label: string,
  maximumBytes: number,
): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new Error(`${label} is invalid`);
  }
}

function assertReferenceImportAuthor(
  author: NonNullable<WorkInput["authors"]>[number],
  itemIndex: number,
  authorIndex: number,
): void {
  if (
    typeof author.displayName !== "string" ||
    Buffer.byteLength(author.displayName, "utf8") > MAX_REFERENCE_IMPORT_AUTHOR_TEXT_BYTES ||
    !Number.isSafeInteger(author.position) ||
    author.position < 0 ||
    (author.role !== undefined && author.role !== "author" && author.role !== "editor")
  ) {
    throw new Error(`Reference author at index ${itemIndex}:${authorIndex} is invalid`);
  }
}
