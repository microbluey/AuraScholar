import { CANVAS_SCHEMA_VERSION } from "@aurascholar/core";
import { CanvasRepo, type Database } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  CanvasWorkspaceDocumentDto,
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
  overrides: Partial<CanvasWorkspaceDocumentDto> = {},
): CanvasWorkspaceDocumentDto {
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

function populatedWorkspaceDocument(
  seed: CanvasWorkspaceDocumentDto,
): CanvasWorkspaceDocumentDto {
  const now = seed.updatedAt + 1;
  return {
    ...seed,
    name: "Complete document DTO workspace",
    description: "Every supported Canvas field crosses the command boundary.",
    viewport: { x: -120.5, y: 48.25, zoom: 1.35 },
    updatedAt: now,
    nodes: [
      {
        id: "canvas-node:group",
        type: "group",
        position: { x: 20, y: 30 },
        dimensions: { width: 900, height: 540 },
        tags: ["related-work"],
        createdAt: now,
        updatedAt: now,
        data: { title: "Attention lineage", colorTheme: "violet", collapsed: true },
      },
      {
        id: "canvas-node:paper",
        type: "paper",
        position: { x: 80, y: 110 },
        dimensions: { width: 320, height: 220 },
        groupId: "canvas-node:group",
        tags: ["transformer", "foundational"],
        createdAt: now + 1,
        updatedAt: now + 1,
        data: {
          workId: "work:unlinked",
          title: "Attention Is All You Need",
          authors: ["Ashish Vaswani"],
          year: 2017,
          venue: "NeurIPS",
          doi: "10.48550/arxiv.1706.03762",
          abstractSnippet: "Self-attention replaces recurrence.",
          oaPdfUrl: "https://example.test/attention.pdf",
          localPdfPath: "/tmp/attention.pdf",
          annotationCount: 1,
        },
      },
      {
        id: "canvas-node:excerpt",
        type: "excerpt",
        position: { x: 460, y: 110 },
        dimensions: { width: 300, height: 180 },
        groupId: "canvas-node:group",
        tags: ["mechanism"],
        createdAt: now + 2,
        updatedAt: now + 2,
        data: {
          workId: "work:unlinked",
          paperTitle: "Attention Is All You Need",
          highlightText: "The dominant sequence transduction models...",
          highlightColor: "yellow",
          pageIndex: 0,
          annotationId: "annotation:one",
          attachmentId: "attachment:one",
          anchor: { exact: "The dominant sequence transduction models" },
          marginNote: "Useful framing",
        },
      },
      {
        id: "canvas-node:synth",
        type: "ai-synth",
        position: { x: 460, y: 340 },
        dimensions: { width: 340, height: 210 },
        groupId: "canvas-node:group",
        tags: ["synthesis"],
        createdAt: now + 3,
        updatedAt: now + 3,
        data: {
          sourceNodeIds: ["canvas-node:paper", "canvas-node:excerpt"],
          synthType: "tldr",
          title: "Core contribution",
          contentMarkdown: "Self-attention replaces recurrence.",
          structuredTable: {
            headers: ["Claim", "Evidence"],
            rows: [["Parallelism", "No recurrence"]],
          },
          modelName: "test-model",
        },
      },
      {
        id: "canvas-node:idea",
        type: "idea-note",
        position: { x: 80, y: 380 },
        dimensions: { width: 280, height: 150 },
        groupId: "canvas-node:group",
        tags: ["hypothesis"],
        createdAt: now + 4,
        updatedAt: now + 4,
        data: {
          title: "Scaling question",
          contentMarkdown: "Does sparse attention preserve quality?",
          hasEquations: false,
        },
      },
    ],
    edges: [
      {
        id: "canvas-edge:derived",
        sourceId: "canvas-node:synth",
        targetId: "canvas-node:excerpt",
        relationType: "derived-from",
        label: "synthesized from",
        style: { stroke: "#7c3aed", animated: true },
        createdAt: now + 5,
        updatedAt: now + 5,
      },
      {
        id: "canvas-edge:supports",
        sourceId: "canvas-node:excerpt",
        targetId: "canvas-node:idea",
        relationType: "supports",
        style: { animated: false },
        createdAt: now + 6,
        updatedAt: now + 6,
      },
    ],
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
      { input: { name: "文".repeat(171) }, name: "canvas.createWorkspace" },
      { input: { workspaceId: "canvas:one" }, name: "canvas.renameWorkspace" },
      {
        input: { name: "Canvas", workspaceId: "canvas:one", extra: true },
        name: "canvas.renameWorkspace",
      },
      {
        input: { name: "文".repeat(171), workspaceId: "canvas:one" },
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
    expect(initial.workspaces[0]).not.toHaveProperty("projectId");
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
    } satisfies CanvasWorkspaceDocumentDto;
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

  it("maps a complete workspace DTO losslessly across save, load, and rename", async () => {
    const created = await command("canvas.createWorkspace", { name: "Document DTO" });
    const document = populatedWorkspaceDocument(created.workspace);

    await expect(command("canvas.saveWorkspace", { document })).resolves.toEqual({ saved: true });
    await expect(
      command("canvas.loadWorkspace", { workspaceId: document.workspaceId }),
    ).resolves.toEqual({ workspace: document });

    const renamed = await command("canvas.renameWorkspace", {
      workspaceId: document.workspaceId,
      name: "Renamed document DTO",
    });
    expect(renamed.workspace).toEqual({
      ...document,
      name: "Renamed document DTO",
      updatedAt: expect.any(Number),
    });
    expect(renamed.workspace.updatedAt).toBeGreaterThan(document.updatedAt);
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
