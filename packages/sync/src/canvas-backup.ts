/** Canvas tables must be exported/imported in foreign-key dependency order. */
export const SPATIAL_CANVAS_BACKUP_TABLES = [
  "canvas_workspaces",
  "canvas_nodes",
  "canvas_edges",
] as const;

/** The current UI loads this workspace directly and has no workspace picker. */
export const DEFAULT_SPATIAL_CANVAS_WORKSPACE_ID = "canvas:default";

export type SpatialCanvasBackupTable = (typeof SPATIAL_CANVAS_BACKUP_TABLES)[number];

export interface SpatialCanvasBackupIdMaps {
  attachments: ReadonlyMap<string, string>;
  annotations: ReadonlyMap<string, string>;
  edges: ReadonlyMap<string, string>;
  nodes: ReadonlyMap<string, string>;
  works: ReadonlyMap<string, string>;
  workspaces: ReadonlyMap<string, string>;
}

export interface SpatialCanvasBackupRemapResult {
  redirected: boolean;
  row: Record<string, unknown>;
}

/**
 * Fails fast if a backup table list would import children before their
 * parents. `works` is also required before canvas_nodes because work_id is a
 * nullable works reference; it is never a canvas node id.
 */
export function assertSpatialCanvasBackupOrder(tables: readonly string[]): void {
  const requiredOrder = ["works", ...SPATIAL_CANVAS_BACKUP_TABLES] as const;
  let previousIndex = -1;
  for (const table of requiredOrder) {
    const index = tables.indexOf(table);
    if (index < 0) throw new Error(`Spatial Canvas backup is missing table ${table}`);
    if (index <= previousIndex) {
      throw new Error(
        "Spatial Canvas backup tables must be ordered works → canvas_workspaces → canvas_nodes → canvas_edges",
      );
    }
    previousIndex = index;
  }
}

/**
 * Remaps a Canvas backup row after merging it into an existing library. The
 * four id namespaces remain deliberately separate: a node's work_id uses the
 * works map, while group_id/source_id/target_id use the canvas node map.
 */
export function remapSpatialCanvasBackupRow(
  table: SpatialCanvasBackupTable,
  row: Record<string, unknown>,
  maps: SpatialCanvasBackupIdMaps,
): SpatialCanvasBackupRemapResult {
  let next = row;
  let redirected = false;

  const update = (field: string, value: unknown) => {
    if (next === row) next = { ...row };
    next[field] = value;
    redirected = true;
  };
  const remap = (field: string, map: ReadonlyMap<string, string>) => {
    const current = typeof next[field] === "string" ? next[field] : null;
    if (!current) return;
    const mapped = map.get(current);
    if (mapped && mapped !== current) update(field, mapped);
  };
  const remapWorkspace = (field: string) => {
    // Keep the imported default workspace visible in the current single-
    // workspace UI even when a generic collision map contains a replacement.
    if (next[field] === DEFAULT_SPATIAL_CANVAS_WORKSPACE_ID) return;
    remap(field, maps.workspaces);
  };

  if (table === "canvas_workspaces") {
    remapWorkspace("id");
    return { redirected, row: next };
  }

  if (table === "canvas_nodes") {
    remap("id", maps.nodes);
    remapWorkspace("workspace_id");
    remap("work_id", maps.works);
    remap("group_id", maps.nodes);

    const remappedData = remapCanvasNodeDataJson(next, maps);
    if (remappedData !== next.data_json) update("data_json", remappedData);
    return { redirected, row: next };
  }

  remap("id", maps.edges);
  remapWorkspace("workspace_id");
  remap("source_id", maps.nodes);
  remap("target_id", maps.nodes);
  return { redirected, row: next };
}

function remapCanvasNodeDataJson(
  row: Record<string, unknown>,
  maps: SpatialCanvasBackupIdMaps,
): string {
  if (typeof row.data_json !== "string") {
    throw new Error("Spatial Canvas backup node has invalid data_json");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data_json) as unknown;
  } catch {
    throw new Error("Spatial Canvas backup node has malformed data_json");
  }
  if (!isRecord(parsed)) throw new Error("Spatial Canvas backup node has invalid data_json");

  let data = parsed;
  const update = (field: string, value: unknown) => {
    if (data === parsed) data = { ...parsed };
    data[field] = value;
  };
  const remap = (field: string, map: ReadonlyMap<string, string>) => {
    const current = typeof data[field] === "string" ? data[field] : null;
    if (!current) return;
    const mapped = map.get(current);
    if (mapped && mapped !== current) update(field, mapped);
  };

  if (row.type === "paper" || row.type === "excerpt") remap("workId", maps.works);
  if (row.type === "excerpt") {
    remap("annotationId", maps.annotations);
    remap("attachmentId", maps.attachments);
  }
  if (row.type === "ai-synth" && data.sourceNodeIds !== undefined) {
    const rawSourceNodeIds = data.sourceNodeIds;
    if (
      !Array.isArray(rawSourceNodeIds) ||
      !rawSourceNodeIds.every((id) => typeof id === "string")
    ) {
      throw new Error("Spatial Canvas AI synthesis node has invalid sourceNodeIds");
    }
    const sourceNodeIds = rawSourceNodeIds.map((id) => maps.nodes.get(id) ?? id);
    if (sourceNodeIds.some((id, index) => id !== rawSourceNodeIds[index])) {
      update("sourceNodeIds", sourceNodeIds);
    }
  }

  return data === parsed ? row.data_json : JSON.stringify(data);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
