import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { KnowledgeContentSearchResult } from "../../services/knowledge-search";
import { toPreviewPayload, type EvidenceShelfItem } from "../../services/evidence-shelf";
import { EvidenceShelfPromoteDialog, parseEvidenceShelfTags } from "./EvidenceShelfPromoteDialog";

const result: KnowledgeContentSearchResult = {
  anchor: { kind: "pdf", pageIndex: 2, revisionId: "revision:promote", version: 1 },
  assetId: "asset:promote",
  excerpt: "The staged paragraph is shown before it becomes Evidence.",
  headingPath: ["Methods"],
  id: "content-unit:promote",
  language: "en",
  ordinal: 1,
  parentUnitId: null,
  revisionId: "revision:promote",
  score: 1,
  sourceId: "revision:promote",
  sourceType: "pdf",
  state: "ready",
  text: "The staged paragraph is shown before it becomes Evidence.",
  tokenCount: 10,
  workId: "work:promote",
  workTitle: "Promotion source",
};

const item: EvidenceShelfItem = {
  anchorSnapshot: result.anchor,
  assetId: result.assetId,
  createdAt: 1,
  currentRevisionId: result.revisionId,
  currentSourceContentHash: "a".repeat(64),
  deletedAt: null,
  id: "shelf:promote",
  isStale: false,
  libraryId: "library:promote",
  previewPayload: toPreviewPayload(result),
  projectId: "project:promote",
  revisionId: result.revisionId,
  sourceContentHash: "a".repeat(64),
  status: "staged",
  updatedAt: 2,
  workId: result.workId,
};

describe("EvidenceShelfPromoteDialog", () => {
  it("renders the verification boundary and editable Evidence metadata", () => {
    const markup = renderToStaticMarkup(
      <EvidenceShelfPromoteDialog item={item} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("先核验当前修订与内容哈希");
    expect(markup).toContain("The staged paragraph is shown before it becomes Evidence.");
    expect(markup).toContain("证据类型");
    expect(markup).toContain("备注");
    expect(markup).toContain("核验并保存");
  });

  it("normalizes comma-separated tags without allowing oversized lists", () => {
    expect(parseEvidenceShelfTags("方法,  核验，方法\n结论")).toEqual(["方法", "核验", "结论"]);
    expect(() =>
      parseEvidenceShelfTags(Array.from({ length: 65 }, (_, i) => `tag-${i}`).join(",")),
    ).toThrow("标签最多 64 个");
    expect(() => parseEvidenceShelfTags("x".repeat(129))).toThrow("每个标签最多 128 个字符");
  });
});
