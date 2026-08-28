import type { ScholarIdentity } from "../shared";

const DOI_RE = /10\.\d{4,9}\/[^\s"'<>]+/;

export function normalizeResearchScholarMeta(
  meta: Record<string, string[]>,
  pageUrl: string,
): ScholarIdentity | undefined {
  const first = (key: string): string | undefined => meta[key]?.[0]?.trim() || undefined;
  let doi: string | undefined;
  for (const candidate of [
    ...(meta["citation_doi"] ?? []),
    ...(meta["dc.identifier"] ?? []),
    ...(meta["prism.doi"] ?? []),
  ]) {
    const match = candidate.match(DOI_RE);
    if (match) {
      doi = match[0].replace(/[).,;]+$/, "").toLowerCase();
      break;
    }
  }
  let arxivId = first("citation_arxiv_id");
  if (!arxivId) {
    const fromUrl = pageUrl.match(/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+)/i);
    if (fromUrl) arxivId = fromUrl[1]!.replace(/\.pdf$/i, "");
  }

  const title = first("citation_title");
  let pdfUrl: string | undefined;
  const rawPdf = first("citation_pdf_url");
  if (rawPdf) {
    try {
      pdfUrl = new URL(rawPdf, pageUrl).href;
    } catch {
      // Ignore malformed citation metadata.
    }
  }
  if (!doi && !arxivId && !title && !pdfUrl) return undefined;
  return { doi, arxivId, title, pdfUrl, sourceUrl: pageUrl };
}
