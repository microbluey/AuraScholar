// Unpaywall — legal OA PDF discovery by DOI. Requires a contact email.
// https://unpaywall.org/products/api
import { getJson, type ConnectorContext } from "./client";

interface UnpaywallResponse {
  is_oa: boolean;
  best_oa_location?: {
    url_for_pdf?: string;
    url?: string;
    version?: string;
    license?: string;
  };
}

export interface OaLocation {
  pdfUrl: string;
  version?: string;
  license?: string;
}

export async function unpaywallPdf(
  ctx: ConnectorContext,
  doi: string,
): Promise<OaLocation | null> {
  try {
    const data = await getJson<UnpaywallResponse>(
      ctx,
      `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(ctx.mailto)}`,
    );
    const loc = data.best_oa_location;
    const pdfUrl = loc?.url_for_pdf ?? undefined;
    if (!data.is_oa || !pdfUrl) return null;
    return { pdfUrl, version: loc?.version, license: loc?.license };
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}
