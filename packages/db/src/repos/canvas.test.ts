import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { runMigrations } from "../migrations";
import { WorksRepo } from "./works";
import {
  CanvasRepo,
  DEFAULT_CANVAS_WORKSPACE_ID,
  type StoredCanvasWorkspaceDocument,
} from "./canvas";

let db: Database;
let works: WorksRepo;
let canvas: CanvasRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  works = new WorksRepo(db);
  canvas = new CanvasRepo(db);
});

async function createSourceWork(): Promise<string> {
  const result = await works.upsert({
    title: "Attention Is All You Need",
    doi: "10.48550/arxiv.1706.03762",
    year: 2017,
    venueName: "NeurIPS",
    authors: [{ displayName: "Ashish Vaswani", position: 0 }],
  });
  return result.id;
}

function makeDocument(
  sourceWorkId: string,
  seed: StoredCanvasWorkspaceDocument,
): StoredCanvasWorkspaceDocument {
  const now = 1_784_665_234_000;
  return {
    schemaVersion: 1,
    workspaceId: seed.workspaceId,
    name: "Transformer research map",
    description: "Methods, evidence, and open questions",
    viewport: { x: -120.5, y: 48.25, zoom: 1.35 },
    createdAt: seed.createdAt,
    updatedAt: now,
    nodes: [
      {
        id: "node-group",
        type: "group",
        position: { x: 20, y: 30 },
        dimensions: { width: 900, height: 540 },
        tags: ["related-work"],
        createdAt: now,
        updatedAt: now,
        data: { title: "Attention lineage", colorTheme: "violet" },
      },
      {
        id: "node-paper",
        type: "paper",
        position: { x: 80, y: 110 },
        dimensions: { width: 320, height: 220 },
        groupId: "node-group",
        tags: ["transformer", "foundational"],
        createdAt: now + 1,
        updatedAt: now + 1,
        data: {
          workId: sourceWorkId,
          title: "Attention Is All You Need",
          authors: ["Ashish Vaswani"],
          year: 2017,
          venue: "NeurIPS",
          annotationCount: 1,
        },
      },
      {
        id: "node-excerpt",
        type: "excerpt",
        position: { x: 460, y: 110 },
        dimensions: { width: 300, height: 180 },
        groupId: "node-group",
        tags: ["mechanism"],
        createdAt: now + 2,
        updatedAt: now + 2,
        data: {
          workId: sourceWorkId,
          paperTitle: "Attention Is All You Need",
          highlightText: "The dominant sequence transduction models...",
          highlightColor: "yellow",
          pageIndex: 0,
          anchor: { exact: "The dominant sequence transduction models" },
        },
      },
      {
        id: "node-synth",
        type: "ai-synth",
        position: { x: 460, y: 340 },
        dimensions: { width: 340, height: 210 },
        groupId: "node-group",
        tags: ["synthesis"],
        createdAt: now + 3,
        updatedAt: now + 3,
        data: {
          sourceNodeIds: ["node-paper", "node-excerpt"],
          synthType: "tldr",
          title: "Core contribution",
          contentMarkdown: "Self-attention replaces recurrence.",
          modelName: "test-model",
        },
      },
      {
        id: "node-idea",
        type: "idea-note",
        position: { x: 80, y: 380 },
        dimensions: { width: 280, height: 150 },
        groupId: "node-group",
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
        id: "edge-derived",
        sourceId: "node-synth",
        targetId: "node-excerpt",
        relationType: "derived-from",
        label: "synthesized from",
        style: { stroke: "#7c3aed", animated: true },
        createdAt: now + 5,
        updatedAt: now + 5,
      },
      {
        id: "edge-supports",
        sourceId: "node-excerpt",
        targetId: "node-idea",
        relationType: "supports",
        createdAt: now + 6,
        updatedAt: now + 6,
      },
    ],
  };
}

