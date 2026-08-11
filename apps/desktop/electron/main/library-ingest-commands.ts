import { Buffer } from "node:buffer";
import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import { AttachmentsRepo, type AttachmentInput } from "@aurascholar/db/repos/attachments";
import {
  WorksRepo,
  type AuthorRole,
  type WorkAuthorInput,
  type WorkInput,
} from "@aurascholar/db/repos/works";
import type {
  DataCommandOutput,
  DataCommandRequest,
  LibraryFinalizeIngestCommandInput,
  LibraryFinalizeIngestCommandResult,
  LibraryFinalizeIngestPdfInput,
  LibraryStagePdfCommandResult,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";
import { claimVerifiedStagedPdfBeforeTransaction } from "./library-staged-pdf-claim";
const MAX_AUTHOR_COUNT = 1_000;
const MAX_AUTHOR_TEXT_LENGTH = 16 * 1024;
const MAX_CSL_JSON_BYTES = 2 * 1024 * 1024;
const MAX_KEYWORD_COUNT = 1_000;
const MAX_KEYWORD_LENGTH = 16 * 1024;
const MAX_PDF_FILENAME_LENGTH = 4_096;
const MAX_PDF_PAGE_COUNT = 100_000;
const MAX_PDF_SOURCE_URL_LENGTH = 16 * 1024;
const MAX_WORK_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_WORK_TEXT_LENGTH = 256 * 1024;
const MAX_WORK_YEAR = 10_000;
const MIN_WORK_YEAR = -10_000;
const STAGE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
type LibraryIngestCommandName = "library.finalizeIngest";

export type LibraryIngestCommandRequest = Extract<
  DataCommandRequest,
  { name: LibraryIngestCommandName }
>;
/**
 * Finalizes an already-reviewed ingest decision. The attach branch does not
 * restore a work: a dedup target is expected to be active, and validating it
 * is an idempotent no-op when no fresh staged PDF needs linking.
 */
export async function executeLibraryIngestCommand(
  request: LibraryIngestCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<LibraryIngestCommandName>> {
  const input = parseLibraryFinalizeIngestInput(request.input);
  const stagedPdf = input.pdf
    ? await claimVerifiedStagedPdfBeforeTransaction(input.pdf.stageId, dependencies)
    : null;
  try {
    const output = await dependencies.transaction(request.name, async (database) => {
      const libraryId = await requireActiveLocalLibraryId(database);
      if (input.mode === "create")
        return finalizeCreate(database, libraryId, input, stagedPdf?.receipt);
      return finalizeAttach(database, libraryId, input, stagedPdf?.receipt);
    });
    stagedPdf?.consume();
    return output;
  } catch (error) {
    stagedPdf?.release();
    throw error;
  }
}

function parseLibraryFinalizeIngestInput(value: unknown): LibraryFinalizeIngestCommandInput {
  if (!isRecord(value) || (value.mode !== "create" && value.mode !== "attach")) {
    throw new Error("Invalid library.finalizeIngest input");
  }
  if (value.mode === "create") {
    const input = requireExactInput(value, ["mode", "pdf", "workInput"]);
    return {
      mode: "create",
      pdf: parseStagedPdf(input.pdf),
      workInput: parseLibraryWorkInput(input.workInput),
    };
  }
  const input = requireExactInput(value, ["mode", "pdf", "workId"]);
  return {
    mode: "attach",
    pdf: parseStagedPdf(input.pdf),
    workId: requireRecordId(input.workId, "Work id"),
  };
}

function requireExactInput(
  value: Record<string, unknown>,
  fields: readonly string[],
  optionalFields: readonly string[] = [],
): Record<string, unknown> {
  const allowedFields = [...fields, ...optionalFields];
  if (
    Object.keys(value).some((field) => !allowedFields.includes(field)) ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error("Invalid library.finalizeIngest input");
  }
  return value;
}

function parseStagedPdf(value: unknown): LibraryFinalizeIngestPdfInput | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("Staged PDF is invalid");
  const input = requireExactInput(
    value,
    ["fetchedVia", "fileName", "pageCount", "stageId"],
    ["sourceUrl"],
  );
  if (
    !Number.isSafeInteger(input.pageCount) ||
    (input.pageCount as number) <= 0 ||
    (input.pageCount as number) > MAX_PDF_PAGE_COUNT
  ) {
    throw new Error("Staged PDF page count is invalid");
  }
  if (typeof input.fileName !== "string" || input.fileName.trim() === "") {
    throw new Error("Staged PDF filename is required");
  }
  if (input.fileName.length > MAX_PDF_FILENAME_LENGTH) {
    throw new Error("Staged PDF filename is too long");
  }
  if (
    input.fetchedVia !== "manual" &&
    input.fetchedVia !== "research-download" &&
    input.fetchedVia !== "arxiv" &&
    input.fetchedVia !== "openalex" &&
    input.fetchedVia !== "unpaywall"
  ) {
    throw new Error("Staged PDF source is invalid");
  }
  if (typeof input.stageId !== "string" || !STAGE_ID_PATTERN.test(input.stageId)) {
    throw new Error("Staged PDF receipt is invalid");
  }
  const sourceUrl = optionalOaPdfSourceUrl(input, input.fetchedVia);
  return {
    fetchedVia: input.fetchedVia,
    fileName: input.fileName,
    pageCount: input.pageCount as number,
    stageId: input.stageId,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
  };
}

function optionalOaPdfSourceUrl(
  input: Record<string, unknown>,
  fetchedVia: LibraryFinalizeIngestPdfInput["fetchedVia"],
): string | undefined {
  const requiresSourceUrl =
    fetchedVia === "arxiv" || fetchedVia === "openalex" || fetchedVia === "unpaywall";
  if (!Object.hasOwn(input, "sourceUrl")) {
    if (requiresSourceUrl) throw new Error("Staged OA PDF source URL is required");
    return undefined;
  }
  if (!requiresSourceUrl) throw new Error("Staged PDF source URL is invalid");
  if (typeof input.sourceUrl !== "string" || input.sourceUrl.length > MAX_PDF_SOURCE_URL_LENGTH) {
    throw new Error("Staged OA PDF source URL is invalid");
  }
  let url: URL;
  try {
    url = new URL(input.sourceUrl);
  } catch {
    throw new Error("Staged OA PDF source URL is invalid");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("Staged OA PDF source URL is invalid");
  }
  return url.toString();
}

const NULLABLE_WORK_TEXT_FIELDS = [
  "abstract",
  "accessedDate",
  "accessionNumber",
  "arxivId",
  "callNumber",
  "databaseName",
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
  "url",
  "venueName",
  "venueType",
  "volume",
] as const;

const WORK_INPUT_FIELDS = new Set<string>([
  "authors",
  "cslJson",
  "doi",
  "keywords",
  "title",
  "type",
  "year",
  ...NULLABLE_WORK_TEXT_FIELDS,
]);

/**
 * Validates a connector-derived work before a main-owned background workflow
 * can upsert it. This intentionally shares the exact limits used by the
 * renderer-facing `library.finalizeIngest` command instead of trusting a
 * remote scholarly response because it arrived inside Electron main.
 */
export function parseLibraryWorkInput(value: unknown): WorkInput {
  if (
    !isRecord(value) ||
    !Object.hasOwn(value, "title") ||
    Object.keys(value).some((field) => !WORK_INPUT_FIELDS.has(field))
  ) {
    throw new Error("Work input is invalid");
  }
  const title = requireWorkText(value.title, "Work title");
  if (title.trim() === "") throw new Error("Work title is required");
  const input: WorkInput = { title };

  const type = optionalWorkText(value, "type", "Work type");
  if (type !== undefined) input.type = type;
  const doi = optionalWorkText(value, "doi", "Work DOI");
  if (doi !== undefined) input.doi = doi;
  const year = optionalWorkYear(value);
  if (year !== undefined) input.year = year;
  const keywords = optionalWorkKeywords(value);
  if (keywords !== undefined) input.keywords = keywords;
  const authors = optionalWorkAuthors(value);
  if (authors !== undefined) input.authors = authors;
  const cslJson = optionalCslJson(value);
  if (cslJson !== undefined) input.cslJson = cslJson;

  for (const field of NULLABLE_WORK_TEXT_FIELDS) {
    const parsed = optionalNullableWorkText(value, field, `Work ${field}`);
    if (parsed !== undefined) Object.assign(input, { [field]: parsed });
  }
  assertWorkInputSize(input);
  return input;
}

function optionalWorkText(
  input: Record<string, unknown>,
  field: "doi" | "type",
  label: string,
): string | undefined {
  if (!Object.hasOwn(input, field) || input[field] === undefined) return undefined;
  return requireWorkText(input[field], label);
}

function optionalNullableWorkText(
  input: Record<string, unknown>,
  field: (typeof NULLABLE_WORK_TEXT_FIELDS)[number],
  label: string,
): string | null | undefined {
  if (!Object.hasOwn(input, field) || input[field] === undefined) return undefined;
  if (input[field] === null) return null;
  return requireWorkText(input[field], label);
}

function requireWorkText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  if (value.length > MAX_WORK_TEXT_LENGTH) throw new Error(`${label} is too long`);
  return value;
}

