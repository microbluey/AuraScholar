import type { EvidenceRecord } from "@aurascholar/db/repos/evidence";
import { describe, expect, it, vi } from "vitest";
import {
  loadReaderEvidenceDeepLink,
  resolveReaderScrollPage,
  type ReaderEvidenceDeepLinkDataSource,
} from "./evidence-deep-link";

const evidence: EvidenceRecord = {
  anchor: {
    kind: "pdf",
    pageIndex: 3,
    position: { end: 31, start: 12 },
    quads: { pageIndex: 3, rects: [{ x1: 1, x2: 4, y1: 2, y2: 5 }] },
    quote: { exact: "original claim", prefix: "The ", suffix: " remains." },
    revisionId: "revision:historical",
    version: 1,
  },
  assetId: "asset:one",
  availabilityStatus: "available",
  canonicalStatus: "active",
  createdAt: 1,
  deletedAt: null,
  evidenceKind: "method",
  id: "evidence:one",
  libraryId: "library:one",
  noteMd: null,
  provenance: {},
  revisionId: "revision:historical",
  revisionStatus: "historical",
  sourceContentHash: "hash",
  sourceKind: "document",
  tags: [],
  text: "original claim",
  title: null,
  updatedAt: 1,
  workId: "work:one",
};

function dataSource(overrides: Partial<ReaderEvidenceDeepLinkDataSource> = {}) {
  return {
    getEvidence: vi.fn(async () => ({ evidence })),
    getLibraryId: vi.fn(async () => "library:one"),
    resolveRevision: vi.fn(async () => ({
      revision: {
        assetId: "asset:one",
        attachmentId: "attachment:historical",
        availabilityStatus: "available" as const,
        blobSha256: "a".repeat(64),
        currentRevisionId: "revision:current",
        pageCount: 9,
        revisionId: "revision:historical",
        revisionNo: 1,
        workId: "work:one",
      },
    })),
    ...overrides,
  } satisfies ReaderEvidenceDeepLinkDataSource;
}

describe("Reader Evidence deep link", () => {
  it("keeps the immutable Evidence anchor ahead of an edited page query", () => {
    expect(
      resolveReaderScrollPage({ evidencePage: 3, page: 8, translationPage: 5 }),
    ).toBe(3);
    expect(resolveReaderScrollPage({ page: 8, translationPage: 5 })).toBe(8);
  });

  it("creates a transient highlight only for the exact historical revision", async () => {
    await expect(
      loadReaderEvidenceDeepLink(
        {
          attachmentId: "attachment:historical",
          evidenceId: evidence.id,
          workId: evidence.workId,
        },
        dataSource(),
      ),
    ).resolves.toMatchObject({
      annotation: {
        anchor: { pageIndex: 3, quote: { exact: "original claim" } },
        id: "evidence-preview:evidence:one",
        pageIndex: 3,
        type: "highlight",
      },
      pageIndex: 3,
    });
  });

  it("rejects a route that silently resolves to another revision", async () => {
    const source = dataSource({
      resolveRevision: vi.fn(async () => ({
        revision: {
          assetId: "asset:one",
          attachmentId: "attachment:current",
          availabilityStatus: "available" as const,
          blobSha256: "b".repeat(64),
          currentRevisionId: "revision:current",
          pageCount: 9,
          revisionId: "revision:current",
          revisionNo: 2,
          workId: "work:one",
        },
      })),
    });
    await expect(
      loadReaderEvidenceDeepLink(
        {
          attachmentId: "attachment:historical",
          evidenceId: evidence.id,
          workId: evidence.workId,
        },
        source,
      ),
    ).rejects.toThrow("不一致");
  });

  it("honors an aborted Reader session before issuing source reads", async () => {
    const controller = new AbortController();
    controller.abort();
    const source = dataSource();
    await expect(
      loadReaderEvidenceDeepLink(
        {
          attachmentId: "attachment:historical",
          evidenceId: evidence.id,
          signal: controller.signal,
          workId: evidence.workId,
        },
        source,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(source.getLibraryId).not.toHaveBeenCalled();
  });
});
