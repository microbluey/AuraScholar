export interface FulltextLandingTarget {
  arxivId?: string | null;
  doi?: string | null;
  id: string;
  title: string;
  url?: string | null;
}

function encodeUrlPath(value: string): string {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function fulltextLandingUrl(target: FulltextLandingTarget): string {
  const arxivId = target.arxivId?.trim();
  if (arxivId) return `https://arxiv.org/abs/${encodeUrlPath(arxivId)}`;
  const doi = target.doi?.trim();
  if (doi) return `https://doi.org/${encodeUrlPath(doi)}`;
  const url = target.url?.trim();
  if (url) return url;
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(target.title)}`;
}

export function fulltextHandoffPath(target: FulltextLandingTarget): string {
  const params = new URLSearchParams({
    pendingWorkId: target.id,
    pendingTitle: target.title,
    url: fulltextLandingUrl(target),
  });
  return `/discovery?${params.toString()}`;
}
