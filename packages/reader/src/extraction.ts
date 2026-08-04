import type { PdfTextSource } from "@aurascholar/knowledge";
import type { PdfDocument } from "./document.js";

/**
 * Adapter from the reader's frozen PageTextIndex text space to the pure
 * knowledge extraction contract. No layout or text normalization happens here.
 */
export function createPdfTextSource(
  document: Pick<PdfDocument, "pageCount" | "getPageText">,
): PdfTextSource {
  return {
    pageCount: document.pageCount,
    async getPageText(pageIndex, signal) {
      if (signal?.aborted) {
        const error = new Error("PDF extraction was aborted");
        error.name = "AbortError";
        throw error;
      }
      const page = await document.getPageText(pageIndex);
      if (signal?.aborted) {
        const error = new Error("PDF extraction was aborted");
        error.name = "AbortError";
        throw error;
      }
      return { pageIndex, text: page.text };
    },
  };
}
