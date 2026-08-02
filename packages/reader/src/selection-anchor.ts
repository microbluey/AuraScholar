import type { PageTextIndex } from "./document.js";
import type { PendingSelection } from "./annotations.js";
import type { AnnotationAnchor } from "./anchor-types.js";
import { makeQuoteSelector } from "./anchoring.js";
import { rectsForTextRange } from "./quads.js";

export interface ReaderPdfEvidenceAnchor extends AnnotationAnchor {
  kind: "pdf";
  quads: NonNullable<AnnotationAnchor["quads"]>;
  quote: NonNullable<AnnotationAnchor["quote"]>;
  position: NonNullable<AnnotationAnchor["position"]>;
}

export interface ReaderEvidenceSelection {
  anchor: ReaderPdfEvidenceAnchor;
  clientRect: PendingSelection["clientRect"];
  exact: string;
  pageIndex: number;
}

/**
 * Builds the canonical multi-selector anchor used by every PDF selection action.
 * Keeping annotation and Evidence capture on this boundary prevents selector drift.
 */
export function buildPdfSelectionAnchor(
  index: PageTextIndex,
  selection: Pick<PendingSelection, "end" | "pageIndex" | "start">,
): AnnotationAnchor {
  return {
    version: 1,
    pageIndex: selection.pageIndex,
    quote: makeQuoteSelector(index.text, selection.start, selection.end),
    position: { start: selection.start, end: selection.end },
    quads: {
      pageIndex: selection.pageIndex,
      rects: rectsForTextRange(index, selection.start, selection.end),
    },
  };
}

export function buildReaderEvidenceSelection(
  index: PageTextIndex,
  selection: PendingSelection,
): ReaderEvidenceSelection {
  const anchor = buildPdfSelectionAnchor(index, selection);
  if (!anchor.quote || !anchor.position || !anchor.quads) {
    throw new Error("PDF selection did not produce a complete Evidence anchor");
  }
  return {
    anchor: { ...anchor, kind: "pdf", quote: anchor.quote, position: anchor.position, quads: anchor.quads },
    clientRect: selection.clientRect,
    exact: anchor.quote.exact,
    pageIndex: selection.pageIndex,
  };
}
