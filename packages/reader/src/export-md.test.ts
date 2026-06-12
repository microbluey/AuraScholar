import { describe, expect, it } from "vitest";
import { annotationsToMarkdown } from "./export-md";
import type { ReaderAnnotation } from "./annotations";

function ann(over: Partial<ReaderAnnotation>): ReaderAnnotation {
  return {
    id: "a1",
    type: "highlight",
    color: "#ffd866",
    pageIndex: 0,
    anchor: { version: 1, pageIndex: 0 },
    ...over,
  };
}

describe("annotationsToMarkdown", () => {
  it("renders header with metadata", () => {
    const md = annotationsToMarkdown(
      { title: "Attention Is All You Need", authors: ["Vaswani"], year: 2017, doi: "10.1/x" },
      [],
    );
    expect(md).toContain("# Attention Is All You Need");
    expect(md).toContain("Vaswani · 2017");
    expect(md).toContain("doi.org/10.1/x");
  });

  it("groups by page and orders by position", () => {
    const md = annotationsToMarkdown({ title: "T" }, [
      ann({
        id: "later",
        pageIndex: 1,
        anchor: { version: 1, pageIndex: 1, quote: { exact: "page two text", prefix: "", suffix: "" } },
      }),
      ann({
        id: "second-on-page",
        pageIndex: 0,
        anchor: {
          version: 1,
          pageIndex: 0,
          quote: { exact: "second quote", prefix: "", suffix: "" },
          position: { start: 500, end: 510 },
        },
      }),
      ann({
        id: "first-on-page",
        pageIndex: 0,
        anchor: {
          version: 1,
          pageIndex: 0,
          quote: { exact: "first quote", prefix: "", suffix: "" },
          position: { start: 10, end: 20 },
        },
        contentMd: "我的想法",
      }),
    ]);
    expect(md.indexOf("## 第 1 页")).toBeLessThan(md.indexOf("## 第 2 页"));
    expect(md.indexOf("first quote")).toBeLessThan(md.indexOf("second quote"));
    expect(md).toContain("我的想法");
  });

  it("flags orphaned annotations", () => {
    const md = annotationsToMarkdown({ title: "T" }, [
      ann({
        orphaned: true,
        anchor: { version: 1, pageIndex: 0, quote: { exact: "gone text", prefix: "", suffix: "" } },
      }),
    ]);
    expect(md).toContain("原文位置已失效");
  });
});
