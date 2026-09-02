import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { previewEvidenceShelfService } from "../../services/evidence-shelf";
import { EvidenceShelfPanel } from "./EvidenceShelfPanel";

describe("EvidenceShelfPanel", () => {
  it("fails closed in browser preview and exposes no promotion controls", () => {
    const markup = renderToStaticMarkup(
      <EvidenceShelfPanel
        enabled={false}
        onOpenResult={vi.fn()}
        projectId="project:preview"
        projectName="预览项目"
        service={previewEvidenceShelfService}
      />,
    );

    expect(markup).toContain("浏览器预览不会写入或读取持久化 Evidence Shelf");
    expect(markup).toContain("evidence-shelf--unavailable");
    expect(markup).not.toContain("核验并保存");
  });

  it("keeps the desktop panel loading until its project-local list resolves", () => {
    const markup = renderToStaticMarkup(
      <EvidenceShelfPanel
        enabled
        onOpenResult={vi.fn()}
        projectId="project:desktop"
        projectName="桌面项目"
        service={{ ...previewEvidenceShelfService, mode: "desktop" }}
      />,
    );

    expect(markup).toContain("正在载入 Shelf");
    expect(markup).not.toContain("Evidence Shelf 操作失败");
  });
});
