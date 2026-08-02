import type { Database } from "@aurascholar/db";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { applyRemoteSegment, type ApplyRemoteSegmentCommand } from "@aurascholar/sync";
import { CH } from "../shared";
import type {
  ApplyRemoteSyncSegmentCommandInput,
  DataCommandName,
  DataCommandOutput,
  DataCommandRequest,
  ImportLibraryBackupCommandInput,
  MergeWorksCommandInput,
  PurgeDeletedWorksCommandInput,
  SetWorkReadingStatusCommandInput,
  SetWorkStarredCommandInput,
  WorkIdsCommandInput,
} from "../data-command-contract";
import {
  importParsedLibraryBackupIntoDatabase,
  parseLibraryBackupJson,
} from "../../src/shared/library-backup";
import { SqliteSyncStorage } from "../../src/shared/sqlite-sync-storage";
import { withMainDatabase, withMainDatabaseTransaction } from "./db";
import { handle } from "./ipc";
import { getStableDeviceId } from "./platform";
import { executeLibraryCollectionCommand } from "./library-collection-commands";
import { executeLibraryTagCommand } from "./library-tag-commands";
import { executeResearchProjectCommand } from "./research-project-commands";
import { executeEvidenceCommand } from "./evidence-commands";
import { executeSavedSearchCommand } from "./saved-search-commands";
import { executeSentinelCommand } from "./sentinel-commands";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireNonEmptyString,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";

const MAX_BACKUP_TEXT_LENGTH = 64 * 1024 * 1024;
const MAX_MERGE_DUPLICATE_IDS = 500;
const MAX_WORK_IDS_PER_COMMAND = 500;
const MAX_REMOTE_SEGMENT_ENTRIES = 500;
const PROVIDER_SCOPE_PATTERN = /^webdav-[a-z0-9]{14}$/;

export type { DataCommandDependencies } from "./data-command-runtime";

const defaultDependencies: DataCommandDependencies = {
  execute: (_commandName, operation) => withMainDatabase(operation),
  getDeviceId: getStableDeviceId,
  transaction: withMainDatabaseTransaction,
};

export function registerDataCommandHandlers(): void {
  handle(CH.dataCommand, (_event, request: unknown) => executeDataCommand(request));
}

