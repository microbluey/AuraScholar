import { Buffer } from "node:buffer";
import {
  CanvasRepo,
  MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES,
  type Database,
  type CanvasWorkspaceSummary,
  type StoredCanvasWorkspaceDocument,
} from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import type {
  CanvasCreateWorkspaceCommandInput,
  CanvasCreateWorkspaceCommandResult,
  CanvasDeleteWorkspaceCommandInput,
  CanvasDeleteWorkspaceCommandResult,
  CanvasListWorkspacesCommandResult,
  CanvasWorkspaceDocumentDto,
  CanvasWorkspaceSummaryDto,
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

// Reserve a small, explicit allowance for the command wrapper and JSON
// escaping so a valid maximum-size document can still be returned through IPC.
const MAX_CANVAS_WORKSPACE_ENVELOPE_ALLOWANCE_BYTES = 64 * 1024;
const MAX_CANVAS_WORKSPACE_OUTPUT_BYTES =
  MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES + MAX_CANVAS_WORKSPACE_ENVELOPE_ALLOWANCE_BYTES;

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
        return requireBoundedCanvasWorkspaceOutput(await listCanvasWorkspaces(database, libraryId));
      });
    }
    case "canvas.loadWorkspace": {
      const input = parseCanvasLoadWorkspaceInput(request.input);
      return executeCanvasWorkspaceQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return requireBoundedCanvasWorkspaceOutput(
          await loadCanvasWorkspace(database, libraryId, input),
        );
      });
    }
    case "canvas.createWorkspace": {
      const input = parseCanvasCreateWorkspaceInput(request.input);
      return executeCanvasWorkspaceMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return requireBoundedCanvasWorkspaceOutput(
          await createCanvasWorkspace(database, libraryId, input),
        );
      });
    }
    case "canvas.renameWorkspace": {
      const input = parseCanvasRenameWorkspaceInput(request.input);
      return executeCanvasWorkspaceMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return requireBoundedCanvasWorkspaceOutput(
          await renameCanvasWorkspace(database, libraryId, input),
        );
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

/** Final serialized envelope guard for Canvas workspace metadata and snapshots. */
function requireBoundedCanvasWorkspaceOutput<T>(output: T): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error("Canvas workspace output cannot be serialized");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_CANVAS_WORKSPACE_OUTPUT_BYTES) {
    throw new Error(
      `Canvas workspace output is limited to ${MAX_CANVAS_WORKSPACE_OUTPUT_BYTES} bytes`,
    );
  }
  return output;
}

async function listCanvasWorkspaces(
  database: Database,
  libraryId: string,
): Promise<CanvasListWorkspacesCommandResult> {
  const repo = new CanvasRepo(database, libraryId);
  const workspaces = await repo.list();
  if (workspaces.length > 0) return toCanvasWorkspaceListResult(workspaces);
  await repo.ensureDefault();
  return toCanvasWorkspaceListResult(await repo.list());
}

function toCanvasWorkspaceListResult(
  workspaces: readonly CanvasWorkspaceSummary[],
): CanvasListWorkspacesCommandResult {
  return { workspaces: workspaces.map(toCanvasWorkspaceSummaryDto) };
}

function toCanvasWorkspaceSummaryDto(
  workspace: CanvasWorkspaceSummary,
): CanvasWorkspaceSummaryDto {
  return {
    schemaVersion: workspace.schemaVersion,
    workspaceId: workspace.workspaceId,
    name: workspace.name,
    ...(workspace.description === undefined ? {} : { description: workspace.description }),
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

async function loadCanvasWorkspace(
  database: Database,
  libraryId: string,
  input: CanvasLoadWorkspaceCommandInput,
): Promise<CanvasLoadWorkspaceCommandResult> {
  const workspace = await new CanvasRepo(database, libraryId).load(input.workspaceId);
  return { workspace: workspace === null ? null : toCanvasWorkspaceDocumentDto(workspace) };
}

async function createCanvasWorkspace(
  database: Database,
  libraryId: string,
  input: CanvasCreateWorkspaceCommandInput,
): Promise<CanvasCreateWorkspaceCommandResult> {
  return {
    workspace: toCanvasWorkspaceDocumentDto(
      await new CanvasRepo(database, libraryId).create(input.name),
    ),
  };
}

async function renameCanvasWorkspace(
  database: Database,
  libraryId: string,
  input: CanvasRenameWorkspaceCommandInput,
): Promise<CanvasRenameWorkspaceCommandResult> {
  return {
    workspace: toCanvasWorkspaceDocumentDto(
      await new CanvasRepo(database, libraryId).rename(input.workspaceId, input.name),
    ),
  };
}

function toCanvasWorkspaceDocumentDto(
  workspace: StoredCanvasWorkspaceDocument,
): CanvasWorkspaceDocumentDto {
  return {
    schemaVersion: workspace.schemaVersion,
    workspaceId: workspace.workspaceId,
    name: workspace.name,
    ...(workspace.description === undefined ? {} : { description: workspace.description }),
    viewport: {
      x: workspace.viewport.x,
      y: workspace.viewport.y,
      zoom: workspace.viewport.zoom,
    },
    nodes: workspace.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: { x: node.position.x, y: node.position.y },
      dimensions: { width: node.dimensions.width, height: node.dimensions.height },
      ...(node.groupId === undefined ? {} : { groupId: node.groupId }),
      tags: [...node.tags],
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      data: node.data,
    })),
    edges: workspace.edges.map((edge) => ({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      relationType: edge.relationType,
      ...(edge.label === undefined ? {} : { label: edge.label }),
      ...(edge.style === undefined
        ? {}
        : {
            style: {
              ...(edge.style.stroke === undefined ? {} : { stroke: edge.style.stroke }),
              ...(edge.style.animated === undefined ? {} : { animated: edge.style.animated }),
            },
          }),
      createdAt: edge.createdAt,
      updatedAt: edge.updatedAt,
    })),
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
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
