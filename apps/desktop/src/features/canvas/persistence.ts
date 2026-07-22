import {
  CANVAS_SCHEMA_VERSION,
  type AISynthesisType,
  type CanvasNode,
  type CanvasWorkspaceDocument,
  type ExcerptHighlightColor,
} from "@aurascholar/core";
import {
  CanvasRepo,
  type StoredCanvasNode,
  type StoredCanvasWorkspaceDocument,
} from "@aurascholar/db/repos/canvas";
import { getDb } from "../../services/aura-db";
import { isDesktopRuntime } from "../../services/aura-platform";
import { CANVAS_STORAGE_KEY, createPreviewWorkspace } from "./model";

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
  return {
    ...stored,
    schemaVersion: CANVAS_SCHEMA_VERSION,
    nodes: stored.nodes.map(narrowNode),
    edges: stored.edges,
  };
}

function readPreviewWorkspace(): CanvasWorkspaceDocument {
  try {
    const raw = window.localStorage.getItem(CANVAS_STORAGE_KEY);
    if (!raw) return createPreviewWorkspace();
    return narrowDocument(JSON.parse(raw) as StoredCanvasWorkspaceDocument);
  } catch {
    return createPreviewWorkspace();
  }
}

export async function loadCanvasWorkspace(): Promise<CanvasWorkspaceDocument> {
  if (!isDesktopRuntime()) return readPreviewWorkspace();
  const repo = new CanvasRepo(await getDb());
  const stored = await repo.ensureDefault();
  return narrowDocument(stored);
}

export async function saveCanvasWorkspace(document: CanvasWorkspaceDocument): Promise<void> {
  if (!isDesktopRuntime()) {
    window.localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(document));
    return;
  }
  const repo = new CanvasRepo(await getDb());
  await repo.save(document);
  window.dispatchEvent(new Event("aurascholar:canvas-updated"));
}
