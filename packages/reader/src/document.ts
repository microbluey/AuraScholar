// pdf.js wrapper: loads a document, renders pages, and produces the
// normalized per-page text streams that anchoring runs against.
//
// IMPORTANT: the text produced by `getPageText` is the canonical text space
// for TextQuote/TextPosition selectors. Its construction (item joining rules)
// must stay stable — changing it invalidates stored positions, which the
// fuzzy anchoring will recover from, but exact-match performance degrades.
// Treat this file's text assembly as frozen; bump AnnotationAnchor.version
// if it ever has to change.
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export interface PageTextIndex {
  /** Normalized page text used for anchoring. */
  text: string;
  /**
   * Map from char offset in `text` to the text item + char-within-item,
   * sampled at item starts. Used to convert text ranges back to page quads.
   */
  items: Array<{
    /** Offset in `text` where this item begins. */
    textStart: number;
    /** The raw pdf.js item (has transform + width/height). */
    item: TextItem;
  }>;
}

export function configureWorker(workerSrc: string): void {
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
}

export class PdfDocument {
  private textCache = new Map<number, PageTextIndex>();

  private constructor(readonly raw: PDFDocumentProxy) {}

  static async load(data: Uint8Array): Promise<PdfDocument> {
    const doc = await pdfjs.getDocument({ data }).promise;
    return new PdfDocument(doc);
  }

  get pageCount(): number {
    return this.raw.numPages;
  }

  async getPage(pageIndex: number): Promise<PDFPageProxy> {
    return this.raw.getPage(pageIndex + 1); // pdf.js is 1-based
  }

  /** Builds (and caches) the anchoring text index for a page. */
  async getPageText(pageIndex: number): Promise<PageTextIndex> {
    const cached = this.textCache.get(pageIndex);
    if (cached) return cached;

    const page = await this.getPage(pageIndex);
    const content = await page.getTextContent();
    let text = "";
    const items: PageTextIndex["items"] = [];

    for (const item of content.items) {
      if (!("str" in item)) continue;
      const textItem = item as TextItem;
      items.push({ textStart: text.length, item: textItem });
      text += textItem.str;
      // pdf.js marks explicit line/paragraph breaks; normalize to single space
      // so quotes survive different line-breaking between extractions.
      if (textItem.hasEOL) text += " ";
    }

    const index: PageTextIndex = { text, items };
    this.textCache.set(pageIndex, index);
    return index;
  }

  destroy(): void {
    this.textCache.clear();
    void this.raw.destroy();
  }
}

/** Full-document text extraction for the AI flashcard pipeline. */
export async function extractFullText(doc: PdfDocument, maxPages?: number): Promise<string> {
  const n = Math.min(doc.pageCount, maxPages ?? doc.pageCount);
  const pages: string[] = [];
  for (let i = 0; i < n; i++) {
    const { text } = await doc.getPageText(i);
    pages.push(text);
  }
  return pages.join("\n\n");
}
