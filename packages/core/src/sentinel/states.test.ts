import { describe, expect, it } from "vitest";
import { deriveMilestones, isTerminal, nextPollInterval, stateRank } from "./states";

describe("deriveMilestones", () => {
  it("returns accepted-only when nothing resolves", () => {
    const out = deriveMilestones({ crossref: null, openalex: null });
    expect(out.reached).toHaveLength(0);
    expect(out.highestState).toBe("accepted");
  });

  it("detects registration when Crossref resolves without dates", () => {
    const out = deriveMilestones({
      crossref: { DOI: "10.1/x", title: ["T"] },
      openalex: null,
    });
    expect(out.reached.map((m) => m.state)).toEqual(["registered"]);
    expect(out.highestState).toBe("registered");
  });

  it("detects online from published-online date", () => {
    const out = deriveMilestones({
      crossref: { DOI: "10.1/x", "published-online": { "date-parts": [[2026, 5, 1]] } },
      openalex: null,
    });
    expect(out.reached.map((m) => m.state)).toContain("online");
    expect(out.highestState).toBe("online");
  });

  it("detects in_issue from volume+issue", () => {
    const out = deriveMilestones({
      crossref: {
        DOI: "10.1/x",
        "published-online": { "date-parts": [[2026, 5, 1]] },
        volume: "12",
        issue: "3",
        page: "100-115",
      },
      openalex: null,
    });
    expect(out.highestState).toBe("in_issue");
  });

  it("treats volume+page (no issue) as in_issue too", () => {
    const out = deriveMilestones({
      crossref: { DOI: "10.1/x", volume: "12", page: "100-115" },
      openalex: null,
    });
    expect(out.reached.map((m) => m.state)).toContain("in_issue");
  });

  it("detects OpenAlex and PubMed indexing", () => {
    const out = deriveMilestones({
      crossref: null,
      openalex: {
        id: "https://openalex.org/W123",
        ids: { pmid: "https://pubmed.ncbi.nlm.nih.gov/12345" },
      },
    });
    const states = out.reached.map((m) => m.state);
    expect(states).toContain("indexed_openalex");
    expect(states).toContain("indexed_pubmed");
    expect(states).toContain("online"); // OpenAlex presence implies online
  });

  it("keeps evidence snapshots in milestones", () => {
    const out = deriveMilestones({
      crossref: { DOI: "10.1/x", volume: "1", issue: "2", ISSN: ["1234-5678"] },
      openalex: null,
    });
    const inIssue = out.reached.find((m) => m.state === "in_issue")!;
    expect(inIssue.evidence["volume"]).toBe("1");
    expect(inIssue.evidence["ISSN"]).toEqual(["1234-5678"]);
    expect(inIssue.source).toBe("crossref");
  });
});

describe("nextPollInterval", () => {
  it("polls early states daily-ish and later states weekly-ish", () => {
    expect(nextPollInterval("accepted", 0)).toBeGreaterThan(0.8 * 86_400);
    expect(nextPollInterval("accepted", 0)).toBeLessThan(1.3 * 86_400);
    expect(nextPollInterval("in_issue", 0)).toBeGreaterThan(6 * 86_400);
  });

  it("backs off on errors with a cap", () => {
    const base = nextPollInterval("accepted", 0);
    const backedOff = nextPollInterval("accepted", 10);
    expect(backedOff).toBeGreaterThan(base * 2);
    expect(backedOff).toBeLessThan(base * 6); // capped at 4x + jitter
  });
});

describe("isTerminal", () => {
  it("defaults to terminal at indexed rank", () => {
    expect(isTerminal("indexed_openalex", [])).toBe(true);
    expect(isTerminal("in_issue", [])).toBe(false);
  });
  it("respects explicit targets", () => {
    expect(isTerminal("online", ["online"])).toBe(true);
    expect(isTerminal("online", ["in_issue"])).toBe(false);
  });
});

describe("stateRank", () => {
  it("is monotonic along the pipeline", () => {
    expect(stateRank("accepted")).toBeLessThan(stateRank("registered"));
    expect(stateRank("registered")).toBeLessThan(stateRank("online"));
    expect(stateRank("online")).toBeLessThan(stateRank("in_issue"));
    expect(stateRank("in_issue")).toBeLessThan(stateRank("indexed_openalex"));
  });
});
