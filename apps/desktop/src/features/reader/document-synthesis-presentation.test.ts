import { describe, expect, it } from "vitest";
import {
  MAX_DOCUMENT_SYNTHESIS_QUERY_BYTES,
  documentSynthesisClaimKindLabel,
  documentSynthesisCoverageLabel,
  documentSynthesisQueryError,
  documentSynthesisRelationLabel,
  documentSynthesisSettingsCta,
  documentSynthesisStatusPresentation,
} from "./document-synthesis-presentation";

describe("document synthesis presentation", () => {
  it("keeps answer, conflict, and insufficient evidence visually distinct", () => {
    expect(documentSynthesisStatusPresentation("answer")).toMatchObject({
      label: "证据合成完成",
      tone: "success",
    });
    expect(documentSynthesisStatusPresentation("conflicting")).toMatchObject({
      label: "发现证据冲突",
      tone: "warning",
    });
    expect(documentSynthesisStatusPresentation("insufficient").detail).toContain("模型记忆");
  });

  it("uses relation and coverage labels without implying unsupported certainty", () => {
    expect(documentSynthesisCoverageLabel("multiple-supporting-sources")).toBe("多处支持");
    expect(documentSynthesisCoverageLabel("conflicting-sources")).toBe("证据冲突");
    expect(documentSynthesisClaimKindLabel("uncertain")).toBe("不确定主张");
    expect(documentSynthesisRelationLabel("qualifies")).toBe("限定");
    expect(documentSynthesisRelationLabel(undefined)).toBe("未标注关系");
  });

  it("matches the main-process question boundary before a provider run starts", () => {
    expect(documentSynthesisQueryError("   ")).toBe("请输入想让当前文献回答的问题。");
    expect(documentSynthesisQueryError("研究方法是什么？")).toBeNull();
    expect(documentSynthesisQueryError("中".repeat(MAX_DOCUMENT_SYNTHESIS_QUERY_BYTES))).toContain(
      "16 KB",
    );
  });

  it("offers AI settings only for a configuration failure", () => {
    expect(documentSynthesisSettingsCta("请先在设置页配置 AI 服务")).toEqual({
      label: "去配置 AI",
      path: "/settings?section=ai",
    });
    expect(documentSynthesisSettingsCta("请求超时")).toBeNull();
  });
});
