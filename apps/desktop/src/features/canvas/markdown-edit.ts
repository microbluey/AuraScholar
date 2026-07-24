export type MarkdownFormatAction =
  | "bold"
  | "bullet-list"
  | "formula"
  | "heading"
  | "inline-code"
  | "italic"
  | "link"
  | "quote";

export interface MarkdownEditResult {
  selectionEnd: number;
  selectionStart: number;
  value: string;
}

const WRAP_FORMATS: Partial<
  Record<MarkdownFormatAction, { fallback: string; prefix: string; suffix: string }>
> = {
  bold: { fallback: "加粗文本", prefix: "**", suffix: "**" },
  formula: { fallback: "E = mc^2", prefix: "$", suffix: "$" },
  "inline-code": { fallback: "code", prefix: "`", suffix: "`" },
  italic: { fallback: "斜体文本", prefix: "_", suffix: "_" },
  link: { fallback: "链接文字", prefix: "[", suffix: "](https://)" },
};

const LINE_PREFIXES: Partial<Record<MarkdownFormatAction, string>> = {
  "bullet-list": "- ",
  heading: "## ",
  quote: "> ",
};

export function applyMarkdownFormat(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  action: MarkdownFormatAction,
): MarkdownEditResult {
  const safeStart = Math.max(0, Math.min(selectionStart, value.length));
  const safeEnd = Math.max(safeStart, Math.min(selectionEnd, value.length));
  const selected = value.slice(safeStart, safeEnd);
  const wrap = WRAP_FORMATS[action];

  if (wrap) {
    const inner = selected || wrap.fallback;
    const replacement = `${wrap.prefix}${inner}${wrap.suffix}`;
    const nextValue = `${value.slice(0, safeStart)}${replacement}${value.slice(safeEnd)}`;
    return {
      value: nextValue,
      selectionStart: safeStart + wrap.prefix.length,
      selectionEnd: safeStart + wrap.prefix.length + inner.length,
    };
  }

  const linePrefix = LINE_PREFIXES[action];
  if (!linePrefix) {
    return { value, selectionStart: safeStart, selectionEnd: safeEnd };
  }

  const lineStart = value.lastIndexOf("\n", Math.max(0, safeStart - 1)) + 1;
  const nextLineBreak = value.indexOf("\n", safeEnd);
  const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
  const block = value.slice(lineStart, lineEnd);
  const replacement = block
    .split("\n")
    .map((line) => `${linePrefix}${line}`)
    .join("\n");
  const prefixCount = block.split("\n").length;
  const nextValue = `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`;

  return {
    value: nextValue,
    selectionStart: safeStart + linePrefix.length,
    selectionEnd: safeEnd + linePrefix.length * prefixCount,
  };
}
