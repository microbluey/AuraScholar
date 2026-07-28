import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import { applyRemoteSegment, type ApplyRemoteSegmentCommand } from "@aurascholar/sync";
import { CH } from "../shared";
import type {
  ApplyRemoteSyncSegmentCommandInput,
  DataCommandRequest,
  ImportLibraryBackupCommandInput,
} from "../data-command-contract";
import {
  importParsedLibraryBackupIntoDatabase,
  parseLibraryBackupJson,
} from "../../src/shared/library-backup";
import { SqliteSyncStorage } from "../../src/shared/sqlite-sync-storage";
import { withMainDatabaseTransaction } from "./db";
import { handle } from "./ipc";
import { getStableDeviceId } from "./platform";

const MAX_BACKUP_TEXT_LENGTH = 64 * 1024 * 1024;
const MAX_REMOTE_SEGMENT_ENTRIES = 500;
const PROVIDER_SCOPE_PATTERN = /^webdav-[a-z0-9]{14}$/;

export interface DataCommandDependencies {
  getDeviceId?(): Promise<string>;
  transaction<T>(
    commandName: string,
    operation: (database: Database) => Promise<T> | T,
  ): Promise<T>;
}

const defaultDependencies: DataCommandDependencies = {
  getDeviceId: getStableDeviceId,
  transaction: withMainDatabaseTransaction,
};

export function registerDataCommandHandlers(): void {
  handle(CH.dataCommand, (_event, request: unknown) => executeDataCommand(request));
}

export async function executeDataCommand(
  request: unknown,
  dependencies: DataCommandDependencies = defaultDependencies,
): Promise<unknown> {
  const envelope = parseEnvelope(request);
  switch (envelope.name) {
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
  if (value.name !== "library.importBackup" && value.name !== "sync.applyRemoteSegment") {
    throw new Error(`Unsupported data command "${value.name}"`);
  }
  return value as unknown as DataCommandRequest;
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

async function assertActiveLocalLibrary(database: Database, expectedLibraryId: string) {
  const durableLibraryId = await requireLocalLibraryId(database);
  if (durableLibraryId !== expectedLibraryId) {
    throw new Error("Rejected stale or foreign Library scope");
  }
  const rows = await database.query<{ id: string }>(
    `SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [expectedLibraryId],
  );
  if (rows.length !== 1) {
    throw new Error("Target Library does not exist or is deleted");
  }
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
