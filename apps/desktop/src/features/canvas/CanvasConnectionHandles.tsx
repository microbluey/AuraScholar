import { Handle, Position, useInternalNode, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";

const CONNECTION_HANDLES = [
  { id: "link-left", label: "左侧", position: Position.Left },
  { id: "link-top", label: "上侧", position: Position.Top },
  { id: "link-right", label: "右侧", position: Position.Right },
  { id: "link-bottom", label: "下侧", position: Position.Bottom },
] as const;

export function isCanvasConnectionHandleReady(
  sourceHandles: readonly Readonly<{ id?: string | null }>[] | null | undefined,
  handleId: string,
): boolean {
  return sourceHandles?.some((handle) => handle.id === handleId) ?? false;
}

export function needsCanvasConnectionHandleMeasurement(
  node: Readonly<{ internals: Readonly<{ handleBounds?: unknown }> }> | undefined,
): boolean {
  return Boolean(node && node.internals.handleBounds === undefined);
}

export function CanvasConnectionHandles({
  isConnectable,
  nodeLabel,
  nodeId,
}: {
  isConnectable: boolean;
  nodeLabel: string;
  nodeId: string;
}) {
  const internalNode = useInternalNode(nodeId);
  const updateNodeInternals = useUpdateNodeInternals();
  const sourceHandles = internalNode?.internals.handleBounds?.source;
  const needsMeasurement = needsCanvasConnectionHandleMeasurement(internalNode);

  useEffect(() => {
    // A controlled React Flow node can be recreated after its DOM handles commit.
    // Force exactly one post-commit measurement until those handles are available.
    if (needsMeasurement) updateNodeInternals(nodeId);
  }, [needsMeasurement, nodeId, updateNodeInternals]);

  return (
    <>
      {CONNECTION_HANDLES.map((handle) => (
        <Handle
          key={handle.id}
          id={handle.id}
          type="source"
          position={handle.position}
          isConnectable={isConnectable}
          isConnectableStart={isConnectable}
          isConnectableEnd={isConnectable}
          data-canvas-connection-handle={handle.id}
          data-canvas-connection-ready={
            isCanvasConnectionHandleReady(sourceHandles, handle.id) ? "true" : "false"
          }
          tabIndex={-1}
          aria-hidden="true"
          title={`从“${nodeLabel}”的${handle.label}拖动建立连线`}
        />
      ))}
    </>
  );
}
