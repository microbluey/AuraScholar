import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ResearchProjectService } from "../../services/research-project-service";
import type { ResearchProjectSummary } from "./model";
import { ResearchProjectWorkspace } from "./ResearchProjectWorkspace";

const project: ResearchProjectSummary = {
  createdAt: 1,
  description: "A bounded research corpus.",
  id: "project:workspace",
  name: "可解释检索",
  sourceCount: 0,
  status: "active",
  updatedAt: 1,
};

const service = { mode: "desktop" } as ResearchProjectService;

function renderWorkspace(previewMode: boolean): string {
  return renderToStaticMarkup(
    <ResearchProjectWorkspace
      busyAction={null}
      error={null}
      message={null}
      onAddWorks={vi.fn()}
      onCreate={vi.fn()}
      onDismissFeedback={vi.fn()}
      onOpenKnowledgeResult={vi.fn()}
      onOpenSource={vi.fn()}
      onRemoveWork={vi.fn()}
      onRename={vi.fn()}
      onSelect={vi.fn()}
      previewMode={previewMode}
      project={project}
      projects={[project]}
      service={service}
      sources={[]}
    />,
  );
}

describe("ResearchProjectWorkspace knowledge search", () => {
  it("mounts grounded search with an explicit visible Project corpus", () => {
    const markup = renderWorkspace(false);

    expect(markup).toContain("内容检索");
    expect(markup).toContain("项目 · 可解释检索");
    expect(markup).toContain('aria-label="当前检索范围：项目 · 可解释检索"');
    expect(markup).toContain('id="knowledge-search-input"');
  });

  it("keeps the Project scope visible but disables durable search in browser preview", () => {
    const markup = renderWorkspace(true);

    expect(markup).toContain("项目 · 可解释检索");
    expect(markup).toContain("内容检索使用设备上的持久化索引");
    expect(markup).not.toContain('id="knowledge-search-input"');
  });
});
