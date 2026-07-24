import { describe, expect, it } from "vitest";
import { applyMarkdownFormat } from "./markdown-edit";

describe("canvas markdown formatting", () => {
  it("wraps the selected text and keeps it selected", () => {
    expect(applyMarkdownFormat("hello world", 6, 11, "bold")).toEqual({
      value: "hello **world**",
      selectionStart: 8,
      selectionEnd: 13,
    });
  });

  it("inserts an editable fallback when no text is selected", () => {
    expect(applyMarkdownFormat("", 0, 0, "link")).toEqual({
      value: "[链接文字](https://)",
      selectionStart: 1,
      selectionEnd: 5,
    });
  });

  it("prefixes every selected line", () => {
    expect(applyMarkdownFormat("alpha\nbeta", 0, 10, "quote")).toEqual({
      value: "> alpha\n> beta",
      selectionStart: 2,
      selectionEnd: 14,
    });
  });
});
