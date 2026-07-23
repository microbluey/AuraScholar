// Spatial Canvas snapshot persistence. Domain-level discriminated node data
// lives in @aurascholar/core; this package intentionally exposes a structural
// storage contract to avoid a core <-> db dependency cycle.
import type { Database } from "../database.js";
import { newId } from "../ids.js";

export const DEFAULT_CANVAS_WORKSPACE_ID = "canvas:default";
export const DEFAULT_CANVAS_WORKSPACE_NAME = "研究画布";

export const STORED_CANVAS_NODE_TYPES = [
  "paper",
  "excerpt",
  "ai-synth",
  "idea-note",
  "group",
] as const;

export const STORED_CANVAS_EDGE_RELATIONS = [
  "cites",
  "supports",
  "contradicts",
  "extends",
  "derived-from",
  "custom",
] as const;

export type StoredCanvasNodeType = (typeof STORED_CANVAS_NODE_TYPES)[number];
export type StoredCanvasEdgeRelation = (typeof STORED_CANVAS_EDGE_RELATIONS)[number];

export interface StoredCanvasPoint {
  x: number;
  y: number;
}

export interface StoredCanvasDimensions {
  width: number;
  height: number;
}

export interface StoredCanvasViewport extends StoredCanvasPoint {
  zoom: number;
}

export interface StoredCanvasNode {
  id: string;
  type: StoredCanvasNodeType;
  position: StoredCanvasPoint;
  dimensions: StoredCanvasDimensions;
  groupId?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  /** JSON payload; @aurascholar/core supplies the strict type-specific shape. */
  data: unknown;
}

export interface StoredCanvasEdgeStyle {
  stroke?: string;
  animated?: boolean;
}

export interface StoredCanvasEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: StoredCanvasEdgeRelation;
  label?: string;
  style?: StoredCanvasEdgeStyle;
  createdAt: number;
  updatedAt: number;
}

/** Structurally compatible with core's CanvasWorkspaceDocument. */
export interface StoredCanvasWorkspaceDocument {
  schemaVersion: number;
  workspaceId: string;
  name: string;
  description?: string;
  viewport: StoredCanvasViewport;
  nodes: StoredCanvasNode[];
  edges: StoredCanvasEdge[];
  createdAt: number;
  updatedAt: number;
}

export interface CanvasWorkspaceSummary {
  schemaVersion: number;
  workspaceId: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

interface CanvasWorkspaceRow {
  id: string;
  name: string;
  description: string | null;
  schema_version: number;
  viewport_json: string;
  created_at: number;
  updated_at: number;
}

interface CanvasNodeRow {
  id: string;
  type: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  group_id: string | null;
  tags_json: string;
  data_json: string;
  created_at: number;
  updated_at: number;
}

interface CanvasEdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  label: string | null;
  style_json: string | null;
  created_at: number;
  updated_at: number;
}

const canvasWriteQueues = new WeakMap<Database, Promise<void>>();
const canvasNodeTypeSet = new Set<string>(STORED_CANVAS_NODE_TYPES);
const canvasEdgeRelationSet = new Set<string>(STORED_CANVAS_EDGE_RELATIONS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function assertTimestamp(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be an epoch-millisecond integer`);
  }
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} contains invalid JSON`);
  }
}

function stringifyJson(value: unknown, label: string): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("not serializable");
    return serialized;
  } catch {
    throw new Error(`${label} must be JSON-serializable`);
  }
}

function parseViewport(value: string, workspaceId: string): StoredCanvasViewport {
  const parsed = parseJson(value, `Canvas workspace ${workspaceId} viewport`);
  if (!isRecord(parsed)) throw new Error(`Canvas workspace ${workspaceId} viewport is invalid`);
  assertFiniteNumber(parsed.x, `Canvas workspace ${workspaceId} viewport.x`);
  assertFiniteNumber(parsed.y, `Canvas workspace ${workspaceId} viewport.y`);
  assertFiniteNumber(parsed.zoom, `Canvas workspace ${workspaceId} viewport.zoom`);
  if (parsed.zoom <= 0)
    throw new Error(`Canvas workspace ${workspaceId} viewport.zoom must be > 0`);
  return { x: parsed.x, y: parsed.y, zoom: parsed.zoom };
}

function parseTags(value: string, nodeId: string): string[] {
  const parsed = parseJson(value, `Canvas node ${nodeId} tags`);
  if (!Array.isArray(parsed) || !parsed.every((tag) => typeof tag === "string")) {
    throw new Error(`Canvas node ${nodeId} tags are invalid`);
  }
  return parsed;
}

