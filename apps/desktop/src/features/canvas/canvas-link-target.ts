import type {
  CanvasNode,
  CanvasNodeType,
  CanvasPoint,
  CanvasWorkspaceDocument,
} from "@aurascholar/core";

export interface CanvasLinkTargetOption {
  description: string;
  distance: number;
  existingEdgeId?: string;
  groupLabel?: string;
  label: string;
  nodeId: string;
  parentGroupId?: string;
  requiresExpand?: boolean;
  type: CanvasNodeType;
}

function compact(value: string, maxLength = 82): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
    : normalized;
}

export function canvasNodeTargetLabel(node: CanvasNode): string {
  switch (node.type) {
    case "paper":
      return compact(node.data.title);
    case "excerpt":
      return compact(node.data.highlightText || `《${node.data.paperTitle}》摘录`);
    case "ai-synth":
      return compact(node.data.title);
    case "idea-note":
      return compact(node.data.title || "未命名研究想法");
    case "group":
      return compact(node.data.title);
  }
}

function canvasNodeTargetDescription(node: CanvasNode): string {
  switch (node.type) {
    case "paper":
      return compact(
        [node.data.authors.slice(0, 2).join("、"), node.data.year?.toString(), node.data.venue]
          .filter(Boolean)
          .join(" · ") || "文献卡片",
      );
    case "excerpt":
      return compact(`《${node.data.paperTitle}》 · 第 ${node.data.pageIndex + 1} 页`);
    case "ai-synth":
      return "AI 合成";
    case "idea-note":
      return compact(node.data.contentMarkdown || "研究想法");
    case "group":
      return "逻辑分组";
  }
}

function absoluteNodePosition(node: CanvasNode, nodes: readonly CanvasNode[]): CanvasPoint {
  if (!node.groupId) return node.position;
  const parent = nodes.find(
    (candidate) => candidate.id === node.groupId && candidate.type === "group",
  );
  return parent
    ? { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y }
    : node.position;
}

function normalizedSearchText(node: CanvasNode, groupLabel: string): string {
  const typeLabel =
    node.type === "paper"
      ? "文献 paper"
      : node.type === "excerpt"
        ? "摘录 excerpt"
        : node.type === "ai-synth"
          ? "ai 合成 synthesis"
          : node.type === "idea-note"
            ? "研究想法 note"
            : "分组 group";
  return [
    canvasNodeTargetLabel(node),
    canvasNodeTargetDescription(node),
    groupLabel,
    node.tags.join(" "),
    typeLabel,
  ]
    .join(" ")
    .toLocaleLowerCase();
}

export function buildCanvasLinkTargetOptions(
  document: CanvasWorkspaceDocument,
  sourceId: string,
  query: string,
  dropPosition: CanvasPoint,
  limit = 8,
): CanvasLinkTargetOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const groups = new Map(
    document.nodes.filter((node) => node.type === "group").map((node) => [node.id, node] as const),
  );
  const safeLimit = Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 8));

  return document.nodes
    .filter((node) => node.id !== sourceId)
    .flatMap((node) => {
      const parentGroup = node.groupId ? groups.get(node.groupId) : undefined;
      const groupLabel = parentGroup?.data.title ?? "";
      const searchText = normalizedSearchText(node, groupLabel);
      if (queryTokens.some((token) => !searchText.includes(token))) return [];
      const position = absoluteNodePosition(node, document.nodes);
      const center = {
        x: position.x + node.dimensions.width / 2,
        y: position.y + node.dimensions.height / 2,
      };
      const existingEdge = document.edges.find(
        (edge) => edge.sourceId === sourceId && edge.targetId === node.id,
      );
      const queryRank = normalizedQuery
        ? canvasNodeTargetLabel(node).toLocaleLowerCase().startsWith(normalizedQuery)
          ? 0
          : 1
        : 0;
      return [
        {
          option: {
            nodeId: node.id,
            type: node.type,
            label: canvasNodeTargetLabel(node),
            description: canvasNodeTargetDescription(node),
            ...(groupLabel ? { groupLabel } : {}),
            ...(parentGroup ? { parentGroupId: parentGroup.id } : {}),
            ...(parentGroup?.data.collapsed ? { requiresExpand: true } : {}),
            ...(existingEdge ? { existingEdgeId: existingEdge.id } : {}),
            distance: Math.hypot(center.x - dropPosition.x, center.y - dropPosition.y),
          } satisfies CanvasLinkTargetOption,
          queryRank,
        },
      ];
    })
    .sort(
      (left, right) =>
        Number(Boolean(left.option.existingEdgeId)) -
          Number(Boolean(right.option.existingEdgeId)) ||
        left.queryRank - right.queryRank ||
        left.option.distance - right.option.distance ||
        left.option.label.localeCompare(right.option.label, "zh-CN"),
    )
    .slice(0, safeLimit)
    .map(({ option }) => option);
}
