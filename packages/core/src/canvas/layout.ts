import type {
  CanvasDimensions,
  CanvasNode,
  CanvasPoint,
  CanvasWorkspaceDocument,
  PaperNode,
} from "./types.js";

export type CanvasLayoutMode = "timeline" | "citation-tree";

export type CanvasLayoutFailure =
  | "collapsed-parent-group"
  | "missing-node"
  | "missing-parent-group"
  | "mixed-node-types"
  | "mixed-parent"
  | "no-citation-edges"
  | "selection-too-small";

export interface CanvasLayoutNodePosition {
  nodeId: string;
  position: CanvasPoint;
}

export interface CanvasLayoutGroupResize {
  dimensions: CanvasDimensions;
  groupId: string;
}

export interface CanvasLayoutSuccessPlan {
  groupResize?: CanvasLayoutGroupResize;
  mode: CanvasLayoutMode;
  nodePositions: readonly CanvasLayoutNodePosition[];
  parentGroupId: string | null;
  status: "success";
  workspaceId: string;
}

export interface CanvasLayoutErrorPlan {
  mode: CanvasLayoutMode;
  reason: CanvasLayoutFailure;
  status: "error";
}

export type CanvasLayoutPlan = CanvasLayoutSuccessPlan | CanvasLayoutErrorPlan;

export const CANVAS_TIMELINE_HORIZONTAL_GAP = 56;
export const CANVAS_TREE_HORIZONTAL_GAP = 88;
export const CANVAS_TREE_VERTICAL_GAP = 40;
export const CANVAS_GROUP_LAYOUT_PADDING = 34;

function errorPlan(mode: CanvasLayoutMode, reason: CanvasLayoutFailure): CanvasLayoutErrorPlan {
  return { status: "error", mode, reason };
}

function normalizedYear(node: PaperNode): number {
  return typeof node.data.year === "number" && Number.isFinite(node.data.year)
    ? node.data.year
    : Number.POSITIVE_INFINITY;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePapers(left: PaperNode, right: PaperNode): number {
  const leftYear = normalizedYear(left);
  const rightYear = normalizedYear(right);
  if (leftYear !== rightYear) return leftYear < rightYear ? -1 : 1;
  const titleDifference = compareText(left.data.title, right.data.title);
  return titleDifference || compareText(left.id, right.id);
}

function compareTreePapers(left: PaperNode, right: PaperNode): number {
  const yDifference = left.position.y - right.position.y;
  if (yDifference !== 0) return yDifference;
  return comparePapers(left, right);
}

function timelinePositions(papers: readonly PaperNode[]): CanvasLayoutNodePosition[] {
  const ordered = [...papers].sort(comparePapers);
  const anchorX = Math.min(...papers.map((node) => node.position.x));
  const anchorY = Math.min(...papers.map((node) => node.position.y));
  let cursorX = anchorX;
  return ordered.map((node) => {
    const update = { nodeId: node.id, position: { x: cursorX, y: anchorY } };
    cursorX += node.dimensions.width + CANVAS_TIMELINE_HORIZONTAL_GAP;
    return update;
  });
}

function stronglyConnectedComponents(
  orderedNodeIds: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): string[][] {
  let nextIndex = 0;
  const indexByNode = new Map<string, number>();
  const lowLinkByNode = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (nodeId: string) => {
    const index = nextIndex;
    nextIndex += 1;
    indexByNode.set(nodeId, index);
    lowLinkByNode.set(nodeId, index);
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const targetId of adjacency.get(nodeId) ?? []) {
      if (!indexByNode.has(targetId)) {
        visit(targetId);
        lowLinkByNode.set(
          nodeId,
          Math.min(lowLinkByNode.get(nodeId)!, lowLinkByNode.get(targetId)!),
        );
      } else if (onStack.has(targetId)) {
        lowLinkByNode.set(nodeId, Math.min(lowLinkByNode.get(nodeId)!, indexByNode.get(targetId)!));
      }
    }

    if (lowLinkByNode.get(nodeId) !== indexByNode.get(nodeId)) return;
    const component: string[] = [];
    while (stack.length) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === nodeId) break;
    }
    components.push(component);
  };

  for (const nodeId of orderedNodeIds) {
    if (!indexByNode.has(nodeId)) visit(nodeId);
  }
  return components;
}