function parseEdgeStyle(value: string | null, edgeId: string): StoredCanvasEdgeStyle | undefined {
  if (value === null) return undefined;
  const parsed = parseJson(value, `Canvas edge ${edgeId} style`);
  if (!isRecord(parsed)) throw new Error(`Canvas edge ${edgeId} style is invalid`);
  if (parsed.stroke !== undefined && typeof parsed.stroke !== "string") {
    throw new Error(`Canvas edge ${edgeId} style.stroke is invalid`);
  }
  if (parsed.animated !== undefined && typeof parsed.animated !== "boolean") {
    throw new Error(`Canvas edge ${edgeId} style.animated is invalid`);
  }
  return {
    ...(typeof parsed.stroke === "string" ? { stroke: parsed.stroke } : {}),
    ...(typeof parsed.animated === "boolean" ? { animated: parsed.animated } : {}),
  };
}

function workIdForNode(node: StoredCanvasNode): string | null {
  if (node.type !== "paper" && node.type !== "excerpt") return null;
  if (!isRecord(node.data)) throw new Error(`Canvas node ${node.id} data must be an object`);
  const workId = node.data.workId;
  assertNonEmptyString(workId, `Canvas node ${node.id} data.workId`);
  if (workId === node.id) {
    throw new Error(`Canvas node ${node.id} must not reuse its library work id`);
  }
  return workId;
}

async function existingWorkIdsForNodes(
  db: Database,
  nodes: StoredCanvasNode[],
): Promise<Set<string>> {
  const requested = [
    ...new Set(
      nodes
        .map((node) => workIdForNode(node))
        .filter((workId): workId is string => workId !== null),
    ),
  ];
  const existing = new Set<string>();

  // Stay comfortably below SQLite's default host-parameter limit. Missing
  // works are valid here: the node keeps its data_json snapshot, but its
  // optional FK is left NULL so an archived canvas remains saveable.
  for (let offset = 0; offset < requested.length; offset += 500) {
    const chunk = requested.slice(offset, offset + 500);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM works WHERE id IN (${placeholders})`,
      chunk,
    );
    for (const row of rows) existing.add(row.id);
  }

  return existing;
}

function validateDocument(document: StoredCanvasWorkspaceDocument): void {
  if (!Number.isSafeInteger(document.schemaVersion) || document.schemaVersion < 1) {
    throw new Error("Canvas schemaVersion must be a positive integer");
  }
  assertNonEmptyString(document.workspaceId, "Canvas workspaceId");
  assertNonEmptyString(document.name, "Canvas workspace name");
  if (document.description !== undefined && typeof document.description !== "string") {
    throw new Error("Canvas workspace description must be a string");
  }
  assertFiniteNumber(document.viewport.x, "Canvas viewport.x");
  assertFiniteNumber(document.viewport.y, "Canvas viewport.y");
  assertFiniteNumber(document.viewport.zoom, "Canvas viewport.zoom");
  if (document.viewport.zoom <= 0) throw new Error("Canvas viewport.zoom must be > 0");
  assertTimestamp(document.createdAt, "Canvas workspace createdAt");
  assertTimestamp(document.updatedAt, "Canvas workspace updatedAt");

  const nodeIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const node of document.nodes) {
    assertNonEmptyString(node.id, "Canvas node id");
    if (nodeIds.has(node.id)) throw new Error(`Duplicate canvas node id ${node.id}`);
    nodeIds.add(node.id);
    if (!canvasNodeTypeSet.has(node.type))
      throw new Error(`Unsupported canvas node type ${node.type}`);
    if (node.type === "group") groupIds.add(node.id);
    assertFiniteNumber(node.position.x, `Canvas node ${node.id} position.x`);
    assertFiniteNumber(node.position.y, `Canvas node ${node.id} position.y`);
    assertFiniteNumber(node.dimensions.width, `Canvas node ${node.id} dimensions.width`);
    assertFiniteNumber(node.dimensions.height, `Canvas node ${node.id} dimensions.height`);
    if (node.dimensions.width <= 0 || node.dimensions.height <= 0) {
      throw new Error(`Canvas node ${node.id} dimensions must be > 0`);
    }
    if (node.groupId !== undefined) {
      assertNonEmptyString(node.groupId, `Canvas node ${node.id} groupId`);
      if (node.groupId === node.id) throw new Error(`Canvas node ${node.id} cannot group itself`);
    }
    if (!Array.isArray(node.tags) || !node.tags.every((tag) => typeof tag === "string")) {
      throw new Error(`Canvas node ${node.id} tags must be strings`);
    }
    assertTimestamp(node.createdAt, `Canvas node ${node.id} createdAt`);
    assertTimestamp(node.updatedAt, `Canvas node ${node.id} updatedAt`);
    workIdForNode(node);
    stringifyJson(node.data, `Canvas node ${node.id} data`);
  }

  for (const node of document.nodes) {
    if (node.groupId !== undefined && !groupIds.has(node.groupId)) {
      throw new Error(`Canvas node ${node.id} references missing group ${node.groupId}`);
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of document.edges) {
    assertNonEmptyString(edge.id, "Canvas edge id");
    if (edgeIds.has(edge.id)) throw new Error(`Duplicate canvas edge id ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
      throw new Error(`Canvas edge ${edge.id} references a node outside its workspace`);
    }
    if (!canvasEdgeRelationSet.has(edge.relationType)) {
      throw new Error(`Unsupported canvas edge relation ${edge.relationType}`);
    }
    if (edge.label !== undefined && typeof edge.label !== "string") {
      throw new Error(`Canvas edge ${edge.id} label must be a string`);
    }
    if (edge.style !== undefined) stringifyJson(edge.style, `Canvas edge ${edge.id} style`);
    assertTimestamp(edge.createdAt, `Canvas edge ${edge.id} createdAt`);
    assertTimestamp(edge.updatedAt, `Canvas edge ${edge.id} updatedAt`);
  }
}

