import {
  AnnotationsRepo,
  AttachmentsRepo,
  type AttachmentRow,
  type Database,
  WorksRepo,
} from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import type {
  DataCommandOutput,
  DataCommandRequest,
  ReaderCreateAnnotationCommandInput,
  ReaderCreateAnnotationCommandResult,
  ReaderDeleteAnnotationCommandInput,
  ReaderDeleteAnnotationCommandResult,
  ReaderGetAttachmentCommandInput,
  ReaderGetAttachmentCommandResult,
  ReaderGetWorkPdfCandidatesCommandInput,
  ReaderGetWorkPdfCandidatesCommandResult,
  ReaderListAnnotationsCommandInput,
  ReaderListAnnotationsCommandResult,
  ReaderMarkWorkReadingStartedCommandInput,
  ReaderMarkWorkReadingStartedCommandResult,
  ReaderReadAttachmentPdfCommandInput,
  ReaderReadAttachmentPdfCommandResult,
  ReaderRestoreAnnotationCommandInput,
  ReaderRestoreAnnotationCommandResult,
  ReaderUpdateAnnotationContentCommandInput,
  ReaderUpdateAnnotationContentCommandResult,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";

type ReaderReadCommandName =
  | "reader.getAttachment"
  | "reader.getWorkPdfCandidates"
  | "reader.listAnnotations"
  | "reader.readAttachmentPdf";

type ReaderWriteCommandName =
  | "reader.createAnnotation"
  | "reader.deleteAnnotation"
  | "reader.markWorkReadingStarted"
  | "reader.restoreAnnotation"
  | "reader.updateAnnotationContent";

type ReaderCommandName = ReaderReadCommandName | ReaderWriteCommandName;

export type ReaderCommandRequest = Extract<DataCommandRequest, { name: ReaderCommandName }>;

/**
 * Reader session metadata is deliberately split from the document-byte path.
 * Every request derives the local Library inside a coordinator lease, so a
 * renderer cannot use a record id to cross a Library boundary.
 */
export async function executeReaderCommand(
  request: ReaderCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<ReaderCommandName>> {
  switch (request.name) {
    case "reader.createAnnotation": {
      const input = parseReaderCreateAnnotationInput(request.input);
      return executeReaderMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return createAnnotation(database, libraryId, input);
      });
    }
    case "reader.deleteAnnotation": {
      const input = parseReaderDeleteAnnotationInput(request.input);
      return executeReaderMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return deleteAnnotation(database, libraryId, input);
      });
    }
    case "reader.getWorkPdfCandidates": {
      const input = parseReaderGetWorkPdfCandidatesInput(request.input);
      return executeReaderQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return loadWorkPdfCandidates(database, libraryId, input);
      });
    }
    case "reader.getAttachment": {
      const input = parseReaderGetAttachmentInput(request.input);
      return executeReaderQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return loadAttachment(database, libraryId, input);
      });
    }
    case "reader.listAnnotations": {
      const input = parseReaderListAnnotationsInput(request.input);
      return executeReaderQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return loadAnnotations(database, libraryId, input);
      });
    }
    case "reader.readAttachmentPdf": {
      const input = parseReaderReadAttachmentPdfInput(request.input);
      return readAttachmentPdf(dependencies, input);
    }
    case "reader.markWorkReadingStarted": {
      const input = parseReaderMarkWorkReadingStartedInput(request.input);
      return executeReaderMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return markWorkReadingStarted(database, libraryId, input);
      });
    }
    case "reader.restoreAnnotation": {
      const input = parseReaderRestoreAnnotationInput(request.input);
      return executeReaderMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return restoreAnnotation(database, libraryId, input);
      });
    }
    case "reader.updateAnnotationContent": {
      const input = parseReaderUpdateAnnotationContentInput(request.input);
      return executeReaderMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return updateAnnotationContent(database, libraryId, input);
      });
    }
  }
}

function executeReaderQuery<K extends ReaderReadCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

function executeReaderMutation<K extends ReaderWriteCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  return dependencies.transaction(commandName, operation);
}