function optionalWorkYear(input: Record<string, unknown>): number | null | undefined {
  if (!Object.hasOwn(input, "year") || input.year === undefined) return undefined;
  if (input.year === null) return null;
  if (
    typeof input.year !== "number" ||
    !Number.isSafeInteger(input.year) ||
    input.year < MIN_WORK_YEAR ||
    input.year > MAX_WORK_YEAR
  ) {
    throw new Error("Work year is invalid");
  }
  return input.year;
}

function assertWorkInputSize(input: WorkInput): void {
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > MAX_WORK_INPUT_BYTES) {
    throw new Error(`Work input is limited to ${MAX_WORK_INPUT_BYTES} bytes`);
  }
}

function optionalWorkKeywords(input: Record<string, unknown>): string[] | null | undefined {
  if (!Object.hasOwn(input, "keywords") || input.keywords === undefined) return undefined;
  if (input.keywords === null) return null;
  if (!Array.isArray(input.keywords) || input.keywords.length > MAX_KEYWORD_COUNT) {
    throw new Error("Work keywords are invalid");
  }
  return input.keywords.map((keyword, index) => {
    if (typeof keyword !== "string" || keyword.length > MAX_KEYWORD_LENGTH) {
      throw new Error(`Work keyword at index ${index} is invalid`);
    }
    return keyword;
  });
}

