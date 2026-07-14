// Converting between text ranges (anchoring space) and page-space rectangles
// (rendering space). Quads are stored in PDF user space so they are
// independent of zoom; the view layer scales them with the page viewport.
import type { PageTextIndex } from "./document.js";
import type { QuadRect } from "./anchor-types.js";

/**
 * Computes PDF-user-space rects covering a text range [start, end) of a page's
 * normalized text. One rect per contributing text item, merged per line.
 */
export function rectsForTextRange(index: PageTextIndex, start: number, end: number): QuadRect[] {
  const rects: QuadRect[] = [];
  const { items } = index;

  for (let i = 0; i < items.length; i++) {
    const entry = items[i]!;
    const itemStart = entry.textStart;
    const itemEnd = itemStart + entry.item.str.length;
    if (itemEnd <= start || itemStart >= end) continue;

    const t = entry.item.transform; // [a, b, c, d, e, f]
    const fontHeight = Math.hypot(t[2]!, t[3]!);
    const baseX = t[4]!;
    const baseY = t[5]!;
    const itemWidth = entry.item.width;
    const len = entry.item.str.length || 1;

    // Character coverage within this item (approximate: proportional width).
    const coverStart = Math.max(start, itemStart) - itemStart;
    const coverEnd = Math.min(end, itemEnd) - itemStart;
    const x1 = baseX + (coverStart / len) * itemWidth;
    const x2 = baseX + (coverEnd / len) * itemWidth;

    rects.push({ x1, y1: baseY - fontHeight * 0.2, x2, y2: baseY + fontHeight });
  }

  return mergeLineRects(rects);
}

/** Merges horizontally adjacent rects on the same baseline into one. */
function mergeLineRects(rects: QuadRect[]): QuadRect[] {
  if (rects.length <= 1) return rects;
  const sorted = [...rects].sort((a, b) => b.y1 - a.y1 || a.x1 - b.x1);
  const merged: QuadRect[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    const sameLine = last && Math.abs(last.y1 - r.y1) < (last.y2 - last.y1) * 0.5;
    if (sameLine && r.x1 <= last.x2 + 2) {
      last.x2 = Math.max(last.x2, r.x2);
      last.y2 = Math.max(last.y2, r.y2);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/**
 * Maps a DOM selection within a page's text layer back to offsets in the
 * page's normalized text. Each text-layer span carries data-item-index;
 * offsets accumulate from the item table.
 */
export function textRangeFromDomSelection(
  index: PageTextIndex,
  anchorItemIdx: number,
  anchorCharOffset: number,
  focusItemIdx: number,
  focusCharOffset: number,
): { start: number; end: number } | null {
  const a = index.items[anchorItemIdx];
  const f = index.items[focusItemIdx];
  if (!a || !f) return null;
  const p1 = a.textStart + Math.min(anchorCharOffset, a.item.str.length);
  const p2 = f.textStart + Math.min(focusCharOffset, f.item.str.length);
  const start = Math.min(p1, p2);
  const end = Math.max(p1, p2);
  return start === end ? null : { start, end };
}