export async function executeDataCommand(
  request: unknown,
  dependencies: DataCommandDependencies = defaultDependencies,
): Promise<DataCommandOutput<DataCommandName>> {
  const envelope = parseEnvelope(request);
  switch (envelope.name) {
    case "document.resolveAttachmentRevision":
    case "evidence.get":
    case "evidence.list":
    case "evidence.saveText":
      return executeEvidenceCommand(envelope, dependencies);
    case "library.addTagToWorks":
    case "library.createTag":
    case "library.deleteTag":
    case "library.renameTag":
    case "library.restoreTag":
    case "library.setTagColor":
      return executeLibraryTagCommand(envelope, dependencies);
    case "library.createCollection":
    case "library.deleteCollection":
    case "library.moveCollection":
    case "library.renameCollection":
    case "library.restoreCollection":
    case "library.setWorksCollection":
      return executeLibraryCollectionCommand(envelope, dependencies);
    case "project.addWorks":
    case "project.create":
    case "project.get":
    case "project.getScope":
    case "project.list":
    case "project.listSources":
    case "project.removeWorks":
    case "project.rename":
    case "project.searchLibraryWorks":
      return executeResearchProjectCommand(envelope, dependencies);
    case "savedSearch.clearNew":
    case "savedSearch.create":
    case "savedSearch.delete":
    case "savedSearch.recordError":
    case "savedSearch.recordRun":
    case "savedSearch.restore":
      return executeSavedSearchCommand(envelope, dependencies);
    case "sentinel.createOrRestore":
    case "sentinel.delete":
    case "sentinel.linkWork":
    case "sentinel.recordCheck":
    case "sentinel.restore":
    case "sentinel.setStatus":
      return executeSentinelCommand(envelope, dependencies);
    case "library.mergeWorks": {
      const input = parseMergeWorksInput(envelope.input);
      return dependencies.transaction(envelope.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await assertActiveMergeWorksBelongToLibrary(
          database,
          input.libraryId,
          input.primaryId,
          input.duplicateIds,
        );
        const result = await new WorksRepo(database, input.libraryId).mergeInto(
          input.primaryId,
          input.duplicateIds,
        );
        if (result.primaryId !== input.primaryId || result.merged !== input.duplicateIds.length) {
          throw new Error("Merge did not retire every requested duplicate work");
        }
        return result;
      });
    }
    case "library.restoreWorks": {
      const input = parseWorkIdsCommandInput(envelope.input, envelope.name);
      return dependencies.transaction(envelope.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await assertDeletedWorksBelongToLibrary(database, input.libraryId, input.workIds);
        const updated = await new WorksRepo(database, input.libraryId).restoreMany(input.workIds);
        if (updated !== input.workIds.length) {
          throw new Error("Restore did not update every requested work");
        }
        return { updated };
      });
    }
    case "library.setWorkReadingStatus": {
      const input = parseSetWorkReadingStatusInput(envelope.input);
      return dependencies.transaction(envelope.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await assertActiveWorksBelongToLibrary(database, input.libraryId, [input.workId]);
        await new WorksRepo(database, input.libraryId).setReadingStatus(input.workId, input.status);
        return { updated: 1 };
      });
    }
    case "library.setWorkStarred": {
      const input = parseSetWorkStarredInput(envelope.input);
      return dependencies.transaction(envelope.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await assertActiveWorksBelongToLibrary(database, input.libraryId, [input.workId]);
        await new WorksRepo(database, input.libraryId).setStarred(input.workId, input.starred);
        return { updated: 1 };
      });
    }
    case "library.trashWorks": {
      const input = parseWorkIdsCommandInput(envelope.input, envelope.name);
      return dependencies.transaction(envelope.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await assertActiveWorksBelongToLibrary(database, input.libraryId, input.workIds);
        const updated = await new WorksRepo(database, input.libraryId).softDeleteMany(
          input.workIds,
        );
        if (updated !== input.workIds.length) {
          throw new Error("Trash did not update every requested work");
        }
        return { updated };
      });
    }
    case "library.purgeDeletedWorks": {
      const input = parsePurgeDeletedWorksInput(envelope.input);
      return dependencies.transaction(envelope.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await assertDeletedWorksBelongToLibrary(database, input.libraryId, input.workIds);
        const purged = await new WorksRepo(database, input.libraryId).purgeDeletedMany(
          input.workIds,
        );
        if (purged !== input.workIds.length) {
          throw new Error("Permanent deletion did not remove every requested work");
        }
        return { purged };
      });
    }
    case "library.importBackup": {
      const input = parseImportLibraryBackupInput(envelope.input);
      // Parsing, sanitization, graph validation, and potentially expensive JSON
      // work happen before the exclusive database lease begins.
      const backup = parseLibraryBackupJson(input.backupText);
      return dependencies.transaction(envelope.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        return importParsedLibraryBackupIntoDatabase(database, backup, input.libraryId);
      });
    }
    case "sync.applyRemoteSegment": {
      const input = parseApplyRemoteSyncSegmentInput(envelope.input);
      const localDeviceId = await dependencies.getDeviceId?.();
      if (!localDeviceId) throw new Error("Local device identity is unavailable");
      return dependencies.transaction(envelope.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const storage = new SqliteSyncStorage(
          database,
          localDeviceId,
          input.libraryId,
          input.providerScope,
          `remote:${input.providerScope}`,
        );
        return applyRemoteSegment(storage, input.segment);
      });
    }
  }
}

