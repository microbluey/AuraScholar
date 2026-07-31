import { describe, expect, it } from "vitest";
import {
  reconcileProjectSourceSelection,
  toggleProjectSourceSelection,
  type ProjectLibraryWorkOption,
} from "./model";

function option(workId: string, inProject = false): ProjectLibraryWorkOption {
  return {
    annotationCount: 0,
    authorNames: [],
    inProject,
    pdfCount: 0,
    readingStatus: "unread",
    title: workId,
    venue: null,
    workId,
    year: null,
  };
}

describe("project source selection", () => {
  it("keeps selections across searches but removes newly unavailable works", () => {
    const selected = new Set(["work-a", "work-b", "work-offscreen"]);
    expect([
      ...reconcileProjectSourceSelection(selected, [option("work-a", true), option("work-b")]),
    ]).toEqual(["work-b", "work-offscreen"]);
  });

  it("toggles without mutating the previous selection", () => {
    const selected = new Set(["work-a"]);
    const next = toggleProjectSourceSelection(selected, "work-b", true);
    expect([...selected]).toEqual(["work-a"]);
    expect([...next]).toEqual(["work-a", "work-b"]);
    expect([...toggleProjectSourceSelection(next, "work-a", false)]).toEqual(["work-b"]);
  });
});
