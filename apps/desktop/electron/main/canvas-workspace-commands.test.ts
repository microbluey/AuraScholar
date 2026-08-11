import { CANVAS_SCHEMA_VERSION } from "@aurascholar/core";
import { CanvasRepo, type Database, type StoredCanvasWorkspaceDocument } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DataCommandInput,
  DataCommandName,
  DataCommandOutput,
} from "../data-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand } from "./data-commands";
import type { DataCommandDependencies } from "./data-command-runtime";

let database: Database;
let dependencies: DataCommandDependencies;
let libraryId: string;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "canvas-workspace-command-device",
    deviceName: "Canvas workspace commands",
    platform: "test",
  }));
  const coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
});

function command<K extends DataCommandName>(
  name: K,
  input: DataCommandInput<K>,
): Promise<DataCommandOutput<K>> {
  return executeDataCommand({ input, name }, dependencies) as Promise<DataCommandOutput<K>>;
}

function workspaceDocument(
  workspaceId = "canvas:autosave",
  overrides: Partial<StoredCanvasWorkspaceDocument> = {},
): StoredCanvasWorkspaceDocument {
  return {
    createdAt: 1,
    edges: [],
    name: "Autosave workspace",
    nodes: [],
    schemaVersion: CANVAS_SCHEMA_VERSION,
    updatedAt: 2,
    viewport: { x: 0, y: 0, zoom: 1 },
    workspaceId,
    ...overrides,
  };
}