function optionalWorkAuthors(input: Record<string, unknown>): WorkAuthorInput[] | undefined {
  if (!Object.hasOwn(input, "authors") || input.authors === undefined) return undefined;
  if (!Array.isArray(input.authors) || input.authors.length > MAX_AUTHOR_COUNT) {
    throw new Error("Work authors are invalid");
  }
  const authors = input.authors.map((author, index) => parseWorkAuthor(author, index));
  if (new Set(authors.map((author) => author.position)).size !== authors.length) {
    throw new Error("Work author positions must be unique");
  }
  return authors;
}

function parseWorkAuthor(value: unknown, index: number): WorkAuthorInput {
  const label = `Work author at index ${index}`;
  if (
    !isRecord(value) ||
    !Object.hasOwn(value, "displayName") ||
    !Object.hasOwn(value, "position") ||
    Object.keys(value).some(
      (field) => !["displayName", "orcid", "position", "role"].includes(field),
    )
  ) {
    throw new Error(`${label} is invalid`);
  }
  if (
    typeof value.position !== "number" ||
    !Number.isSafeInteger(value.position) ||
    value.position < 0
  ) {
    throw new Error(`${label} position is invalid`);
  }
  const displayName = requireWorkAuthorText(value.displayName, `${label} display name`);
  if (displayName.trim() === "") throw new Error(`${label} display name is required`);
  const author: WorkAuthorInput = { displayName, position: value.position };
  if (Object.hasOwn(value, "orcid") && value.orcid !== undefined) {
    author.orcid = requireWorkAuthorText(value.orcid, `${label} ORCID`);
  }
  if (Object.hasOwn(value, "role") && value.role !== undefined) {
    author.role = requireWorkAuthorRole(value.role, label);
  }
  return author;
}

