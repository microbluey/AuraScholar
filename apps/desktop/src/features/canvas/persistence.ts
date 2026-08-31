import {
  CANVAS_SCHEMA_VERSION,
  type CanvasNode,
  type CanvasWorkspaceDocument,
} from "@aurascholar/core";
import type {
  CanvasWorkspaceNodeDto,
  CanvasWorkspaceSummaryDto,
} from "../../../electron/data-command-contract";
import { isDesktopRuntime } from "../../services/aura-platform";
import {
  createCanvasWorkspaceData,
  deleteCanvasWorkspaceData,
  listCanvasWorkspaceData,
  loadCanvasWorkspaceData,
  renameCanvasWorkspaceData,
  saveCanvasWorkspaceData,
} from "../../services/canvas-workspace-data";
import {
  decodeCanvasWorkspaceCreateResult,
  decodeCanvasWorkspaceDeleteResult,
  decodeCanvasWorkspaceLoadResult,
  decodeCanvasWorkspaceRenameResult,
  decodeCanvasWorkspaceSaveResult,
} from "../../shared/canvas-workspace-command-result-codec";
import { decodeCanvasWorkspaceDocument } from "../../shared/canvas-workspace-document-codec";
import { decodeCanvasWorkspaceListResult } from "../../shared/canvas-workspace-summary-codec";
import {
  CANVAS_LAST_WORKSPACE_ID_KEY,
  CANVAS_STORAGE_KEY,
  CANVAS_STORAGE_V2_KEY,
  createCanvasId,
  createPreviewWorkspace,
} from "./model";

interface PreviewCanvasEnvelope {
  activeWorkspaceId: string;
  version: 2;
  workspaces: Record<string, CanvasWorkspaceDocument>;
}

function createPreviewWorkspaceMap(): Record<string, CanvasWorkspaceDocument> {
  return Object.create(null) as Record<string, CanvasWorkspaceDocument>;
}

