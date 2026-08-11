import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import type {
  DataCommandOutput,
  DataCommandRequest,
  LibraryRestoreAnnotationsForAttachmentCommandInput,
  LibraryRestoreAnnotationsForAttachmentCommandResult,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";

type AnnotationRecoveryCommandName = "library.restoreAnnotationsForAttachment";

export type AnnotationRecoveryCommandRequest = Extract<
  DataCommandRequest,
  { name: AnnotationRecoveryCommandName }
>;

/**
 * When a PDF is reattached, preserve active annotations that were anchored to
 * its soft-deleted PDF predecessors. Main resolves and verifies every local
 * parent before a single rebinding UPDATE can occur.
 */
export async function executeAnnotationRecoveryCommand(
  request: AnnotationRecoveryCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<AnnotationRecoveryCommandName>> {
  const input = parseRestoreAnnotationsForAttachmentInput(request.input);
  return dependencies.transaction(request.name, async (database) => {
    const libraryId = await requireActiveLocalLibraryId(database);
    await assertActiveWorkForLibrary(database, libraryId, input.workId);
    await assertActivePdfAttachmentForWork(database, input);
    return restoreAnnotationsForAttachment(database, input);
  });
}

function parseRestoreAnnotationsForAttachmentInput(
  value: unknown,
): LibraryRestoreAnnotationsForAttachmentCommandInput {
  const input = requireExactAnnotationRecoveryInput(value);
  return {
    attachmentId: requireRecordId(input.attachmentId, "Attachment id"),
    workId: requireRecordId(input.workId, "Work id"),
  };
}

function requireExactAnnotationRecoveryInput(value: unknown): Record<string, unknown> {
  const fields = ["attachmentId", "workId"] as const;
  if (
    !isRecord(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((field) => !fields.includes(field as (typeof fields)[number])) ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error("Invalid library.restoreAnnotationsForAttachment input");
  }
  return value;
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

async function assertActiveWorkForLibrary(
  database: Database,
  libraryId: string,
  workId: string,
): Promise<void> {
  const rows = await database.query<{ id: string }>(
    `SELECT id
     FROM works
     WHERE id = ? AND library_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [workId, libraryId],
  );
  if (!rows[0]) {
    throw new Error(`Work ${workId} is missing, removed, or outside the active Library`);
  }
}

async function assertActivePdfAttachmentForWork(
  database: Database,
  input: LibraryRestoreAnnotationsForAttachmentCommandInput,
): Promise<void> {
  const rows = await database.query<{ id: string }>(
    `SELECT id
     FROM attachments
     WHERE id = ? AND work_id = ? AND kind = 'pdf' AND deleted_at IS NULL
     LIMIT 1`,
    [input.attachmentId, input.workId],
  );
  if (!rows[0]) {
    throw new Error(
      `Attachment ${input.attachmentId} is missing, removed, non-PDF, or not active for work ${input.workId}`,
    );
  }
}

async function restoreAnnotationsForAttachment(
  database: Database,
  input: LibraryRestoreAnnotationsForAttachmentCommandInput,
): Promise<LibraryRestoreAnnotationsForAttachmentCommandResult> {
  const restoredAnnotationCount = await database.run(
    `UPDATE annotations
     SET attachment_id = ?, updated_at = ?
     WHERE work_id = ?
       AND deleted_at IS NULL
       AND attachment_id IN (
         SELECT id
         FROM attachments
         WHERE work_id = ? AND kind = 'pdf' AND deleted_at IS NOT NULL
       )`,
    [input.attachmentId, Date.now(), input.workId, input.workId],
  );
  return { restoredAnnotationCount };
}
