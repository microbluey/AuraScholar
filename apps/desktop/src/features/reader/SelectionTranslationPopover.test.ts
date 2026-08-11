import { describe, expect, it } from "vitest";
import { translationSettingsCta } from "./SelectionTranslationPopover";

describe("translation settings CTA", () => {
  it("sends a main-owned AI configuration error to the targeted AI settings section", () => {
    expect(translationSettingsCta("请先在设置页配置 AI 服务(地址、模型与 API Key)")).toEqual({
      label: "去配置 AI",
      path: "/settings?section=ai",
    });
  });

  it("keeps provider-specific setup errors scoped to translation settings", () => {
    expect(translationSettingsCta("请先在设置页填写 DeepL API Key，或切换为大模型翻译。")).toEqual({
      label: "去配置翻译",
      path: "/settings?section=translate",
    });
  });

  it("does not turn ordinary provider failures into a settings CTA", () => {
    expect(translationSettingsCta("翻译服务暂时不可用，请稍后重试。")).toBeNull();
  });
});
