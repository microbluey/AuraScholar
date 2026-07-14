import { describe, expect, it } from "vitest";
import { layoutTimeline } from "./layout";
import type { CitationGraph } from "./build";

function makeGraph(): CitationGraph {
  return {
    centerId: "W1",
    truncated: false,
    nodes: [
      { id: "W1", title: "Center", year: 2020, citedByCount: 100, relation: "center" },
      { id: "W2", title: "Old ref", year: 2015, citedByCount: 5000, relation: "reference" },
      { id: "W3", title: "Recent ref", year: 2019, citedByCount: 50, relation: "reference" },
      { id: "W4", title: "Citer A", year: 2022, citedByCount: 10, relation: "citer" },
      { id: "W5", title: "Citer B", year: 2023, citedByCount: 3, relation: "citer" },
      { id: "W6", title: "Same-year citer", year: 2023, citedByCount: 8, relation: "citer" },
      { id: "W7", title: "No year", year: undefined, citedByCount: 1, relation: "reference" },
    ],
    edges: [
      { source: "W1", target: "W2" },
      { source: "W1", target: "W3" },
      { source: "W4", target: "W1" },
      { source: "W5", target: "W1" },
      { source: "W6", target: "W1" },
      { source: "W4", target: "W2" },
    ],
  };
}

describe("layoutTimeline", () => {
  it("orders x strictly by year", () => {
    const layout = layoutTimeline(makeGraph());
    const x = Object.fromEntries(layout.nodes.map((n) => [n.id, n.x]));
    expect(x.W2).toBeLessThan(x.W3!); // 2015 < 2019
    expect(x.W3).toBeLessThan(x.W1!); // 2019 < 2020
    expect(x.W1).toBeLessThan(x.W4!); // 2020 < 2022
    expect(x.W4).toBeLessThan(x.W5!); // 2022 < 2023
    expect(x.W5).toBe(x.W6!); // same year → same column
  });

  it("separates same-column nodes vertically", () => {
    const layout = layoutTimeline(makeGraph());
    const w5 = layout.nodes.find((n) => n.id === "W5")!;
    const w6 = layout.nodes.find((n) => n.id === "W6")!;
    expect(Math.abs(w5.y - w6.y)).toBeGreaterThan(w5.size + w6.size);
  });

  it("sizes nodes by citation count", () => {
    const layout = layoutTimeline(makeGraph());
    const heavily = layout.nodes.find((n) => n.id === "W2")!;
    const lightly = layout.nodes.find((n) => n.id === "W5")!;
    expect(heavily.size).toBeGreaterThan(lightly.size);
  });

  it("caps highly cited nodes so they cannot overwhelm the canvas", () => {
    const graph = makeGraph();
    graph.nodes[0]!.citedByCount = 10_000_000;
    const layout = layoutTimeline(graph);
    expect(layout.nodes.find((node) => node.id === "W1")!.size).toBeLessThanOrEqual(22);
  });

  it("keeps all nodes inside the canvas", () => {
    const layout = layoutTimeline(makeGraph());
    for (const n of layout.nodes) {
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(layout.height);
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(layout.width);
    }
  });

  it("interpolates missing years instead of dropping nodes", () => {
    const layout = layoutTimeline(makeGraph());
    expect(layout.nodes.find((n) => n.id === "W7")).toBeDefined();
  });

  it("is deterministic", () => {
    const a = layoutTimeline(makeGraph());
    const b = layoutTimeline(makeGraph());
    expect(a.nodes.map((n) => [n.id, n.x, n.y])).toEqual(b.nodes.map((n) => [n.id, n.x, n.y]));
  });
});
