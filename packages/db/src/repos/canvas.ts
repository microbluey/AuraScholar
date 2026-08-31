// Spatial Canvas snapshot persistence. Domain-level discriminated node data
// lives in @aurascholar/core; this package intentionally exposes a structural
// storage contract to avoid a core <-> db dependency cycle.
import type { Database } from "../database.js";
import { newId } from "../ids.js";
import { ResearchProjectsRepo } from "./research-projects.js";
import {
  listBoundedCanvasWorkspaceSummaries,
  loadBoundedCanvasWorkspaceDocument,
} from "./canvas-workspace-read.js";

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
  projectId?: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
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

function stringifyJson(value: unknown, label: string): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("not serializable");
    return serialized;
  } catch {
    throw new Error(`${label} must be JSON-serializable`);
  }
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
  libraryId: string,
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
    const rows = await db.query<{ id: string; library_id: string }>(
      `SELECT id, library_id FROM works WHERE id IN (${placeholders})`,
      chunk,
    );
    for (const row of rows) {
      if (row.library_id !== libraryId) {
        throw new Error(`Canvas node references a work outside library ${libraryId}`);
      }
      existing.add(row.id);
    }
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
      if (node.type === "group") {
        throw new Error(`Canvas group ${node.id} cannot belong to another group`);
      }
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
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    if (!libraryId.trim()) throw new Error("libraryId must be a non-empty string");
  }

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
    const projectId = (await new ResearchProjectsRepo(this.db, this.libraryId).ensureDefault()).id;
    return this.withWriteLock(async () => {
      const legacyDefault = await this.db.query<{ id: string; library_id: string }>(
        `SELECT id, library_id
         FROM canvas_workspaces
         WHERE id = ?
         LIMIT 1`,
        [DEFAULT_CANVAS_WORKSPACE_ID],
      );
      const workspaceId =
        !legacyDefault[0] || legacyDefault[0].library_id === this.libraryId
          ? DEFAULT_CANVAS_WORKSPACE_ID
          : `${DEFAULT_CANVAS_WORKSPACE_ID}:${this.libraryId}`;
      const now = Date.now();
      await this.db.run(
        `INSERT OR IGNORE INTO canvas_workspaces
           (id, library_id, project_id, name, description, schema_version, viewport_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, 1, ?, ?, ?)`,
        [
          workspaceId,
          this.libraryId,
          projectId,
          DEFAULT_CANVAS_WORKSPACE_NAME,
          JSON.stringify({ x: 0, y: 0, zoom: 1 }),
          now,
          now,
        ],
      );
      const workspace = await this.load(workspaceId);
      if (!workspace) throw new Error("Failed to create the default canvas workspace");
      return workspace;
    });
  }

  /** Creates an empty workspace with a generated, globally unique id. */
  async create(
    name: string,
    description?: string,
    projectId?: string,
  ): Promise<StoredCanvasWorkspaceDocument> {
    const trimmedName = name.trim();
    assertNonEmptyString(trimmedName, "Canvas workspace name");
    if (description !== undefined && typeof description !== "string") {
      throw new Error("Canvas workspace description must be a string");
    }
    const resolvedProjectId = await this.resolveActiveProjectId(projectId);

    return this.withWriteLock(() =>
      this.withSavepoint("canvas_create", async () => {
        const workspaceId = newId();
        const now = Date.now();
        await this.db.run(
          `INSERT INTO canvas_workspaces
             (id, library_id, project_id, name, description, schema_version, viewport_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          [
            workspaceId,
            this.libraryId,
            resolvedProjectId,
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
          `SELECT updated_at
           FROM canvas_workspaces
           WHERE id = ? AND library_id = ?
           LIMIT 1`,
          [workspaceId, this.libraryId],
        );
        const existing = rows[0];
        if (!existing) throw new Error(`Canvas workspace ${workspaceId} does not exist`);

        const updatedAt = Math.max(Date.now(), existing.updated_at + 1);
        const changed = await this.db.run(
          `UPDATE canvas_workspaces
           SET name = ?, updated_at = ?
           WHERE id = ? AND library_id = ?`,
          [trimmedName, updatedAt, workspaceId, this.libraryId],
        );
        if (changed === 0) throw new Error(`Canvas workspace ${workspaceId} does not exist`);

        const workspace = await this.load(workspaceId);
        if (!workspace) throw new Error(`Failed to rename canvas workspace ${workspaceId}`);
        return workspace;
      }),
    );
  }

  async list(): Promise<CanvasWorkspaceSummary[]> {
    return listBoundedCanvasWorkspaceSummaries(this.db, this.libraryId);
  }

  async load(workspaceId: string): Promise<StoredCanvasWorkspaceDocument | null> {
    const document = await loadBoundedCanvasWorkspaceDocument(
      this.db,
      this.libraryId,
      workspaceId,
      { edgeRelationSet: canvasEdgeRelationSet, nodeTypeSet: canvasNodeTypeSet },
    );
    if (!document) return null;
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
           CROSS JOIN (
             SELECT COUNT(*) AS total
             FROM canvas_workspaces
             WHERE library_id = ?
           ) AS totals
           WHERE target.id = ? AND target.library_id = ?
           LIMIT 1`,
          [this.libraryId, workspaceId, this.libraryId],
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
        const changed = await this.db.run(
          `DELETE FROM canvas_workspaces WHERE id = ? AND library_id = ?`,
          [workspaceId, this.libraryId],
        );
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
    const fallbackProjectId = await this.resolveActiveProjectId();
    return this.withWriteLock(() =>
      this.withSavepoint("canvas_save", async () => {
        const existingWorkspace = await this.db.query<{ library_id: string; project_id: string }>(
          `SELECT library_id, project_id FROM canvas_workspaces WHERE id = ? LIMIT 1`,
          [document.workspaceId],
        );
        if (existingWorkspace[0] && existingWorkspace[0].library_id !== this.libraryId) {
          throw new Error(`Canvas workspace ${document.workspaceId} belongs to another library`);
        }
        const existingWorkIds = await existingWorkIdsForNodes(
          this.db,
          this.libraryId,
          document.nodes,
        );

        const workspaceChanged = await this.db.run(
          `INSERT INTO canvas_workspaces
             (id, library_id, project_id, name, description, schema_version, viewport_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             description = excluded.description,
             schema_version = excluded.schema_version,
             viewport_json = excluded.viewport_json,
             updated_at = excluded.updated_at
           WHERE canvas_workspaces.library_id = excluded.library_id`,
          [
            document.workspaceId,
            this.libraryId,
            existingWorkspace[0]?.project_id ?? fallbackProjectId,
            document.name,
            document.description ?? null,
            document.schemaVersion,
            stringifyJson(document.viewport, "Canvas viewport"),
            document.createdAt,
            document.updatedAt,
          ],
        );
        if (workspaceChanged === 0) {
          throw new Error(`Canvas workspace ${document.workspaceId} belongs to another library`);
        }

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

  private async resolveActiveProjectId(projectId?: string): Promise<string> {
    const projects = new ResearchProjectsRepo(this.db, this.libraryId);
    if (!projectId) return (await projects.ensureDefault()).id;
    const project = await projects.get(projectId);
    if (!project || project.deleted_at !== null || project.status !== "active") {
      throw new Error(`Research project ${projectId} is missing, removed, or archived`);
    }
    return project.id;
  }

  /** Hard-deletes only the workspace placement and incident canvas edges. */
  async deleteNode(workspaceId: string, nodeId: string): Promise<boolean> {
    return this.withWriteLock(() =>
      this.withSavepoint("canvas_delete_node", async () => {
        const workspace = await this.db.query<{ id: string }>(
          `SELECT id
           FROM canvas_workspaces
           WHERE id = ? AND library_id = ?
           LIMIT 1`,
          [workspaceId, this.libraryId],
        );
        if (!workspace[0]) return false;
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
          await this.db.run(
            `UPDATE canvas_workspaces
             SET updated_at = ?
             WHERE id = ? AND library_id = ?`,
            [now, workspaceId, this.libraryId],
          );
        }
        return changed > 0;
      }),
    );
  }
}
