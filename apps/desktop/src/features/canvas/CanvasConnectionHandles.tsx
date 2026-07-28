import { Handle, Position } from "@xyflow/react";

const CONNECTION_HANDLES = [
  { id: "link-left", label: "左侧", position: Position.Left },
  { id: "link-top", label: "上侧", position: Position.Top },
  { id: "link-right", label: "右侧", position: Position.Right },
  { id: "link-bottom", label: "下侧", position: Position.Bottom },
] as const;

export function CanvasConnectionHandles({
  isConnectable,
  nodeLabel,
}: {
  isConnectable: boolean;
  nodeLabel: string;
}) {
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
          tabIndex={-1}
          aria-hidden="true"
          title={`从“${nodeLabel}”的${handle.label}拖动建立连线`}
        />
      ))}
    </>
  );
}
