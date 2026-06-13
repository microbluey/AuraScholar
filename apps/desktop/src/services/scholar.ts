// Live enrichment from Semantic Scholar for the detail panel: tldr (AI summary)
// and citation signals. Fetched on demand by DOI — these aren't stored on the
// work (they drift over time and not every paper is in S2), so the panel shows
// them as live, best-effort context.
import { s2EnrichByDoi, type ConnectorContext, type S2Enrichment } from "@aurascholar/connectors";
import { tauriHttp } from "./tauri-platform";

const ctx: ConnectorContext = { http: tauriHttp, mailto: "contact@aurascholar.app" };

export type { S2Enrichment };

export async function fetchScholarEnrichment(doi: string): Promise<S2Enrichment | null> {
  return s2EnrichByDoi(ctx, doi);
}
