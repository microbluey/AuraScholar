import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import type { CanvasEdgePrimaryClick } from "./canvas-interactions";

export interface RelationFlowEdgeData extends Record<string, unknown> {
  label?: string;
  onEditLabel?: (
    clientPosition: { x: number; y: number },
    returnFocusElement: HTMLElement | SVGElement,
  ) => void;
  onPrimaryClick?: (
    click: CanvasEdgePrimaryClick,
    returnFocusElement: HTMLElement | SVGElement,
  ) => void;
  reciprocal?: boolean;
}

export type RelationFlowEdge = Edge<RelationFlowEdgeData, "relation">;

export function RelationEdge({
  data,
  id,
  interactionWidth,
  markerEnd,
  selected,
  sourcePosition,
  sourceX,
  sourceY,
  style,
  targetPosition,
  targetX,
  targetY,
}: EdgeProps<RelationFlowEdge>) {
  const [bezierPath, bezierLabelX, bezierLabelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const deltaX = targetX - sourceX;
  const deltaY = targetY - sourceY;
  const distance = Math.hypot(deltaX, deltaY);
  const reciprocalOffset = data?.reciprocal && distance > 0 ? 18 : 0;
  const normalX = distance > 0 ? -deltaY / distance : 0;
  const normalY = distance > 0 ? deltaX / distance : 0;
  const controlX = (sourceX + targetX) / 2 + normalX * reciprocalOffset * 2;
  const controlY = (sourceY + targetY) / 2 + normalY * reciprocalOffset * 2;
  const edgePath = reciprocalOffset
    ? `M ${sourceX},${sourceY} Q ${controlX},${controlY} ${targetX},${targetY}`
    : bezierPath;
  const labelX = reciprocalOffset ? (sourceX + 2 * controlX + targetX) / 4 : bezierLabelX;
  const labelY = reciprocalOffset ? (sourceY + 2 * controlY + targetY) / 4 : bezierLabelY;
  const label = data?.label?.trim();
  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={Math.max(interactionWidth ?? 0, 36)}
        className={`canvas-relation-edge${selected ? " canvas-relation-edge--selected" : ""}`}
      />
      {label && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="canvas-edge-label nodrag nopan"
            data-canvas-interactive
            data-edge-id={id}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            aria-label={`连线文字：${label}。双击或按 F2 编辑`}
            title={label}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              data?.onPrimaryClick?.(
                {
                  clientX: event.clientX,
                  clientY: event.clientY,
                  edgeId: id,
                  timeStamp: event.timeStamp,
                },
                event.currentTarget,
              );
            }}
            onKeyDown={(event) => {
              if (event.key !== "F2") return;
              event.preventDefault();
              event.stopPropagation();
              data?.onEditLabel?.(
                {
                  x: event.currentTarget.getBoundingClientRect().left,
                  y: event.currentTarget.getBoundingClientRect().bottom,
                },
                event.currentTarget,
              );
            }}
          >
            {label}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const canvasEdgeTypes = { relation: RelationEdge };
