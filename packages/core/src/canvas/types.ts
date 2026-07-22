/**
 * Persisted Spatial Canvas document version. Bump this only when a stored
 * document needs a data migration; adding optional payload fields is backward
 * compatible and does not require a bump.
 */
export const CANVAS_SCHEMA_VERSION = 1 as const;

export type CanvasSchemaVersion = typeof CANVAS_SCHEMA_VERSION;

export type CanvasJsonValue =
  | string
  | number
  | boolean
  | null
  | CanvasJsonValue[]
  | { [key: string]: CanvasJsonValue };

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasDimensions {
  width: number;
  height: number;
}

export interface CanvasViewport extends CanvasPoint {
  zoom: number;
}

export interface PaperNodeData {
  /** Library work id. This is deliberately separate from the canvas node id. */
  workId: string;
  title: string;
  authors: string[];
  year: number | null;
  venue?: string;
  doi?: string;
  abstractSnippet?: string;
  oaPdfUrl?: string;
  localPdfPath?: string;
  annotationCount: number;
}

export type ExcerptHighlightColor = "yellow" | "green" | "blue" | "pink" | "purple" | "orange";

export interface ExcerptNodeData {
  /** Library work id. This is deliberately separate from the canvas node id. */
  workId: string;
  paperTitle: string;
  highlightText: string;
  highlightColor: ExcerptHighlightColor;
  /** Zero-based PDF page index, matching the reader/annotation model. */
  pageIndex: number;
  annotationId?: string;
  attachmentId?: string;
  anchor?: CanvasJsonValue;
  marginNote?: string;
}

export type AISynthesisType =
  | "methodology_matrix"
  | "contradiction_analysis"
  | "research_gap"
  | "tldr";

export interface AISynthNodeData {
  sourceNodeIds: string[];
  synthType: AISynthesisType;
  title: string;
  contentMarkdown: string;
  structuredTable?: {
    headers: string[];
    rows: string[][];
  };
  modelName?: string;
}

export interface IdeaNoteNodeData {
  title?: string;
  contentMarkdown: string;
  hasEquations: boolean;
}

export interface GroupNodeData {
  title: string;
  colorTheme?: string;
  /** Whether the group is rendered as a compact header instead of its full bounds. */
  collapsed?: boolean;
}

/**
 * Extension seam for future card kinds. New card packages can augment this
 * interface and automatically participate in CanvasNodeType/CanvasNode.
 */
export interface CanvasNodeDataByType {
  paper: PaperNodeData;
  excerpt: ExcerptNodeData;
  "ai-synth": AISynthNodeData;
  "idea-note": IdeaNoteNodeData;
  group: GroupNodeData;
}

export type CanvasNodeType = Extract<keyof CanvasNodeDataByType, string>;

export interface CanvasNodeBase<TType extends CanvasNodeType, TData> {
  /** UUIDv7 for this placement/card; never reuse a works.id here. */
  id: string;
  type: TType;
  position: CanvasPoint;
  dimensions: CanvasDimensions;
  /** Parent group node id, if grouped. */
  groupId?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  data: TData;
}

/** Distributive generic: the default is the strict discriminated node union. */
export type CanvasNode<TType extends CanvasNodeType = CanvasNodeType> = TType extends CanvasNodeType
  ? CanvasNodeBase<TType, CanvasNodeDataByType[TType]>
  : never;

export type PaperNode = CanvasNode<"paper">;
export type ExcerptNode = CanvasNode<"excerpt">;
export type AISynthNode = CanvasNode<"ai-synth">;
export type IdeaNoteNode = CanvasNode<"idea-note">;
export type GroupNode = CanvasNode<"group">;
/** Compatibility-friendly descriptive alias for the group card. */
export type GroupContainerNode = GroupNode;
export type AnyCanvasNode = CanvasNode;

export type CanvasEdgeRelation =
  | "cites"
  | "supports"
  | "contradicts"
  | "extends"
  | "derived-from"
  | "custom";

export interface CanvasEdgeStyle {
  stroke?: string;
  animated?: boolean;
}

export interface CanvasEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: CanvasEdgeRelation;
  label?: string;
  style?: CanvasEdgeStyle;
  createdAt: number;
  updatedAt: number;
}

/**
 * Complete persistence document. Selection/focus are intentionally absent:
 * they are ephemeral UI state, while viewport, nodes, and edges are durable.
 */
export interface CanvasWorkspaceDocument {
  schemaVersion: CanvasSchemaVersion;
  workspaceId: string;
  name: string;
  description?: string;
  viewport: CanvasViewport;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  createdAt: number;
  updatedAt: number;
}
