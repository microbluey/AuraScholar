// Splits long text into translation-sized chunks. Full-page / full-document
// translation sends one chunk per request; chunking keeps each request within
// model limits and lets the UI show progress. Splits on paragraph boundaries,
// falling back to sentence then hard cuts for pathologically long blocks.

const DEFAULT_MAX = 1800;

export function splitForTranslation(text: string, maxChars = DEFAULT_MAX): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = "";

  const flush = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = "";
  };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      flush();
      for (const piece of splitLongBlock(para, maxChars)) chunks.push(piece);
      continue;
    }
    if (buf.length + para.length + 2 > maxChars) flush();
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  flush();
  return chunks;
}

/** Sentence-aware split for a single oversized paragraph, then hard cut. */
function splitLongBlock(block: string, maxChars: number): string[] {
  const sentences = block.split(/(?<=[.!?。!?])\s+/);
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (s.length > maxChars) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars));
      continue;
    }
    if (buf.length + s.length + 1 > maxChars) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    }
    buf = buf ? `${buf} ${s}` : s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
