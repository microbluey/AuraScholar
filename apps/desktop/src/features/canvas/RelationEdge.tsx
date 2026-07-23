import type { CanvasEdgeRelation } from "@aurascholar/core";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { RELATION_LABELS } from "./model";

export interface RelationFlowEdgeData extends Record<string, unknown> {
  label?: string;
  pending?: boolean;
  relationType: CanvasEdgeRelation;
}

export type RelationFlowEdge = Edge<RelationFlowEdgeData, "relation">;

export function RelationEdge({
  data,
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
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const relation = data?.relationType ?? "custom";
  const pending = data?.pending === true;
  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={style}
        className={`canvas-relation-edge${selected ? " canvas-relation-edge--selected" : ""}${pending ? " canvas-relation-edge--pending" : ""}`}
      />
      {!pending && (
        <EdgeLabelRenderer>
          <span
            className={`canvas-edge-label canvas-edge-label--${relation}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data?.label || RELATION_LABELS[relation]}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const canvasEdgeTypes = { relation: RelationEdge };