function citationTreePositions(
  document: CanvasWorkspaceDocument,
  papers: readonly PaperNode[],
): CanvasLayoutNodePosition[] | null {
  const paperById = new Map(papers.map((node) => [node.id, node] as const));
  const paperIds = new Set(paperById.keys());
  const citationEdges = document.edges.filter(
    (edge) =>
      edge.relationType === "cites" &&
      edge.sourceId !== edge.targetId &&
      paperIds.has(edge.sourceId) &&
      paperIds.has(edge.targetId),
  );
  if (!citationEdges.length) return null;

  // A cites B is stored as A -> B. The layout graph is deliberately reversed
  // so the cited paper B appears to the left of the citing paper A.
  const adjacencySets = new Map(papers.map((node) => [node.id, new Set<string>()] as const));
  for (const edge of citationEdges) {
    adjacencySets.get(edge.targetId)!.add(edge.sourceId);
  }
  const adjacency = new Map(
    [...adjacencySets].map(([nodeId, targets]) => [
      nodeId,
      [...targets].sort((left, right) =>
        comparePapers(paperById.get(left)!, paperById.get(right)!),
      ),
    ]),
  );
  const orderedNodeIds = [...papers].sort(comparePapers).map((node) => node.id);
  const components = stronglyConnectedComponents(orderedNodeIds, adjacency);
  for (const component of components) {
    component.sort((left, right) => comparePapers(paperById.get(left)!, paperById.get(right)!));
  }

  const componentByNode = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    for (const nodeId of component) componentByNode.set(nodeId, componentIndex);
  });
  const componentEdges = components.map(() => new Set<number>());
  const indegree = components.map(() => 0);
  for (const [sourceId, targets] of adjacency) {
    const sourceComponent = componentByNode.get(sourceId)!;
    for (const targetId of targets) {
      const targetComponent = componentByNode.get(targetId)!;
      if (
        sourceComponent === targetComponent ||
        componentEdges[sourceComponent]!.has(targetComponent)
      ) {
        continue;
      }
      componentEdges[sourceComponent]!.add(targetComponent);
      indegree[targetComponent] = indegree[targetComponent]! + 1;
    }
  }

  const componentKey = (componentIndex: number) => components[componentIndex]![0]!;
  const compareComponents = (left: number, right: number) =>
    comparePapers(paperById.get(componentKey(left))!, paperById.get(componentKey(right))!);
  const queue = components
    .map((_component, componentIndex) => componentIndex)
    .filter((componentIndex) => indegree[componentIndex] === 0)
    .sort(compareComponents);
  const layerByComponent = components.map(() => 0);
  while (queue.length) {
    const componentIndex = queue.shift()!;
    const targets = [...componentEdges[componentIndex]!].sort(compareComponents);
    for (const targetComponent of targets) {
      layerByComponent[targetComponent] = Math.max(
        layerByComponent[targetComponent]!,
        layerByComponent[componentIndex]! + 1,
      );
      indegree[targetComponent] = indegree[targetComponent]! - 1;
      if (indegree[targetComponent] === 0) {
        queue.push(targetComponent);
        queue.sort(compareComponents);
      }
    }
  }

  const columns = new Map<number, PaperNode[]>();
  for (const paper of papers) {
    const layer = layerByComponent[componentByNode.get(paper.id)!]!;
    const column = columns.get(layer) ?? [];
    column.push(paper);
    columns.set(layer, column);
  }
  const anchorX = Math.min(...papers.map((node) => node.position.x));
  const anchorY = Math.min(...papers.map((node) => node.position.y));
  const updates: CanvasLayoutNodePosition[] = [];
  let cursorX = anchorX;
  for (const layer of [...columns.keys()].sort((left, right) => left - right)) {
    const column = columns.get(layer)!.sort(compareTreePapers);
    let cursorY = anchorY;
    let columnWidth = 0;
    for (const node of column) {
      updates.push({ nodeId: node.id, position: { x: cursorX, y: cursorY } });
      cursorY += node.dimensions.height + CANVAS_TREE_VERTICAL_GAP;
      columnWidth = Math.max(columnWidth, node.dimensions.width);
    }
    cursorX += columnWidth + CANVAS_TREE_HORIZONTAL_GAP;
  }
  return updates;
}

