import type {
  KnowledgeContentSearchRetrieval,
  KnowledgeContentSearchResult,
} from "../../services/knowledge-search";

export type KnowledgeSearchSourceFilter = "all" | KnowledgeContentSearchResult["sourceType"];

export const SOURCE_FILTERS: readonly KnowledgeSearchSourceFilter[] = [
  "all",
  "pdf",
  "annotation",
  "evidence",
];

export interface KnowledgeSearchRetrievalPresentation {
  detail: string;
  label: string;
}

export function knowledgeSearchRetrievalPresentation(
  retrieval: KnowledgeContentSearchRetrieval,
): KnowledgeSearchRetrievalPresentation {
  const languagePreference = retrieval.languagePreference;
  const languageLabel = languagePreference
    ? languagePreference.requestedLanguage === "zh"
      ? "中文"
      : "英文"
    : null;
  if (retrieval.mode === "hybrid" && retrieval.semanticStatus === "used") {
    return {
      detail: languagePreference
        ? languagePreference.applied
          ? `搜索已索引的 PDF、批注和 Evidence。当前为本地关键词与语义融合检索；已按明确的${languageLabel}资料请求优先显示已标注语种的来源，其他候选仍保留；资料不会上传。`
          : `搜索已索引的 PDF、批注和 Evidence。当前为本地关键词与语义融合检索；未找到可用于${languageLabel}偏好的语种标记，保留通常排序；资料不会上传。`
        : "搜索已索引的 PDF、批注和 Evidence。当前为本地关键词与语义融合检索；资料不会上传。",
      label: languagePreference?.applied ? `混合检索 · ${languageLabel}优先` : "混合检索",
    };
  }
  if (retrieval.semanticStatus === "unavailable") {
    return {
      detail: languagePreference
        ? languagePreference.applied
          ? `搜索已索引的 PDF、批注和 Evidence。本地语义检索暂不可用，已回退到关键词检索；同时按明确的${languageLabel}资料请求优先显示已标注语种的来源；资料不会上传。`
          : `搜索已索引的 PDF、批注和 Evidence。本地语义检索暂不可用，已回退到关键词检索；未找到可用于${languageLabel}偏好的语种标记；资料不会上传。`
        : "搜索已索引的 PDF、批注和 Evidence。本地语义检索暂不可用，已回退到关键词检索；资料不会上传。",
      label: languagePreference?.applied ? `关键词检索 · ${languageLabel}优先` : "关键词检索",
    };
  }
  return {
    detail: languagePreference
      ? languagePreference.applied
        ? `搜索已索引的 PDF、批注和 Evidence。当前为本地关键词检索；已按明确的${languageLabel}资料请求优先显示已标注语种的来源；资料不会上传。`
        : `搜索已索引的 PDF、批注和 Evidence。当前为本地关键词检索；未找到可用于${languageLabel}偏好的语种标记；资料不会上传。`
      : "搜索已索引的 PDF、批注和 Evidence。当前为本地关键词检索；未配置语义模型时不会上传资料。",
    label: languagePreference?.applied ? `关键词检索 · ${languageLabel}优先` : "关键词检索",
  };
}

export function sourceTypesForKnowledgeSearchFilter(
  sourceFilter: KnowledgeSearchSourceFilter,
): KnowledgeContentSearchResult["sourceType"][] | undefined {
  return sourceFilter === "all" ? undefined : [sourceFilter];
}
