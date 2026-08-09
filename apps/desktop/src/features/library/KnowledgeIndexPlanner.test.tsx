import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { KnowledgeContentIndexStats } from "../../services/knowledge-index-stats";
import {
  formatBinaryBytes,
  KnowledgeIndexPlanner,
  KnowledgeIndexPlanSummary,
} from "./KnowledgeIndexPlanner";

const stats: KnowledgeContentIndexStats = {
  totalContentUnits: 16,
  readyContentUnits: 12,
  contextOnlyContentUnits: 4,
  sourceCounts: { pdf: 10, annotation: 3, evidence: 3 },
  languageCoverage: { zh: 4, en: 6, other: 1, missing: 1 },
};

describe("KnowledgeIndexPlanner", () => {
  it("explains that capacity controls are planning-only", () => {
    const markup = renderToStaticMarkup(<KnowledgeIndexPlanner enabled={false} />);

    expect(markup).toContain("语义索引规划");
    expect(markup).toContain("不会下载模型、创建向量库或上传资料");
    expect(markup).toContain('aria-label="当前状态：仅规划，未创建索引"');
    expect(markup).toContain("需要 AuraScholar 桌面应用");
  });

  it("uses ready ContentUnits for its quota calculation and exposes its assumptions", () => {
    const markup = renderToStaticMarkup(
      <KnowledgeIndexPlanSummary
        stats={stats}
        dimension={768}
        precision="float32"
        quotaBytes={1024}
      />,
    );

    expect(markup).toContain("12</strong> 个可直接引用的片段");
    expect(markup).toContain("4 个仅上下文片段不计入语义索引");
    expect(markup).toContain("中文/英文资料偏好可识别 10 / 12 个可直接引用片段");
    expect(markup).toContain("1 个未标注，1 个为当前未支持的其他语种");
    expect(markup).toContain("PDF 10 · 批注 3 · Evidence 3");
    expect(markup).toContain("预计超过 1 KiB 磁盘配额");
    expect(markup).toContain("预留 50% 索引开销");
  });

  it("formats local disk estimates in binary units", () => {
    expect(formatBinaryBytes(0)).toBe("0 B");
    expect(formatBinaryBytes(1024)).toBe("1 KiB");
    expect(formatBinaryBytes(1536)).toBe("1.5 KiB");
  });
});