function groupResizeForPositions(
  document: CanvasWorkspaceDocument,
  parentGroupId: string | null,
  nodePositions: readonly CanvasLayoutNodePosition[],
): CanvasLayoutGroupResize | undefined {
  if (!parentGroupId) return undefined;
  const group = document.nodes.find((node) => node.id === parentGroupId && node.type === "group");
  if (!group || group.type !== "group") return undefined;
  const positionByNode = new Map(
    nodePositions.map((update) => [update.nodeId, update.position] as const),
  );
  const children = document.nodes.filter((node) => node.groupId === parentGroupId);
  const requiredWidth =
    Math.max(
      0,
      ...children.map((node) => {
        const position = positionByNode.get(node.id) ?? node.position;
        return position.x + node.dimensions.width;
      }),
    ) + CANVAS_GROUP_LAYOUT_PADDING;
  const requiredHeight =
    Math.max(
      0,
      ...children.map((node) => {
        const position = positionByNode.get(node.id) ?? node.position;
        return position.y + node.dimensions.height;
      }),
    ) + CANVAS_GROUP_LAYOUT_PADDING;
  const dimensions = {
    width: Math.max(group.dimensions.width, requiredWidth),
    height: Math.max(group.dimensions.height, requiredHeight),
  };
  return dimensions.width === group.dimensions.width &&
    dimensions.height === group.dimensions.height
    ? undefined
    : { groupId: group.id, dimensions };
}

export function planCanvasLayout(
  document: CanvasWorkspaceDocument,
  selectedNodeIds: ReadonlySet<string>,
  mode: CanvasLayoutMode,
): CanvasLayoutPlan {
  if (selectedNodeIds.size < 2) return errorPlan(mode, "selection-too-small");
  const nodeById = new Map(document.nodes.map((node) => [node.id, node] as const));
  const selectedNodes: CanvasNode[] = [];
  for (const nodeId of selectedNodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) return errorPlan(mode, "missing-node");
    selectedNodes.push(node);
  }
  if (selectedNodes.some((node) => node.type !== "paper")) {
    return errorPlan(mode, "mixed-node-types");
  }
  const papers = selectedNodes as PaperNode[];
  const parentGroupIds = new Set(papers.map((node) => node.groupId ?? null));
  if (parentGroupIds.size !== 1) return errorPlan(mode, "mixed-parent");
  const parentGroupId = parentGroupIds.values().next().value ?? null;
  if (parentGroupId) {
    const parent = nodeById.get(parentGroupId);
    if (!parent || parent.type !== "group") return errorPlan(mode, "missing-parent-group");
    if (parent.data.collapsed === true) return errorPlan(mode, "collapsed-parent-group");
  }

  const nodePositions =
    mode === "timeline" ? timelinePositions(papers) : citationTreePositions(document, papers);
  if (!nodePositions) return errorPlan(mode, "no-citation-edges");
  return {
    status: "success",
    mode,
    workspaceId: document.workspaceId,
    parentGroupId,
    nodePositions,
    groupResize: groupResizeForPositions(document, parentGroupId, nodePositions),
  };
}

export function applyCanvasLayout(
  document: CanvasWorkspaceDocument,
  plan: CanvasLayoutSuccessPlan,
  timestamp = Date.now(),
): CanvasWorkspaceDocument {
  if (document.workspaceId !== plan.workspaceId) return document;
  const nodeById = new Map(document.nodes.map((node) => [node.id, node] as const));
  for (const update of plan.nodePositions) {
    const node = nodeById.get(update.nodeId);
    if (!node || node.type !== "paper" || (node.groupId ?? null) !== plan.parentGroupId) {
      return document;
    }
  }
  if (plan.parentGroupId) {
    const parent = nodeById.get(plan.parentGroupId);
    if (!parent || parent.type !== "group" || parent.data.collapsed === true) return document;
  }

  const positionByNode = new Map(
    plan.nodePositions.map((update) => [update.nodeId, update.position] as const),
  );
  let changed = false;
  const nodes = document.nodes.map((node) => {
    const position = positionByNode.get(node.id);
    if (position && (position.x !== node.position.x || position.y !== node.position.y)) {
      changed = true;
      return { ...node, position: { ...position }, updatedAt: timestamp } as CanvasNode;
    }
    if (plan.groupResize?.groupId === node.id && node.type === "group") {
      const dimensions = {
        width: Math.max(node.dimensions.width, plan.groupResize.dimensions.width),
        height: Math.max(node.dimensions.height, plan.groupResize.dimensions.height),
      };
      if (
        dimensions.width !== node.dimensions.width ||
        dimensions.height !== node.dimensions.height
      ) {
        changed = true;
        return { ...node, dimensions, updatedAt: timestamp };
      }
    }
    return node;
  });
  return changed ? { ...document, nodes, updatedAt: timestamp } : document;
}
