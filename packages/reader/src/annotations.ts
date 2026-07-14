// View-model types for the reader UI. The app layer persists these via the
// db package; the reader package itself is storage-agnostic.
import type { AnnotationAnchor } from "./anchor-types.js";

export type AnnotationType = "highlight" | "underline" | "strikeout" | "note";

export interface ReaderAnnotation {
  id: string;
  type: AnnotationType;
  /** Highlight color key (see tokens highlightColors) or CSS color. */
  color: string;
  pageIndex: number;
  anchor: AnnotationAnchor;
  /** Markdown body for notes/comments attached to this annotation. */
  contentMd?: string;
  orphaned?: boolean;
}

export interface PendingSelection {
  pageIndex: number;
  start: number;
  end: number;
  exact: string;
  /** Viewport-space bounding rect of the selection, for toolbar placement. */
  clientRect: { x: number; y: number; width: number; height: number };
}
