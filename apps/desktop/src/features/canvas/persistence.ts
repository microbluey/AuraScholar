import {
  CANVAS_SCHEMA_VERSION,
  type AISynthesisType,
  type CanvasNode,
  type CanvasWorkspaceDocument,
  type ExcerptHighlightColor,
} from "@aurascholar/core";
import {
  CanvasRepo,
  type CanvasWorkspaceSummary,
  type StoredCanvasNode,
  type StoredCanvasWorkspaceDocument,
} from "@aurascholar/db/repos/canvas";
import { getDb } from "../../services/aura-db";
import { isDesktopRuntime } from "../../services/aura-platform";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isPaperData(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.workId === "string" &&
    typeof value.title === "string" &&
    isStringArray(value.authors) &&
    (value.year === null || typeof value.year === "number") &&
    isOptionalString(value.venue) &&
    isOptionalString(value.doi) &&
    isOptionalString(value.abstractSnippet) &&
    typeof value.annotationCount === "number"
  );
}

const HIGHLIGHT_COLORS = new Set<ExcerptHighlightColor>([
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
  "orange",
]);

function isExcerptData(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.workId === "string" &&
    typeof value.paperTitle === "string" &&
    typeof value.highlightText === "string" &&
    typeof value.highlightColor === "string" &&
    HIGHLIGHT_COLORS.has(value.highlightColor as ExcerptHighlightColor) &&
    typeof value.pageIndex === "number" &&
    isOptionalString(value.annotationId) &&
    isOptionalString(value.attachmentId) &&
    isOptionalString(value.marginNote)
  );
}

const SYNTHESIS_TYPES = new Set<AISynthesisType>([
  "methodology_matrix",
  "contradiction_analysis",
  "research_gap",
  "tldr",
]);

function isStructuredTable(value: unknown): boolean {
  if (!isRecord(value) || !isStringArray(value.headers) || !Array.isArray(value.rows)) {
    return false;
  }
  const headers = value.headers;
  const rows = value.rows;
  if (headers.length < 2 || headers.length > 8 || rows.length > 12) {
    return false;
  }
  return rows.every((row) => isStringArray(row) && row.length === headers.length);
}

function isSynthData(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isStringArray(value.sourceNodeIds) &&
    typeof value.synthType === "string" &&
    SYNTHESIS_TYPES.has(value.synthType as AISynthesisType) &&
    typeof value.title === "string" &&
    typeof value.contentMarkdown === "string" &&
    (value.structuredTable === undefined || isStructuredTable(value.structuredTable)) &&
    isOptionalString(value.modelName)
  );
}

function isIdeaData(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOptionalString(value.title) &&
    typeof value.contentMarkdown === "string" &&
    typeof value.hasEquations === "boolean"
  );
}

function isGroupData(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    isOptionalString(value.colorTheme) &&
    (value.collapsed === undefined || typeof value.collapsed === "boolean")
  );
}

function narrowNode(node: StoredCanvasNode): CanvasNode {
  const valid =
    (node.type === "paper" && isPaperData(node.data)) ||
    (node.type === "excerpt" && isExcerptData(node.data)) ||
    (node.type === "ai-synth" && isSynthData(node.data)) ||
    (node.type === "idea-note" && isIdeaData(node.data)) ||
    (node.type === "group" && isGroupData(node.data));
  if (!valid) throw new Error(`画布卡片 ${node.id} 的数据格式不兼容`);
  return node as CanvasNode;
}

