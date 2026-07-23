import {
  type CanvasJsonValue,
  type CanvasPoint,
  type ExcerptHighlightColor,
  type ExcerptNode,
} from "@aurascholar/core";
import type { ReaderAnnotation } from "@aurascholar/reader";

const READER_COLOR_TO_EXCERPT_COLOR: Readonly<Record<string, ExcerptHighlightColor>> = {
  yellow: "yellow",
  "#ffd866": "yellow",
  green: "green",
  "#a9dc76": "green",
  blue: "blue",
  "#78dce8": "blue",
  pink: "pink",
  "#ff6188": "pink",
  purple: "purple",
  "#ab9df2": "purple",
  orange: "orange",
  "#fc9867": "orange",
};

export interface CreateExcerptNodeFromAnnotationInput {
  annotation: ReaderAnnotation;
  attachmentId: string;
  id: string;
  now: number;
  paperTitle: string;
  position: CanvasPoint;
  workId: string;
}

/**
 * Maps both Reader palette keys and their persisted hex values to the compact
 * color vocabulary stored by the Canvas. Unknown/custom CSS colors fall back
 * to yellow so a future Reader theme cannot create an invalid Canvas document.
 */
export function mapReaderAnnotationColor(color: string): ExcerptHighlightColor {
  return READER_COLOR_TO_EXCERPT_COLOR[color.trim().toLocaleLowerCase()] ?? "yellow";
}

function cloneAnchor(annotation: ReaderAnnotation): CanvasJsonValue {
  // AnnotationAnchor is deliberately JSON-only. Copying at this boundary
  // prevents later Reader selection/anchoring updates from mutating a card.
  return JSON.parse(JSON.stringify(annotation.anchor)) as CanvasJsonValue;
}

function excerptText(annotation: ReaderAnnotation): {
  highlightText: string;
  marginNote?: string;
} {
  const exact = annotation.anchor.quote?.exact.trim();
  const note = annotation.contentMd?.trim();

  return {
    highlightText: exact || note || `第 ${annotation.pageIndex + 1} 页批注`,
    ...(exact && note ? { marginNote: note } : {}),
  };
}

export function createExcerptNodeFromAnnotation(
  input: CreateExcerptNodeFromAnnotationInput,
): ExcerptNode {
  const text = excerptText(input.annotation);
  return {
    id: input.id,
    type: "excerpt",
    position: { ...input.position },
    dimensions: { width: 300, height: 216 },
    tags: [],
    createdAt: input.now,
    updatedAt: input.now,
    data: {
      workId: input.workId,
      paperTitle: input.paperTitle.trim(),
      highlightText: text.highlightText,
      highlightColor: mapReaderAnnotationColor(input.annotation.color),
      pageIndex: input.annotation.pageIndex,
      annotationId: input.annotation.id,
      attachmentId: input.attachmentId,
      anchor: cloneAnchor(input.annotation),
      ...(text.marginNote === undefined ? {} : { marginNote: text.marginNote }),
    },
  };
}
