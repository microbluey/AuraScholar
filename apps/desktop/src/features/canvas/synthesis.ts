import type {
  AISynthNodeData,
  AISynthesisType,
  CanvasNode,
  ExcerptNode,
  PaperNode,
} from "@aurascholar/core";
import { SYNTHESIS_LABELS } from "./model";

export interface CanvasSynthesisRequest {
  sourceNodes: Array<PaperNode | ExcerptNode>;
  synthType: AISynthesisType;
}

export interface CanvasSynthesisResult extends AISynthNodeData {
  preview: boolean;
}

export interface CanvasSynthesisService {
  synthesize(request: CanvasSynthesisRequest): Promise<Omit<CanvasSynthesisResult, "preview">>;
}

let injectedSynthesisService: CanvasSynthesisService | null = null;

/** Product integrations can inject the configured AI service without coupling the canvas to a provider. */
export function setCanvasSynthesisService(service: CanvasSynthesisService | null): void {
  injectedSynthesisService = service;
}

function sourceTitle(node: CanvasNode): string {
  if (node.type === "paper") return node.data.title;
  if (node.type === "excerpt") return `${node.data.paperTitle} · 第 ${node.data.pageIndex + 1} 页`;
  return "画布来源";
}

async function previewFallback(request: CanvasSynthesisRequest): Promise<CanvasSynthesisResult> {
  await new Promise((resolve) => window.setTimeout(resolve, 520));
  const sourceNames = request.sourceNodes.map(sourceTitle);
  const rows = sourceNames.map((name, index) => [
    `来源 ${index + 1}`,
    name,
    index === 0 ? "作为主要论点" : "用于交叉验证",
  ]);

  return {
    sourceNodeIds: request.sourceNodes.map((node) => node.id),
    synthType: request.synthType,
    title: `${SYNTHESIS_LABELS[request.synthType]} · 预览`,
    contentMarkdown:
      "这是未连接 AI 服务时的界面预览，只展示来源组织方式，不代表真实模型分析结果。配置并注入合成服务后，这张卡片会显示实际输出。",
    structuredTable: {
      headers: ["来源", "材料", "在合成中的角色"],
      rows,
    },
    modelName: "preview-fallback",
    preview: true,
  };
}

export async function synthesizeCanvasSelection(
  request: CanvasSynthesisRequest,
): Promise<CanvasSynthesisResult> {
  if (!injectedSynthesisService) return previewFallback(request);
  const result = await injectedSynthesisService.synthesize(request);
  return { ...result, preview: false };
}