function parseEnvelope(value: unknown): DataCommandRequest {
  if (!isRecord(value) || typeof value.name !== "string" || !("input" in value)) {
    throw new Error("Invalid data command request");
  }
  if (
    value.name !== "library.addTagToWorks" &&
    value.name !== "document.resolveAttachmentRevision" &&
    value.name !== "evidence.get" &&
    value.name !== "evidence.list" &&
    value.name !== "evidence.saveText" &&
    value.name !== "library.createCollection" &&
    value.name !== "library.createTag" &&
    value.name !== "library.deleteCollection" &&
    value.name !== "library.deleteTag" &&
    value.name !== "library.mergeWorks" &&
    value.name !== "library.moveCollection" &&
    value.name !== "library.renameCollection" &&
    value.name !== "library.renameTag" &&
    value.name !== "library.restoreCollection" &&
    value.name !== "library.restoreTag" &&
    value.name !== "library.restoreWorks" &&
    value.name !== "library.setTagColor" &&
    value.name !== "library.setWorkReadingStatus" &&
    value.name !== "library.setWorkStarred" &&
    value.name !== "library.setWorksCollection" &&
    value.name !== "library.trashWorks" &&
    value.name !== "library.purgeDeletedWorks" &&
    value.name !== "library.importBackup" &&
    value.name !== "project.addWorks" &&
    value.name !== "project.create" &&
    value.name !== "project.get" &&
    value.name !== "project.getScope" &&
    value.name !== "project.list" &&
    value.name !== "project.listSources" &&
    value.name !== "project.removeWorks" &&
    value.name !== "project.rename" &&
    value.name !== "project.searchLibraryWorks" &&
    value.name !== "savedSearch.clearNew" &&
    value.name !== "savedSearch.create" &&
    value.name !== "savedSearch.delete" &&
    value.name !== "savedSearch.recordError" &&
    value.name !== "savedSearch.recordRun" &&
    value.name !== "savedSearch.restore" &&
    value.name !== "sentinel.createOrRestore" &&
    value.name !== "sentinel.delete" &&
    value.name !== "sentinel.linkWork" &&
    value.name !== "sentinel.recordCheck" &&
    value.name !== "sentinel.restore" &&
    value.name !== "sentinel.setStatus" &&
    value.name !== "sync.applyRemoteSegment"
  ) {
    throw new Error(`Unsupported data command "${value.name}"`);
  }
  return value as unknown as DataCommandRequest;
}

function parseMergeWorksInput(value: unknown): MergeWorksCommandInput {
  if (!isRecord(value)) throw new Error("Invalid library.mergeWorks input");
  const libraryId = requireRecordId(value.libraryId, "Library id");
  const primaryId = requireRecordId(value.primaryId, "Primary work id");
  if (!Array.isArray(value.duplicateIds) || value.duplicateIds.length === 0) {
    throw new Error("At least one duplicate work id is required");
  }
  if (value.duplicateIds.length > MAX_MERGE_DUPLICATE_IDS) {
    throw new Error(`Merging is limited to ${MAX_MERGE_DUPLICATE_IDS} duplicate works at a time`);
  }
  const duplicateIds = Array.from(value.duplicateIds, (workId, index) =>
    requireRecordId(workId, `Duplicate work id at index ${index}`),
  );
  if (new Set(duplicateIds).size !== duplicateIds.length) {
    throw new Error("Duplicate work ids must be unique");
  }
  if (duplicateIds.includes(primaryId)) {
    throw new Error("Primary work cannot also be a duplicate");
  }
  return { libraryId, primaryId, duplicateIds };
}

function parsePurgeDeletedWorksInput(value: unknown): PurgeDeletedWorksCommandInput {
  return parseWorkIdsCommandInput(value, "library.purgeDeletedWorks");
}

function parseWorkIdsCommandInput(
  value: unknown,
  commandName: "library.purgeDeletedWorks" | "library.restoreWorks" | "library.trashWorks",
): WorkIdsCommandInput {
  if (!isRecord(value)) throw new Error(`Invalid ${commandName} input`);
  const libraryId = requireRecordId(value.libraryId, "Library id");
  if (!Array.isArray(value.workIds) || value.workIds.length === 0) {
    throw new Error("At least one work id is required");
  }
  if (value.workIds.length > MAX_WORK_IDS_PER_COMMAND) {
    throw new Error(`Library work updates are limited to ${MAX_WORK_IDS_PER_COMMAND} at a time`);
  }
  const workIds = Array.from(value.workIds, (workId, index) =>
    requireRecordId(workId, `Work id at index ${index}`),
  );
  if (new Set(workIds).size !== workIds.length) {
    throw new Error("Work ids must be unique");
  }
  return { libraryId, workIds };
}

