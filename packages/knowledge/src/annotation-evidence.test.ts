import { describe, expect, it } from "vitest";
import { buildAnnotationContentUnit, buildEvidenceContentUnit, sha256Text } from "./index.js";

const legacyPdfAnchor = {
  version: 1,
  pageIndex: 3,
  quote: { exact: "A captured sentence", prefix: "Before ", suffix: " after" },
  position: { start: 8, end: 27 },
};

describe("annotation and Evidence ContentUnits", () => {
  it("upgrades a legacy reader annotation anchor to a revision-bound source anchor", async () => {
    const unit = await buildAnnotationContentUnit({
      libraryId: "library-1",
      annotationId: "annotation-1",
      workId: "work-1",
      assetId: "asset-1",
      revisionId: "revision-1",
      anchor: legacyPdfAnchor,
    });

    expect(unit).toMatchObject({
      sourceType: "annotation",
      sourceId: "annotation-1",
      text: "A captured sentence",
      revisionId: "revision-1",
      anchor: { kind: "pdf", revisionId: "revision-1", pageIndex: 3 },
    });
  });

  it("uses annotation note text when there is no selected quote", async () => {
    const unit = await buildAnnotationContentUnit({
      libraryId: "library-1",
      annotationId: "annotation-note",
      revisionId: "revision-1",
      anchor: { version: 1, pageIndex: 0 },
      contentMd: "A note attached to the page.",
    });
    expect(unit.text).toBe("A note attached to the page.");
  });

  it("keeps both the selected text and the annotation note searchable", async () => {
    const unit = await buildAnnotationContentUnit({
      libraryId: "library-1",
      annotationId: "annotation-highlight-note",
      revisionId: "revision-1",
      anchor: legacyPdfAnchor,
      contentMd: "Why this matters.",
    });
    expect(unit.text).toBe("A captured sentence\n\nWhy this matters.");
  });

  it("rejects Evidence when the supplied source content hash is stale", async () => {
    await expect(
      buildEvidenceContentUnit({
        libraryId: "library-1",
        evidenceId: "evidence-1",
        revisionId: "revision-1",
        anchor: {
          version: 1,
          kind: "pdf",
          revisionId: "revision-1",
          pageIndex: 0,
          quote: { exact: "Evidence text", prefix: "", suffix: "" },
        },
        text: "Evidence text",
        sourceContentHash: "0".repeat(64),
      }),
    ).rejects.toThrow("does not match the Evidence text");
  });

  it("creates a hash-verified, revision-bound Evidence unit", async () => {
    const text = "Evidence text";
    const unit = await buildEvidenceContentUnit({
      libraryId: "library-1",
      evidenceId: "evidence-1",
      workId: "work-1",
      assetId: "asset-1",
      revisionId: "revision-1",
      anchor: {
        version: 1,
        kind: "pdf",
        revisionId: "revision-1",
        pageIndex: 0,
        quote: { exact: text, prefix: "", suffix: "" },
      },
      text,
      sourceContentHash: await sha256Text(text),
    });
    expect(unit).toMatchObject({
      sourceType: "evidence",
      sourceId: "evidence-1",
      text,
      revisionId: "revision-1",
      contentHash: await sha256Text(text),
    });
  });
});
