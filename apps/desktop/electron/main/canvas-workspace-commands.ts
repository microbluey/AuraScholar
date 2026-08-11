import { CanvasRepo, type Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import type {
  CanvasCreateWorkspaceCommandInput,
  CanvasCreateWorkspaceCommandResult,
  CanvasDeleteWorkspaceCommandInput,
  CanvasDeleteWorkspaceCommandResult,
  CanvasListWorkspacesCommandResult,
  CanvasLoadWorkspaceCommandInput,
  CanvasLoadWorkspaceCommandResult,
  CanvasRenameWorkspaceCommandInput,
  CanvasRenameWorkspaceCommandResult,
  CanvasSaveWorkspaceCommandInput,
  CanvasSaveWorkspaceCommandResult,
  DataCommandOutput,
  DataCommandRequest,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  type DataCommandDependencies,
} from "./data-command-runtime";
import {
  parseCanvasCreateWorkspaceInput,
  parseCanvasDeleteWorkspaceInput,
  parseCanvasListWorkspacesInput,
  parseCanvasLoadWorkspaceInput,
  parseCanvasRenameWorkspaceInput,
  parseCanvasSaveWorkspaceInput,
} from "./canvas-workspace-command-input";

type CanvasWorkspaceReadCommandName = "canvas.loadWorkspace";
type CanvasWorkspaceMutationCommandName =
  | "canvas.listWorkspaces"
  | "canvas.createWorkspace"
  | "canvas.renameWorkspace"
  | "canvas.deleteWorkspace"
  | "canvas.saveWorkspace";
type CanvasWorkspaceCommandName =
  | CanvasWorkspaceReadCommandName
  | CanvasWorkspaceMutationCommandName;

export type CanvasWorkspaceCommandRequest = Extract<
  DataCommandRequest,
  { name: CanvasWorkspaceCommandName }
>;

/**
 * Durable workspace commands keep CanvasRepo and its savepoints in the main
 * process. The renderer provides a snapshot, never a Library id; each lease
 * resolves the active local Library immediately before touching its rows.
 */
export async function executeCanvasWorkspaceCommand(
  request: CanvasWorkspaceCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<CanvasWorkspaceCommandName>> {
  switch (request.name) {
    case "canvas.listWorkspaces": {
      parseCanvasListWorkspacesInput(request.input);
      return executeCanvasWorkspaceMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return listCanvasWorkspaces(database, libraryId);
      });
    }
    case "canvas.loadWorkspace": {
      const input = parseCanvasLoadWorkspaceInput(request.input);
      return executeCanvasWorkspaceQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return loadCanvasWorkspace(database, libraryId, input);
      });
    }
    case "canvas.createWorkspace": {
      const input = parseCanvasCreateWorkspaceInput(request.input);
      return executeCanvasWorkspaceMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return createCanvasWorkspace(database, libraryId, input);
      });
    }
    case "canvas.renameWorkspace": {
      const input = parseCanvasRenameWorkspaceInput(request.input);
      return executeCanvasWorkspaceMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return renameCanvasWorkspace(database, libraryId, input);
      });
    }
    case "canvas.deleteWorkspace": {
      const input = parseCanvasDeleteWorkspaceInput(request.input);
      return executeCanvasWorkspaceMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return deleteCanvasWorkspace(database, libraryId, input);
      });
    }
    case "canvas.saveWorkspace": {
      const input = parseCanvasSaveWorkspaceInput(request.input);
      return executeCanvasWorkspaceMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return saveCanvasWorkspace(database, libraryId, input);
      });
    }
  }
}

function executeCanvasWorkspaceQuery<K extends CanvasWorkspaceReadCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

function executeCanvasWorkspaceMutation<K extends CanvasWorkspaceMutationCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  return dependencies.transaction(commandName, operation);
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

async function listCanvasWorkspaces(
  database: Database,
  libraryId: string,
): Promise<CanvasListWorkspacesCommandResult> {
  const repo = new CanvasRepo(database, libraryId);
  const workspaces = await repo.list();
  if (workspaces.length > 0) return { workspaces };
  await repo.ensureDefault();
  return { workspaces: await repo.list() };
}

async function loadCanvasWorkspace(
  database: Database,
  libraryId: string,
  input: CanvasLoadWorkspaceCommandInput,
): Promise<CanvasLoadWorkspaceCommandResult> {
  return { workspace: await new CanvasRepo(database, libraryId).load(input.workspaceId) };
}

async function createCanvasWorkspace(
  database: Database,
  libraryId: string,
  input: CanvasCreateWorkspaceCommandInput,
): Promise<CanvasCreateWorkspaceCommandResult> {
  return { workspace: await new CanvasRepo(database, libraryId).create(input.name) };
}

async function renameCanvasWorkspace(
  database: Database,
  libraryId: string,
  input: CanvasRenameWorkspaceCommandInput,
): Promise<CanvasRenameWorkspaceCommandResult> {
  return { workspace: await new CanvasRepo(database, libraryId).rename(input.workspaceId, input.name) };
}

async function deleteCanvasWorkspace(
  database: Database,
  libraryId: string,
  input: CanvasDeleteWorkspaceCommandInput,
): Promise<CanvasDeleteWorkspaceCommandResult> {
  return { deleted: await new CanvasRepo(database, libraryId).deleteWorkspace(input.workspaceId) };
}

async function saveCanvasWorkspace(
  database: Database,
  libraryId: string,
  input: CanvasSaveWorkspaceCommandInput,
): Promise<CanvasSaveWorkspaceCommandResult> {
  await new CanvasRepo(database, libraryId).save(input.document);
  return { saved: true };
}
