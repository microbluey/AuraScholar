import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import { WorksRepo } from "@aurascholar/db/repos/works";
import type {
  DataCommandOutput,
  DataCommandRequest,
  LibraryImportReferencesCommandResult,
} from "../data-command-contract";
import { parseReferenceImport } from "../../src/shared/reference-import";
import {
  parseReferenceImportCommandInput,
  validateReferenceImportPayload,
} from "./reference-import-command-input";
import { assertActiveLocalLibrary, type DataCommandDependencies } from "./data-command-runtime";

type ReferenceImportCommandName = "library.importReferences";

export type ReferenceImportCommandRequest = Extract<
  DataCommandRequest,
  { name: ReferenceImportCommandName }
>;

/**
 * The renderer may preview parsed CSL locally, but only main turns that export
 * into Library work records. Parsing and payload validation happen before the
 * transaction; main alone resolves the durable local Library identity.
 */
export async function executeReferenceImportCommand(
  request: ReferenceImportCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<ReferenceImportCommandName>> {
  const input = parseReferenceImportCommandInput(request.input);
  const parsed = parseReferenceImport(input.text, input.format);
  validateReferenceImportPayload(parsed.items, parsed.workInputs);

  return dependencies.transaction(request.name, async (database) => {
    const libraryId = await requireActiveLocalLibraryId(database);
    return importReferenceWorks(database, libraryId, parsed.workInputs);
  });
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

async function importReferenceWorks(
  database: Database,
  libraryId: string,
  workInputs: Parameters<WorksRepo["upsertMany"]>[0],
): Promise<LibraryImportReferencesCommandResult> {
  // `upsertMany` owns a SAVEPOINT; it is safe inside the coordinator's outer
  // transaction and is deliberately invoked once for a complete import.
  return new WorksRepo(database, libraryId).upsertMany(workInputs);
}
