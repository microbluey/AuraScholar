import { describe, expect, it } from "vitest";
import type { CanvasLibraryWork } from "./model";
import {
  buildCanvasCommandItems,
  clampCanvasCommandIndex,
  isCanvasAiCommandQuery,
  resolveCanvasCommandKey,
} from "./canvas-command";

function work(
  id: string,
  title: string,
  overrides: Partial<CanvasLibraryWork> = {},
): CanvasLibraryWork {
  return {
    abstract: null,
    authorNames: [],
    doi: null,
    id,
    readingStatus: "unread",
    title,
    venue: null,
    year: null,
    ...overrides,
  };
}

const WORKS = [
  work("paper-1", "Knowledge Graphs for Explainable AI", {
    authorNames: ["A. Sharma", "L. Chen"],
    venue: "Journal of AI Research",
    year: 2023,
  }),
  work("paper-2", "Retrieval-Augmented Generation for Knowledge-Intensive NLP", {
    authorNames: ["P. Lewis"],
    venue: "NeurIPS",
    year: 2020,
  }),
  work("paper-3", "Causal Reasoning over Scholarly Knowledge Graphs", {
    authorNames: ["R. Ito"],
    tags: ["causal inference", "evidence"],
    venue: "KDD",
    year: 2022,
  }),
];

describe("canvas command items", () => {
  it("shows a bounded, explicitly ordered common-paper list for an empty query", () => {
    const items = buildCanvasCommandItems({
      addedWorkIds: new Set(["paper-2"]),
      canSynthesize: false,
      commonLimit: 2,
      commonWorkIds: ["missing", "paper-2", "paper-2"],
      query: "   ",
      works: WORKS,
    });

    expect(items.map((item) => item.id)).toEqual(["work:paper-2", "work:paper-1"]);
    expect(items[0]).toMatchObject({ added: true, group: "常用论文", kind: "work" });
    expect(items[1]).toMatchObject({ added: false, group: "常用论文", kind: "work" });
  });

  it.each([
    ["explainable", ["paper-1"]],
    ["sharma", ["paper-1"]],
    ["neurips", ["paper-2"]],
    ["2022", ["paper-3"]],
    ["evidence", ["paper-3"]],
    ["knowledge 2020", ["paper-2"]],
  ])("searches title, author, venue, year, and combined tokens: %s", (query, expectedIds) => {
    const items = buildCanvasCommandItems({
      addedWorkIds: new Set(),
      canSynthesize: false,
      query,
      works: WORKS,
    });

    expect(items.map((item) => (item.kind === "work" ? item.work.id : item.synthesisType))).toEqual(
      expectedIds,
    );
    expect(items.every((item) => item.group === "文献搜索")).toBe(true);
  });

  it("marks an already-added search result without removing it", () => {
    const [item] = buildCanvasCommandItems({
      addedWorkIds: new Set(["paper-1"]),
      canSynthesize: false,
      query: "Sharma",
      works: WORKS,
    });

    expect(item).toMatchObject({ added: true, id: "work:paper-1", kind: "work" });
  });

  it("preserves results already matched by the database search", () => {
    const abstractOnlyResult = work("paper-abstract", "A Different Title", {
      abstract: "Retrieval augmented generation",
    });
    const items = buildCanvasCommandItems({
      addedWorkIds: new Set(),
      canSynthesize: false,
      prefilteredSearchResults: true,
      query: "retrieval/augmented",
      works: [abstractOnlyResult],
    });

    expect(items).toMatchObject([{ id: "work:paper-abstract", kind: "work" }]);
  });

  it("switches every /ai-prefixed query to four stable synthesis actions", () => {
    expect(isCanvasAiCommandQuery(" /AI methodology")).toBe(true);
    const items = buildCanvasCommandItems({
      addedWorkIds: new Set(),
      canSynthesize: false,
      query: "/ai methodology",
      synthesisHint: "请选择 2–10 张来源卡片",
      works: WORKS,
    });

    expect(items).toHaveLength(4);
    expect(
      items.map((item) => (item.kind === "synthesis" ? item.synthesisType : item.work.id)),
    ).toEqual(["methodology_matrix", "contradiction_analysis", "research_gap", "tldr"]);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disabled: true,
          disabledReason: "请选择 2–10 张来源卡片",
          kind: "synthesis",
        }),
      ]),
    );
  });

  it("enables all synthesis actions when the current selection can be synthesized", () => {
    const items = buildCanvasCommandItems({
      addedWorkIds: new Set(),
      canSynthesize: true,
      query: "/ai",
      works: WORKS,
    });

    expect(items.every((item) => item.kind === "synthesis" && !item.disabled)).toBe(true);
  });
});

describe("canvas command keyboard navigation", () => {
  it("wraps Arrow keys and supports Home and End", () => {
    expect(resolveCanvasCommandKey({ currentIndex: 3, itemCount: 4, key: "ArrowDown" })).toEqual({
      handled: true,
      nextIndex: 0,
    });
    expect(resolveCanvasCommandKey({ currentIndex: 0, itemCount: 4, key: "ArrowUp" })).toEqual({
      handled: true,
      nextIndex: 3,
    });
    expect(resolveCanvasCommandKey({ currentIndex: 2, itemCount: 4, key: "Home" })).toEqual({
      handled: true,
      nextIndex: 0,
    });
    expect(resolveCanvasCommandKey({ currentIndex: 1, itemCount: 4, key: "End" })).toEqual({
      handled: true,
      nextIndex: 3,
    });
  });

  it("resolves Enter and Escape actions without moving the active item", () => {
    expect(resolveCanvasCommandKey({ currentIndex: 2, itemCount: 4, key: "Enter" })).toEqual({
      action: "activate",
      handled: true,
      nextIndex: 2,
    });
    expect(resolveCanvasCommandKey({ currentIndex: 2, itemCount: 4, key: "Escape" })).toEqual({
      action: "close",
      handled: true,
      nextIndex: 2,
    });
    expect(resolveCanvasCommandKey({ currentIndex: 0, itemCount: 0, key: "Enter" })).toEqual({
      handled: true,
      nextIndex: 0,
    });
  });

  it("ignores IME composition and modified shortcuts, and suppresses repeated activation", () => {
    expect(
      resolveCanvasCommandKey({
        composing: true,
        currentIndex: 1,
        itemCount: 3,
        key: "Enter",
      }),
    ).toEqual({ handled: false, nextIndex: 1 });
    expect(
      resolveCanvasCommandKey({
        currentIndex: 1,
        itemCount: 3,
        key: "ArrowDown",
        metaKey: true,
      }),
    ).toEqual({ handled: false, nextIndex: 1 });
    expect(
      resolveCanvasCommandKey({
        currentIndex: 1,
        itemCount: 3,
        key: "Enter",
        repeat: true,
      }),
    ).toEqual({ handled: true, nextIndex: 1 });
  });

  it("clamps stale active indices after result changes", () => {
    expect(clampCanvasCommandIndex(8, 3)).toBe(2);
    expect(clampCanvasCommandIndex(-4, 3)).toBe(0);
    expect(clampCanvasCommandIndex(4, 0)).toBe(0);
  });
});
