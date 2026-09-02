import type { KnowledgeCorpusScope } from "../../services/knowledge-search";

export function knowledgeSearchScopeLabel(
  scope: KnowledgeCorpusScope | undefined,
  label?: string,
): string {
  const normalizedLabel = label?.trim();
  if (normalizedLabel) return normalizedLabel;
  if (!scope || scope.kind === "library") return "整个资料库";
  if (scope.kind === "project") return "当前项目";
  if (scope.kind === "asset") return "当前文档资产";
  if (scope.kind === "works") return "所选文献";
  return "当前资料范围";
}

export function knowledgeSearchScopeKey(scope: KnowledgeCorpusScope | undefined): string {
  if (!scope || scope.kind === "library") return "library";
  return JSON.stringify(scope);
}
