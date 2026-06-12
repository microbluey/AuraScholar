import { describe, expect, it } from "vitest";
import { findDoiByTitle } from "./title-match";
import type { ConnectorContext } from "@aurascholar/connectors";

// Stub Crossref search via a fake HttpClient returning a canned response.
function ctxWithResults(items: unknown[]): ConnectorContext {
  return {
    mailto: "t@t.io",
    http: {
      async request() {
        return {
          status: 200,
          headers: {},
          body: new TextEncoder().encode(JSON.stringify({ message: { items } })),
        };
      },
    },
  };
}

const HIT = {
  DOI: "10.1109/test.2026.1",
  title: ["Adaptive Graph Learning for Traffic Forecasting"],
  "container-title": ["IEEE Transactions on Intelligent Transportation Systems"],
  author: [{ given: "Wei", family: "Zhang" }, { given: "Li", family: "Chen" }],
  score: 90,
};

describe("findDoiByTitle", () => {
  it("matches an exact title with high confidence", async () => {
    const r = await findDoiByTitle(
      ctxWithResults([HIT]),
      "Adaptive Graph Learning for Traffic Forecasting",
    );
    expect(r?.doi).toBe("10.1109/test.2026.1");
    expect(r?.confidence).toBeGreaterThan(0.9);
  });

  it("boosts confidence when venue hint agrees", async () => {
    const base = await findDoiByTitle(ctxWithResults([HIT]), "Adaptive Graph Learning for Traffic Forecasting");
    const boosted = await findDoiByTitle(
      ctxWithResults([HIT]),
      "Adaptive Graph Learning for Traffic Forecasting",
      { venue: "IEEE Transactions on Intelligent Transportation Systems" },
    );
    expect(boosted!.confidence).toBeGreaterThanOrEqual(base!.confidence);
  });

  it("penalizes when venue hint disagrees", async () => {
    const r = await findDoiByTitle(
      ctxWithResults([HIT]),
      "Adaptive Graph Learning for Traffic Forecasting",
      { venue: "Nature Machine Intelligence" },
    );
    expect(r!.confidence).toBeLessThan(0.85);
  });

  it("uses author hint (family name) as corroborator", async () => {
    const ok = await findDoiByTitle(
      ctxWithResults([HIT]),
      "Adaptive Graph Learning for Traffic Forecasting",
      { author: "Zhang" },
    );
    const bad = await findDoiByTitle(
      ctxWithResults([HIT]),
      "Adaptive Graph Learning for Traffic Forecasting",
      { author: "Wang" },
    );
    expect(ok!.confidence).toBeGreaterThan(bad!.confidence);
  });

  it("returns null when nothing comes back", async () => {
    expect(await findDoiByTitle(ctxWithResults([]), "anything")).toBeNull();
  });

  it("keeps evidence for the match decision", async () => {
    const r = await findDoiByTitle(ctxWithResults([HIT]), "Adaptive Graph Learning for Traffic Forecasting", { venue: "IEEE" });
    expect(r?.evidence["matched_doi"]).toBe("10.1109/test.2026.1");
    expect(r?.evidence["hints"]).toEqual({ venue: "IEEE" });
  });
});
