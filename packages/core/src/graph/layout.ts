// Timeline hybrid layout — the readable alternative to force-directed hairballs:
//   x = publication year (fixed; missing years interpolate to the median)
//   y = collision-avoiding relaxation that pulls connected nodes together
// Node size uses a capped log scale so highly cited papers remain legible.
import type { CitationGraph, GraphEdge, GraphNode } from "./build.js";

export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
  /** Render size in arbitrary units (view scales). */
  size: number;
}

export interface GraphLayout {
  nodes: PositionedNode[];
  edges: GraphEdge[];
  /** Year ticks for the x-axis. */
  years: number[];
  width: number;
  height: number;
}

const WIDTH = 1000;
const HEIGHT = 600;
const MARGIN = 60;
const ITERATIONS = 60;
const MIN_NODE_SIZE = 5;
const MAX_NODE_SIZE = 22;

function nodeSize(citedByCount: number): number {
  return Math.min(MAX_NODE_SIZE, MIN_NODE_SIZE + Math.log10(citedByCount + 1) * 3);
}

export function layoutTimeline(graph: CitationGraph): GraphLayout {
  const known = graph.nodes.filter((n) => n.year).map((n) => n.year!);
  const minYear = known.length ? Math.min(...known) : 2000;
  const maxYear = known.length ? Math.max(...known) : 2025;
  const span = Math.max(1, maxYear - minYear);
  const medianYear = known.length
    ? [...known].sort((a, b) => a - b)[Math.floor(known.length / 2)]!
    : minYear;

  const xFor = (year: number | undefined) =>
    MARGIN + (((year ?? medianYear) - minYear) / span) * (WIDTH - 2 * MARGIN);

  // Initial placement: x by year; y stratified by relation so references
  // start above and citers below the center band, then relax.
  const laneOf = (n: GraphNode) =>
    n.relation === "center" ? 0.5 : n.relation === "reference" ? 0.28 : 0.72;
  const nodes: PositionedNode[] = graph.nodes.map((n, i) => ({
    ...n,
    x: xFor(n.year),
    y: HEIGHT * laneOf(n) + ((i * 37) % 120) - 60, // deterministic jitter
    size: nodeSize(n.citedByCount),
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const center = byId.get(graph.centerId);
  if (center) {
    center.y = HEIGHT / 2;
    center.size = Math.max(center.size, 10);
  }

  // Adjacency for the attraction pass.
  const neighbors = new Map<string, string[]>();
  for (const e of graph.edges) {
    (neighbors.get(e.source) ?? neighbors.set(e.source, []).get(e.source)!).push(e.target);
    (neighbors.get(e.target) ?? neighbors.set(e.target, []).get(e.target)!).push(e.source);
  }

  // Relaxation: attract along edges (y only), repel vertical overlaps.
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const t = 1 - iter / ITERATIONS; // cooling
    for (const n of nodes) {
      if (n.relation === "center") continue;
      // Attraction toward neighbor mean y
      const ns = neighbors.get(n.id);
      if (ns?.length) {
        let sum = 0;
        for (const id of ns) sum += byId.get(id)?.y ?? n.y;
        n.y += (sum / ns.length - n.y) * 0.15 * t;
      }
    }
    // Pairwise vertical separation within year columns (cheap n² is fine ≤100 nodes)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = a.x - b.x;
        if (Math.abs(dx) > 40) continue;
        const minGap = a.size + b.size + 6;
        const dy = a.y - b.y;
        const dist = Math.abs(dy) || 0.01;
        if (dist < minGap) {
          const push = ((minGap - dist) / 2) * (dy >= 0 ? 1 : -1) * t;
          if (a.relation !== "center") a.y += push;
          if (b.relation !== "center") b.y -= push;
        }
      }
    }
    // Clamp inside canvas
    for (const n of nodes) {
      n.y = Math.max(MARGIN, Math.min(HEIGHT - MARGIN, n.y));
    }
  }

  const years: number[] = [];
  const step = span <= 10 ? 1 : span <= 25 ? 5 : 10;
  for (let y = Math.ceil(minYear / step) * step; y <= maxYear; y += step) years.push(y);

  return { nodes, edges: graph.edges, years, width: WIDTH, height: HEIGHT };
}