export class CanvasRepo {
  constructor(private readonly db: Database) {}

  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = canvasWriteQueues.get(this.db) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(fn);
    canvasWriteQueues.set(
      this.db,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private async withSavepoint<T>(prefix: string, fn: () => Promise<T>): Promise<T> {
    const name = `${prefix}_${newId().replace(/-/g, "_")}`;
    await this.db.exec(`SAVEPOINT ${name}`);
    try {
      const result = await fn();
      await this.db.exec(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      try {
        await this.db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
      } finally {
        try {
          await this.db.exec(`RELEASE SAVEPOINT ${name}`);
        } catch {
          // Preserve the original persistence error if SQLite unwound it.
        }
      }
      throw error;
    }
  }

  async ensureDefault(): Promise<StoredCanvasWorkspaceDocument> {
    return this.withWriteLock(async () => {
      const now = Date.now();
      await this.db.run(
        `INSERT OR IGNORE INTO canvas_workspaces
           (id, name, description, schema_version, viewport_json, created_at, updated_at)
         VALUES (?, ?, NULL, 1, ?, ?, ?)`,
        [
          DEFAULT_CANVAS_WORKSPACE_ID,
          DEFAULT_CANVAS_WORKSPACE_NAME,
          JSON.stringify({ x: 0, y: 0, zoom: 1 }),
          now,
          now,
        ],
      );
      const workspace = await this.load(DEFAULT_CANVAS_WORKSPACE_ID);
      if (!workspace) throw new Error("Failed to create the default canvas workspace");
      return workspace;
    });
  }

  /** Creates an empty workspace with a generated, globally unique id. */
  async create(name: string, description?: string): Promise<StoredCanvasWorkspaceDocument> {
    const trimmedName = name.trim();
    assertNonEmptyString(trimmedName, "Canvas workspace name");
    if (description !== undefined && typeof description !== "string") {
      throw new Error("Canvas workspace description must be a string");
    }

    return this.withWriteLock(() =>
      this.withSavepoint("canvas_create", async () => {
        const workspaceId = newId();
        const now = Date.now();
        await this.db.run(
          `INSERT INTO canvas_workspaces
             (id, name, description, schema_version, viewport_json, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?, ?)`,
          [
            workspaceId,
            trimmedName,
            description ?? null,
            JSON.stringify({ x: 0, y: 0, zoom: 1 }),
            now,
            now,
          ],
        );

        const workspace = await this.load(workspaceId);
        if (!workspace) throw new Error(`Failed to create canvas workspace ${workspaceId}`);
        return workspace;
      }),
    );
  }

  /** Renames one workspace without replacing its canvas snapshot. */
  async rename(workspaceId: string, name: string): Promise<StoredCanvasWorkspaceDocument> {
    assertNonEmptyString(workspaceId, "Canvas workspaceId");
    const trimmedName = name.trim();
    assertNonEmptyString(trimmedName, "Canvas workspace name");

    return this.withWriteLock(() =>
      this.withSavepoint("canvas_rename", async () => {
        const rows = await this.db.query<{ updated_at: number }>(
          `SELECT updated_at FROM canvas_workspaces WHERE id = ? LIMIT 1`,
          [workspaceId],
        );
        const existing = rows[0];
        if (!existing) throw new Error(`Canvas workspace ${workspaceId} does not exist`);

        const updatedAt = Math.max(Date.now(), existing.updated_at + 1);
        await this.db.run(`UPDATE canvas_workspaces SET name = ?, updated_at = ? WHERE id = ?`, [
          trimmedName,
          updatedAt,
          workspaceId,
        ]);

        const workspace = await this.load(workspaceId);
        if (!workspace) throw new Error(`Failed to rename canvas workspace ${workspaceId}`);
        return workspace;
      }),
    );
  }

  async list(): Promise<CanvasWorkspaceSummary[]> {
    const rows = await this.db.query<Omit<CanvasWorkspaceRow, "viewport_json">>(
      `SELECT id, name, description, schema_version, created_at, updated_at
       FROM canvas_workspaces
       ORDER BY updated_at DESC, created_at ASC, id ASC`,
    );
    return rows.map((row) => ({
      schemaVersion: row.schema_version,
      workspaceId: row.id,
      name: row.name,
      ...(row.description === null ? {} : { description: row.description }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async load(workspaceId: string): Promise<StoredCanvasWorkspaceDocument | null> {
    const workspaces = await this.db.query<CanvasWorkspaceRow>(
      `SELECT id, name, description, schema_version, viewport_json, created_at, updated_at
       FROM canvas_workspaces WHERE id = ? LIMIT 1`,
      [workspaceId],
    );
    const workspace = workspaces[0];
    if (!workspace) return null;

    const [nodeRows, edgeRows] = await Promise.all([
      this.db.query<CanvasNodeRow>(
        `SELECT id, type, pos_x, pos_y, width, height, group_id, tags_json, data_json,
                created_at, updated_at
         FROM canvas_nodes WHERE workspace_id = ? ORDER BY sort_order, id`,
        [workspaceId],
      ),
      this.db.query<CanvasEdgeRow>(
        `SELECT id, source_id, target_id, relation_type, label, style_json, created_at, updated_at
         FROM canvas_edges WHERE workspace_id = ? ORDER BY sort_order, id`,
        [workspaceId],
      ),
    ]);

    const nodes = nodeRows.map<StoredCanvasNode>((row) => {
      if (!canvasNodeTypeSet.has(row.type))
        throw new Error(`Unsupported canvas node type ${row.type}`);
      return {
        id: row.id,
        type: row.type as StoredCanvasNodeType,
        position: { x: row.pos_x, y: row.pos_y },
        dimensions: { width: row.width, height: row.height },
        ...(row.group_id === null ? {} : { groupId: row.group_id }),
        tags: parseTags(row.tags_json, row.id),
        data: parseJson(row.data_json, `Canvas node ${row.id} data`),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    const edges = edgeRows.map<StoredCanvasEdge>((row) => {
      if (!canvasEdgeRelationSet.has(row.relation_type)) {
        throw new Error(`Unsupported canvas edge relation ${row.relation_type}`);
      }
      const style = parseEdgeStyle(row.style_json, row.id);
      return {
        id: row.id,
        sourceId: row.source_id,
        targetId: row.target_id,
        relationType: row.relation_type as StoredCanvasEdgeRelation,
        ...(row.label === null ? {} : { label: row.label }),
        ...(style === undefined ? {} : { style }),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    const document: StoredCanvasWorkspaceDocument = {
      schemaVersion: workspace.schema_version,
      workspaceId: workspace.id,
      name: workspace.name,
      ...(workspace.description === null ? {} : { description: workspace.description }),
      viewport: parseViewport(workspace.viewport_json, workspace.id),
      nodes,
      edges,
      createdAt: workspace.created_at,
      updatedAt: workspace.updated_at,
    };
    validateDocument(document);
    return document;
  }

  /**
   * Deletes a workspace and its placements, but never library works. At least
   * one workspace must remain so `/canvas` always has a valid destination.
   */
  async deleteWorkspace(workspaceId: string): Promise<boolean> {
    assertNonEmptyString(workspaceId, "Canvas workspaceId");
    return this.withWriteLock(() =>
      this.withSavepoint("canvas_delete_workspace", async () => {
        const rows = await this.db.query<{ id: string; workspace_total: number }>(
          `SELECT target.id, totals.total AS workspace_total
           FROM canvas_workspaces AS target
           CROSS JOIN (SELECT COUNT(*) AS total FROM canvas_workspaces) AS totals
           WHERE target.id = ?
           LIMIT 1`,
          [workspaceId],
        );
        const target = rows[0];
        if (!target) return false;

        // Resolve target existence and the invariant guard from the same
        // transactional snapshot before touching any workspace-owned rows.
        if (target.workspace_total <= 1) {
          throw new Error("Cannot delete the last canvas workspace");
        }

        // Keep this correct for drivers that do not enable foreign-key
        // cascades themselves. The optional canvas_nodes.work_id relation is
        // outbound, so these deletes never mutate works.
        await this.db.run(`DELETE FROM canvas_edges WHERE workspace_id = ?`, [workspaceId]);
        await this.db.run(`DELETE FROM canvas_nodes WHERE workspace_id = ?`, [workspaceId]);
        const changed = await this.db.run(`DELETE FROM canvas_workspaces WHERE id = ?`, [
          workspaceId,
        ]);
        return changed > 0;
      }),
    );
  }

  /**
   * Atomically replaces one workspace snapshot. Deleting a node from the
   * document removes only canvas_nodes/canvas_edges rows; works is never
   * mutated. A failed insert rolls the whole snapshot back to its prior state.
   */
  async save(document: StoredCanvasWorkspaceDocument): Promise<void> {
    validateDocument(document);
    return this.withWriteLock(() =>
      this.withSavepoint("canvas_save", async () => {
        const existingWorkIds = await existingWorkIdsForNodes(this.db, document.nodes);

        await this.db.run(
          `INSERT INTO canvas_workspaces
             (id, name, description, schema_version, viewport_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             description = excluded.description,
             schema_version = excluded.schema_version,
             viewport_json = excluded.viewport_json,
             updated_at = excluded.updated_at`,
          [
            document.workspaceId,
            document.name,
            document.description ?? null,
            document.schemaVersion,
            stringifyJson(document.viewport, "Canvas viewport"),
            document.createdAt,
            document.updatedAt,
          ],
        );

        // Explicit edge deletion keeps this safe even on drivers that do not
        // enable SQLite foreign-key cascades themselves.
        await this.db.run(`DELETE FROM canvas_edges WHERE workspace_id = ?`, [
          document.workspaceId,
        ]);
        await this.db.run(`DELETE FROM canvas_nodes WHERE workspace_id = ?`, [
          document.workspaceId,
        ]);

        for (const [sortOrder, node] of document.nodes.entries()) {
          const referencedWorkId = workIdForNode(node);
          await this.db.run(
            `INSERT INTO canvas_nodes
               (id, workspace_id, work_id, type, pos_x, pos_y, width, height, group_id,
                sort_order, tags_json, data_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              node.id,
              document.workspaceId,
              referencedWorkId !== null && existingWorkIds.has(referencedWorkId)
                ? referencedWorkId
                : null,
              node.type,
              node.position.x,
              node.position.y,
              node.dimensions.width,
              node.dimensions.height,
              node.groupId ?? null,
              sortOrder,
              stringifyJson(node.tags, `Canvas node ${node.id} tags`),
              stringifyJson(node.data, `Canvas node ${node.id} data`),
              node.createdAt,
              node.updatedAt,
            ],
          );
        }

        for (const [sortOrder, edge] of document.edges.entries()) {
          await this.db.run(
            `INSERT INTO canvas_edges
               (id, workspace_id, source_id, target_id, relation_type, label, style_json,
                sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              edge.id,
              document.workspaceId,
              edge.sourceId,
              edge.targetId,
              edge.relationType,
              edge.label ?? null,
              edge.style === undefined
                ? null
                : stringifyJson(edge.style, `Canvas edge ${edge.id} style`),
              sortOrder,
              edge.createdAt,
              edge.updatedAt,
            ],
          );
        }
      }),
    );
  }

  /** Hard-deletes only the workspace placement and incident canvas edges. */
  async deleteNode(workspaceId: string, nodeId: string): Promise<boolean> {
    return this.withWriteLock(() =>
      this.withSavepoint("canvas_delete_node", async () => {
        const now = Date.now();
        await this.db.run(
          `UPDATE canvas_nodes SET group_id = NULL, updated_at = ?
           WHERE workspace_id = ? AND group_id = ?`,
          [now, workspaceId, nodeId],
        );
        await this.db.run(
          `DELETE FROM canvas_edges
           WHERE workspace_id = ? AND (source_id = ? OR target_id = ?)`,
          [workspaceId, nodeId, nodeId],
        );
        const changed = await this.db.run(
          `DELETE FROM canvas_nodes WHERE workspace_id = ? AND id = ?`,
          [workspaceId, nodeId],
        );
        if (changed > 0) {
          await this.db.run(`UPDATE canvas_workspaces SET updated_at = ? WHERE id = ?`, [
            now,
            workspaceId,
          ]);
        }
        return changed > 0;
      }),
    );
  }
}
