import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { requireLocalLibraryId } from "../local-first";
import { runMigrations } from "../migrations";
import {
  MAX_CANVAS_EDGES,
  MAX_CANVAS_NODE_TAGS_JSON_BYTES,
  MAX_CANVAS_NODES,
  MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
  MAX_CANVAS_WORKSPACE_LIST_ROWS,
} from "./canvas-workspace-bounds";
import { CanvasRepo } from "./canvas";

let database: Database;
let libraryId: string;
let canvas: CanvasRepo;
let workspaceId: string;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  libraryId = await requireLocalLibraryId(database);
  canvas = new CanvasRepo(database, libraryId);
  workspaceId = (await canvas.ensureDefault()).workspaceId;
});

async function insertNode(id: string, dataJson = "{}", tagsJson = "[]"): Promise<void> {
  await database.run(
    `INSERT INTO canvas_nodes (
       id, workspace_id, work_id, type, pos_x, pos_y, width, height, group_id,
       sort_order, tags_json, data_json, created_at, updated_at
     ) VALUES (?, ?, NULL, 'idea-note', 0, 0, 1, 1, NULL, 0, ?, ?, 1, 1)`,
    [id, workspaceId, tagsJson, dataJson],
  );
}

async function insertEdge(id: string, label: string | null = null): Promise<void> {
  await database.run(
    `INSERT INTO canvas_edges (
       id, workspace_id, source_id, target_id, relation_type, label, style_json,
       sort_order, created_at, updated_at
     ) VALUES (?, ?, 'source', 'target', 'supports', ?, NULL, 0, 1, 1)`,
    [id, workspaceId, label],
  );
}

describe("CanvasRepo bounded workspace reads", () => {
  it("keeps missing workspace reads fail-closed as null", async () => {
    await expect(canvas.load("missing-workspace")).resolves.toBeNull();
  });

  it("rejects workspace list row overflow before retrieving summaries", async () => {
    const project = await database.query<{ project_id: string }>(
      "SELECT project_id FROM canvas_workspaces WHERE id = ?",
      [workspaceId],
    );
    for (let index = 0; index < MAX_CANVAS_WORKSPACE_LIST_ROWS; index += 1) {
      await database.run(
        `INSERT INTO canvas_workspaces (
           id, library_id, project_id, name, description, schema_version, viewport_json,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, NULL, 1, '{"x":0,"y":0,"zoom":1}', 1, 1)`,
        [`overflow-workspace-${index}`, libraryId, project[0]!.project_id, `Workspace ${index}`],
      );
    }

    await expect(canvas.list()).rejects.toThrow(
      `Canvas workspaces are limited to ${MAX_CANVAS_WORKSPACE_LIST_ROWS}`,
    );
  });

  it("uses the serialized UTF-8 list budget after SQLite raw-byte preflight", async () => {
    const project = await database.query<{ project_id: string }>(
      "SELECT project_id FROM canvas_workspaces WHERE id = ?",
      [workspaceId],
    );
    const escapedDescription = "\u0000".repeat(MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES);
    for (let index = 0; index < 120; index += 1) {
      await database.run(
        `INSERT INTO canvas_workspaces (
           id, library_id, project_id, name, description, schema_version, viewport_json,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, '{"x":0,"y":0,"zoom":1}', 1, 1)`,
        [`escaped-workspace-${index}`, libraryId, project[0]!.project_id, "Escaped", escapedDescription],
      );
    }

    await expect(canvas.list()).rejects.toThrow("Canvas workspace list is limited to");
  });

  it("rejects oversized node fields and node row counts before JSON parsing", async () => {
    await insertNode("oversized-tags", "not-json", "x".repeat(MAX_CANVAS_NODE_TAGS_JSON_BYTES + 1));
    await expect(canvas.load(workspaceId)).rejects.toThrow(
      "Canvas workspace nodes contain fields exceeding read bounds",
    );

    await database.run("DELETE FROM canvas_nodes WHERE id = ?", ["oversized-tags"]);
    for (let index = 0; index <= MAX_CANVAS_NODES; index += 1) {
      await insertNode(`node-overflow-${index}`);
    }
    await expect(canvas.load(workspaceId)).rejects.toThrow(
      `Canvas nodes are limited to ${MAX_CANVAS_NODES}`,
    );
  });

  it("rejects edge row overflow and serialized document expansion after preflight", async () => {
    await insertNode("source");
    await insertNode("target");
    for (let index = 0; index <= MAX_CANVAS_EDGES; index += 1) {
      await insertEdge(`edge-overflow-${index}`);
    }
    await expect(canvas.load(workspaceId)).rejects.toThrow(
      `Canvas edges are limited to ${MAX_CANVAS_EDGES}`,
    );

    await database.run("DELETE FROM canvas_edges WHERE workspace_id = ?", [workspaceId]);
    const escapedLabel = "\u0000".repeat(16 * 1024);
    for (let index = 0; index < 400; index += 1) {
      await insertEdge(`edge-escaped-${index}`, escapedLabel);
    }
    await expect(canvas.load(workspaceId)).rejects.toThrow("Canvas workspace payload is limited to");
  });
});
