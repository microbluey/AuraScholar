import {
  generateCanvasSynthesis,
  type CanvasSynthesisMode,
  type CanvasSynthesisSource,
} from "@aurascholar/ai";
import type { AISynthNodeData, CanvasNode } from "@aurascholar/core";
import { canvasSynthesisInputSource } from "../features/canvas/synthesis";
import { makeProvider } from "./ai";

function synthesisSource(node: CanvasNode): CanvasSynthesisSource | null {
  return node.type === "paper" || node.type === "excerpt" ? canvasSynthesisInputSource(node) : null;
}

export async function synthesizeCanvasSelection(
  nodes: CanvasNode[],
  mode: CanvasSynthesisMode,
): Promise<AISynthNodeData> {
  const sources = nodes.map(synthesisSource).filter((source) => source !== null);
  if (sources.length < 2) {
    throw new Error("请至少选择两张文献或摘录卡片后再进行 AI 合成。");
  }
  const provider = await makeProvider();
  if (!provider) throw new Error("请先在设置页配置 AI 服务，再进行观点合成。");
  const output = await generateCanvasSynthesis(provider, {
    mode,
    sources,
    language: "zh",
  });
  const containsPaper = sources.some((source) => source.kind === "paper");
  const scopeNotice = containsPaper
    ? "> 分析范围：文献卡基于题录与可用摘要，摘录卡基于所选原文；这不是全文审读。\n\n"
    : "> 分析范围：仅基于所选摘录原文。\n\n";
  return {
    sourceNodeIds: sources.map((source) => source.id),
    synthType: mode,
    title: output.title,
    contentMarkdown: `${scopeNotice}${output.contentMarkdown}`,
    structuredTable: output.structuredTable,
    modelName: provider.model,
  };
}
