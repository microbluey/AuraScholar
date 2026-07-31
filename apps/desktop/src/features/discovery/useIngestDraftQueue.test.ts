import { describe, expect, it } from "vitest";
import type { IngestDraft } from "../../services/library-types";
import { ingestDraftQueueReducer, type DraftQueueEntry } from "./useIngestDraftQueue";

function draft(title: string): IngestDraft {
  return {
    source: "browser",
    candidates: [],
    bestIndex: -1,
    confidence: 0,
    pdf: null,
    dedup: null,
    fallbackTitle: title,
    pdfFields: null,
    localMatches: [],
  };
}

describe("ingest draft confirmation queue", () => {
  it("keeps an active edit stable while later downloads wait", () => {
    const first: DraftQueueEntry = { draft: draft("A"), id: "job-a" };
    const second: DraftQueueEntry = { draft: draft("B"), id: "job-b" };
    const queued = ingestDraftQueueReducer(
      ingestDraftQueueReducer([], { type: "enqueue", entry: first }),
      { type: "enqueue", entry: second },
    );

    expect(queued).toEqual([first, second]);
    expect(ingestDraftQueueReducer(queued, { type: "dismiss", draft: second.draft })).toBe(queued);
    expect(ingestDraftQueueReducer(queued, { type: "dismiss", draft: first.draft })).toEqual([
      second,
    ]);
    expect(ingestDraftQueueReducer(queued, { type: "remove", draft: second.draft })).toEqual([
      first,
    ]);
  });
});
