import type {
  CanvasDimensions,
  CanvasNode,
  CanvasNodeType,
  CanvasPoint,
  CanvasWorkspaceDocument,
  PaperNode,
} from "./types.js";

export type CanvasLayoutMode = "compact-grid" | "timeline" | "citation-tree";

/**
 * A transient Library citation used only to plan a citation-tree layout.
 * These relations are keyed by Library work ids and are never persisted as
 * visible Canvas edges.
 */
export interface CanvasCitationRelation {
  citingWorkId: string;
  citedWorkId: string;
}

export type CanvasLayoutFailure =
  | "collapsed-parent-group"
  | "missing-node"
  | "missing-parent-group"
  | "mixed-node-types"
  | "mixed-parent"
  | "no-citation-edges"
  | "selection-too-small";

export interface CanvasLayoutNodePosition {
  expectedDimensions: CanvasDimensions;
  expectedNodeType: CanvasNodeType;
  expectedParentGroupId: string | null;
  expectedPosition: CanvasPoint;
  expectedUpdatedAt: number;
  nodeId: string;
  position: CanvasPoint;
}

export interface CanvasLayoutGroupResize {
  dimensions: CanvasDimensions;
  expectedDimensions: CanvasDimensions;
  expectedUpdatedAt: number;
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
export const CANVAS_COMPACT_GRID_HORIZONTAL_GAP = 48;
export const CANVAS_COMPACT_GRID_VERTICAL_GAP = 36;
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

function layoutPosition(node: CanvasNode, position: CanvasPoint): CanvasLayoutNodePosition {
  return {
    nodeId: node.id,
    expectedDimensions: { ...node.dimensions },
    expectedNodeType: node.type,
    expectedParentGroupId: node.groupId ?? null,
    expectedPosition: { ...node.position },
    expectedUpdatedAt: node.updatedAt,
    position,
  };
}

function compareCanvasX(left: CanvasNode, right: CanvasNode): number {
  const xDifference = left.position.x - right.position.x;
  if (xDifference !== 0) return xDifference;
  const yDifference = left.position.y - right.position.y;
  if (yDifference !== 0) return yDifference;
  return compareText(left.id, right.id);
}

function sharesVisualRow(anchor: CanvasNode, candidate: CanvasNode): boolean {
  const anchorCenter = anchor.position.y + anchor.dimensions.height / 2;
  const candidateCenter = candidate.position.y + candidate.dimensions.height / 2;
  const shorterHeight = Math.min(anchor.dimensions.height, candidate.dimensions.height);
  const centerTolerance = Math.max(24, shorterHeight * 0.5);
  const overlap =
    Math.min(
      anchor.position.y + anchor.dimensions.height,
      candidate.position.y + candidate.dimensions.height,
    ) - Math.max(anchor.position.y, candidate.position.y);
  return overlap > 0 && Math.abs(anchorCenter - candidateCenter) <= centerTolerance;
}

function canvasReadingOrder(nodes: readonly CanvasNode[]): CanvasNode[] {
  const candidates = [...nodes].sort((left, right) => {
    const yDifference = left.position.y - right.position.y;
    return yDifference || compareCanvasX(left, right);
  });
  const rows: Array<{ anchor: CanvasNode; nodes: CanvasNode[] }> = [];

  for (const node of candidates) {
    const row = rows
      .filter((candidate) => sharesVisualRow(candidate.anchor, node))
      .sort((left, right) => {
        const leftDistance = Math.abs(
          left.anchor.position.y +
            left.anchor.dimensions.height / 2 -
            (node.position.y + node.dimensions.height / 2),
        );
        const rightDistance = Math.abs(
          right.anchor.position.y +
            right.anchor.dimensions.height / 2 -
            (node.position.y + node.dimensions.height / 2),
        );
        return leftDistance - rightDistance;
      })[0];
    if (row) row.nodes.push(node);
    else rows.push({ anchor: node, nodes: [node] });
  }

  return rows
    .sort((left, right) => {
      const yDifference = left.anchor.position.y - right.anchor.position.y;
      return yDifference || compareCanvasX(left.anchor, right.anchor);
    })
    .flatMap((row) => row.nodes.sort(compareCanvasX));
}

function compactGridPositions(nodes: readonly CanvasNode[]): CanvasLayoutNodePosition[] {
  const ordered = canvasReadingOrder(nodes);
  const columnCount = Math.ceil(Math.sqrt(ordered.length));
  const rowCount = Math.ceil(ordered.length / columnCount);
  const columnWidths = Array.from({ length: columnCount }, () => 0);
  const rowHeights = Array.from({ length: rowCount }, () => 0);

  ordered.forEach((node, index) => {
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    columnWidths[column] = Math.max(columnWidths[column]!, node.dimensions.width);
    rowHeights[row] = Math.max(rowHeights[row]!, node.dimensions.height);
  });

  const anchorX = Math.min(...nodes.map((node) => node.position.x));
  const anchorY = Math.min(...nodes.map((node) => node.position.y));
  const columnX = columnWidths.map((_width, column) => {
    let x = anchorX;
    for (let index = 0; index < column; index += 1) {
      x += columnWidths[index]! + CANVAS_COMPACT_GRID_HORIZONTAL_GAP;
    }
    return x;
  });
  const rowY = rowHeights.map((_height, row) => {
    let y = anchorY;
    for (let index = 0; index < row; index += 1) {
      y += rowHeights[index]! + CANVAS_COMPACT_GRID_VERTICAL_GAP;
    }
    return y;
  });

  return ordered.map((node, index) =>
    layoutPosition(node, {
      x: columnX[index % columnCount]!,
      y: rowY[Math.floor(index / columnCount)]!,
    }),
  );
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
    const update = layoutPosition(node, { x: cursorX, y: anchorY });
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
  citationRelations: readonly CanvasCitationRelation[],
): CanvasLayoutNodePosition[] | null {
  const paperById = new Map(papers.map((node) => [node.id, node] as const));
  const paperIds = new Set(paperById.keys());

  // A cites B is stored as A -> B. The layout graph is deliberately reversed
  // so the cited paper B appears to the left of the citing paper A.
  const adjacencySets = new Map(papers.map((node) => [node.id, new Set<string>()] as const));
  let citationCount = 0;
  const addCitation = (citingNodeId: string, citedNodeId: string) => {
    if (citingNodeId === citedNodeId || !paperIds.has(citingNodeId) || !paperIds.has(citedNodeId)) {
      return;
    }
    const citingNodes = adjacencySets.get(citedNodeId)!;
    const previousSize = citingNodes.size;
    citingNodes.add(citingNodeId);
    if (citingNodes.size > previousSize) citationCount += 1;
  };

  for (const edge of document.edges) {
    if (edge.relationType === "cites") addCitation(edge.sourceId, edge.targetId);
  }

  const papersByWorkId = new Map<string, PaperNode[]>();
  for (const paper of papers) {
    const placements = papersByWorkId.get(paper.data.workId) ?? [];
    placements.push(paper);
    papersByWorkId.set(paper.data.workId, placements);
  }
  for (const relation of citationRelations) {
    if (relation.citingWorkId === relation.citedWorkId) continue;
    const citingPapers = papersByWorkId.get(relation.citingWorkId) ?? [];
    const citedPapers = papersByWorkId.get(relation.citedWorkId) ?? [];
    for (const citingPaper of citingPapers) {
      for (const citedPaper of citedPapers) addCitation(citingPaper.id, citedPaper.id);
    }
  }
  if (citationCount === 0) return null;

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
      updates.push(layoutPosition(node, { x: cursorX, y: cursorY }));
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
    : {
        groupId: group.id,
        dimensions,
        expectedDimensions: { ...group.dimensions },
        expectedUpdatedAt: group.updatedAt,
      };
}

function hasSelectedGroupAncestor(
  node: CanvasNode,
  selectedNodeIds: ReadonlySet<string>,
  nodeById: ReadonlyMap<string, CanvasNode>,
): boolean {
  let parentId = node.groupId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodeById.get(parentId);
    if (!parent || parent.type !== "group") return false;
    if (selectedNodeIds.has(parent.id)) return true;
    parentId = parent.groupId;
  }
  return false;
}

