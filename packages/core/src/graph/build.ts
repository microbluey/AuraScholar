// Citation graph construction: one-hop neighborhood around a center work
// from OpenAlex (referenced_works = outgoing, cites filter = incoming), plus
// edges among neighbors so clusters are visible.
import {
  openalexByDoi,
  openalexById,
  openalexCitedBy,
  type ConnectorContext,
  type OpenAlexWork,
} from "@aurascholar/connectors";

export type GraphRelation = "center" | "reference" | "citer";

export interface GraphNode {
  /** OpenAlex short id, e.g. "W2741809807". */
  id: string;
  title: string;
  year?: number;
  citedByCount: number;
  doi?: string;
  venue?: string;
  firstAuthor?: string;
  relation: GraphRelation;
}

export interface GraphEdge {
  /** Citing node id. */
  source: string;
  /** Cited node id. */
  target: string;
}

export interface CitationGraph {
  centerId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** True when reference lists were truncated for budget. */
  truncated: boolean;
}

const MAX_REFERENCES = 40;
const MAX_CITERS = 40;

function shortId(openalexUrl: string): string {
  return openalexUrl.replace(/^https:\/\/openalex\.org\//, "");
}

function toNode(w: OpenAlexWork, relation: GraphRelation): GraphNode {
  return {
    id: shortId(w.id),
    title: w.display_name ?? w.title ?? "(untitled)",
    year: w.publication_year,
    citedByCount: w.cited_by_count ?? 0,
    doi: w.doi?.replace(/^https:\/\/doi\.org\//, "").toLowerCase(),
    venue: w.primary_location?.source?.display_name,
    firstAuthor: w.authorships?.[0]?.author?.display_name,
    relation,
  };
}

/**
 * Builds the neighborhood graph for a work identified by DOI or OpenAlex id.
 * Reference detail fetches are batched via the OpenAlex filter API.
 */
export async function buildCitationGraph(
  ctx: ConnectorContext,
  opts: { doi?: string; openalexId?: string },
): Promise<CitationGraph | null> {
  const center = opts.openalexId
    ? await openalexById(ctx, opts.openalexId)
    : opts.doi
      ? await openalexByDoi(ctx, opts.doi)
      : null;
  if (!center) return null;

  const centerId = shortId(center.id);
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  nodes.set(centerId, toNode(center, "center"));

  // --- References (center cites them) ---
  const refIds = (center.referenced_works ?? []).map(shortId);
  const keptRefs = refIds.slice(0, MAX_REFERENCES);
  const refs = await fetchWorksBatch(ctx, keptRefs);
  for (const r of refs) {
    const id = shortId(r.id);
    if (!nodes.has(id)) nodes.set(id, toNode(r, "reference"));
    edges.push({ source: centerId, target: id });
  }

  // --- Citers (they cite center) ---
  const citers = await openalexCitedBy(ctx, centerId, MAX_CITERS);
  for (const c of citers) {
    const id = shortId(c.id);
    if (!nodes.has(id)) nodes.set(id, toNode(c, "citer"));
    edges.push({ source: id, target: centerId });
  }

  // --- Edges among neighbors (visible clusters) ---
  // Citers' reference lists are already in the citers payload; check which
  // ones point at nodes we kept. Same for references→references.
  const kept = new Set(nodes.keys());
  for (const c of [...citers, ...refs]) {
    const from = shortId(c.id);
    for (const refUrl of c.referenced_works ?? []) {
      const to = shortId(refUrl);
      if (from !== centerId && to !== centerId && kept.has(to) && kept.has(from)) {
        edges.push({ source: from, target: to });
      }
    }
  }

  // Dedup edges
  const seen = new Set<string>();
  const uniqueEdges = edges.filter((e) => {
    const key = `${e.source}→${e.target}`;
    if (seen.has(key) || e.source === e.target) return false;
    seen.add(key);
    return true;
  });

  return {
    centerId,
    nodes: [...nodes.values()],
    edges: uniqueEdges,
    truncated: refIds.length > keptRefs.length,
  };
}

/** Batch-fetch works by id via the filter API (50 per request max). */
async function fetchWorksBatch(ctx: ConnectorContext, ids: string[]): Promise<OpenAlexWork[]> {
  if (ids.length === 0) return [];
  const { getJson } = await import("@aurascholar/connectors");
  const out: OpenAlexWork[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data = await getJson<{ results: OpenAlexWork[] }>(
      ctx,
      `https://api.openalex.org/works?filter=openalex_id:${batch.join("|")}&per-page=50&mailto=${encodeURIComponent(ctx.mailto)}`,
    );
    out.push(...(data.results ?? []));
  }
  return out;
}
