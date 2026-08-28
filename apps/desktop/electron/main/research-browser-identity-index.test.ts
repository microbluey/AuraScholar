import { describe, expect, it } from "vitest";
import { ResearchBrowserIdentityIndex } from "./research-browser-identity-index";

describe("research browser identity index", () => {
  it("matches remembered full-text URLs despite a hash or trailing slash", () => {
    const index = new ResearchBrowserIdentityIndex();
    const identity = {
      doi: "10.1000/example",
      pdfUrl: "https://example.edu/paper.pdf#viewer",
      title: "Example paper",
    };

    index.remember(identity);

    expect(index.lookup("https://example.edu/paper.pdf/")).toEqual(identity);
  });

  it("prefers the source tab identity and clears remembered identities", () => {
    const index = new ResearchBrowserIdentityIndex();
    const remembered = { doi: "10.1000/remembered", pdfUrl: "https://example.edu/paper.pdf" };
    const sourceTab = { doi: "10.1000/source-tab" };
    index.remember(remembered);

    expect(index.resolve(sourceTab, "https://example.edu/paper.pdf")).toEqual(sourceTab);

    index.clear();

    expect(index.lookup("https://example.edu/paper.pdf")).toBeUndefined();
  });
});
