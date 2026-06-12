// Markdown export of a document's annotations — the "take my notes with me"
// feature researchers expect from any reference manager.
import type { ReaderAnnotation } from "./annotations";

export interface ExportMeta {
  title: string;
  authors?: string[];
  year?: number;
  doi?: string;
}

const TYPE_LABEL: Record<string, string> = {
  highlight: "高亮",
  underline: "下划线",
  strikeout: "删除线",
  note: "批注",
};

export function annotationsToMarkdown(meta: ExportMeta, annotations: ReaderAnnotation[]): string {
  const lines: string[] = [];
  lines.push(`# ${meta.title}`);
  const sub: string[] = [];
  if (meta.authors?.length) sub.push(meta.authors.join(", "));
  if (meta.year) sub.push(String(meta.year));
  if (meta.doi) sub.push(`[doi:${meta.doi}](https://doi.org/${meta.doi})`);
  if (sub.length) lines.push(`> ${sub.join(" · ")}`);
  lines.push("");

  const sorted = [...annotations].sort(
    (a, b) =>
      a.pageIndex - b.pageIndex ||
      (a.anchor.position?.start ?? 0) - (b.anchor.position?.start ?? 0),
  );

  let currentPage = -1;
  for (const ann of sorted) {
    if (ann.pageIndex !== currentPage) {
      currentPage = ann.pageIndex;
      lines.push(`## 第 ${currentPage + 1} 页`);
      lines.push("");
    }
    const label = TYPE_LABEL[ann.type] ?? ann.type;
    const quote = ann.anchor.quote?.exact?.trim();
    if (quote) {
      lines.push(`> ${quote.replace(/\n/g, " ")}`);
      lines.push(">");
      lines.push(`> — *${label}*${ann.orphaned ? "(原文位置已失效)" : ""}`);
    } else {
      lines.push(`*${label}*`);
    }
    if (ann.contentMd?.trim()) {
      lines.push("");
      lines.push(ann.contentMd.trim());
    }
    lines.push("");
  }

  return lines.join("\n");
}
