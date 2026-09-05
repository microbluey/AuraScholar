import type {
  AiGroundedAnswerStatus,
  AiGroundedClaimCoverage,
  AiGroundedClaimKind,
  AiGroundedClaimRelation,
} from "../../../electron/ai-command-contract";

export const DEFAULT_DOCUMENT_SYNTHESIS_QUERY =
  "请概述这篇文献的研究问题、方法、关键发现与局限，并为每个要点保留证据引用。";

export const MAX_DOCUMENT_SYNTHESIS_QUERY_BYTES = 16 * 1024;

export interface DocumentSynthesisStatusPresentation {
  detail: string;
  label: string;
  tone: "neutral" | "success" | "warning";
}

const STATUS_PRESENTATION: Record<AiGroundedAnswerStatus, DocumentSynthesisStatusPresentation> = {
  answer: {
    detail: "每条主张均保留了当前文献中的可审计证据引用。",
    label: "证据合成完成",
    tone: "success",
  },
  conflicting: {
    detail: "不同证据对部分主张给出了不一致的信号，请结合下方证据逐项判断。",
    label: "发现证据冲突",
    tone: "warning",
  },
  insufficient: {
    detail: "当前可用且仍是最新版本的证据不足，未以模型记忆补全回答。",
    label: "证据不足",
    tone: "warning",
  },
};

const COVERAGE_LABELS: Record<AiGroundedClaimCoverage, string> = {
  "conflicting-sources": "证据冲突",
  "insufficient-evidence": "证据不足",
  "multiple-supporting-sources": "多处支持",
  "partial-support": "部分支持",
};

const CLAIM_KIND_LABELS: Record<AiGroundedClaimKind, string> = {
  factual: "事实主张",
  interpretive: "解释性主张",
  uncertain: "不确定主张",
};

const RELATION_LABELS: Record<AiGroundedClaimRelation, string> = {
  background: "仅背景",
  contradicts: "相矛盾",
  qualifies: "限定",
  supports: "支持",
};

export function documentSynthesisStatusPresentation(
  status: AiGroundedAnswerStatus,
): DocumentSynthesisStatusPresentation {
  return STATUS_PRESENTATION[status];
}

export function documentSynthesisCoverageLabel(coverage: AiGroundedClaimCoverage): string {
  return COVERAGE_LABELS[coverage];
}

export function documentSynthesisClaimKindLabel(kind: AiGroundedClaimKind): string {
  return CLAIM_KIND_LABELS[kind];
}

export function documentSynthesisRelationLabel(relation: AiGroundedClaimRelation | undefined): string {
  return relation ? RELATION_LABELS[relation] : "未标注关系";
}

export function documentSynthesisQueryError(query: string): string | null {
  const normalized = query.trim();
  if (!normalized) return "请输入想让当前文献回答的问题。";
  if (new TextEncoder().encode(normalized).byteLength > MAX_DOCUMENT_SYNTHESIS_QUERY_BYTES) {
    return "问题不能超过 16 KB。请缩短后重新生成。";
  }
  return null;
}

export function documentSynthesisSettingsCta(
  message: string | null,
): { label: string; path: string } | null {
  return message && /配置 AI 服务|配置.*AI/.test(message)
    ? { label: "去配置 AI", path: "/settings?section=ai" }
    : null;
}
