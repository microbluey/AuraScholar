import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalSemanticIndexControl } from "./LocalSemanticIndexControl";

describe("LocalSemanticIndexControl", () => {
  it("keeps vector generation as an explicit desktop-only action", () => {
    const markup = renderToStaticMarkup(<LocalSemanticIndexControl enabled={false} />);

    expect(markup).toContain("本地语义索引");
    expect(markup).toContain("资料文本不会离开设备");
    expect(markup).toContain("AuraScholar 桌面应用中创建");
    expect(markup).not.toContain("创建语义索引</button>");
  });

  it("offers a fixed local build action in the desktop surface", () => {
    const markup = renderToStaticMarkup(<LocalSemanticIndexControl enabled />);

    expect(markup).toContain("创建语义索引");
    expect(markup).toContain("模型未安装或本机向量运行时不可用时，不会创建索引。");
  });
});