export function planCanvasLayout(
  document: CanvasWorkspaceDocument,
  selectedNodeIds: ReadonlySet<string>,
  mode: CanvasLayoutMode,
  citationRelations: readonly CanvasCitationRelation[] = [],
): CanvasLayoutPlan {
  if (selectedNodeIds.size < 2) return errorPlan(mode, "selection-too-small");
  const nodeById = new Map(document.nodes.map((node) => [node.id, node] as const));
  let selectedNodes: CanvasNode[] = [];
  for (const nodeId of selectedNodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) return errorPlan(mode, "missing-node");
    selectedNodes.push(node);
  }
  if (mode === "compact-grid") {
    selectedNodes = selectedNodes.filter(
      (node) => !hasSelectedGroupAncestor(node, selectedNodeIds, nodeById),
    );
  }
  if (selectedNodes.length < 2) return errorPlan(mode, "selection-too-small");
  if (mode !== "compact-grid" && selectedNodes.some((node) => node.type !== "paper")) {
    return errorPlan(mode, "mixed-node-types");
  }
  const parentGroupIds = new Set(selectedNodes.map((node) => node.groupId ?? null));
  if (parentGroupIds.size !== 1) return errorPlan(mode, "mixed-parent");
  const parentGroupId = parentGroupIds.values().next().value ?? null;
  if (parentGroupId) {
    const parent = nodeById.get(parentGroupId);
    if (!parent || parent.type !== "group") return errorPlan(mode, "missing-parent-group");
    if (parent.data.collapsed === true) return errorPlan(mode, "collapsed-parent-group");
  }

  const papers = selectedNodes as PaperNode[];
  const nodePositions =
    mode === "compact-grid"
      ? compactGridPositions(selectedNodes)
      : mode === "timeline"
        ? timelinePositions(papers)
        : citationTreePositions(document, papers, citationRelations);
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
    if (
      !node ||
      node.dimensions.width !== update.expectedDimensions.width ||
      node.dimensions.height !== update.expectedDimensions.height ||
      node.type !== update.expectedNodeType ||
      (node.groupId ?? null) !== update.expectedParentGroupId ||
      node.position.x !== update.expectedPosition.x ||
      node.position.y !== update.expectedPosition.y ||
      node.updatedAt !== update.expectedUpdatedAt ||
      update.expectedParentGroupId !== plan.parentGroupId ||
      (plan.mode !== "compact-grid" && node.type !== "paper")
    ) {
      return document;
    }
  }
  if (plan.parentGroupId) {
    const parent = nodeById.get(plan.parentGroupId);
    if (!parent || parent.type !== "group" || parent.data.collapsed === true) return document;
  }
  if (plan.groupResize) {
    const group = nodeById.get(plan.groupResize.groupId);
    if (
      !group ||
      group.type !== "group" ||
      group.dimensions.width !== plan.groupResize.expectedDimensions.width ||
      group.dimensions.height !== plan.groupResize.expectedDimensions.height ||
      group.updatedAt !== plan.groupResize.expectedUpdatedAt
    ) {
      return document;
    }
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
