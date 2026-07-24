import { normalizeCanvasSynthesisSource, type CanvasSynthesisSource } from "@aurascholar/ai";
import type {
  AISynthNode,
  AISynthNodeData,
  AISynthesisType,
  CanvasNode,
  CanvasWorkspaceDocument,
  ExcerptNode,
  PaperNode,
} from "@aurascholar/core";
import { SYNTHESIS_LABELS } from "./model";

export interface CanvasSynthesisRequest {
  sourceNodes: Array<PaperNode | ExcerptNode>;
  synthType: AISynthesisType;
}

export interface CanvasSynthesisResult extends AISynthNodeData {
  preview: boolean;
}

export interface CanvasSynthesisService {
  synthesize(request: CanvasSynthesisRequest): Promise<Omit<CanvasSynthesisResult, "preview">>;
}

export type CanvasSynthesisSourceType = "paper" | "excerpt";

export type CanvasSynthesisInputSource = CanvasSynthesisSource;

/**
 * Builds the exact source payload sent to the synthesis provider. Keeping this
 * projection shared with the desktop adapter prevents stale-result validation
 * from drifting away from the actual AI input.
 */
export function canvasSynthesisInputSource(
  node: PaperNode | ExcerptNode,
): CanvasSynthesisInputSource {
  if (node.type === "paper") {
    return {
      id: node.id,
      kind: "paper",
      title: node.data.title,
      content:
        node.data.abstractSnippet?.trim() ||
        [node.data.title, node.data.authors.join(", "), node.data.venue, node.data.year]
          .filter(Boolean)
          .join(" · "),
    };
  }
  return {
    id: node.id,
    kind: "excerpt",
    title: `${node.data.paperTitle} · 第 ${node.data.pageIndex + 1} 页`,
    content: [node.data.highlightText, node.data.marginNote].filter(Boolean).join("\n\n"),
  };
}

export function canvasSynthesisSourceFingerprint(node: PaperNode | ExcerptNode): string {
  return JSON.stringify(normalizeCanvasSynthesisSource(canvasSynthesisInputSource(node)));
}

/**
 * Immutable identity and AI-visible content captured when a request starts.
 * The fingerprint excludes canvas-only layout and timestamps.
 */
export interface CanvasSynthesisSourceSnapshot {
  id: string;
  type: CanvasSynthesisSourceType;
  inputFingerprint: string;
}

export interface CompletedCanvasSynthesis {
  /** The request whose result is being committed. */
  requestId: string;
  /** The request that is still authoritative for this canvas UI. */
  activeRequestId: string | null;
  /** Workspace captured when the request started. */
  workspaceId: string;
  /** Exact source identities captured when the request started. */
  sourceSnapshot: readonly CanvasSynthesisSourceSnapshot[];
  /** Completed AI card. Its sourceNodeIds are replaced by sourceSnapshot. */
  completedNode: AISynthNode;
  /** Preallocated ids, in sourceSnapshot order, for provenance edges. */
  provenanceEdgeIds: readonly string[];
}

export type CanvasSynthesisCommitStatus =
  | "applied"
  | "stale-request"
  | "workspace-mismatch"
  | "invalid-source-snapshot"
  | "source-changed"
  | "id-conflict";

export interface CanvasSynthesisCommitResult {
  document: CanvasWorkspaceDocument;
  status: CanvasSynthesisCommitStatus;
}

let injectedSynthesisService: CanvasSynthesisService | null = null;

/** Product integrations can inject the configured AI service without coupling the canvas to a provider. */
export function setCanvasSynthesisService(service: CanvasSynthesisService | null): void {
  injectedSynthesisService = service;
}

function sourceTitle(node: CanvasNode): string {
  if (node.type === "paper" || node.type === "excerpt") {
    return canvasSynthesisInputSource(node).title;
  }
  return "画布来源";
}

async function previewFallback(request: CanvasSynthesisRequest): Promise<CanvasSynthesisResult> {
  await new Promise((resolve) => window.setTimeout(resolve, 520));
  const sourceNames = request.sourceNodes.map(sourceTitle);
  const rows = sourceNames.map((name, index) => [
    `来源 ${index + 1}`,
    name,
    index === 0 ? "作为主要论点" : "用于交叉验证",
  ]);

  return {
    sourceNodeIds: request.sourceNodes.map((node) => node.id),
    synthType: request.synthType,
    title: `${SYNTHESIS_LABELS[request.synthType]} · 预览`,
    contentMarkdown:
      "这是未连接 AI 服务时的界面预览，只展示来源组织方式，不代表真实模型分析结果。配置并注入合成服务后，这张卡片会显示实际输出。",
    structuredTable: {
      headers: ["来源", "材料", "在合成中的角色"],
      rows,
    },
    modelName: "preview-fallback",
    preview: true,
  };
}

