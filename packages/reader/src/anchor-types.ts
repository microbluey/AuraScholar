// Multi-level annotation anchoring, W3C Web Annotation flavored.
// Every text annotation stores all three selectors:
//   quads    — PDF user-space rectangles: instant rendering, zoom-independent
//   quote    — exact text + context: survives layout/extraction changes
//   position — char offset in the page's text stream: fast re-search hint
// Resolution tries quads (validated against quote), then position-guided
// fuzzy search, then whole-page fuzzy search. Failure → orphaned, never lost.

/** Rectangle in PDF user space (origin bottom-left, y grows upward). */
export interface QuadRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface QuadSelector {
  pageIndex: number;
  rects: QuadRect[];
}

export interface TextQuoteSelector {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface TextPositionSelector {
  /** Char offsets within the page's normalized text stream. */
  start: number;
  end: number;
}

export interface AnnotationAnchor {
  version: 1;
  pageIndex: number;
  quads?: QuadSelector;
  quote?: TextQuoteSelector;
  position?: TextPositionSelector;
}

export type AnchorResolution =
  | { status: "exact"; start: number; end: number }
  | { status: "fuzzy"; start: number; end: number; score: number }
  | { status: "orphaned" };
