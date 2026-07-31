import { describe, expect, it } from "vitest";
import type { FulltextTask } from "../../services/fulltext";
import type { IngestDraft } from "../../services/library-types";
import { planFulltextDownload } from "./fulltext-download-plan";

function draft(overrides: Partial<IngestDraft> = {}): IngestDraft {
  return {
    source: "browser",
    candidates: [],
    bestIndex: -1,
    confidence: 0,
    pdf: null,
    dedup: null,
    fallbackTitle: "Captured PDF",
    pdfFields: null,
    localMatches: [],
    ...overrides,
  };
}

const task: FulltextTask = {
  handoffId: "handoff-a",
  id: "work-a",
  landingUrl: "https://doi.org/10.1000/a",
  targetTabId: "tab-a",
  title: "Target A",
};

describe("planFulltextDownload", () => {
  it("only applies the target to a download from its bound tab", () => {
    const unrelated = draft();
    expect(planFulltextDownload(task, "tab-b", unrelated)).toEqual({
      kind: "confirm",
      draft: unrelated,
    });

    expect(planFulltextDownload(task, "tab-a", unrelated)).toEqual({
      kind: "confirm",
      draft: expect.objectContaining({
        targetHandoffId: "handoff-a",
        targetTitle: "Target A",
        targetWorkId: "work-a",
      }),
    });
  });

  it("completes a dedup only when it identifies the explicit target", () => {
    const same = draft({
      dedup: { reason: "doi", title: "Target A", workId: "work-a" },
    });
    expect(planFulltextDownload(task, "tab-a", same)).toMatchObject({
      kind: "attach-dedup",
      draft: { targetWorkId: "work-a" },
    });
  });

  it("surfaces a cross-work dedup conflict and keeps the explicit target", () => {
    const conflict = { reason: "exact-file" as const, title: "Existing B", workId: "work-b" };
    const planned = planFulltextDownload(task, "tab-a", draft({ dedup: conflict }));

    expect(planned).toMatchObject({
      kind: "confirm",
      draft: {
        targetConflict: conflict,
        targetHandoffId: "handoff-a",
        targetWorkId: "work-a",
      },
    });
  });

  it("preserves normal dedup behavior for an unbound download", () => {
    const ordinary = draft({
      dedup: { reason: "exact-file", title: "Existing B", workId: "work-b" },
    });
    expect(planFulltextDownload(null, "tab-b", ordinary)).toEqual({
      kind: "attach-dedup",
      draft: ordinary,
    });
  });
});
