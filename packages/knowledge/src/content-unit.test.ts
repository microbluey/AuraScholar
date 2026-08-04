import { describe, expect, it } from "vitest";
import { parseSourceAnchor } from "@aurascholar/anchors";
import { canonicalJson, createContentUnit, makeContentUnitId, sha256Text } from "./index.js";

const anchor = parseSourceAnchor({
  version: 1,
  kind: "pdf",
  revisionId: "revision-1",
  pageIndex: 0,
  quote: { exact: "Hello", prefix: "", suffix: " world" },
  position: { start: 0, end: 5 },
});

describe("ContentUnit identity and integrity", () => {
  it("uses WebCrypto SHA-256 and canonical JSON", async () => {
    await expect(sha256Text("hello")).resolves.toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(canonicalJson({ z: 1, a: { y: true, x: null } })).toBe(
      '{"a":{"x":null,"y":true},"z":1}',
    );
  });

  it("rebuilds the same unit with the same id", async () => {
    const input = {
      libraryId: "library-1",
      sourceType: "pdf" as const,
      sourceId: "revision-1",
      revisionId: "revision-1",
      ordinal: 0,
      anchor,
      text: "Hello",
      extractorProfile: "pdf-text-v1",
      chunkProfile: "pdf-page-v1",
    };
    const first = await createContentUnit(input);
    const second = await createContentUnit({ ...input });
    expect(second).toEqual(first);
    await expect(
      makeContentUnitId({
        libraryId: first.libraryId,
        sourceType: first.sourceType,
        sourceId: first.sourceId,
        workId: first.workId,
        assetId: first.assetId,
        revisionId: first.revisionId,
        parentUnitId: first.parentUnitId,
        ordinal: first.ordinal,
        contentHash: first.contentHash,
        extractorProfile: first.extractorProfile,
        chunkProfile: first.chunkProfile,
      }),
    ).resolves.toBe(first.id);
  });

  it("rejects a revision-bound anchor mismatch", async () => {
    await expect(
      createContentUnit({
        libraryId: "library-1",
        sourceType: "pdf",
        sourceId: "revision-1",
        revisionId: "revision-2",
        ordinal: 0,
        anchor,
        text: "Hello",
        extractorProfile: "pdf-text-v1",
        chunkProfile: "pdf-page-v1",
      }),
    ).rejects.toThrow("revision does not match");
  });
});
