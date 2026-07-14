export type {
  AnnotationAnchor,
  AnchorResolution,
  QuadSelector,
  QuadRect,
  TextQuoteSelector,
  TextPositionSelector,
} from "./anchor-types.js";
export { normalizeAnnotationAnchor, parseAnnotationAnchorJson } from "./anchor-guard.js";
export type { NormalizedAnchor } from "./anchor-guard.js";
export { makeQuoteSelector, resolveAnchor, similarity, CONTEXT_CHARS } from "./anchoring.js";
export { PdfDocument, configureWorker, extractFullText } from "./document.js";
export type { PageTextIndex, PdfDocumentMetadata } from "./document.js";
export { rectsForTextRange, textRangeFromDomSelection } from "./quads.js";
export type { ReaderAnnotation, AnnotationType, PendingSelection } from "./annotations.js";
export { PdfReader } from "./PdfReader.js";
export type { PdfReaderProps, ReaderTextSelection } from "./PdfReader.js";
export { PdfPage } from "./PdfPage.js";
export { AnnotationSidebar } from "./AnnotationSidebar.js";
export type { AnnotationSidebarProps } from "./AnnotationSidebar.js";
export { annotationsToMarkdown } from "./export-md.js";
export type { ExportMeta } from "./export-md.js";