function requireWorkAuthorText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > MAX_AUTHOR_TEXT_LENGTH) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireWorkAuthorRole(value: unknown, label: string): AuthorRole {
  if (value === "author" || value === "editor" || value === "translator") return value;
  throw new Error(`${label} role is invalid`);
}

function optionalCslJson(input: Record<string, unknown>): unknown | undefined {
  if (!Object.hasOwn(input, "cslJson") || input.cslJson === undefined) return undefined;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input.cslJson);
  } catch {
    throw new Error("Work CSL JSON is invalid");
  }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > MAX_CSL_JSON_BYTES) {
    throw new Error("Work CSL JSON is invalid");
  }
  return JSON.parse(serialized) as unknown;
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

async function finalizeCreate(
  database: Database,
  libraryId: string,
  input: Extract<LibraryFinalizeIngestCommandInput, { mode: "create" }>,
  receipt: LibraryStagePdfCommandResult | undefined,
): Promise<LibraryFinalizeIngestCommandResult> {
  const work = await new WorksRepo(database, libraryId).upsert(input.workInput);
  // `upsert` can resolve a DOI/fingerprint duplicate and backfill it. Return
  // the persisted work title rather than echoing the incoming duplicate title,
  // so callers do not claim that a different work was added.
  const persistedWork = await findActiveLocalWork(database, libraryId, work.id);
  if (!persistedWork) {
    throw new Error("Finalized work is missing from the active Library");
  }
  const attachment = input.pdf
    ? await createStagedPdfAttachment(
        database,
        libraryId,
        persistedWork.id,
        input.pdf,
        requireReceipt(receipt),
      )
    : null;
  return {
    attachment,
    deduped: work.deduped,
    pdfFetched: input.pdf !== null,
    title: persistedWork.title,
    workId: persistedWork.id,
  };
}

async function finalizeAttach(
  database: Database,
  libraryId: string,
  input: Extract<LibraryFinalizeIngestCommandInput, { mode: "attach" }>,
  receipt: LibraryStagePdfCommandResult | undefined,
): Promise<LibraryFinalizeIngestCommandResult> {
  const work = await findActiveLocalWork(database, libraryId, input.workId);
  if (!work) {
    throw new Error(`Work ${input.workId} is missing, removed, or outside the active Library`);
  }
  const attachment = input.pdf
    ? await createStagedPdfAttachment(
        database,
        libraryId,
        work.id,
        input.pdf,
        requireReceipt(receipt),
      )
    : null;
  return {
    attachment,
    deduped: true,
    pdfFetched: input.pdf !== null,
    title: work.title,
    workId: work.id,
  };
}

async function findActiveLocalWork(
  database: Database,
  libraryId: string,
  workId: string,
): Promise<{ id: string; title: string } | null> {
  const rows = await database.query<{ id: string; title: string }>(
    `SELECT id, title
     FROM works
     WHERE id = ? AND library_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [workId, libraryId],
  );
  return rows[0] ?? null;
}

function createStagedPdfAttachment(
  database: Database,
  libraryId: string,
  workId: string,
  pdf: LibraryFinalizeIngestPdfInput,
  receipt: LibraryStagePdfCommandResult,
): Promise<{ deduped: boolean; id: string }> {
  const input: AttachmentInput = {
    byteSize: receipt.byteSize,
    fetchedVia: pdf.fetchedVia,
    originalFilename: pdf.fileName,
    pageCount: pdf.pageCount,
    sha256: receipt.sha,
    ...(pdf.sourceUrl === undefined ? {} : { sourceUrl: pdf.sourceUrl }),
    workId,
  };
  return new AttachmentsRepo(database, libraryId).create(input);
}

function requireReceipt(
  receipt: LibraryStagePdfCommandResult | undefined,
): LibraryStagePdfCommandResult {
  if (!receipt) throw new Error("Staged PDF receipt is unavailable");
  return receipt;
}
