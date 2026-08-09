import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeContentSearchResult } from "../../electron/data-command-contract";
import { getLibraryDb } from "./aura-db";
import {
  knowledgeSearchReaderPath,
  knowledgeSearchReaderTarget,
  resolveKnowledgeSearchReaderPath,
} from "./knowledge-search-navigation";

vi.mock("./aura-db", () => ({ getLibraryDb: vi.fn() }));

function result(
  overrides: Partial<KnowledgeContentSearchResult> = {},
): KnowledgeContentSearchResult {
  return {
    anchor: { kind: "pdf", pageIndex: 2, revisionId: "revision:one", version: 1 },
    assetId: "asset:one",
    excerpt: "A grounded result with an exact reader anchor.",
    headingPath: ["Methods", "Sampling"],
    id: "content-unit:one",
    language: "en",
    ordinal: 0,
    parentUnitId: null,
    revisionId: "revision:one",
    score: 1,
    sourceId: "revision:one",
    sourceType: "pdf",
    state: "ready",
    text: "A grounded result with an exact reader anchor.",
    tokenCount: 8,
    workId: "work:one",
    workTitle: "A grounded paper",
    ...overrides,
  };
}

describe("Knowledge search Reader navigation", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    vi.mocked(getLibraryDb).mockResolvedValue({ db: {} as never, libraryId: "library:one" });
  });

  it("creates source-aware Reader targets from revision-bound PDF anchors", () => {
    const pdfTarget = knowledgeSearchReaderTarget(result());
    expect(pdfTarget).toMatchObject({
      pageIndex: 2,
      revisionId: "revision:one",
      sourceType: "pdf",
      workId: "work:one",
    });
    expect(knowledgeSearchReaderPath(pdfTarget!, "attachment:one")).toBe(
      "/reader?attachment=attachment%3Aone&page=3&work=work%3Aone",
    );

    const annotationTarget = knowledgeSearchReaderTarget(
      result({ sourceId: "annotation:one", sourceType: "annotation" }),
    );
    expect(knowledgeSearchReaderPath(annotationTarget!, "attachment:one")).toBe(
      "/reader?attachment=attachment%3Aone&annotation=annotation%3Aone&page=3&work=work%3Aone",
    );

    const evidenceTarget = knowledgeSearchReaderTarget(
      result({ sourceId: "evidence:one", sourceType: "evidence" }),
    );
    expect(knowledgeSearchReaderPath(evidenceTarget!, "attachment:one")).toBe(
      "/reader?attachment=attachment%3Aone&evidence=evidence%3Aone&page=3&work=work%3Aone",
    );
  });

  it("rejects malformed anchors and metadata that could drift to another revision", async () => {
    expect(
      knowledgeSearchReaderTarget(
        result({ anchor: { kind: "pdf", pageIndex: 2, revisionId: "revision:other", version: 1 } }),
      ),
    ).toBeNull();
    expect(knowledgeSearchReaderTarget(result({ sourceId: "revision:other" }))).toBeNull();
    expect(knowledgeSearchReaderTarget(result({ workId: null }))).toBeNull();

    await expect(
      resolveKnowledgeSearchReaderPath(result({ anchor: { kind: "pdf", version: 1 } })),
    ).resolves.toBeNull();
    expect(getLibraryDb).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });

  it("resolves the indexed revision to its exact attachment before creating a Reader path", async () => {
    command.mockResolvedValue({
      revision: {
        assetId: "asset:one",
        attachmentId: "attachment:historical",
        availabilityStatus: "available",
        blobSha256: "a".repeat(64),
        currentRevisionId: "revision:newer",
        pageCount: 8,
        revisionId: "revision:one",
        revisionNo: 1,
        workId: "work:one",
      },
    });

    await expect(resolveKnowledgeSearchReaderPath(result())).resolves.toBe(
      "/reader?attachment=attachment%3Ahistorical&page=3&work=work%3Aone",
    );
    expect(command).toHaveBeenCalledWith("document.resolveRevision", {
      libraryId: "library:one",
      revisionId: "revision:one",
      workId: "work:one",
    });
  });

  it("refuses unavailable or mismatched revision records instead of falling back", async () => {
    command.mockResolvedValue({
      revision: {
        assetId: "asset:one",
        attachmentId: "attachment:missing",
        availabilityStatus: "missing",
        blobSha256: "a".repeat(64),
        currentRevisionId: "revision:one",
        pageCount: 8,
        revisionId: "revision:one",
        revisionNo: 1,
        workId: "work:one",
      },
    });
    await expect(resolveKnowledgeSearchReaderPath(result())).resolves.toBeNull();

    command.mockResolvedValue({
      revision: {
        assetId: "asset:other",
        attachmentId: "attachment:other",
        availabilityStatus: "available",
        blobSha256: "a".repeat(64),
        currentRevisionId: "revision:one",
        pageCount: 8,
        revisionId: "revision:one",
        revisionNo: 1,
        workId: "work:one",
      },
    });
    await expect(resolveKnowledgeSearchReaderPath(result())).resolves.toBeNull();
  });
});