function parseReaderCreateAnnotationInput(value: unknown): ReaderCreateAnnotationCommandInput {
  const input = requireExactReaderInput(
    value,
    "reader.createAnnotation",
    ["workId", "attachmentId", "type", "pageIndex"],
    ["anchor", "color", "contentMd", "inkPaths"],
  );
  const color = optionalReaderString(input, "color", "Annotation color");
  const contentMd = optionalReaderString(input, "contentMd", "Annotation content");
  return {
    attachmentId: requireRecordId(input.attachmentId, "Attachment id"),
    ...(Object.hasOwn(input, "anchor") ? { anchor: input.anchor } : {}),
    ...(color === undefined ? {} : { color }),
    ...(contentMd === undefined ? {} : { contentMd }),
    ...(Object.hasOwn(input, "inkPaths") ? { inkPaths: input.inkPaths } : {}),
    pageIndex: requireAnnotationPageIndex(input.pageIndex),
    type: requireReaderAnnotationType(input.type),
    workId: requireRecordId(input.workId, "Work id"),
  };
}

function parseReaderDeleteAnnotationInput(value: unknown): ReaderDeleteAnnotationCommandInput {
  const input = requireExactReaderInput(value, "reader.deleteAnnotation", ["annotationId"]);
  return { annotationId: requireRecordId(input.annotationId, "Annotation id") };
}

function parseReaderGetWorkPdfCandidatesInput(
  value: unknown,
): ReaderGetWorkPdfCandidatesCommandInput {
  const input = requireExactReaderInput(value, "reader.getWorkPdfCandidates", ["workId"]);
  return { workId: requireRecordId(input.workId, "Work id") };
}

function parseReaderGetAttachmentInput(value: unknown): ReaderGetAttachmentCommandInput {
  const input = requireExactReaderInput(value, "reader.getAttachment", ["workId", "attachmentId"]);
  return {
    attachmentId: requireRecordId(input.attachmentId, "Attachment id"),
    workId: requireRecordId(input.workId, "Work id"),
  };
}

function parseReaderListAnnotationsInput(value: unknown): ReaderListAnnotationsCommandInput {
  const input = requireExactReaderInput(value, "reader.listAnnotations", [
    "workId",
    "attachmentId",
  ]);
  return {
    attachmentId: requireRecordId(input.attachmentId, "Attachment id"),
    workId: requireRecordId(input.workId, "Work id"),
  };
}

function parseReaderReadAttachmentPdfInput(value: unknown): ReaderReadAttachmentPdfCommandInput {
  const input = requireExactReaderInput(value, "reader.readAttachmentPdf", [
    "workId",
    "attachmentId",
  ]);
  return {
    attachmentId: requireRecordId(input.attachmentId, "Attachment id"),
    workId: requireRecordId(input.workId, "Work id"),
  };
}

function parseReaderMarkWorkReadingStartedInput(
  value: unknown,
): ReaderMarkWorkReadingStartedCommandInput {
  const input = requireExactReaderInput(value, "reader.markWorkReadingStarted", ["workId"]);
  return { workId: requireRecordId(input.workId, "Work id") };
}

function parseReaderRestoreAnnotationInput(value: unknown): ReaderRestoreAnnotationCommandInput {
  const input = requireExactReaderInput(value, "reader.restoreAnnotation", ["annotationId"]);
  return { annotationId: requireRecordId(input.annotationId, "Annotation id") };
}

function parseReaderUpdateAnnotationContentInput(
  value: unknown,
): ReaderUpdateAnnotationContentCommandInput {
  const input = requireExactReaderInput(value, "reader.updateAnnotationContent", [
    "annotationId",
    "contentMd",
  ]);
  if (typeof input.contentMd !== "string") {
    throw new Error("Annotation content is required");
  }
  return {
    annotationId: requireRecordId(input.annotationId, "Annotation id"),
    contentMd: input.contentMd,
  };
}

function requireExactReaderInput(
  value: unknown,
  commandName: ReaderCommandName,
  requiredFields: readonly string[],
  optionalFields: readonly string[] = [],
): Record<string, unknown> {
  const allowedFields = [...requiredFields, ...optionalFields];
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !allowedFields.includes(field)) ||
    requiredFields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`Invalid ${commandName} input`);
  }
  return value;
}

function optionalReaderString(
  input: Record<string, unknown>,
  field: string,
  label: string,
): string | undefined {
  if (!Object.hasOwn(input, field)) return undefined;
  if (typeof input[field] !== "string") throw new Error(`${label} is invalid`);
  return input[field];
}

function requireAnnotationPageIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Annotation page index is invalid");
  }
  return value as number;
}

function requireReaderAnnotationType(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Annotation type is required");
  }
  return value;
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

