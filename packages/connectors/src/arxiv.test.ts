import { describe, expect, it } from "vitest";
import { StubHttpClient } from "@aurascholar/platform";
import type { HttpResponse } from "@aurascholar/platform";
import { arxivByid, arxivSearchByTitle } from "./arxiv";
import type { ConnectorContext } from "./client";

function ctxWith(http: StubHttpClient): ConnectorContext {
  return { http, mailto: "test@example.com" };
}

function xmlResponse(body: string): HttpResponse {
  return {
    status: 200,
    headers: { "content-type": "application/atom+xml" },
    body: new TextEncoder().encode(body),
  };
}

const ENTRY = (id: string, title: string) => `
  <entry>
    <id>http://arxiv.org/abs/${id}v1</id>
    <title>${title}</title>
    <summary>An abstract about ${title}.</summary>
    <published>2021-06-12T17:57:34Z</published>
    <author><name>Ada Lovelace</name></author>
    <author><name>Alan Turing</name></author>
  </entry>`;

describe("arxivByid", () => {
  it("parses a single entry", async () => {
    const http = new StubHttpClient();
    http.on(/id_list=2106\.01234/, () =>
      xmlResponse(`<feed>${ENTRY("2106.01234", "Attention Redux")}</feed>`),
    );
    const work = (await arxivByid(ctxWith(http), "2106.01234"))!;
    expect(work.title).toBe("Attention Redux");
    expect(work.arxivId).toBe("2106.01234");
    expect(work.year).toBe(2021);
    expect(work.oaPdfUrl).toBe("https://arxiv.org/pdf/2106.01234");
    expect(work.authors).toHaveLength(2);
  });
});

describe("arxivSearchByTitle", () => {
  it("returns multiple entries from a topic query", async () => {
    const http = new StubHttpClient();
    http.on(/search_query=/, () =>
      xmlResponse(
        `<feed>${ENTRY("2106.01234", "Graph Networks")}${ENTRY("2107.05555", "More Graph Networks")}</feed>`,
      ),
    );
    const works = await arxivSearchByTitle(ctxWith(http), "graph networks", 5);
    expect(works).toHaveLength(2);
    expect(works[0]?.arxivId).toBe("2106.01234");
    expect(works[1]?.arxivId).toBe("2107.05555");
    expect(http.requests[0]?.url).toContain("search_query=");
  });

  it("skips error entries", async () => {
    const http = new StubHttpClient();
    http.on(/search_query=/, () =>
      xmlResponse(`<feed><entry><title>Error</title></entry></feed>`),
    );
    const works = await arxivSearchByTitle(ctxWith(http), "nothing here", 5);
    expect(works).toEqual([]);
  });

  it("wraps plain text as ti/abs phrase and starts at 0 (regression)", async () => {
    const http = new StubHttpClient();
    http.on(/search_query=/, () => xmlResponse(`<feed></feed>`));
    await arxivSearchByTitle(ctxWith(http), "graph networks", 5);
    const url = decodeURIComponent(http.requests[0]!.url);
    expect(url).toContain('search_query=ti:"graph networks" OR abs:"graph networks"');
    expect(url).toContain("start=0");
  });

  it("passes a boolean query through verbatim and paginates with start", async () => {
    const http = new StubHttpClient();
    http.on(/search_query=/, () => xmlResponse(`<feed></feed>`));
    await arxivSearchByTitle(ctxWith(http), "transformer AND attention", 10, undefined, undefined, 2);
    const url = decodeURIComponent(http.requests[0]!.url);
    expect(url).toContain("search_query=transformer AND attention");
    expect(url).toContain("start=10");
  });

  it("adds au: for the author filter and submittedDate sort for year", async () => {
    const http = new StubHttpClient();
    http.on(/search_query=/, () => xmlResponse(`<feed></feed>`));
    await arxivSearchByTitle(ctxWith(http), "vision", 5, undefined, {
      author: "Hinton",
      sort: "year",
    });
    const url = decodeURIComponent(http.requests[0]!.url);
    expect(url).toContain('au:"Hinton"');
    expect(url).toContain("sortBy=submittedDate&sortOrder=descending");
  });
});
