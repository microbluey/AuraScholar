/** Canvas tables must be exported/imported in foreign-key dependency order. */
export const SPATIAL_CANVAS_BACKUP_TABLES = [
  "canvas_workspaces",
  "canvas_nodes",
  "canvas_edges",
] as const;

/** Legacy id used by installations created before multiple workspaces were exposed. */
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

interface SpatialCanvasBackupNodeIndex {
  groups: Map<string, Record<string, unknown>>;
  workspaces: Map<string, string>;
}

function indexSpatialCanvasBackupNodes(
  rows: readonly Record<string, unknown>[],
): SpatialCanvasBackupNodeIndex {
  const nodeIds = new Set<string>();
  const groups = new Map<string, Record<string, unknown>>();
  const workspaces = new Map<string, string>();
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : "";
    const workspaceId = typeof row.workspace_id === "string" ? row.workspace_id : "";
    if (!id.trim() || !workspaceId.trim()) {
      throw new Error("Spatial Canvas backup node is missing id or workspace_id");
    }
    if (nodeIds.has(id)) {
      throw new Error(`Spatial Canvas backup contains duplicate node id ${id}`);
    }
    nodeIds.add(id);
    workspaces.set(id, workspaceId);
    if (row.type === "group") groups.set(id, row);
  }
  return { groups, workspaces };
}

function finiteBackupCoordinate(value: unknown, groupId: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Spatial Canvas backup group ${groupId} has invalid ${field}`);
  }
  return value;
}

function addBackupCoordinates(
  current: number,
  parent: number,
  groupId: string,
  field: "pos_x" | "pos_y",
): number {
  const sum = current + parent;
  if (!Number.isFinite(sum)) {
    throw new Error(`Spatial Canvas backup group ${groupId} overflows ${field}`);
  }
  return sum;
}

/**
 * Makes unsupported legacy group nesting readable without moving ordinary
 * child cards: nested Group positions are converted to root coordinates, then
 * only the Group's own parent reference is cleared.
 */
export function flattenSpatialCanvasBackupNodeGroups(
  rows: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const { groups, workspaces } = indexSpatialCanvasBackupNodes(rows);
  const normalized = rows.map((row) => {
    if (row.type !== "group" || row.group_id === null || row.group_id === undefined) {
      return row;
    }
    if (typeof row.group_id !== "string" || !row.group_id.trim()) {
      throw new Error("Spatial Canvas backup group has invalid group_id");
    }
    const id = row.id as string;
    const workspaceId = row.workspace_id as string;
    let x = finiteBackupCoordinate(row.pos_x, id, "pos_x");
    let y = finiteBackupCoordinate(row.pos_y, id, "pos_y");
    let parentId: string | undefined = row.group_id;
    const visited = new Set([id]);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = groups.get(parentId);
      if (!parent || workspaces.get(parentId) !== workspaceId) {
        throw new Error(
          `Spatial Canvas backup group ${id} references a missing or cross-workspace group`,
        );
      }
      x = addBackupCoordinates(
        x,
        finiteBackupCoordinate(parent.pos_x, parentId, "pos_x"),
        id,
        "pos_x",
      );
      y = addBackupCoordinates(
        y,
        finiteBackupCoordinate(parent.pos_y, parentId, "pos_y"),
        id,
        "pos_y",
      );
      parentId = typeof parent.group_id === "string" ? parent.group_id : undefined;
    }
    return { ...row, pos_x: x, pos_y: y, group_id: null };
  });
  assertSpatialCanvasBackupNodeGroups(normalized);
  return normalized;
}

/**
 * Keeps imported Canvas data within the currently supported flat grouping
 * model. The Desktop renderer only resolves one parent coordinate space, so
 * accepting nested groups here would persist a document CanvasRepo rejects.
 */
export function assertSpatialCanvasBackupNodeGroups(
  rows: readonly Record<string, unknown>[],
): void {
  const { groups, workspaces } = indexSpatialCanvasBackupNodes(rows);
  for (const row of rows) {
    if (row.type !== "group") continue;
    const id = row.id as string;
    if (row.group_id !== null && row.group_id !== undefined) {
      throw new Error(`Spatial Canvas backup group ${id} cannot belong to another group`);
    }
  }

  for (const row of rows) {
    if (row.group_id === null || row.group_id === undefined) continue;
    if (typeof row.group_id !== "string" || !row.group_id.trim()) {
      throw new Error("Spatial Canvas backup node has invalid group_id");
    }
    const nodeId = row.id as string;
    const parent = groups.get(row.group_id);
    if (!parent || workspaces.get(row.group_id) !== workspaces.get(nodeId)) {
      throw new Error(
        `Spatial Canvas backup node ${nodeId} references a missing or cross-workspace group`,
      );
    }
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
  const remapWorkspace = (field: string) => remap(field, maps.workspaces);

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
