// One PDF page: canvas render + text layer (selection) + annotation layer.
// Annotation rects are in PDF user space; we scale them by the viewport.
import { clsx } from "clsx";
import { memo, useEffect, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import type { PdfDocument, PageTextIndex } from "./document.js";
import type { QuadRect } from "./anchor-types.js";
import type { ReaderAnnotation } from "./annotations.js";
import { resolveAnchor } from "./anchoring.js";
import { rectsForTextRange } from "./quads.js";

export interface PageProps {
  doc: PdfDocument;
  pageIndex: number;
  scale: number;
  annotations: ReaderAnnotation[];
  onAnnotationClick?: (id: string) => void;
  /** Page filter: "none" | "sepia" | "invert" — PDF area has its own filter, never theme-inverted. */
  pageFilter?: string;
}

interface ResolvedQuads {
  annotation: ReaderAnnotation;
  rects: QuadRect[];
}

export const PdfPage = memo(function PdfPage({
  doc,
  pageIndex,
  scale,
  annotations,
  onAnnotationClick,
  pageFilter = "none",
}: PageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [textIndex, setTextIndex] = useState<PageTextIndex | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // Load page + text index
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const p = await doc.getPage(pageIndex);
      const idx = await doc.getPageText(pageIndex);
      if (cancelled) return;
      setPage(p);
      setTextIndex(idx);
      const vp = p.getViewport({ scale: 1 });
      setSize({ w: vp.width, h: vp.height });
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex]);

  // Render canvas at current scale (devicePixelRatio-aware)
  useEffect(() => {
    if (!page || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * dpr });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width / dpr}px`;
    canvas.style.height = `${viewport.height / dpr}px`;
    const ctx = canvas.getContext("2d")!;
    const task = page.render({ canvasContext: ctx, viewport });
    task.promise.catch(() => {}); // cancelled renders throw; ignore
    return () => task.cancel();
  }, [page, scale]);

  // Build text layer spans (one per text item, positioned in CSS pixels)
  useEffect(() => {
    if (!page || !textIndex || !textLayerRef.current) return;
    const container = textLayerRef.current;
    container.textContent = "";
    const viewport = page.getViewport({ scale });
    for (let i = 0; i < textIndex.items.length; i++) {
      const { item } = textIndex.items[i]!;
      const t = item.transform;
      const fontHeight = Math.hypot(t[2]!, t[3]!);
      // PDF user space → viewport CSS space
      const [x, y] = viewport.convertToViewportPoint(t[4]!, t[5]!);
      const span = document.createElement("span");
      span.textContent = item.str;
      span.dataset.itemIndex = String(i);
      span.style.cssText = `position:absolute;left:${x}px;top:${(y as number) - fontHeight * scale}px;font-size:${fontHeight * scale}px;line-height:1;white-space:pre;transform-origin:0 0;`;
      // Horizontal scale so DOM text width matches rendered glyph width
      if (item.width > 0 && item.str.length > 0) {
        container.appendChild(span);
        const domWidth = span.getBoundingClientRect().width;
        const targetWidth = item.width * scale;
        if (domWidth > 0) span.style.transform = `scaleX(${targetWidth / domWidth})`;
      } else {
        container.appendChild(span);
      }
    }
  }, [page, textIndex, scale]);

  // Resolve annotation anchors against current page text
  const [resolved, setResolved] = useState<ResolvedQuads[]>([]);
  useEffect(() => {
    if (!textIndex) return;
    const out: ResolvedQuads[] = [];
    for (const ann of annotations) {
      if (ann.pageIndex !== pageIndex) continue;
      // Fast path: stored quads are authoritative until text says otherwise.
      const res = resolveAnchor(ann.anchor, textIndex.text);
      if (res.status === "orphaned") {
        if (ann.anchor.quads) out.push({ annotation: ann, rects: ann.anchor.quads.rects });
        continue;
      }
      out.push({ annotation: ann, rects: rectsForTextRange(textIndex, res.start, res.end) });
    }
    setResolved(out);
  }, [annotations, textIndex, pageIndex]);

  if (!size) {
    return <div className="au-reader-page au-reader-page--loading" data-page-index={pageIndex} />;
  }

  return (
    <div
      className="au-reader-page"
      data-page-index={pageIndex}
      style={{ width: size.w * scale, height: size.h * scale, filter: cssFilter(pageFilter) }}
    >
      <canvas ref={canvasRef} className="au-reader-page__canvas" />
      <div ref={textLayerRef} className="au-reader-page__text" data-page-index={pageIndex} />
      <svg
        className="au-reader-page__annotations"
        viewBox={`0 0 ${size.w} ${size.h}`}
        preserveAspectRatio="none"
      >
        {resolved.map(({ annotation, rects }) =>
          rects.map((r, i) => {
            // PDF user space y grows upward; SVG y grows downward.
            const y = size.h - r.y2;
            const h = r.y2 - r.y1;
            const common = {
              key: `${annotation.id}-${i}`,
              onClick: () => onAnnotationClick?.(annotation.id),
              className: clsx(
                "au-reader-annotation",
                `au-reader-annotation--${annotation.type}`,
                annotation.orphaned && "au-reader-annotation--orphaned",
              ),
              style: { cursor: "pointer" },
            };
            if (annotation.type === "underline" || annotation.type === "strikeout") {
              const lineY = annotation.type === "underline" ? y + h : y + h / 2;
              return (
                <line
                  {...common}
                  x1={r.x1}
                  x2={r.x2}
                  y1={lineY}
                  y2={lineY}
                  stroke={annotation.color}
                  strokeWidth={Math.max(1, h * 0.06)}
                />
              );
            }
            return (
              <rect
                {...common}
                x={r.x1}
                y={y}
                width={r.x2 - r.x1}
                height={h}
                fill={annotation.color}
                fillOpacity={0.35}
              />
            );
          }),
        )}
      </svg>
    </div>
  );
});

function cssFilter(filter: string): string | undefined {
  switch (filter) {
    case "sepia":
      return "sepia(0.25) brightness(0.96)";
    case "invert":
      return "invert(0.93) hue-rotate(180deg)";
    default:
      return undefined;
  }
}