describe("CanvasRepo", () => {
  it("creates uniquely identified empty workspaces and lists them independently", async () => {
    const seed = await canvas.ensureDefault();
    const methods = await canvas.create("  方法论对比  ", "候选方法与实验差异");
    const evidence = await canvas.create("证据链");

    expect(methods).toEqual({
      schemaVersion: 1,
      workspaceId: expect.any(String),
      name: "方法论对比",
      description: "候选方法与实验差异",
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [],
      edges: [],
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    expect(methods.workspaceId).not.toBe(DEFAULT_CANVAS_WORKSPACE_ID);
    expect(evidence.workspaceId).not.toBe(methods.workspaceId);
    expect(await canvas.load(seed.workspaceId)).toEqual(seed);
    expect((await canvas.list()).map((workspace) => workspace.workspaceId)).toEqual(
      expect.arrayContaining([seed.workspaceId, methods.workspaceId, evidence.workspaceId]),
    );
  });

  it("renames only the selected workspace and rejects blank or missing targets", async () => {
    const seed = await canvas.ensureDefault();
    const sourceWorkId = await createSourceWork();
    const methods = await canvas.create("Methods");
    const populated = makeDocument(sourceWorkId, methods);
    await canvas.save(populated);

    const renamed = await canvas.rename(methods.workspaceId, "  方法比较  ");
    expect(renamed).toEqual({
      ...populated,
      name: "方法比较",
      updatedAt: expect.any(Number),
    });
    expect(renamed.updatedAt).toBeGreaterThan(populated.updatedAt);
    expect(await canvas.load(seed.workspaceId)).toEqual(seed);

    await expect(canvas.create("   ")).rejects.toThrow("must be a non-empty string");
    await expect(canvas.rename(methods.workspaceId, "\t\n")).rejects.toThrow(
      "must be a non-empty string",
    );
    await expect(canvas.rename("missing-workspace", "New name")).rejects.toThrow("does not exist");
  });

  it("deletes one workspace in isolation, never its source work, and preserves a last workspace", async () => {
    const sourceWorkId = await createSourceWork();
    const seed = await canvas.ensureDefault();
    const disposable = await canvas.create("临时白板");
    await canvas.save(makeDocument(sourceWorkId, disposable));

    expect(await canvas.deleteWorkspace(disposable.workspaceId)).toBe(true);
    expect(await canvas.deleteWorkspace(disposable.workspaceId)).toBe(false);
    expect(await canvas.load(disposable.workspaceId)).toBeNull();
    expect(await canvas.load(seed.workspaceId)).toEqual(seed);
    expect((await works.get(sourceWorkId))?.deleted_at).toBeNull();

    await expect(canvas.deleteWorkspace(seed.workspaceId)).rejects.toThrow(
      "Cannot delete the last canvas workspace",
    );
    expect(await canvas.load(seed.workspaceId)).toEqual(seed);
  });

  it("ensures one default workspace and round-trips viewport, all node kinds, and edges", async () => {
    const sourceWorkId = await createSourceWork();
    const first = await canvas.ensureDefault();
    const second = await canvas.ensureDefault();
    expect(second.workspaceId).toBe(DEFAULT_CANVAS_WORKSPACE_ID);
    expect(second.createdAt).toBe(first.createdAt);
    expect(await canvas.list()).toHaveLength(1);

    const document = makeDocument(sourceWorkId, first);
    await canvas.save(document);

    expect(await canvas.load(document.workspaceId)).toEqual(document);
    expect(await canvas.list()).toEqual([
      expect.objectContaining({
        workspaceId: document.workspaceId,
        name: document.name,
        schemaVersion: 1,
        updatedAt: document.updatedAt,
      }),
    ]);
  });

  it("deletes only a canvas node and its incident edges, never the source work", async () => {
    const sourceWorkId = await createSourceWork();
    const seed = await canvas.ensureDefault();
    const document = makeDocument(sourceWorkId, seed);
    await canvas.save(document);

    expect(document.nodes.find((node) => node.id === "node-paper")?.id).not.toBe(sourceWorkId);
    expect(await canvas.deleteNode(document.workspaceId, "node-paper")).toBe(true);
    expect(await canvas.deleteNode(document.workspaceId, "node-paper")).toBe(false);

    const stored = await canvas.load(document.workspaceId);
    expect(stored?.nodes.map((node) => node.id)).not.toContain("node-paper");
    expect(stored?.edges.some((edge) => edge.sourceId === "node-paper")).toBe(false);
    expect(stored?.edges.some((edge) => edge.targetId === "node-paper")).toBe(false);

    const sourceWork = await works.get(sourceWorkId);
    expect(sourceWork?.id).toBe(sourceWorkId);
    expect(sourceWork?.deleted_at).toBeNull();
  });

  it("keeps archived node snapshots saveable after their source work is purged", async () => {
    const sourceWorkId = await createSourceWork();
    const seed = await canvas.ensureDefault();
    const document = makeDocument(sourceWorkId, seed);
    await canvas.save(document);

    await works.softDelete(sourceWorkId);
    await works.purgeDeleted(sourceWorkId);

    const archived = await canvas.load(document.workspaceId);
    expect(archived).not.toBeNull();
    expect(archived?.nodes.find((node) => node.id === "node-paper")?.data).toEqual(
      expect.objectContaining({ workId: sourceWorkId }),
    );

    await expect(canvas.save(archived!)).resolves.toBeUndefined();
    expect(await canvas.load(document.workspaceId)).toEqual(archived);

    const foreignKeys = await db.query<{ work_id: string | null }>(
      `SELECT work_id FROM canvas_nodes
       WHERE workspace_id = ? AND id IN ('node-paper', 'node-excerpt')
       ORDER BY id`,
      [document.workspaceId],
    );
    expect(foreignKeys).toEqual([{ work_id: null }, { work_id: null }]);
  });

  it("retargets paper and excerpt Reader links when their duplicate work is merged", async () => {
    const primary = await works.upsert({
      title: "Canonical Attention Paper",
      doi: "10.9/canvas-primary",
    });
    const duplicate = await works.upsert({
      title: "Duplicate Attention Paper",
      doi: "10.9/canvas-duplicate",
    });
    const seed = await canvas.ensureDefault();
    const document = makeDocument(duplicate.id, seed);
    await canvas.save(document);

    await expect(works.mergeInto(primary.id, [duplicate.id])).resolves.toMatchObject({
      primaryId: primary.id,
      merged: 1,
    });

    const merged = await canvas.load(document.workspaceId);
    expect(merged).not.toBeNull();
    expect(merged?.nodes.find((node) => node.id === "node-paper")?.data).toEqual(
      expect.objectContaining({ workId: primary.id }),
    );
    expect(merged?.nodes.find((node) => node.id === "node-excerpt")?.data).toEqual(
      expect.objectContaining({ workId: primary.id, pageIndex: 0 }),
    );

    const foreignKeys = await db.query<{ id: string; work_id: string | null }>(
      `SELECT id, work_id FROM canvas_nodes
       WHERE workspace_id = ? AND id IN ('node-paper', 'node-excerpt')
       ORDER BY id`,
      [document.workspaceId],
    );
    expect(foreignKeys).toEqual([
      { id: "node-excerpt", work_id: primary.id },
      { id: "node-paper", work_id: primary.id },
    ]);

    await expect(canvas.save(merged!)).resolves.toBeUndefined();
    expect(await canvas.load(document.workspaceId)).toEqual(merged);
  });

  it("rolls canvas reference changes back when a work merge fails", async () => {
    const primary = await works.upsert({
      title: "Canvas Merge Primary",
      doi: "10.9/canvas-rollback-primary",
    });
    const duplicate = await works.upsert({
      title: "Canvas Merge Duplicate",
      doi: "10.9/canvas-rollback-duplicate",
    });
    const seed = await canvas.ensureDefault();
    const document = makeDocument(duplicate.id, seed);
    await canvas.save(document);

    await db.exec(`
      CREATE TEMP TRIGGER fail_canvas_work_merge_retire
      BEFORE UPDATE OF deleted_at ON works
      WHEN OLD.id = '${duplicate.id}' AND NEW.deleted_at IS NOT NULL
      BEGIN
        SELECT RAISE(FAIL, 'forced work merge failure');
      END;
    `);

    try {
      await expect(works.mergeInto(primary.id, [duplicate.id])).rejects.toThrow(
        "forced work merge failure",
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_canvas_work_merge_retire");
    }

    expect(await canvas.load(document.workspaceId)).toEqual(document);
    expect((await works.get(duplicate.id))?.deleted_at).toBeNull();
  });

  it("rolls back the whole snapshot when a later edge insert fails", async () => {
    const sourceWorkId = await createSourceWork();
    const seed = await canvas.ensureDefault();
    const original = makeDocument(sourceWorkId, seed);
    await canvas.save(original);

    await db.exec(`
      CREATE TEMP TRIGGER fail_canvas_edge_insert
      BEFORE INSERT ON canvas_edges
      WHEN NEW.id = 'edge-fail'
      BEGIN
        SELECT RAISE(FAIL, 'forced canvas edge failure');
      END;
    `);

    const broken: StoredCanvasWorkspaceDocument = {
      ...original,
      name: "Must roll back",
      updatedAt: original.updatedAt + 100,
      edges: [
        ...original.edges,
        {
          id: "edge-fail",
          sourceId: "node-paper",
          targetId: "node-idea",
          relationType: "extends",
          createdAt: original.updatedAt + 100,
          updatedAt: original.updatedAt + 100,
        },
      ],
    };

    try {
      await expect(canvas.save(broken)).rejects.toThrow("forced canvas edge failure");
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_canvas_edge_insert");
    }

    expect(await canvas.load(original.workspaceId)).toEqual(original);
  });
});
