import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EvidenceInboxItemDto } from "@aurascholar/db/repos/evidence-inbox";
import { EvidenceCard } from "./EvidenceCard";
import { EvidenceInboxEmpty } from "./EvidenceInboxStates";
import { EvidenceInboxToolbar } from "./EvidenceInboxToolbar";
import { EvidenceInspector } from "./EvidenceInspector";

function evidenceItem(): EvidenceInboxItemDto {
  return {
    assetKind: "pdf",
    assetTitle: "evidence-paper.pdf",
    attachmentId: "attachment:evidence",
    authorNames: ["Ada Lovelace", "Grace Hopper"],
    evidence: {
      anchor: { kind: "pdf", pageIndex: 3, revisionId: "revision:evidence" },
      assetId: "asset:evidence",
      availabilityStatus: "available",
      canonicalStatus: "active",
      createdAt: 1,
      deletedAt: null,
      evidenceKind: "method",
      id: "evidence:one",
      libraryId: "library:one",
      noteMd: "用于方法论对比。",
      provenance: {},
      revisionId: "revision:evidence",
      revisionStatus: "historical",
      sourceContentHash: "hash",
      sourceKind: "document",
      tags: ["causal"],
      text: "The proposed estimator remains unbiased under the stated assumptions.",
      title: "无偏估计证据",
      updatedAt: 2,
      workId: "work:evidence",
    },
    mimeType: "application/pdf",
    pageIndex: 3,
    projectMemberships: [{ projectId: "project:causal", projectName: "因果推断" }],
    revisionNo: 2,
    workTitle: "A Robust Causal Estimator",
    year: 2025,
  };
}

describe("Evidence Inbox views", () => {
  it("renders quote-first cards with source, revision, status, and project context", () => {
    const markup = renderToStaticMarkup(
      <EvidenceCard item={evidenceItem()} selected onSelect={vi.fn()} onOpenSource={vi.fn()} />,
    );

    expect(markup.indexOf("The proposed estimator")).toBeLessThan(
      markup.indexOf("A Robust Causal Estimator"),
    );
    expect(markup).toContain("历史修订");
    expect(markup).toContain("修订 2");
    expect(markup).toContain("因果推断");
    expect(markup).toContain('aria-pressed="true"');
  });

  it("exposes Inbox, Library, Project, query, kind, and source filters", () => {
    const markup = renderToStaticMarkup(
      <EvidenceInboxToolbar
        filters={{
          evidenceKind: "all",
          query: "",
          scope: { kind: "inbox" },
          source: "all",
        }}
        onChange={vi.fn()}
        projects={[{ id: "project:causal", name: "因果推断" }]}
        projectsLoading={false}
        refreshing={false}
      />,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain("未归档");
    expect(markup).toContain("全部");
    expect(markup).toContain("因果推断");
    expect(markup).toContain('aria-label="Evidence 类型"');
    expect(markup).toContain('aria-label="来源状态"');
    expect(markup).toContain("搜索引文、标题、作者或标签");
  });

  it("explains exact historical revision behavior in the inspector", () => {
    const item = evidenceItem();
    const markup = renderToStaticMarkup(
      <EvidenceInspector
        busy={null}
        canAssignToProject
        item={item}
        onBackToList={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onRecoverSource={vi.fn(async () => true)}
        onRemoveFromProject={vi.fn(async () => true)}
        onRequestProject={vi.fn()}
        scope={{ kind: "project", projectId: "project:causal" }}
      />,
    );

    expect(markup).toContain("将打开捕获 Evidence 时的原始历史修订");
    expect(markup).toContain("返回 Evidence 列表");
    expect(markup).toContain("打开原始来源");
    expect(markup).toContain("移出当前项目");
    expect(markup).toContain("移除 Evidence");
  });

  it("offers source recovery without silently opening a replacement revision", () => {
    const item = evidenceItem();
    item.attachmentId = null;
    item.evidence.availabilityStatus = "relink-required";
    const markup = renderToStaticMarkup(
      <EvidenceInspector
        busy={null}
        canAssignToProject={false}
        item={item}
        onDelete={vi.fn()}
        onOpenSource={null}
        onRecoverSource={vi.fn(async () => true)}
        onRemoveFromProject={vi.fn(async () => true)}
        onRequestProject={vi.fn()}
        scope={{ kind: "library" }}
      />,
    );

    expect(markup).toContain("恢复原始 PDF");
    expect(markup).not.toContain("打开原始来源");
  });

  it("distinguishes filtered empty results from a completed Inbox", () => {
    const filtered = renderToStaticMarkup(
      <EvidenceInboxEmpty
        filters={{
          evidenceKind: "data",
          query: "",
          scope: { kind: "inbox" },
          source: "all",
        }}
        onResetFilters={vi.fn()}
      />,
    );
    const complete = renderToStaticMarkup(
      <EvidenceInboxEmpty
        filters={{
          evidenceKind: "all",
          query: "",
          scope: { kind: "inbox" },
          source: "all",
        }}
        onResetFilters={vi.fn()}
      />,
    );

    expect(filtered).toContain("没有符合条件的 Evidence");
    expect(filtered).toContain("清除筛选");
    expect(complete).toContain("收件箱已经整理完毕");
  });
});