export async function synthesizeCanvasSelection(
  request: CanvasSynthesisRequest,
): Promise<CanvasSynthesisResult> {
  if (!injectedSynthesisService) return previewFallback(request);
  const result = await injectedSynthesisService.synthesize(request);
  return { ...result, preview: false };
}

function unchanged(
  document: CanvasWorkspaceDocument,
  status: Exclude<CanvasSynthesisCommitStatus, "applied">,
): CanvasSynthesisCommitResult {
  return { document, status };
}

function validSourceSnapshot(
  sources: readonly CanvasSynthesisSourceSnapshot[],
  provenanceEdgeIds: readonly string[],
): boolean {
  if (sources.length < 2 || sources.length > 10 || provenanceEdgeIds.length !== sources.length) {
    return false;
  }

  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (
      !source ||
      typeof source.id !== "string" ||
      source.id.length === 0 ||
      (source.type !== "paper" && source.type !== "excerpt") ||
      typeof source.inputFingerprint !== "string" ||
      source.inputFingerprint.length === 0 ||
      sourceIds.has(source.id)
    ) {
      return false;
    }
    sourceIds.add(source.id);
  }

  return true;
}

function currentSynthesisPosition(
  sources: readonly (PaperNode | ExcerptNode)[],
  document: CanvasWorkspaceDocument,
): { x: number; y: number } {
  const absolute = sources.map((node) => {
    if (!node.groupId) return node.position;
    const group = document.nodes.find(
      (candidate) => candidate.id === node.groupId && candidate.type === "group",
    );
    return group
      ? { x: group.position.x + node.position.x, y: group.position.y + node.position.y }
      : node.position;
  });
  const averageX = absolute.reduce((sum, position) => sum + position.x, 0) / absolute.length;
  const bottom = Math.max(
    ...absolute.map((position, index) => position.y + sources[index]!.dimensions.height),
  );
  return { x: averageX, y: bottom + 110 };
}

/**
 * Atomically commits an asynchronous AI result when its request, workspace,
 * sources, and generated ids are still valid.
 *
 * Every rejected completion returns the exact input document object. This
 * makes the function safe to call from a state updater without causing an
 * incidental render or a partial node/edge write.
 */
export function applyCompletedCanvasSynthesis(
  document: CanvasWorkspaceDocument,
  completion: CompletedCanvasSynthesis,
): CanvasSynthesisCommitResult {
  if (completion.requestId.length === 0 || completion.activeRequestId !== completion.requestId) {
    return unchanged(document, "stale-request");
  }
  if (completion.workspaceId !== document.workspaceId) {
    return unchanged(document, "workspace-mismatch");
  }
  if (!validSourceSnapshot(completion.sourceSnapshot, completion.provenanceEdgeIds)) {
    return unchanged(document, "invalid-source-snapshot");
  }

  const currentSources: Array<PaperNode | ExcerptNode> = [];
  for (const source of completion.sourceSnapshot) {
    const matchingNodes = document.nodes.filter((node) => node.id === source.id);
    const matchingNode = matchingNodes[0];
    if (
      matchingNodes.length !== 1 ||
      !matchingNode ||
      (matchingNode.type !== "paper" && matchingNode.type !== "excerpt") ||
      matchingNode.type !== source.type ||
      canvasSynthesisSourceFingerprint(matchingNode) !== source.inputFingerprint
    ) {
      return unchanged(document, "source-changed");
    }
    currentSources.push(matchingNode);
  }

  const generatedIds = [completion.completedNode.id, ...completion.provenanceEdgeIds];
  const occupiedIds = new Set([
    ...document.nodes.map((node) => node.id),
    ...document.edges.map((edge) => edge.id),
  ]);
  if (
    completion.completedNode.type !== "ai-synth" ||
    generatedIds.some((id) => typeof id !== "string" || id.length === 0) ||
    new Set(generatedIds).size !== generatedIds.length ||
    generatedIds.some((id) => occupiedIds.has(id))
  ) {
    return unchanged(document, "id-conflict");
  }

  const sourceNodeIds = completion.sourceSnapshot.map((source) => source.id);
  const completedNode: AISynthNode = {
    ...completion.completedNode,
    position: currentSynthesisPosition(currentSources, document),
    data: {
      ...completion.completedNode.data,
      sourceNodeIds,
    },
  };
  const provenanceEdges = completion.sourceSnapshot.map((source, index) => ({
    id: completion.provenanceEdgeIds[index]!,
    sourceId: source.id,
    targetId: completedNode.id,
    relationType: "derived-from" as const,
    label: "合成来源",
    createdAt: completedNode.updatedAt,
    updatedAt: completedNode.updatedAt,
  }));

  return {
    status: "applied",
    document: {
      ...document,
      nodes: [...document.nodes, completedNode],
      edges: [...document.edges, ...provenanceEdges],
      updatedAt: completedNode.updatedAt,
    },
  };
}
