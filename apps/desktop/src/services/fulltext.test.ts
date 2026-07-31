import { describe, expect, it } from "vitest";
import {
  bindFulltextTaskToTab,
  createFulltextTask,
  fulltextHandoffPath,
  fulltextLandingUrl,
  fulltextReturnPath,
  fulltextWorkHandoffPath,
  initialFulltextTask,
  normalizeFulltextReturnPath,
  parseFulltextTask,
} from "./fulltext";

const target = {
  arxivId: "2401.12345v2",
  doi: "10.1000/example",
  id: "work/with spaces",
  title: "A full-text handoff",
  url: "https://publisher.example/paper",
};

describe("full-text task contract", () => {
  it("keeps the legacy call signature while preserving source identifiers", () => {
    const path = fulltextHandoffPath(target);
    const params = new URLSearchParams(path.slice(path.indexOf("?") + 1));

    expect(params.get("pendingWorkId")).toBe(target.id);
    expect(params.get("pendingTitle")).toBe(target.title);
    expect(params.get("arxivId")).toBe(target.arxivId);
    expect(params.get("doi")).toBe(target.doi);
    expect(params.get("url")).toBe(target.url);
    expect(params.get("landingUrl")).toBe("https://arxiv.org/abs/2401.12345v2");
    expect(params.has("handoffId")).toBe(false);
    expect(params.has("origin")).toBe(false);
    expect(params.has("returnTo")).toBe(false);
    expect(initialFulltextTask(path)).toEqual({
      arxivId: target.arxivId,
      doi: target.doi,
      id: target.id,
      landingUrl: "https://arxiv.org/abs/2401.12345v2",
      title: target.title,
      url: target.url,
    });
  });

  it("parses legacy routes that only carried the pending identity and landing URL", () => {
    expect(
      parseFulltextTask(
        "?pendingWorkId=legacy-work&pendingTitle=Legacy+paper" +
          "&url=https%3A%2F%2Fdoi.org%2F10.1000%2Flegacy",
      ),
    ).toEqual({
      id: "legacy-work",
      landingUrl: "https://doi.org/10.1000/legacy",
      title: "Legacy paper",
      url: "https://doi.org/10.1000/legacy",
    });
  });

  it("round-trips task metadata without serializing the later tab binding", () => {
    const returnTo = fulltextReturnPath("reader", target.id);
    const path = fulltextHandoffPath(target, {
      handoffId: "handoff-1",
      origin: "reader",
      returnTo,
    });
    const parsed = parseFulltextTask(path);

    expect(parsed).toEqual({
      arxivId: target.arxivId,
      doi: target.doi,
      handoffId: "handoff-1",
      id: target.id,
      landingUrl: "https://arxiv.org/abs/2401.12345v2",
      origin: "reader",
      returnTo,
      title: target.title,
      url: target.url,
    });
    expect(path).not.toContain("targetTabId");
  });

  it("builds a unique Reader/Library recovery route with a safe return path", () => {
    const reader = parseFulltextTask(fulltextWorkHandoffPath(target, "reader"));
    const library = parseFulltextTask(fulltextWorkHandoffPath(target, "library"));

    expect(reader).toMatchObject({
      id: target.id,
      origin: "reader",
      returnTo: fulltextReturnPath("reader", target.id),
    });
    expect(library).toMatchObject({
      id: target.id,
      origin: "library",
      returnTo: fulltextReturnPath("library", target.id),
    });
    expect(reader?.handoffId).toBeTruthy();
    expect(library?.handoffId).toBeTruthy();
    expect(reader?.handoffId).not.toBe(library?.handoffId);
  });

  it("only accepts a reader or library return route for the same work", () => {
    const readerPath = fulltextReturnPath("reader", target.id);
    const libraryPath = fulltextReturnPath("library", target.id);

    expect(normalizeFulltextReturnPath(readerPath, target.id)).toBe(readerPath);
    expect(normalizeFulltextReturnPath(libraryPath, target.id)).toBe(libraryPath);
    expect(normalizeFulltextReturnPath("/reader?work=another-work", target.id)).toBeUndefined();
    expect(normalizeFulltextReturnPath(`${readerPath}&tab=annotations`, target.id)).toBeUndefined();
    expect(
      normalizeFulltextReturnPath(
        "https://attacker.example/reader?work=work%2Fwith+spaces",
        target.id,
      ),
    ).toBeUndefined();
    expect(
      normalizeFulltextReturnPath("/discovery?work=work%2Fwith+spaces", target.id),
    ).toBeUndefined();
  });

  it("drops unsafe task metadata at both construction and parsing boundaries", () => {
    const constructed = createFulltextTask(target, {
      origin: "reader",
      returnTo: "/library?work=another-work",
    });
    expect(constructed.returnTo).toBeUndefined();

    const parsed = parseFulltextTask(
      "?pendingWorkId=work-1&pendingTitle=Paper&url=https%3A%2F%2Fexample.test" +
        "&origin=unknown&returnTo=%2Freader%3Fwork%3Dwork-2&targetTabId=attacker-tab",
    );
    expect(parsed).toEqual({
      id: "work-1",
      landingUrl: "https://example.test/",
      title: "Paper",
      url: "https://example.test/",
    });
  });

  it("binds a task to one tab without mutating or allowing reassignment", () => {
    const task = createFulltextTask(target, { handoffId: "handoff-2" });
    const bound = bindFulltextTaskToTab(task, "research-tab-1");

    expect(task.targetTabId).toBeUndefined();
    expect(bound).toEqual({ ...task, targetTabId: "research-tab-1" });
    expect(bindFulltextTaskToTab(bound, "research-tab-1")).toBe(bound);
    expect(() => bindFulltextTaskToTab(bound, "research-tab-2")).toThrow(
      "already bound to another tab",
    );
    expect(() => bindFulltextTaskToTab(task, " ")).toThrow("requires a target tab id");
  });

  it("requires the legacy target identity and preserves landing-url priority", () => {
    expect(parseFulltextTask("?pendingTitle=Paper")).toBeNull();
    expect(parseFulltextTask("?pendingWorkId=work-1")).toBeNull();
    expect(fulltextLandingUrl({ ...target, arxivId: null })).toBe(
      "https://doi.org/10.1000/example",
    );
    expect(fulltextLandingUrl({ ...target, arxivId: null, doi: null })).toBe(target.url);
    expect(
      fulltextLandingUrl({
        id: "work-1",
        title: "Unsafe source",
        url: "javascript:alert(1)",
      }),
    ).toBe("https://scholar.google.com/scholar?q=Unsafe%20source");
    expect(fulltextLandingUrl({ id: "work-1", title: "Graph retrieval & ranking" })).toBe(
      "https://scholar.google.com/scholar?q=Graph%20retrieval%20%26%20ranking",
    );
  });
});