describe("Canvas workspace data commands", () => {
  it("rejects malformed, scope-injected, and structurally invalid snapshots before a database lease", async () => {
    let executeCalls = 0;
    let transactionCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async execute() {
        executeCalls += 1;
        throw new Error("execute reached");
      },
      async transaction() {
        transactionCalls += 1;
        throw new Error("transaction reached");
      },
    };
    const invalidRequests = [
      { input: { libraryId: "library:foreign" }, name: "canvas.listWorkspaces" },
      { input: { workspaceId: " " }, name: "canvas.loadWorkspace" },
      {
        input: { libraryId: "library:foreign", workspaceId: "canvas:one" },
        name: "canvas.loadWorkspace",
      },
      { input: { name: "  " }, name: "canvas.createWorkspace" },
      {
        input: { libraryId: "library:foreign", name: "Canvas" },
        name: "canvas.createWorkspace",
      },
      { input: { workspaceId: "canvas:one" }, name: "canvas.renameWorkspace" },
      {
        input: { name: "Canvas", workspaceId: "canvas:one", extra: true },
        name: "canvas.renameWorkspace",
      },
      { input: { workspaceId: " ", libraryId: "library:foreign" }, name: "canvas.deleteWorkspace" },
      {
        input: {
          document: {
            ...workspaceDocument(),
            libraryId: "library:foreign",
          },
        },
        name: "canvas.saveWorkspace",
      },
      {
        input: {
          document: workspaceDocument("canvas:invalid-edge", {
            edges: [
              {
                createdAt: 1,
                id: "edge:one",
                relationType: "custom",
                sourceId: "missing",
                targetId: "also-missing",
                updatedAt: 2,
              },
            ],
          }),
        },
        name: "canvas.saveWorkspace",
      },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("creates a default workspace transactionally and preserves the workspace lifecycle", async () => {
    const initial = await command("canvas.listWorkspaces", {});
    expect(initial.workspaces).toEqual([
      expect.objectContaining({ name: "研究画布", workspaceId: expect.any(String) }),
    ]);
    const defaultWorkspaceId = initial.workspaces[0]!.workspaceId;

    const created = await command("canvas.createWorkspace", { name: "  方法论比较  " });
    expect(created.workspace.name).toBe("方法论比较");
    expect(created.workspace.workspaceId).not.toBe(defaultWorkspaceId);
    await expect(
      command("canvas.loadWorkspace", { workspaceId: created.workspace.workspaceId }),
    ).resolves.toEqual({ workspace: created.workspace });

    const renamed = await command("canvas.renameWorkspace", {
      name: "  因果推断  ",
      workspaceId: created.workspace.workspaceId,
    });
    expect(renamed.workspace.name).toBe("因果推断");

    const autosave = {
      ...renamed.workspace,
      description: "保留自动保存的空间状态",
      nodes: [
        {
          createdAt: renamed.workspace.createdAt,
          data: {
            abstractSnippet: undefined,
            annotationCount: 0,
            authors: ["Ada Lovelace"],
            doi: undefined,
            title: "Normal paper autosave",
            venue: undefined,
            workId: "missing-work-is-allowed-for-archives",
            year: null,
          },
          dimensions: { height: 220, width: 320 },
          groupId: undefined,
          id: "canvas-node:paper",
          position: { x: -240, y: -45 },
          tags: [],
          type: "paper" as const,
          updatedAt: renamed.workspace.updatedAt + 1,
        },
        {
          createdAt: renamed.workspace.createdAt,
          data: { contentMarkdown: "待验证的研究想法", hasEquations: false },
          dimensions: { height: 160, width: 280 },
          id: "canvas-node:idea",
          position: { x: 120, y: -45 },
          tags: ["idea"],
          type: "idea-note" as const,
          updatedAt: renamed.workspace.updatedAt + 1,
        },
      ],
      edges: [
        {
          createdAt: renamed.workspace.updatedAt + 1,
          id: "canvas-edge:optional-cleared",
          label: undefined,
          relationType: "supports" as const,
          sourceId: "canvas-node:paper",
          style: undefined,
          targetId: "canvas-node:idea",
          updatedAt: renamed.workspace.updatedAt + 1,
        },
      ],
      updatedAt: renamed.workspace.updatedAt + 1,
      viewport: { x: 120, y: -45, zoom: 1.25 },
    } satisfies StoredCanvasWorkspaceDocument;
    await expect(command("canvas.saveWorkspace", { document: autosave })).resolves.toEqual({
      saved: true,
    });
    const loaded = await command("canvas.loadWorkspace", {
      workspaceId: created.workspace.workspaceId,
    });
    expect(loaded.workspace).toMatchObject({
      description: autosave.description,
      viewport: autosave.viewport,
      workspaceId: autosave.workspaceId,
    });
    const paper = loaded.workspace?.nodes.find((node) => node.id === "canvas-node:paper");
    expect(paper).toMatchObject({
      data: { title: "Normal paper autosave", workId: "missing-work-is-allowed-for-archives" },
      type: "paper",
    });
    expect(paper).not.toHaveProperty("groupId");
    expect(paper?.data).not.toHaveProperty("venue");
    expect(paper?.data).not.toHaveProperty("doi");
    expect(loaded.workspace?.edges[0]).not.toHaveProperty("label");
    expect(loaded.workspace?.edges[0]).not.toHaveProperty("style");

    await expect(
      command("canvas.deleteWorkspace", { workspaceId: created.workspace.workspaceId }),
    ).resolves.toEqual({ deleted: true });
    await expect(
      command("canvas.loadWorkspace", { workspaceId: created.workspace.workspaceId }),
    ).resolves.toEqual({ workspace: null });
    await expect(
      command("canvas.deleteWorkspace", { workspaceId: defaultWorkspaceId }),
    ).rejects.toThrow("Cannot delete the last canvas workspace");
  });

  it("does not expose or mutate a workspace that belongs to another Library", async () => {
    const foreignLibraryId = "library:canvas-workspace-foreign";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign Canvas Workspace', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    const foreignWorkspace = await new CanvasRepo(database, foreignLibraryId).create("Foreign workspace");

    await expect(
      command("canvas.loadWorkspace", { workspaceId: foreignWorkspace.workspaceId }),
    ).resolves.toEqual({ workspace: null });
    await expect(
      command("canvas.deleteWorkspace", { workspaceId: foreignWorkspace.workspaceId }),
    ).resolves.toEqual({ deleted: false });
    await expect(
      command("canvas.saveWorkspace", {
        document: { ...foreignWorkspace, description: "forged update", updatedAt: 99 },
      }),
    ).rejects.toThrow("belongs to another library");
    await expect(
      new CanvasRepo(database, foreignLibraryId).load(foreignWorkspace.workspaceId),
    ).resolves.toEqual(foreignWorkspace);
    await expect(command("canvas.listWorkspaces", {})).resolves.toEqual({
      workspaces: [expect.objectContaining({ workspaceId: expect.any(String) })],
    });
    expect(libraryId).not.toBe(foreignLibraryId);
  });
});
