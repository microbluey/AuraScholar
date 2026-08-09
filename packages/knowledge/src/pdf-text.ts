/**
 * The minimal shape emitted by pdf.js for text-bearing content items.
 *
 * This deliberately stays structural so the Knowledge package does not take
 * a runtime dependency on pdf.js. Reader and main-process extraction both use
 * it to preserve the same frozen anchoring text space.
 */
export interface PdfTextItemLike {
  str: string;
  hasEOL?: unknown;
}

/** Returns whether a pdf.js content item contributes text to the anchoring space. */
export function isPdfTextItem(value: unknown): value is PdfTextItemLike {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return typeof (value as { str?: unknown }).str === "string";
}

/**
 * Appends exactly one pdf.js text item using AuraScholar's canonical PDF text
 * normalization. Do not change this without a corresponding anchor-version
 * migration: stored TextPosition selectors depend on these offsets.
 */
export function appendPdfAnchoringText(text: string, item: PdfTextItemLike): string {
  return `${text}${item.str}${item.hasEOL ? " " : ""}`;
}
