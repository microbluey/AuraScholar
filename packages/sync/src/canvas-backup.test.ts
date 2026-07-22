import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPATIAL_CANVAS_WORKSPACE_ID,
  SPATIAL_CANVAS_BACKUP_TABLES,
  assertSpatialCanvasBackupOrder,
  remapSpatialCanvasBackupRow,
  type SpatialCanvasBackupIdMaps,
} from "./canvas-backup";

const maps: SpatialCanvasBackupIdMaps = {
  attachments: new Map([["attachment-old", "attachment-new"]]),
  annotations: new Map([["annotation-old", "annotation-new"]]),
  edges: new Map([["edge-old", "edge-new"]]),
  nodes: new Map([
    ["node-old", "node-new"],
    ["group-old", "group-new"],
    ["source-old", "source-new"],
  ]),
  works: new Map([["work-old", "work-deduped"]]),
  workspaces: new Map([["workspace-old", "workspace-imported"]]),
};

describe("Spatial Canvas backup guards", () => {
  it("requires works → workspaces → nodes → edges import order", () => {
    expect(() =>
      assertSpatialCanvasBackupOrder(["libraries", "works", ...SPATIAL_CANVAS_BACKUP_TABLES]),
    ).not.toThrow();
    expect(() =>
      assertSpatialCanvasBackupOrder([
        "works",
        "canvas_workspaces",
        "canvas_edges",
        "canvas_nodes",
      ]),
    ).toThrow("works → canvas_workspaces → canvas_nodes → canvas_edges");
    expect(() => assertSpatialCanvasBackupOrder(["works"])).toThrow(
      "missing table canvas_workspaces",
    );
  });

  it("keeps canvas:default as the visible merge target despite an id collision", () => {
    const collisionMaps: SpatialCanvasBackupIdMaps = {
      ...maps,
      workspaces: new Map([
        [DEFAULT_SPATIAL_CANVAS_WORKSPACE_ID, "invisible-replacement"],
        ["workspace-old", "workspace-imported"],
      ]),
    };
    expect(
      remapSpatialCanvasBackupRow(
        "canvas_workspaces",
        { id: DEFAULT_SPATIAL_CANVAS_WORKSPACE_ID, name: "Restored canvas" },
        collisionMaps,
      ).row.id,
    ).toBe(DEFAULT_SPATIAL_CANVAS_WORKSPACE_ID);
    expect(
      remapSpatialCanvasBackupRow(
        "canvas_nodes",
        {
          id: "unmapped-node",
          workspace_id: DEFAULT_SPATIAL_CANVAS_WORKSPACE_ID,
          type: "group",
          data_json: JSON.stringify({ title: "Restored group" }),
        },
        collisionMaps,
      ).row.workspace_id,
    ).toBe(DEFAULT_SPATIAL_CANVAS_WORKSPACE_ID);
    expect(
      remapSpatialCanvasBackupRow(
        "canvas_edges",
        {
          id: "unmapped-edge",
          workspace_id: DEFAULT_SPATIAL_CANVAS_WORKSPACE_ID,
          source_id: "unmapped-node",
          target_id: "unmapped-target",
        },
        collisionMaps,
      ).row.workspace_id,
    ).toBe(DEFAULT_SPATIAL_CANVAS_WORKSPACE_ID);
  });

  it("keeps node ids and nullable work ids in separate remap namespaces", () => {
    const result = remapSpatialCanvasBackupRow(
      "canvas_nodes",
      {
        id: "node-old",
        workspace_id: "workspace-old",
        work_id: "work-old",
        group_id: "group-old",
        type: "excerpt",
        data_json: JSON.stringify({
          workId: "work-old",
          annotationId: "annotation-old",
          attachmentId: "attachment-old",
          highlightText: "Evidence",
        }),
      },
      maps,
    );

    expect(result.redirected).toBe(true);
    expect(result.row).toMatchObject({
      id: "node-new",
      workspace_id: "workspace-imported",
      work_id: "work-deduped",
      group_id: "group-new",
    });
    expect(JSON.parse(String(result.row.data_json))).toMatchObject({
      workId: "work-deduped",
      annotationId: "annotation-new",
      attachmentId: "attachment-new",
    });

    const withoutWork = remapSpatialCanvasBackupRow(
      "canvas_nodes",
      {
        id: "group-old",
        workspace_id: "workspace-old",
        work_id: null,
        group_id: null,
        type: "group",
        data_json: JSON.stringify({ title: "Methods" }),
      },
      maps,
    );
    expect(withoutWork.row.work_id).toBeNull();
  });

  it("remaps AI source-node ids and edge endpoints within the imported batch", () => {
    const synth = remapSpatialCanvasBackupRow(
      "canvas_nodes",
      {
        id: "node-old",
        workspace_id: "workspace-old",
        type: "ai-synth",
        data_json: JSON.stringify({ sourceNodeIds: ["source-old", "unmapped-node"] }),
      },
      maps,
    );
    expect(JSON.parse(String(synth.row.data_json)).sourceNodeIds).toEqual([
      "source-new",
      "unmapped-node",
    ]);

    const edge = remapSpatialCanvasBackupRow(
      "canvas_edges",
      {
        id: "edge-old",
        workspace_id: "workspace-old",
        source_id: "source-old",
        target_id: "node-old",
      },
      maps,
    );
    expect(edge.row).toEqual({
      id: "edge-new",
      workspace_id: "workspace-imported",
      source_id: "source-new",
      target_id: "node-new",
    });
  });

  it("rejects malformed node JSON instead of importing broken references", () => {
    expect(() =>
      remapSpatialCanvasBackupRow(
        "canvas_nodes",
        { id: "node", type: "paper", data_json: "{bad" },
        maps,
      ),
    ).toThrow("malformed data_json");
  });
});
