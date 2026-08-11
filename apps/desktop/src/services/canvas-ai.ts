import { type CanvasSynthesisMode, type CanvasSynthesisSource } from "@aurascholar/ai";
import type { AISynthNodeData, CanvasNode } from "@aurascholar/core";
import { canvasSynthesisInputSource } from "../features/canvas/synthesis";
import { synthesizeAiCanvas } from "./ai-data";

function synthesisSource(node: CanvasNode): CanvasSynthesisSource | null {
  return node.type === "paper" || node.type === "excerpt" ? canvasSynthesisInputSource(node) : null;
}

export async function synthesizeCanvasSelection(
  nodes: CanvasNode[],
  mode: CanvasSynthesisMode,
  signal?: AbortSignal,
): Promise<AISynthNodeData> {
  const sources = nodes
    .map((node) => {
      const source = synthesisSource(node);
      if (!source || (node.type !== "paper" && node.type !== "excerpt")) return null;
      return { ...source, workId: node.data.workId };
    })
    .filter((source) => source !== null);
  if (sources.length < 2) {
    throw new Error("请至少选择两张文献或摘录卡片后再进行 AI 合成。");
  }
  const output = await synthesizeAiCanvas({ mode, sources }, signal);
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
    modelName: output.modelName,
  };
}
