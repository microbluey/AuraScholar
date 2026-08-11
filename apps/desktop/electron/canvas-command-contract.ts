import type { CanvasCitationRelation } from "@aurascholar/core";
import type { AnnotationRow } from "@aurascholar/db/repos/annotations";
import type {
  CanvasWorkspaceSummary,
  StoredCanvasWorkspaceDocument,
} from "@aurascholar/db/repos/canvas";
import type { WorkWithAuthors } from "@aurascholar/db/repos/works";
import type { WorkCitationRelation } from "@aurascholar/db/work-list";

/** Canvas workspace snapshots are stored structurally to avoid a core <-> db cycle. */
export type CanvasListWorkspacesCommandInput = Record<string, never>;

export interface CanvasListWorkspacesCommandResult {
  /** Always contains at least the active Library's default workspace. */
  workspaces: CanvasWorkspaceSummary[];
}

export interface CanvasLoadWorkspaceCommandInput {
  workspaceId: string;
}

export interface CanvasLoadWorkspaceCommandResult {
  /** Null represents a missing, deleted, or foreign-library workspace. */
  workspace: StoredCanvasWorkspaceDocument | null;
}

export interface CanvasCreateWorkspaceCommandInput {
  name: string;
}

export interface CanvasCreateWorkspaceCommandResult {
  workspace: StoredCanvasWorkspaceDocument;
}

export interface CanvasRenameWorkspaceCommandInput {
  name: string;
  workspaceId: string;
}

export interface CanvasRenameWorkspaceCommandResult {
  workspace: StoredCanvasWorkspaceDocument;
}

export interface CanvasDeleteWorkspaceCommandInput {
  workspaceId: string;
}

export interface CanvasDeleteWorkspaceCommandResult {
  deleted: boolean;
}

export interface CanvasSaveWorkspaceCommandInput {
  document: StoredCanvasWorkspaceDocument;
}

export interface CanvasSaveWorkspaceCommandResult {
  saved: true;
}

/** A Canvas ingress work is always derived from the active local Library. */
export interface CanvasGetActiveWorkCommandInput {
  workId: string;
}

export interface CanvasGetActiveWorkCommandResult {
  work: WorkWithAuthors | null;
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
  annotation: AnnotationRow;
  work: WorkWithAuthors;
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
