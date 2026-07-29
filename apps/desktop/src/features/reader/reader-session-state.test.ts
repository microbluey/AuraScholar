import { describe, expect, it } from "vitest";
import type { ReaderAnnotation } from "@aurascholar/reader";
import {
  readReaderSessionOwnedValue,
  rollbackReaderAnnotationContent,
  updateReaderSessionOwnedValue,
} from "./reader-session-state";
import type { ReaderSessionGeneration } from "./reader-session-coordinator";

function annotation(id: string, contentMd?: string): ReaderAnnotation {
  return {
    id,
    type: "highlight",
    color: "#ffd866",
    pageIndex: 0,
    anchor: {
      version: 1,
      pageIndex: 0,
      quote: { exact: id, prefix: "", suffix: "" },
    },
    contentMd,
  };
}

describe("reader session state", () => {
  it("starts a new generation from the fallback instead of leaking prior document state", () => {
    const generationA = 1 as ReaderSessionGeneration;
    const generationB = 2 as ReaderSessionGeneration;
    const stateA = updateReaderSessionOwnedValue(
      { generation: null, value: [] as string[] },
      generationA,
      [],
      ["A translation"],
    );
    const stateB = updateReaderSessionOwnedValue(stateA, generationB, [], (current) => [
      ...current,
      "B translation",
    ]);

    expect(readReaderSessionOwnedValue(stateA, generationB, [])).toEqual([]);
    expect(readReaderSessionOwnedValue(stateB, generationB, [])).toEqual(["B translation"]);
  });

  it("rolls back only the failed optimistic comment and preserves concurrent list changes", () => {
    const concurrent = annotation("concurrent", "new");
    const result = rollbackReaderAnnotationContent(
      [annotation("target", "attempted"), concurrent],
      "target",
      "attempted",
      "previous",
    );

    expect(result).toEqual([annotation("target", "previous"), concurrent]);
  });

  it("does not overwrite a newer edit that replaced the failed optimistic value", () => {
    const newer = annotation("target", "newer");

    expect(rollbackReaderAnnotationContent([newer], "target", "attempted", "previous")).toEqual([
      newer,
    ]);
  });
});
