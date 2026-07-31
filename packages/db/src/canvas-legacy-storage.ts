import type { StoredCanvasNode } from "./repos/canvas.js";

function assertFiniteCoordinate(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

/**
 * Nested groups were never a supported Canvas interaction, but early storage
 * accepted them. Read those snapshots compatibly by moving every nested Group
 * into the root coordinate space; its ordinary child cards stay relative to
 * that Group and therefore keep their visual positions.
 */
export function flattenLegacyCanvasGroups(nodes: StoredCanvasNode[]): StoredCanvasNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    if (node.type !== "group" || node.groupId === undefined) return node;
    let x = node.position.x;
    let y = node.position.y;
    let parentId: string | undefined = node.groupId;
    const visited = new Set([node.id]);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = nodeById.get(parentId);
      if (!parent || parent.type !== "group") break;
      x += parent.position.x;
      y += parent.position.y;
      assertFiniteCoordinate(x, `Canvas group ${node.id} flattened position.x`);
      assertFiniteCoordinate(y, `Canvas group ${node.id} flattened position.y`);
      parentId = parent.groupId;
    }
    return { ...node, position: { x, y }, groupId: undefined };
  });
}
