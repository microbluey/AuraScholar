import type { Database } from "../database.js";
import { flattenLegacyCanvasGroups } from "../canvas-legacy-storage.js";
import {
  MAX_CANVAS_EDGE_LABEL_BYTES,
  MAX_CANVAS_EDGE_RELATION_BYTES,
  MAX_CANVAS_EDGE_STYLE_JSON_BYTES,
  MAX_CANVAS_EDGES,
  MAX_CANVAS_JSON_TEXT_BYTES,
  MAX_CANVAS_NODE_TAGS_JSON_BYTES,
  MAX_CANVAS_NODE_TYPE_BYTES,
  MAX_CANVAS_NODES,
  MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
  MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES,
  MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
  MAX_CANVAS_WORKSPACE_LIST_BYTES,
  MAX_CANVAS_WORKSPACE_LIST_ROWS,
  MAX_CANVAS_WORKSPACE_NAME_BYTES,
} from "./canvas-workspace-bounds.js";
import {
  parseCanvasViewport,
  requireCanvasWorkspaceSerializedOutput,
  toStoredCanvasEdge,
  toStoredCanvasNode,
  type CanvasBoundedEdgeRow,
  type CanvasBoundedNodeRow,
} from "./canvas-workspace-read-parse.js";
import type {
  CanvasWorkspaceSummary,
  StoredCanvasWorkspaceDocument,
} from "./canvas.js";

interface CanvasWorkspaceReadValidators {
  edgeRelationSet: ReadonlySet<string>;
  nodeTypeSet: ReadonlySet<string>;
}

interface CanvasWorkspaceSummaryRow {
  created_at: number;
  description: string | null;
  id: string;
  name: string;
  project_id: string;
  schema_version: number;
  updated_at: number;
}

interface CanvasWorkspaceRow extends CanvasWorkspaceSummaryRow {
  viewport_json: string;
}

interface CanvasReadBudget {
  invalid_field_count: number;
  payload_bytes: number;
  row_count: number;
}

/**
 * Lists workspace summaries only after SQLite counts rows and measures every
 * returned text field. This avoids materializing a hostile library-wide list.
 */
