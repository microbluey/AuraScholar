import type { ScholarIdentity } from "../shared";

/** Match previously sniffed full-text URLs back to their scholarly identity. */
export class ResearchBrowserIdentityIndex {
  private readonly byPdfUrl = new Map<string, ScholarIdentity>();

  clear(): void {
    this.byPdfUrl.clear();
  }

  remember(identity: ScholarIdentity): void {
    if (identity.pdfUrl) this.byPdfUrl.set(identity.pdfUrl, identity);
  }

  lookup(url: string): ScholarIdentity | undefined {
    const direct = this.byPdfUrl.get(url);
    if (direct) return direct;
    const key = urlKey(url);
    for (const [pdfUrl, identity] of this.byPdfUrl) {
      if (urlKey(pdfUrl) === key) return identity;
    }
    return undefined;
  }

  resolve(
    tabIdentity: ScholarIdentity | undefined,
    downloadUrl: string,
  ): ScholarIdentity | undefined {
    return tabIdentity ?? this.lookup(downloadUrl);
  }
}

/** Normalize a URL for matching: drop hash, trailing slash, force https host. */
function urlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return `${parsed.host}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
