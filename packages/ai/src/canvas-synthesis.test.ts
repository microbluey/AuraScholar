import { describe, expect, it, vi } from "vitest";
import type { AIProvider, GenerateOptions } from "./provider.js";
import { generateCanvasSynthesis } from "./canvas-synthesis.js";

function providerReturning(value: unknown): AIProvider {
  return {
    id: "test",
    model: "test-model",
    generateText: vi.fn(),
    generateObject: vi.fn(
      async (options: GenerateOptions & { schema: { parse: (v: unknown) => unknown } }) =>
        options.schema.parse(value),
    ) as AIProvider["generateObject"],
  };
}

describe("generateCanvasSynthesis", () => {
  it("requires at least two traceable sources", async () => {
    const provider = providerReturning({ title: "x", contentMarkdown: "y" });
    await expect(
      generateCanvasSynthesis(provider, {
        mode: "research_gap",
        sources: [{ id: "n1", kind: "paper", title: "One", content: "Only one source" }],
      }),
    ).rejects.toThrow("at least two");
  });

  it("asks for a methodology matrix and validates the structured result", async () => {
    const provider = providerReturning({
      title: "方法对比",
      contentMarkdown: "两项工作采用不同证据路径。[S1][S2]",
      structuredTable: {
        headers: ["维度", "S1", "S2"],
        rows: [["方法", "图模型", "对比学习"]],
      },
    });

    const result = await generateCanvasSynthesis(provider, {
      mode: "methodology_matrix",
      sources: [
        { id: "paper-1", kind: "paper", title: "Graph study", content: "Uses graph models." },
        {
          id: "excerpt-2",
          kind: "excerpt",
          title: "Contrastive study",
          content: "Uses contrastive learning.",
        },
      ],
    });

    expect(result.structuredTable?.headers).toEqual(["维度", "S1", "S2"]);
    const call = vi.mocked(provider.generateObject).mock.calls[0]?.[0];
    expect(call?.messages.at(-1)?.content).toContain("methodology_matrix");
    expect(call?.messages.at(-1)?.content).toContain("node_id: paper-1");
    expect(call?.messages.at(-1)?.content).toContain("node_id: excerpt-2");
  });
});