export async function listBoundedCanvasWorkspaceSummaries(
  database: Database,
  libraryId: string,
): Promise<CanvasWorkspaceSummary[]> {
  const budget = await readCanvasWorkspaceListBudget(database, libraryId);
  assertCanvasWorkspaceListBudget(budget);

  const rows = await database.query<CanvasWorkspaceSummaryRow>(
    `SELECT id, project_id, name, description, schema_version, created_at, updated_at
     FROM canvas_workspaces
     WHERE library_id = ?
       AND length(CAST(id AS BLOB)) <= ?
       AND length(CAST(project_id AS BLOB)) <= ?
       AND length(CAST(name AS BLOB)) <= ?
       AND (description IS NULL OR length(CAST(description AS BLOB)) <= ?)
     ORDER BY updated_at DESC, created_at ASC, id ASC
     LIMIT ?`,
    [
      libraryId,
      MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
      MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
      MAX_CANVAS_WORKSPACE_NAME_BYTES,
      MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
      MAX_CANVAS_WORKSPACE_LIST_ROWS + 1,
    ],
  );
  if (rows.length > MAX_CANVAS_WORKSPACE_LIST_ROWS) {
    throw new Error(`Canvas workspaces are limited to ${MAX_CANVAS_WORKSPACE_LIST_ROWS}`);
  }
  if (rows.length !== budget.row_count) {
    throw new Error("Canvas workspace list changed during bounded read");
  }
  return requireCanvasWorkspaceSerializedOutput(
    rows.map((row) => ({
      schemaVersion: row.schema_version,
      workspaceId: row.id,
      projectId: row.project_id,
      name: row.name,
      ...(row.description === null ? {} : { description: row.description }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    MAX_CANVAS_WORKSPACE_LIST_BYTES,
    "Canvas workspace list",
  );
}

/**
 * Preflights every stored workspace field in SQLite before retrieving JSON
 * strings or parsing them into renderer-shaped document objects.
 */
export async function loadBoundedCanvasWorkspaceDocument(
  database: Database,
  libraryId: string,
  workspaceId: string,
  validators: CanvasWorkspaceReadValidators,
): Promise<StoredCanvasWorkspaceDocument | null> {
  const workspaceBudget = await readCanvasWorkspaceBudget(database, libraryId, workspaceId);
  if (workspaceBudget.row_count === 0) return null;
  assertCanvasWorkspaceDocumentBudget(workspaceBudget, "metadata");

  const [nodeBudget, edgeBudget] = await Promise.all([
    readCanvasNodeBudget(database, workspaceId),
    readCanvasEdgeBudget(database, workspaceId),
  ]);
  assertCanvasWorkspaceCollectionBudget(nodeBudget, MAX_CANVAS_NODES, "nodes");
  assertCanvasWorkspaceCollectionBudget(edgeBudget, MAX_CANVAS_EDGES, "edges");
  if (
    workspaceBudget.payload_bytes + nodeBudget.payload_bytes + edgeBudget.payload_bytes >
    MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES
  ) {
    throw new Error(
      `Canvas workspace payload is limited to ${MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES} bytes`,
    );
  }

  const workspace = await readBoundedCanvasWorkspaceRow(database, libraryId, workspaceId);
  if (!workspace) throw new Error("Canvas workspace changed during bounded read");

  const [nodeRows, edgeRows] = await Promise.all([
    readBoundedCanvasNodes(database, workspaceId),
    readBoundedCanvasEdges(database, workspaceId),
  ]);
  if (nodeRows.length !== nodeBudget.row_count || edgeRows.length !== edgeBudget.row_count) {
    throw new Error("Canvas workspace changed during bounded read");
  }

  const nodes = flattenLegacyCanvasGroups(
    nodeRows.map((row) => toStoredCanvasNode(row, validators.nodeTypeSet)),
  );
  const edges = edgeRows.map((row) => toStoredCanvasEdge(row, validators.edgeRelationSet));
  return requireCanvasWorkspaceSerializedOutput({
    schemaVersion: workspace.schema_version,
    workspaceId: workspace.id,
    name: workspace.name,
    ...(workspace.description === null ? {} : { description: workspace.description }),
    viewport: parseCanvasViewport(workspace.viewport_json, workspace.id),
    nodes,
    edges,
    createdAt: workspace.created_at,
    updatedAt: workspace.updated_at,
  }, MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES, "Canvas workspace payload");
}

async function readCanvasWorkspaceListBudget(
  database: Database,
  libraryId: string,
): Promise<CanvasReadBudget> {
  return firstBudgetRow(
    await database.query<CanvasReadBudget>(
      `SELECT
         COUNT(*) AS row_count,
         COALESCE(SUM(CASE
           WHEN id IS NULL
             OR project_id IS NULL
             OR name IS NULL
             OR length(CAST(id AS BLOB)) > ?
             OR length(CAST(project_id AS BLOB)) > ?
             OR length(CAST(name AS BLOB)) > ?
             OR (description IS NOT NULL AND length(CAST(description AS BLOB)) > ?)
           THEN 1 ELSE 0
         END), 0) AS invalid_field_count,
         COALESCE(SUM(
           length(CAST(id AS BLOB))
           + length(CAST(project_id AS BLOB))
           + length(CAST(name AS BLOB))
           + COALESCE(length(CAST(description AS BLOB)), 0)
           + 128
         ), 0) AS payload_bytes
       FROM canvas_workspaces
       WHERE library_id = ?`,
      [
        MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
        MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
        MAX_CANVAS_WORKSPACE_NAME_BYTES,
        MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
        libraryId,
      ],
    ),
  );
}

async function readCanvasWorkspaceBudget(
  database: Database,
  libraryId: string,
  workspaceId: string,
): Promise<CanvasReadBudget> {
  return firstBudgetRow(
    await database.query<CanvasReadBudget>(
      `SELECT
         COUNT(*) AS row_count,
         COALESCE(SUM(CASE
           WHEN id IS NULL
             OR project_id IS NULL
             OR name IS NULL
             OR viewport_json IS NULL
             OR length(CAST(id AS BLOB)) > ?
             OR length(CAST(project_id AS BLOB)) > ?
             OR length(CAST(name AS BLOB)) > ?
             OR (description IS NOT NULL AND length(CAST(description AS BLOB)) > ?)
             OR length(CAST(viewport_json AS BLOB)) > ?
           THEN 1 ELSE 0
         END), 0) AS invalid_field_count,
         COALESCE(SUM(
           length(CAST(id AS BLOB))
           + length(CAST(project_id AS BLOB))
           + length(CAST(name AS BLOB))
           + COALESCE(length(CAST(description AS BLOB)), 0)
           + length(CAST(viewport_json AS BLOB))
           + 256
         ), 0) AS payload_bytes
       FROM canvas_workspaces
       WHERE id = ? AND library_id = ?`,
      [
        MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
        MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
        MAX_CANVAS_WORKSPACE_NAME_BYTES,
        MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
        MAX_CANVAS_JSON_TEXT_BYTES,
        workspaceId,
        libraryId,
      ],
    ),
  );
}

async function readCanvasNodeBudget(database: Database, workspaceId: string): Promise<CanvasReadBudget> {
  // MAX_CANVAS_NODE_TAGS and MAX_CANVAS_NODE_TAG_BYTES are composed into the
  // stored JSON cap so SQLite can reject oversized tag JSON before JSON.parse.
  return firstBudgetRow(
    await database.query<CanvasReadBudget>(
      `SELECT
         COUNT(*) AS row_count,
         COALESCE(SUM(CASE
           WHEN id IS NULL
             OR type IS NULL
             OR tags_json IS NULL
             OR data_json IS NULL
             OR length(CAST(id AS BLOB)) > ?
             OR (group_id IS NOT NULL AND length(CAST(group_id AS BLOB)) > ?)
             OR length(CAST(type AS BLOB)) > ?
             OR length(CAST(tags_json AS BLOB)) > ?
             OR length(CAST(data_json AS BLOB)) > ?
           THEN 1 ELSE 0
         END), 0) AS invalid_field_count,
         COALESCE(SUM(
           length(CAST(id AS BLOB))
           + length(CAST(type AS BLOB))
           + COALESCE(length(CAST(group_id AS BLOB)), 0)
           + length(CAST(tags_json AS BLOB))
           + length(CAST(data_json AS BLOB))
           + 256
         ), 0) AS payload_bytes
       FROM canvas_nodes
       WHERE workspace_id = ?`,
      [
        MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
        MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
        MAX_CANVAS_NODE_TYPE_BYTES,
        MAX_CANVAS_NODE_TAGS_JSON_BYTES,
        MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES,
        workspaceId,
      ],
    ),
  );
}

async function readCanvasEdgeBudget(database: Database, workspaceId: string): Promise<CanvasReadBudget> {
  return firstBudgetRow(
    await database.query<CanvasReadBudget>(
      `SELECT
         COUNT(*) AS row_count,
         COALESCE(SUM(CASE
           WHEN id IS NULL
             OR source_id IS NULL
             OR target_id IS NULL
             OR relation_type IS NULL
             OR length(CAST(id AS BLOB)) > ?
             OR length(CAST(source_id AS BLOB)) > ?
             OR length(CAST(target_id AS BLOB)) > ?
             OR length(CAST(relation_type AS BLOB)) > ?
             OR (label IS NOT NULL AND length(CAST(label AS BLOB)) > ?)
             OR (style_json IS NOT NULL AND length(CAST(style_json AS BLOB)) > ?)
           THEN 1 ELSE 0
         END), 0) AS invalid_field_count,
         COALESCE(SUM(
           length(CAST(id AS BLOB))
           + length(CAST(source_id AS BLOB))
           + length(CAST(target_id AS BLOB))
           + length(CAST(relation_type AS BLOB))
           + COALESCE(length(CAST(label AS BLOB)), 0)
           + COALESCE(length(CAST(style_json AS BLOB)), 0)
           + 192
         ), 0) AS payload_bytes
       FROM canvas_edges
       WHERE workspace_id = ?`,
      [
        MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
        MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
        MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
        MAX_CANVAS_EDGE_RELATION_BYTES,
        MAX_CANVAS_EDGE_LABEL_BYTES,
        MAX_CANVAS_EDGE_STYLE_JSON_BYTES,
        workspaceId,
      ],
    ),
  );
}

async function readBoundedCanvasWorkspaceRow(
  database: Database,
  libraryId: string,
  workspaceId: string,
): Promise<CanvasWorkspaceRow | null> {
  const rows = await database.query<CanvasWorkspaceRow>(
    `SELECT id, project_id, name, description, schema_version, viewport_json, created_at, updated_at
     FROM canvas_workspaces
     WHERE id = ?
       AND library_id = ?
       AND length(CAST(id AS BLOB)) <= ?
       AND length(CAST(project_id AS BLOB)) <= ?
       AND length(CAST(name AS BLOB)) <= ?
       AND (description IS NULL OR length(CAST(description AS BLOB)) <= ?)
       AND length(CAST(viewport_json AS BLOB)) <= ?
     LIMIT 1`,
    [
      workspaceId,
      libraryId,
      MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
      MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
      MAX_CANVAS_WORKSPACE_NAME_BYTES,
      MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
      MAX_CANVAS_JSON_TEXT_BYTES,
    ],
  );
  return rows[0] ?? null;
}

async function readBoundedCanvasNodes(
  database: Database,
  workspaceId: string,
): Promise<CanvasBoundedNodeRow[]> {
  const rows = await database.query<CanvasBoundedNodeRow>(
    `SELECT id, type, pos_x, pos_y, width, height, group_id, tags_json, data_json,
            created_at, updated_at
     FROM canvas_nodes
     WHERE workspace_id = ?
       AND length(CAST(id AS BLOB)) <= ?
       AND (group_id IS NULL OR length(CAST(group_id AS BLOB)) <= ?)
       AND length(CAST(type AS BLOB)) <= ?
       AND length(CAST(tags_json AS BLOB)) <= ?
       AND length(CAST(data_json AS BLOB)) <= ?
     ORDER BY sort_order, id
     LIMIT ?`,
    [
      workspaceId,
      MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
      MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
      MAX_CANVAS_NODE_TYPE_BYTES,
      MAX_CANVAS_NODE_TAGS_JSON_BYTES,
      MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES,
      MAX_CANVAS_NODES + 1,
    ],
  );
  if (rows.length > MAX_CANVAS_NODES) {
    throw new Error(`Canvas nodes are limited to ${MAX_CANVAS_NODES}`);
  }
  return rows;
}

async function readBoundedCanvasEdges(
  database: Database,
  workspaceId: string,
): Promise<CanvasBoundedEdgeRow[]> {
  const rows = await database.query<CanvasBoundedEdgeRow>(
    `SELECT id, source_id, target_id, relation_type, label, style_json, created_at, updated_at
     FROM canvas_edges
     WHERE workspace_id = ?
       AND length(CAST(id AS BLOB)) <= ?
       AND length(CAST(source_id AS BLOB)) <= ?
       AND length(CAST(target_id AS BLOB)) <= ?
       AND length(CAST(relation_type AS BLOB)) <= ?
       AND (label IS NULL OR length(CAST(label AS BLOB)) <= ?)
       AND (style_json IS NULL OR length(CAST(style_json AS BLOB)) <= ?)
     ORDER BY sort_order, id
     LIMIT ?`,
    [
      workspaceId,
      MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
      MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
      MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
      MAX_CANVAS_EDGE_RELATION_BYTES,
      MAX_CANVAS_EDGE_LABEL_BYTES,
      MAX_CANVAS_EDGE_STYLE_JSON_BYTES,
      MAX_CANVAS_EDGES + 1,
    ],
  );
  if (rows.length > MAX_CANVAS_EDGES) {
    throw new Error(`Canvas edges are limited to ${MAX_CANVAS_EDGES}`);
  }
  return rows;
}

function firstBudgetRow(rows: CanvasReadBudget[]): CanvasReadBudget {
  return rows[0] ?? { invalid_field_count: 0, payload_bytes: 0, row_count: 0 };
}

function assertCanvasWorkspaceListBudget(budget: CanvasReadBudget): void {
  if (budget.row_count > MAX_CANVAS_WORKSPACE_LIST_ROWS) {
    throw new Error(`Canvas workspaces are limited to ${MAX_CANVAS_WORKSPACE_LIST_ROWS}`);
  }
  if (budget.invalid_field_count > 0) {
    throw new Error("Canvas workspace list contains fields exceeding read bounds");
  }
  if (budget.payload_bytes > MAX_CANVAS_WORKSPACE_LIST_BYTES) {
    throw new Error(`Canvas workspace list is limited to ${MAX_CANVAS_WORKSPACE_LIST_BYTES} bytes`);
  }
}

function assertCanvasWorkspaceDocumentBudget(budget: CanvasReadBudget, label: string): void {
  if (budget.invalid_field_count > 0) {
    throw new Error(`Canvas workspace ${label} contains fields exceeding read bounds`);
  }
  if (budget.payload_bytes > MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES) {
    throw new Error(
      `Canvas workspace payload is limited to ${MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES} bytes`,
    );
  }
}

function assertCanvasWorkspaceCollectionBudget(
  budget: CanvasReadBudget,
  maximumRows: number,
  label: string,
): void {
  if (budget.row_count > maximumRows) {
    throw new Error(`Canvas ${label} are limited to ${maximumRows}`);
  }
  if (budget.invalid_field_count > 0) {
    throw new Error(`Canvas workspace ${label} contain fields exceeding read bounds`);
  }
}