async function loadWorkPdfCandidates(
  database: Database,
  libraryId: string,
  input: ReaderGetWorkPdfCandidatesCommandInput,
): Promise<ReaderGetWorkPdfCandidatesCommandResult> {
  const work = await new WorksRepo(database, libraryId).get(input.workId);
  if (!work || work.deleted_at !== null) {
    return { pdfAttachments: [], work };
  }
  const attachments = await new AttachmentsRepo(database, libraryId).forWork(input.workId);
  return {
    pdfAttachments: attachments.filter((attachment) => attachment.kind === "pdf"),
    work,
  };
}

async function createAnnotation(
  database: Database,
  libraryId: string,
  input: ReaderCreateAnnotationCommandInput,
): Promise<ReaderCreateAnnotationCommandResult> {
  return {
    annotationId: await new AnnotationsRepo(database, libraryId).create(input),
  };
}

async function deleteAnnotation(
  database: Database,
  libraryId: string,
  input: ReaderDeleteAnnotationCommandInput,
): Promise<ReaderDeleteAnnotationCommandResult> {
  await new AnnotationsRepo(database, libraryId).softDelete(input.annotationId);
  return { updated: 1 };
}

async function loadAttachment(
  database: Database,
  libraryId: string,
  input: ReaderGetAttachmentCommandInput,
): Promise<ReaderGetAttachmentCommandResult> {
  return {
    attachment: await findActiveAttachmentForWork(database, libraryId, input),
  };
}

async function loadAnnotations(
  database: Database,
  libraryId: string,
  input: ReaderListAnnotationsCommandInput,
): Promise<ReaderListAnnotationsCommandResult> {
  const attachment = await findActiveAttachmentForWork(database, libraryId, input);
  if (!attachment) return { annotations: [] };
  return {
    annotations: await new AnnotationsRepo(database, libraryId).listForAttachment(
      input.attachmentId,
    ),
  };
}

/**
 * Resolves the attachment under the active local Library before reading bytes.
 * The database lease is deliberately released before the potentially large
 * canonical blob read so a slow disk cannot block unrelated SQLite commands.
 */
async function readAttachmentPdf(
  dependencies: DataCommandDependencies,
  input: ReaderReadAttachmentPdfCommandInput,
): Promise<ReaderReadAttachmentPdfCommandResult> {
  if (!dependencies.inspect) {
    throw new Error("Main-process Reader PDF lookup is unavailable");
  }
  if (!dependencies.readPdfBlob) {
    throw new Error("Main-process Reader PDF read is unavailable");
  }

  const attachment = await dependencies.inspect(async (database) => {
    const libraryId = await requireActiveLocalLibraryId(database);
    const candidate = await findActiveAttachmentForWork(database, libraryId, input);
    return candidate?.kind === "pdf" ? candidate : null;
  });
  if (!attachment) {
    throw new Error(
      `PDF attachment ${input.attachmentId} is missing, removed, or not active for work ${input.workId}`,
    );
  }

  return { data: await dependencies.readPdfBlob(attachment.sha256) };
}

async function markWorkReadingStarted(
  database: Database,
  libraryId: string,
  input: ReaderMarkWorkReadingStartedCommandInput,
): Promise<ReaderMarkWorkReadingStartedCommandResult> {
  return {
    started: await new WorksRepo(database, libraryId).markReadingStarted(input.workId),
  };
}

async function restoreAnnotation(
  database: Database,
  libraryId: string,
  input: ReaderRestoreAnnotationCommandInput,
): Promise<ReaderRestoreAnnotationCommandResult> {
  await new AnnotationsRepo(database, libraryId).restore(input.annotationId);
  return { updated: 1 };
}

async function updateAnnotationContent(
  database: Database,
  libraryId: string,
  input: ReaderUpdateAnnotationContentCommandInput,
): Promise<ReaderUpdateAnnotationContentCommandResult> {
  await new AnnotationsRepo(database, libraryId).updateContent(input.annotationId, input.contentMd);
  return { updated: 1 };
}

async function findActiveAttachmentForWork(
  database: Database,
  libraryId: string,
  input:
    | ReaderGetAttachmentCommandInput
    | ReaderListAnnotationsCommandInput
    | ReaderReadAttachmentPdfCommandInput,
): Promise<AttachmentRow | null> {
  const attachments = await new AttachmentsRepo(database, libraryId).forWork(input.workId);
  return attachments.find((attachment) => attachment.id === input.attachmentId) ?? null;
}
