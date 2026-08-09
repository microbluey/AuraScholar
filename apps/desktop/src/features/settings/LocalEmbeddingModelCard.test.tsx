import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatBinaryBytes, LocalEmbeddingModelCard } from "./LocalEmbeddingModelCard";

describe("LocalEmbeddingModelCard", () => {
  it("explains that browser previews do not access local model storage or auto-download a model", () => {
    const markup = renderToStaticMarkup(<LocalEmbeddingModelCard enabled={false} />);

    expect(markup).toContain("本地语义模型");
    expect(markup).toContain("浏览器预览不会访问本机模型目录");
    expect(markup).toContain("当前版本不会自动下载模型");
    expect(markup).toContain("等待完整 SHA-256 清单固定");
  });

  it("formats verified local artifact sizes in binary units", () => {
    expect(formatBinaryBytes(0)).toBe("0 B");
    expect(formatBinaryBytes(1024)).toBe("1 KiB");
    expect(formatBinaryBytes(1536)).toBe("1.5 KiB");
  });
});
