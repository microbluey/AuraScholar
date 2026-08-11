import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import type { Database } from "@aurascholar/db";
import { Buffer } from "node:buffer";
import type {
  DataCommandOutput,
  DataCommandRequest,
  ImportLibraryBackupCommandInput,
  LibraryBackupExportCommandInput,
  LibraryBackupExportCommandResult,
} from "../data-command-contract";
import {
  exportLibraryBackupJsonFromDatabase,
  importParsedLibraryBackupIntoDatabase,
  parseLibraryBackupJson,
} from "../../src/shared/library-backup";
import {
  assertActiveLocalLibrary,
  isRecord,
  type DataCommandDependencies,
} from "./data-command-runtime";

export const MAX_BACKUP_IPC_BYTES = 64 * 1024 * 1024;

type LibraryBackupCommandName = "library.exportBackup" | "library.importBackup";

export type LibraryBackupCommandRequest = Extract<
  DataCommandRequest,
  { name: LibraryBackupCommandName }
>;

/**
 * Main-owned Library backup boundary. The active local Library is resolved
 * durably here; renderer code can neither select another scope nor query the
 * database to discover one.
 */
export async function executeLibraryBackupCommand(
  request: LibraryBackupCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<LibraryBackupCommandName>> {
  switch (request.name) {
    case "library.exportBackup": {
      parseLibraryBackupExportInput(request.input);
      return executeLibraryBackupRead(dependencies, async (database) => {
        const libraryId = await requireLocalLibraryId(database);
        await assertActiveLocalLibrary(database, libraryId);
        const backupText = await exportLibraryBackupJsonFromDatabase(database, libraryId);
        assertBackupPayloadByteLength(backupText, "export");
        return { backupText };
      });
    }
    case "library.importBackup": {
      const input = parseImportLibraryBackupInput(request.input);
      // Parsing, sanitization, graph validation, and potentially expensive JSON
      // work happen before the exclusive database lease begins.
      const backup = parseLibraryBackupJson(input.backupText);
      return dependencies.transaction(request.name, async (database) => {
        const libraryId = await requireLocalLibraryId(database);
        await assertActiveLocalLibrary(database, libraryId);
        return importParsedLibraryBackupIntoDatabase(database, backup, libraryId);
      });
    }
  }
}

function executeLibraryBackupRead(
  dependencies: DataCommandDependencies,
  operation: (database: Database) => Promise<LibraryBackupExportCommandResult>,
): Promise<LibraryBackupExportCommandResult> {
  if (!dependencies.inspect) {
    throw new Error("Main-process Library backup read execution is unavailable");
  }
  return dependencies.inspect(operation);
}

function parseLibraryBackupExportInput(value: unknown): LibraryBackupExportCommandInput {
  if (!isRecord(value) || Object.keys(value).length !== 0) {
    throw new Error("Invalid library.exportBackup input");
  }
  return {};
}

function parseImportLibraryBackupInput(value: unknown): ImportLibraryBackupCommandInput {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !("backupText" in value)) {
    throw new Error("Invalid library.importBackup input");
  }
  if (typeof value.backupText !== "string" || value.backupText.length === 0) {
    throw new Error("Backup text is required");
  }
  assertBackupPayloadByteLength(value.backupText, "import");
  return { backupText: value.backupText };
}

/**
 * The IPC budget is for serialized UTF-8 payload bytes, not JavaScript string
 * code units. JSON escaping makes control characters materially larger.
 */
export function assertBackupPayloadByteLength(
  backupText: string,
  direction: "export" | "import",
  maximumBytes: number = MAX_BACKUP_IPC_BYTES,
): void {
  if (backupPayloadByteLength(backupText, direction) > maximumBytes) {
    throw new Error("Backup file is too large");
  }
}

export function backupPayloadByteLength(
  backupText: string,
  direction: "export" | "import",
): number {
  const payload =
    direction === "import"
      ? { input: { backupText }, name: "library.importBackup" }
      : { backupText };
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}
