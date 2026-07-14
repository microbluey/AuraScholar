import { describe, expect, it } from "vitest";
import { findDoiByTitle } from "./title-match";
import type { ConnectorContext } from "@aurascholar/connectors";

// Routes the two search endpoints to separate canned responses.
function ctx(crossrefItems: unknown[], openalexResults: unknown[] = []): ConnectorContext {
  return {
    mailto: "t@t.io",
    http: {
      async request(req: { url: string }) {
        const isOpenAlex = req.url.includes("openalex.org");
        const payload = isOpenAlex
          ? { results: openalexResults }
          : { message: { items: crossrefItems } };
        return {
          status: 200,
          headers: {},
          body: new TextEncoder().encode(JSON.stringify(payload)),
        };
      },
    },
  };
}

function routedCtx(
  route: (url: string) => { status: number; body?: unknown },
): ConnectorContext {
  return {
    mailto: "t@t.io",
    http: {
      async request(req: { url: string }) {
        const response = route(req.url);
        return {
          status: response.status,
          headers: {},
          body: new TextEncoder().encode(JSON.stringify(response.body ?? {})),
        };
      },
    },
  };
}

const CR_HIT = {
  DOI: "10.1109/test.2026.1",
  title: ["Adaptive Graph Learning for Traffic Forecasting"],
  "container-title": ["IEEE Transactions on Intelligent Transportation Systems"],
  author: [{ given: "Wei", family: "Zhang" }, { given: "Li", family: "Chen" }],
  score: 90,
};

// arXiv-style record: DOI registered at DataCite → only visible via OpenAlex.
const OA_HIT = {
  id: "https://openalex.org/W2741809807",
  doi: "https://doi.org/10.48550/arxiv.1706.03762",
  display_name: "Attention Is All You Need",
  publication_year: 2017,
  primary_location: { source: { display_name: "arXiv" } },
  authorships: [{ author: { display_name: "Ashish Vaswani" } }],
};

describe("findDoiByTitle", () => {
  it("matches an exact title via Crossref", async () => {
    const r = await findDoiByTitle(ctx([CR_HIT]), "Adaptive Graph Learning for Traffic Forecasting");
    expect(r?.doi).toBe("10.1109/test.2026.1");
    expect(r?.source).toBe("crossref");
    expect(r?.confidence).toBeGreaterThan(0.9);
  });

  it("finds arXiv/DataCite DOIs via OpenAlex when Crossref has nothing", async () => {
    const r = await findDoiByTitle(ctx([], [OA_HIT]), "Attention Is All You Need");
    expect(r?.doi).toBe("10.48550/arxiv.1706.03762");
    expect(r?.source).toBe("openalex");
    expect(r?.confidence).toBeGreaterThan(0.9);
  });

  it("penalizes when venue hint disagrees", async () => {
    const r = await findDoiByTitle(ctx([CR_HIT]), "Adaptive Graph Learning for Traffic Forecasting", {
      venue: "Nature Machine Intelligence",
    });
    expect(r!.confidence).toBeLessThan(0.85);
  });

  it("treats missing venue as neutral (repository records)", async () => {
    const noVenue = { ...OA_HIT, primary_location: {} };
    const r = await findDoiByTitle(ctx([], [noVenue]), "Attention Is All You Need", {
      venue: "NeurIPS",
    });
    expect(r!.confidence).toBeGreaterThan(0.85); // not vetoed
  });

  it("uses author hint as corroborator", async () => {
    const ok = await findDoiByTitle(ctx([CR_HIT]), "Adaptive Graph Learning for Traffic Forecasting", { author: "Zhang" });
    const bad = await findDoiByTitle(ctx([CR_HIT]), "Adaptive Graph Learning for Traffic Forecasting", { author: "Wang" });
    expect(ok!.confidence).toBeGreaterThan(bad!.confidence);
  });

  it("returns null when both sources are empty", async () => {
    expect(await findDoiByTitle(ctx([], []), "anything")).toBeNull();
  });

  it("reports a failed title lookup when all sources fail", async () => {
    await expect(
      findDoiByTitle(routedCtx(() => ({ status: 403 })), "Unreachable Sentinel Title"),
    ).rejects.toThrow(/标题 DOI 检索失败:.*Crossref.*OpenAlex/);
  });

  it("continues when one title source fails but the other returns a confident hit", async () => {
    const r = await findDoiByTitle(
      routedCtx((url) =>
        url.includes("crossref.org")
          ? { status: 403 }
          : { status: 200, body: { results: [OA_HIT] } },
      ),
      "Attention Is All You Need",
    );

    expect(r?.doi).toBe("10.48550/arxiv.1706.03762");
    expect(r?.source).toBe("openalex");
  });

  it("keeps evidence including the winning source", async () => {
    const r = await findDoiByTitle(ctx([], [OA_HIT]), "Attention Is All You Need");
    expect(r?.evidence["matched_doi"]).toBe("10.48550/arxiv.1706.03762");
    expect(r?.evidence["source"]).toBe("openalex");
  });
});