function hasPreviewWorkspace(
  workspaces: Record<string, CanvasWorkspaceDocument>,
  workspaceId: string,
): boolean {
  return Object.hasOwn(workspaces, workspaceId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function narrowNode(node: CanvasWorkspaceNodeDto): CanvasNode {
  return node as CanvasNode;
}

function narrowDocument(stored: unknown): CanvasWorkspaceDocument {
  try {
    return documentFromDecoded(decodeCanvasWorkspaceDocument(stored));
  } catch (error) {
    throw new Error(`白板数据格式不兼容：${error instanceof Error ? error.message : "未知错误"}`, {
      cause: error,
    });
  }
}

function documentFromDecoded(
  decoded: ReturnType<typeof decodeCanvasWorkspaceDocument>,
): CanvasWorkspaceDocument {
  return {
    ...decoded,
    schemaVersion: CANVAS_SCHEMA_VERSION,
    nodes: decoded.nodes.map(narrowNode),
    edges: decoded.edges,
  };
}

function narrowWorkspaceCommandResult<T>(stored: unknown, decoder: (value: unknown) => T): T {
  try {
    return decoder(stored);
  } catch (error) {
    throw new Error(
      `白板响应数据格式不兼容：${error instanceof Error ? error.message : "未知错误"}`,
      { cause: error },
    );
  }
}

function requireRequestedWorkspace(
  workspace: CanvasWorkspaceDocument,
  requestedWorkspaceId: string,
): CanvasWorkspaceDocument {
  if (workspace.workspaceId !== requestedWorkspaceId) {
    throw new Error("白板响应数据格式不兼容：返回的白板标识与请求不一致");
  }
  return workspace;
}

async function resolveDesktopDeleteOutcome(workspaceId: string): Promise<boolean> {
  const response = await deleteCanvasWorkspaceData({ workspaceId });
  try {
    return decodeCanvasWorkspaceDeleteResult(response).deleted;
  } catch {
    try {
      const workspaces = await listCanvasWorkspaces();
      return !workspaces.some((workspace) => workspace.workspaceId === workspaceId);
    } catch {
      // The delete command resolved after its transaction may have committed,
      // but its acknowledgment cannot prove the outcome. Favor retirement so
      // callers never resume autosave and resurrect a possibly deleted row.
      return true;
    }
  }
}

function narrowWorkspaceSummaries(stored: unknown): CanvasWorkspaceSummaryDto[] {
  try {
    return decodeCanvasWorkspaceListResult(stored).workspaces;
  } catch (error) {
    throw new Error(
      `白板列表数据格式不兼容：${error instanceof Error ? error.message : "未知错误"}`,
      { cause: error },
    );
  }
}

function normalizeWorkspaceName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error("白板名称不能为空");
  return normalized;
}

function createEmptyPreviewWorkspace(name: string): CanvasWorkspaceDocument {
  const now = Date.now();
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    workspaceId: `canvas:${createCanvasId()}`,
    name: normalizeWorkspaceName(name),
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
}

function toWorkspaceSummary(document: CanvasWorkspaceDocument): CanvasWorkspaceSummaryDto {
  return {
    schemaVersion: document.schemaVersion,
    workspaceId: document.workspaceId,
    name: document.name,
    ...(document.description === undefined ? {} : { description: document.description }),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function workspaceSortNewestFirst(
  left: CanvasWorkspaceDocument,
  right: CanvasWorkspaceDocument,
): number {
  return (
    right.updatedAt - left.updatedAt ||
    left.createdAt - right.createdAt ||
    left.workspaceId.localeCompare(right.workspaceId)
  );
}

function persistPreviewEnvelope(envelope: PreviewCanvasEnvelope): void {
  window.localStorage.setItem(CANVAS_STORAGE_V2_KEY, JSON.stringify(envelope));
}

function envelopeForWorkspace(document: CanvasWorkspaceDocument): PreviewCanvasEnvelope {
  const workspaces = createPreviewWorkspaceMap();
  workspaces[document.workspaceId] = document;
  return {
    version: 2,
    activeWorkspaceId: document.workspaceId,
    workspaces,
  };
}

function readLegacyPreviewWorkspace(): CanvasWorkspaceDocument {
  try {
    const raw = window.localStorage.getItem(CANVAS_STORAGE_KEY);
    if (!raw) return createPreviewWorkspace();
    return narrowDocument(JSON.parse(raw));
  } catch {
    return createPreviewWorkspace();
  }
}

function narrowPreviewEnvelope(value: unknown): PreviewCanvasEnvelope {
  if (!isRecord(value) || value.version !== 2 || !isRecord(value.workspaces)) {
    throw new Error("浏览器白板存储格式不兼容");
  }

  const workspaces = createPreviewWorkspaceMap();
  for (const [workspaceId, stored] of Object.entries(value.workspaces)) {
    if (!isRecord(stored)) throw new Error(`白板 ${workspaceId} 的数据格式不兼容`);
    const document = narrowDocument(stored);
    if (document.workspaceId !== workspaceId) {
      throw new Error(`白板 ${workspaceId} 的存储标识不一致`);
    }
    workspaces[workspaceId] = document;
  }

  const documents = Object.values(workspaces).sort(workspaceSortNewestFirst);
  if (documents.length === 0) throw new Error("浏览器白板存储不能为空");
  const fallbackWorkspace = documents[0];
  if (!fallbackWorkspace) throw new Error("浏览器白板存储不能为空");
  const requestedActiveId =
    typeof value.activeWorkspaceId === "string" ? value.activeWorkspaceId : "";
  const activeWorkspaceId = hasPreviewWorkspace(workspaces, requestedActiveId)
    ? requestedActiveId
    : fallbackWorkspace.workspaceId;
  return { version: 2, activeWorkspaceId, workspaces };
}

function readPreviewEnvelope(): PreviewCanvasEnvelope {
  const raw = window.localStorage.getItem(CANVAS_STORAGE_V2_KEY);
  if (raw) {
    try {
      const envelope = narrowPreviewEnvelope(JSON.parse(raw) as unknown);
      // Persist repairs such as a stale active workspace id.
      persistPreviewEnvelope(envelope);
      return envelope;
    } catch (error) {
      throw new Error(
        `浏览器白板数据无法读取：${error instanceof Error ? error.message : "存储格式已损坏"}`,
        { cause: error },
      );
    }
  }

  const envelope = envelopeForWorkspace(readLegacyPreviewWorkspace());
  persistPreviewEnvelope(envelope);
  return envelope;
}

function dispatchCanvasUpdated(): void {
  window.dispatchEvent(new Event("aurascholar:canvas-updated"));
}

/** Lists every workspace and guarantees at least one workspace exists. */
export async function listCanvasWorkspaces(): Promise<CanvasWorkspaceSummaryDto[]> {
  if (!isDesktopRuntime()) {
    return Object.values(readPreviewEnvelope().workspaces)
      .sort(workspaceSortNewestFirst)
      .map(toWorkspaceSummary);
  }

  return narrowWorkspaceSummaries(await listCanvasWorkspaceData());
}

export async function loadCanvasWorkspace(workspaceId: string): Promise<CanvasWorkspaceDocument> {
  const normalizedId = workspaceId.trim();
  if (!normalizedId) throw new Error("白板标识不能为空");
  if (!isDesktopRuntime()) {
    const workspaces = readPreviewEnvelope().workspaces;
    if (!hasPreviewWorkspace(workspaces, normalizedId)) {
      throw new Error("白板不存在或已被删除");
    }
    return workspaces[normalizedId]!;
  }

  const { workspace: stored } = narrowWorkspaceCommandResult(
    await loadCanvasWorkspaceData({ workspaceId: normalizedId }),
    decodeCanvasWorkspaceLoadResult,
  );
  if (!stored) throw new Error("白板不存在或已被删除");
  return requireRequestedWorkspace(documentFromDecoded(stored), normalizedId);
}

export async function createCanvasWorkspace(name: string): Promise<CanvasWorkspaceDocument> {
  const normalizedName = normalizeWorkspaceName(name);
  if (!isDesktopRuntime()) {
    const envelope = readPreviewEnvelope();
    const document = createEmptyPreviewWorkspace(normalizedName);
    envelope.workspaces[document.workspaceId] = document;
    envelope.activeWorkspaceId = document.workspaceId;
    persistPreviewEnvelope(envelope);
    window.localStorage.setItem(CANVAS_LAST_WORKSPACE_ID_KEY, document.workspaceId);
    dispatchCanvasUpdated();
    return document;
  }

  const { workspace } = narrowWorkspaceCommandResult(
    await createCanvasWorkspaceData({ name: normalizedName }),
    decodeCanvasWorkspaceCreateResult,
  );
  const document = documentFromDecoded(workspace);
  rememberLastCanvasWorkspaceId(document.workspaceId);
  dispatchCanvasUpdated();
  return document;
}

export async function renameCanvasWorkspace(
  workspaceId: string,
  name: string,
): Promise<CanvasWorkspaceDocument> {
  const normalizedId = workspaceId.trim();
  if (!normalizedId) throw new Error("白板标识不能为空");
  const normalizedName = normalizeWorkspaceName(name);
  if (!isDesktopRuntime()) {
    const envelope = readPreviewEnvelope();
    if (!hasPreviewWorkspace(envelope.workspaces, normalizedId)) {
      throw new Error("白板不存在或已被删除");
    }
    const existing = envelope.workspaces[normalizedId]!;
    const document: CanvasWorkspaceDocument = {
      ...existing,
      name: normalizedName,
      updatedAt: Date.now(),
    };
    envelope.workspaces[normalizedId] = document;
    persistPreviewEnvelope(envelope);
    dispatchCanvasUpdated();
    return document;
  }

  const { workspace } = narrowWorkspaceCommandResult(
    await renameCanvasWorkspaceData({
      name: normalizedName,
      workspaceId: normalizedId,
    }),
    decodeCanvasWorkspaceRenameResult,
  );
  const document = requireRequestedWorkspace(documentFromDecoded(workspace), normalizedId);
  dispatchCanvasUpdated();
  return document;
}

export async function deleteCanvasWorkspace(workspaceId: string): Promise<boolean> {
  const normalizedId = workspaceId.trim();
  if (!normalizedId) throw new Error("白板标识不能为空");
  if (!isDesktopRuntime()) {
    const envelope = readPreviewEnvelope();
    if (!hasPreviewWorkspace(envelope.workspaces, normalizedId)) return false;
    if (Object.keys(envelope.workspaces).length <= 1) {
      throw new Error("至少需要保留一个白板");
    }
    delete envelope.workspaces[normalizedId];
    if (envelope.activeWorkspaceId === normalizedId) {
      const nextWorkspace = Object.values(envelope.workspaces).sort(workspaceSortNewestFirst)[0];
      if (!nextWorkspace) throw new Error("至少需要保留一个白板");
      envelope.activeWorkspaceId = nextWorkspace.workspaceId;
    }
    persistPreviewEnvelope(envelope);
    // The envelope write above is the deletion commit point. Auxiliary state
    // must never turn a committed deletion into a rejected promise: callers
    // would otherwise resume autosave and recreate the workspace via UPSERT.
    try {
      window.localStorage.setItem(CANVAS_LAST_WORKSPACE_ID_KEY, envelope.activeWorkspaceId);
    } catch {
      // The envelope already contains the authoritative active workspace.
    }
    try {
      dispatchCanvasUpdated();
    } catch {
      // Event delivery is best-effort after the committed storage write.
    }
    return true;
  }

  const deleted = await resolveDesktopDeleteOutcome(normalizedId);
  if (!deleted) return false;
  // The main-process delete command has committed at this point. Keep every following
  // synchronization step best-effort so a post-commit failure cannot make the
  // page restore autosave and resurrect the deleted row.
  try {
    const remaining = await listCanvasWorkspaces();
    const remembered = readLastCanvasWorkspaceId();
    if (remembered === normalizedId && remaining[0]) {
      rememberLastCanvasWorkspaceId(remaining[0].workspaceId);
    }
  } catch {
    // The route-level workspace refresh supplies the same fallback later.
  }
  try {
    dispatchCanvasUpdated();
  } catch {
    // Event delivery is best-effort after the database transaction commits.
  }
  return true;
}

/** Synchronously reads the last active workspace from renderer-local storage. */
export function readLastCanvasWorkspaceId(): string | null {
  try {
    if (!isDesktopRuntime()) return readPreviewEnvelope().activeWorkspaceId;
    const stored = window.localStorage.getItem(CANVAS_LAST_WORKSPACE_ID_KEY)?.trim();
    return stored || null;
  } catch {
    return null;
  }
}

export function rememberLastCanvasWorkspaceId(workspaceId: string): void {
  const normalizedId = workspaceId.trim();
  if (!normalizedId) throw new Error("白板标识不能为空");
  if (!isDesktopRuntime()) {
    const envelope = readPreviewEnvelope();
    if (!hasPreviewWorkspace(envelope.workspaces, normalizedId)) {
      throw new Error("白板不存在或已被删除");
    }
    envelope.activeWorkspaceId = normalizedId;
    persistPreviewEnvelope(envelope);
  }
  window.localStorage.setItem(CANVAS_LAST_WORKSPACE_ID_KEY, normalizedId);
}

export async function saveCanvasWorkspace(document: CanvasWorkspaceDocument): Promise<void> {
  if (!isDesktopRuntime()) {
    const validDocument = narrowDocument(document);
    const envelope = readPreviewEnvelope();
    envelope.workspaces[validDocument.workspaceId] = validDocument;
    persistPreviewEnvelope(envelope);
    dispatchCanvasUpdated();
    return;
  }
  narrowWorkspaceCommandResult(
    await saveCanvasWorkspaceData({ document }),
    decodeCanvasWorkspaceSaveResult,
  );
  dispatchCanvasUpdated();
}
