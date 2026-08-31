import type {
  CanvasCitationRelation,
  CanvasEdgeRelation,
  CanvasNodeType,
} from "@aurascholar/core";
import type { WorkCitationRelation } from "@aurascholar/db/work-list";

/** Canvas workspace snapshots are stored structurally to avoid a core <-> db cycle. */
export type CanvasListWorkspacesCommandInput = Record<string, never>;

/** Renderer-facing workspace metadata; storage ownership stays in the main process. */
export interface CanvasWorkspaceSummaryDto {
  schemaVersion: number;
  workspaceId: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasWorkspacePointDto {
  x: number;
  y: number;
}

export interface CanvasWorkspaceDimensionsDto {
  width: number;
  height: number;
}

export interface CanvasWorkspaceViewportDto extends CanvasWorkspacePointDto {
  zoom: number;
}

/** Deliberately structural so storage and renderer validation remain separate. */
export interface CanvasWorkspaceNodeDto {
  id: string;
  type: CanvasNodeType;
  position: CanvasWorkspacePointDto;
  dimensions: CanvasWorkspaceDimensionsDto;
  groupId?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  data: unknown;
}

export interface CanvasWorkspaceEdgeStyleDto {
  stroke?: string;
  animated?: boolean;
}

export interface CanvasWorkspaceEdgeDto {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: CanvasEdgeRelation;
  label?: string;
  style?: CanvasWorkspaceEdgeStyleDto;
  createdAt: number;
  updatedAt: number;
}

/** Full renderer-facing snapshot. The main process owns DB-model adaptation. */
export interface CanvasWorkspaceDocumentDto {
  schemaVersion: number;
  workspaceId: string;
  name: string;
  description?: string;
  viewport: CanvasWorkspaceViewportDto;
  nodes: CanvasWorkspaceNodeDto[];
  edges: CanvasWorkspaceEdgeDto[];
  createdAt: number;
  updatedAt: number;
}

export interface CanvasListWorkspacesCommandResult {
  /** Always contains at least the active Library's default workspace. */
  workspaces: CanvasWorkspaceSummaryDto[];
}

export interface CanvasLoadWorkspaceCommandInput {
  workspaceId: string;
}

export interface CanvasLoadWorkspaceCommandResult {
  /** Null represents a missing, deleted, or foreign-library workspace. */
  workspace: CanvasWorkspaceDocumentDto | null;
}

export interface CanvasCreateWorkspaceCommandInput {
  name: string;
}

export interface CanvasCreateWorkspaceCommandResult {
  workspace: CanvasWorkspaceDocumentDto;
}

export interface CanvasRenameWorkspaceCommandInput {
  name: string;
  workspaceId: string;
}

export interface CanvasRenameWorkspaceCommandResult {
  workspace: CanvasWorkspaceDocumentDto;
}

export interface CanvasDeleteWorkspaceCommandInput {
  workspaceId: string;
}

export interface CanvasDeleteWorkspaceCommandResult {
  deleted: boolean;
}

export interface CanvasSaveWorkspaceCommandInput {
  document: CanvasWorkspaceDocumentDto;
}

export interface CanvasSaveWorkspaceCommandResult {
  saved: true;
}

/** A Canvas ingress work is always derived from the active local Library. */
export interface CanvasGetActiveWorkCommandInput {
  workId: string;
}

/** Narrow active-work metadata required to create a Canvas paper node. */
export interface CanvasActiveWork {
  abstract: string | null;
  authorNames: string[];
  doi: string | null;
  id: string;
  reading_status: string;
  title: string;
  venue_name: string | null;
  year: number | null;
}

/**
 * Scoped work context for annotation ingress. `deleted_at` lets the renderer
 * retain its defensive source-integrity check without receiving a full row.
 */
export interface CanvasIngressWork extends CanvasActiveWork {
  deleted_at: number | null;
}

/** Narrow annotation metadata needed to place an annotation-derived node. */
export interface CanvasIngressAnnotation {
  anchor_json: string | null;
  attachment_id: string;
  color: string | null;
  content_md: string | null;
  id: string;
  orphaned: number;
  page_index: number;
  type: string;
  work_id: string;
}

export interface CanvasGetActiveWorkCommandResult {
  work: CanvasActiveWork | null;
}

/**
 * A Canvas annotation ingress source must name both records so the main
 * process can prove the annotation belongs to that active source work.
 */
export interface CanvasGetAnnotationIngressSourceCommandInput {
  annotationId: string;
  workId: string;
}

export interface CanvasAnnotationIngressSource {
  annotation: CanvasIngressAnnotation;
  work: CanvasIngressWork;
}

export interface CanvasGetAnnotationIngressSourceCommandResult {
  source: CanvasAnnotationIngressSource | null;
}

/** Active local citation edges whose endpoints are both among `workIds`. */
export interface CanvasGetCitationRelationsCommandInput {
  workIds: string[];
}

export interface CanvasGetCitationRelationsCommandResult {
  relations: WorkCitationRelation[];
}

/**
 * Remote graph edges normalized to local work ids. The main process checks
 * both endpoints against the active local Library before it persists them.
 */
export interface CanvasPersistCitationRelationsCommandInput {
  relations: CanvasCitationRelation[];
}

export interface CanvasPersistCitationRelationsCommandResult {
  /** Actual INSERT OR IGNORE rows newly persisted by this command. */
  persisted: number;
}

/**
 * Canvas ingress reads and citation operations. The renderer never chooses a
 * Library identity; the main process resolves it from durable local-first
 * state inside its lease or transaction.
 */
export interface CanvasDataCommandMap {
  "canvas.listWorkspaces": {
    input: CanvasListWorkspacesCommandInput;
    output: CanvasListWorkspacesCommandResult;
  };
  "canvas.loadWorkspace": {
    input: CanvasLoadWorkspaceCommandInput;
    output: CanvasLoadWorkspaceCommandResult;
  };
  "canvas.createWorkspace": {
    input: CanvasCreateWorkspaceCommandInput;
    output: CanvasCreateWorkspaceCommandResult;
  };
  "canvas.renameWorkspace": {
    input: CanvasRenameWorkspaceCommandInput;
    output: CanvasRenameWorkspaceCommandResult;
  };
  "canvas.deleteWorkspace": {
    input: CanvasDeleteWorkspaceCommandInput;
    output: CanvasDeleteWorkspaceCommandResult;
  };
  "canvas.saveWorkspace": {
    input: CanvasSaveWorkspaceCommandInput;
    output: CanvasSaveWorkspaceCommandResult;
  };
  "canvas.getActiveWork": {
    input: CanvasGetActiveWorkCommandInput;
    output: CanvasGetActiveWorkCommandResult;
  };
  "canvas.getAnnotationIngressSource": {
    input: CanvasGetAnnotationIngressSourceCommandInput;
    output: CanvasGetAnnotationIngressSourceCommandResult;
  };
  "canvas.getCitationRelations": {
    input: CanvasGetCitationRelationsCommandInput;
    output: CanvasGetCitationRelationsCommandResult;
  };
  "canvas.persistCitationRelations": {
    input: CanvasPersistCitationRelationsCommandInput;
    output: CanvasPersistCitationRelationsCommandResult;
  };
}