function narrowDocument(stored: StoredCanvasWorkspaceDocument): CanvasWorkspaceDocument {
  if (stored.schemaVersion !== CANVAS_SCHEMA_VERSION) {
    throw new Error(`暂不支持画布数据版本 ${stored.schemaVersion}`);
  }
  if (
    typeof stored.workspaceId !== "string" ||
    stored.workspaceId.trim().length === 0 ||
    typeof stored.name !== "string" ||
    stored.name.trim().length === 0
  ) {
    throw new Error("白板数据缺少有效的标识或名称");
  }
  return {
    ...stored,
    schemaVersion: CANVAS_SCHEMA_VERSION,
    nodes: stored.nodes.map(narrowNode),
    edges: stored.edges,
  };
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

function toWorkspaceSummary(document: CanvasWorkspaceDocument): CanvasWorkspaceSummary {
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
  return {
    version: 2,
    activeWorkspaceId: document.workspaceId,
    workspaces: { [document.workspaceId]: document },
  };
}

function readLegacyPreviewWorkspace(): CanvasWorkspaceDocument {
  try {
    const raw = window.localStorage.getItem(CANVAS_STORAGE_KEY);
    if (!raw) return createPreviewWorkspace();
    return narrowDocument(JSON.parse(raw) as StoredCanvasWorkspaceDocument);
  } catch {
    return createPreviewWorkspace();
  }
}

function narrowPreviewEnvelope(value: unknown): PreviewCanvasEnvelope {
  if (!isRecord(value) || value.version !== 2 || !isRecord(value.workspaces)) {
    throw new Error("浏览器白板存储格式不兼容");
  }

  const workspaces: Record<string, CanvasWorkspaceDocument> = {};
  for (const [workspaceId, stored] of Object.entries(value.workspaces)) {
    if (!isRecord(stored)) throw new Error(`白板 ${workspaceId} 的数据格式不兼容`);
    const document = narrowDocument(stored as unknown as StoredCanvasWorkspaceDocument);
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
  const activeWorkspaceId = workspaces[requestedActiveId]
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
export async function listCanvasWorkspaces(): Promise<CanvasWorkspaceSummary[]> {
  if (!isDesktopRuntime()) {
    return Object.values(readPreviewEnvelope().workspaces)
      .sort(workspaceSortNewestFirst)
      .map(toWorkspaceSummary);
  }

  const repo = new CanvasRepo(await getDb());
  const existing = await repo.list();
  if (existing.length > 0) return existing;
  await repo.ensureDefault();
  return repo.list();
}

export async function loadCanvasWorkspace(workspaceId: string): Promise<CanvasWorkspaceDocument> {
  const normalizedId = workspaceId.trim();
  if (!normalizedId) throw new Error("白板标识不能为空");
  if (!isDesktopRuntime()) {
    const stored = readPreviewEnvelope().workspaces[normalizedId];
    if (!stored) throw new Error("白板不存在或已被删除");
    return stored;
  }

  const repo = new CanvasRepo(await getDb());
  const stored = await repo.load(normalizedId);
  if (!stored) throw new Error("白板不存在或已被删除");
  return narrowDocument(stored);
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

  const repo = new CanvasRepo(await getDb());
  const document = narrowDocument(await repo.create(normalizedName));
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
    const existing = envelope.workspaces[normalizedId];
    if (!existing) throw new Error("白板不存在或已被删除");
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

  const repo = new CanvasRepo(await getDb());
  const document = narrowDocument(await repo.rename(normalizedId, normalizedName));
  dispatchCanvasUpdated();
  return document;
}

export async function deleteCanvasWorkspace(workspaceId: string): Promise<boolean> {
  const normalizedId = workspaceId.trim();
  if (!normalizedId) throw new Error("白板标识不能为空");
  if (!isDesktopRuntime()) {
    const envelope = readPreviewEnvelope();
    if (!envelope.workspaces[normalizedId]) return false;
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

  const repo = new CanvasRepo(await getDb());
  const deleted = await repo.deleteWorkspace(normalizedId);
  if (!deleted) return false;
  // repo.deleteWorkspace() has committed at this point. Keep every following
  // synchronization step best-effort so a post-commit failure cannot make the
  // page restore autosave and resurrect the deleted row.
  try {
    const remaining = await repo.list();
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
    if (!envelope.workspaces[normalizedId]) throw new Error("白板不存在或已被删除");
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
  const repo = new CanvasRepo(await getDb());
  await repo.save(document);
  dispatchCanvasUpdated();
}