function parseSetWorkReadingStatusInput(value: unknown): SetWorkReadingStatusCommandInput {
  if (!isRecord(value)) throw new Error("Invalid library.setWorkReadingStatus input");
  const libraryId = requireRecordId(value.libraryId, "Library id");
  const workId = requireRecordId(value.workId, "Work id");
  if (value.status !== "unread" && value.status !== "reading" && value.status !== "read") {
    throw new Error("Reading status is invalid");
  }
  return { libraryId, status: value.status, workId };
}

function parseSetWorkStarredInput(value: unknown): SetWorkStarredCommandInput {
  if (!isRecord(value)) throw new Error("Invalid library.setWorkStarred input");
  const libraryId = requireRecordId(value.libraryId, "Library id");
  const workId = requireRecordId(value.workId, "Work id");
  if (typeof value.starred !== "boolean") {
    throw new Error("Starred state must be a boolean");
  }
  return { libraryId, starred: value.starred, workId };
}

function parseImportLibraryBackupInput(value: unknown): ImportLibraryBackupCommandInput {
  if (!isRecord(value)) throw new Error("Invalid library.importBackup input");
  const libraryId = requireNonEmptyString(value.libraryId, "Library id");
  if (typeof value.backupText !== "string" || value.backupText.length === 0) {
    throw new Error("Backup text is required");
  }
  if (value.backupText.length > MAX_BACKUP_TEXT_LENGTH) {
    throw new Error("Backup file is too large");
  }
  return { backupText: value.backupText, libraryId };
}

function parseApplyRemoteSyncSegmentInput(value: unknown): ApplyRemoteSyncSegmentCommandInput {
  if (!isRecord(value)) throw new Error("Invalid sync.applyRemoteSegment input");
  const libraryId = requireNonEmptyString(value.libraryId, "Library id");
  const providerScope = requireNonEmptyString(value.providerScope, "Sync provider scope");
  if (!PROVIDER_SCOPE_PATTERN.test(providerScope)) {
    throw new Error("Invalid sync provider scope");
  }
  const segment = value.segment;
  if (!isRecord(segment) || !Array.isArray(segment.entries)) {
    throw new Error("Invalid remote sync segment");
  }
  if (segment.entries.length === 0 || segment.entries.length > MAX_REMOTE_SEGMENT_ENTRIES) {
    throw new Error("Invalid remote sync segment entry count");
  }
  if (typeof segment.path !== "string" || segment.path.length > 1024) {
    throw new Error("Invalid remote sync segment path");
  }
  return {
    libraryId,
    providerScope,
    segment: segment as unknown as ApplyRemoteSegmentCommand,
  };
}

async function assertDeletedWorksBelongToLibrary(
  database: Database,
  libraryId: string,
  workIds: string[],
): Promise<void> {
  const placeholders = workIds.map(() => "?").join(",");
  const rows = await database.query<{ id: string }>(
    `SELECT id
     FROM works
     WHERE library_id = ?
       AND deleted_at IS NOT NULL
       AND id IN (${placeholders})`,
    [libraryId, ...workIds],
  );
  if (rows.length !== workIds.length) {
    throw new Error("Every work must belong to the active Library recycle bin");
  }
}

async function assertActiveWorksBelongToLibrary(
  database: Database,
  libraryId: string,
  workIds: string[],
): Promise<void> {
  const placeholders = workIds.map(() => "?").join(",");
  const rows = await database.query<{ id: string }>(
    `SELECT id
     FROM works
     WHERE library_id = ?
       AND deleted_at IS NULL
       AND id IN (${placeholders})`,
    [libraryId, ...workIds],
  );
  if (rows.length !== workIds.length) {
    throw new Error("Every work must be active and belong to the active Library");
  }
}

async function assertActiveMergeWorksBelongToLibrary(
  database: Database,
  libraryId: string,
  primaryId: string,
  duplicateIds: string[],
): Promise<void> {
  const workIds = [primaryId, ...duplicateIds];
  const placeholders = workIds.map(() => "?").join(",");
  const rows = await database.query<{ id: string }>(
    `SELECT id
     FROM works
     WHERE library_id = ?
       AND deleted_at IS NULL
       AND id IN (${placeholders})`,
    [libraryId, ...workIds],
  );
  if (rows.length !== workIds.length) {
    throw new Error("Every merge work must be active and belong to the active Library");
  }
}
