import { createNodeDatabase } from "@aurascholar/db/node";
import { runMigrations } from "@aurascholar/db/migrations";
import { describe, expect, it } from "vitest";
import { importLibraryBackupJsonIntoDatabase } from "./sync";

describe("library backup Canvas transaction", () => {
  it("rolls back earlier rows when a strict Canvas node insert fails", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    const backup = JSON.stringify({
      version: 1,
      exportedAt: "2026-07-27T00:00:00.000Z",
      tables: {
        works: [
          {
            id: "work-imported-before-failure",
            title: "Must roll back",
            created_at: 10,
            updated_at: 10,
          },
        ],
        canvas_workspaces: [
          {
            id: "workspace-imported-before-failure",
            name: "Must roll back",
            schema_version: 1,
            viewport_json: JSON.stringify({ x: 0, y: 0, zoom: 1 }),
            created_at: 10,
            updated_at: 10,
          },
        ],
        canvas_nodes: [
          {
            id: "invalid-parent-group",
            workspace_id: "workspace-imported-before-failure",
            work_id: null,
            type: "group",
            pos_x: 0,
            pos_y: 0,
            width: 0,
            height: 400,
            group_id: null,
            sort_order: 0,
            tags_json: "[]",
            data_json: JSON.stringify({ title: "Invalid parent" }),
            created_at: 10,
            updated_at: 10,
          },
          {
            id: "otherwise-valid-child",
            workspace_id: "workspace-imported-before-failure",
            work_id: null,
            type: "idea-note",
            pos_x: 20,
            pos_y: 20,
            width: 280,
            height: 180,
            group_id: "invalid-parent-group",
            sort_order: 1,
            tags_json: "[]",
            data_json: JSON.stringify({
              title: "Child",
              contentMarkdown: "",
              hasEquations: false,
            }),
            created_at: 10,
            updated_at: 10,
          },
        ],
        canvas_edges: [
          {
            id: "edge-after-invalid-parent",
            workspace_id: "workspace-imported-before-failure",
            source_id: "invalid-parent-group",
            target_id: "otherwise-valid-child",
            relation_type: "custom",
            label: null,
            style_json: null,
            sort_order: 0,
            created_at: 10,
            updated_at: 10,
          },
        ],
      },
    });

    await expect(importLibraryBackupJsonIntoDatabase(backup, db, "library-test")).rejects.toThrow();

    for (const [table, id] of [
      ["works", "work-imported-before-failure"],
      ["canvas_workspaces", "workspace-imported-before-failure"],
      ["canvas_nodes", "invalid-parent-group"],
      ["canvas_nodes", "otherwise-valid-child"],
      ["canvas_edges", "edge-after-invalid-parent"],
    ] as const) {
      await expect(
        db.query<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table} WHERE id = ?`, [id]),
      ).resolves.toEqual([{ total: 0 }]);
    }
  });
});
