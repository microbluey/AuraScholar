import type { DiscoverySource } from "@aurascholar/core";
import type { DiscoveryResultWithLibrary } from "../../services/discovery";

export const DISCOVERY_SOURCE_ORDER = [
  "openalex",
  "crossref",
  "s2",
  "arxiv",
] as const satisfies readonly DiscoverySource[];

export const DISCOVERY_SOURCE_LABELS = {
  arxiv: "arXiv",
  crossref: "Crossref",
  openalex: "OpenAlex",
  s2: "Semantic Scholar",
} as const satisfies Record<DiscoverySource, string>;

const DISCOVERY_SOURCE_RANK = new Map<DiscoverySource, number>(
  DISCOVERY_SOURCE_ORDER.map((source, index) => [source, index]),
);

export type DiscoveryResultConfidence = {
  badge: string;
  detail: string;
  label: string;
  tier: "strong" | "medium" | "low";
  variant: "success" | "neutral" | "warning";
};

export type DiscoveryFulltextProfile = {
  detail: string;
  label: string;
  variant: "success" | "neutral" | "warning";
};

export type DiscoveryImportResultSummary = {
  deduped: boolean;
  pdfFetched: boolean;
  title: string;
};

export function sourceLabel(source: DiscoverySource): string {
  return DISCOVERY_SOURCE_LABELS[source];
}

export function resultSources(result: DiscoveryResultWithLibrary): DiscoverySource[] {
  const selected = result.matchedSources?.length ? result.matchedSources : [result.source];
  return [...new Set(selected)].sort(
    (left, right) =>
      (DISCOVERY_SOURCE_RANK.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (DISCOVERY_SOURCE_RANK.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function identifierSignals(work: DiscoveryResultWithLibrary["work"]): string[] {
  return [
    work.doi ? `DOI ${work.doi}` : undefined,
    work.arxivId ? `arXiv ${work.arxivId}` : undefined,
    work.openalexId ? "OpenAlex ID" : undefined,
    work.s2Id ? "Semantic Scholar ID" : undefined,
    work.pmid ? `PMID ${work.pmid}` : undefined,
  ].filter((item): item is string => Boolean(item));
}

export function discoveryResultIdentityKeys(result: DiscoveryResultWithLibrary): string[] {
  const work = result.work;
  return [
    work.doi ? `doi:${work.doi.toLowerCase()}` : undefined,
    work.arxivId ? `arxiv:${work.arxivId.toLowerCase()}` : undefined,
    work.openalexId ? `openalex:${work.openalexId.toLowerCase()}` : undefined,
    work.s2Id ? `s2:${work.s2Id.toLowerCase()}` : undefined,
    work.pmid ? `pmid:${work.pmid.toLowerCase()}` : undefined,
    work.title ? `title:${normalizeDiscoveryTitle(work.title)}:${work.year ?? ""}` : undefined,
  ].filter((key): key is string => Boolean(key));
}

export function resultConfidence(result: DiscoveryResultWithLibrary): DiscoveryResultConfidence {
  const work = result.work;
  const sourceCount = resultSources(result).length;
  const identifiers = identifierSignals(work);
  const stablePrimaryId = Boolean(work.doi || work.arxivId);
  let points = 0;
  if (stablePrimaryId) points += 3;
  else if (identifiers.length > 0) points += 2;
  if (sourceCount >= 2) points += 2;
  if (work.abstract) points += 1;
  if (work.venueName && work.year) points += 1;
  if (work.authors.length > 0) points += 1;
  if (work.oaPdfUrl) points += 1;

  const tier = points >= 6 ? "strong" : points >= 3 ? "medium" : "low";
  const reasons = [
    stablePrimaryId ? "稳定标识" : identifiers.length > 0 ? "外部 ID" : undefined,
    sourceCount >= 2 ? `${sourceCount} 个数据源佐证` : `${sourceLabel(result.source)} 单源`,
    work.abstract ? "有摘要" : undefined,
    work.venueName && work.year ? "出版信息完整" : undefined,
    work.oaPdfUrl ? "有开放全文线索" : undefined,
  ].filter((item): item is string => Boolean(item));

  if (tier === "strong") {
    return {
      badge: "可信度强",
      detail: reasons.slice(0, 3).join(" · "),
      label: "强",
      tier,
      variant: "success",
    };
  }
  if (tier === "medium") {
    return {
      badge: "可信度中",
      detail: reasons.slice(0, 3).join(" · "),
      label: "中",
      tier,
      variant: "neutral",
    };
  }
  return {
    badge: "需核对",
    detail: reasons.slice(0, 2).join(" · ") || "缺少稳定标识",
    label: "需核对",
    tier,
    variant: "warning",
  };
}

export function fulltextProfile(result: DiscoveryResultWithLibrary): DiscoveryFulltextProfile {
  if (result.inLibrary && result.needsFulltext) {
    return {
      detail: result.work.oaPdfUrl
        ? "已入库，但开放 PDF 未能自动挂载；可继续用站点浏览或机构入口补全文。"
        : "已入库但还没有 PDF，适合继续走站点浏览或图书馆入口补全文。",
      label: "待补全文",
      variant: "warning",
    };
  }
  if (result.work.oaPdfUrl) {
    return {
      detail: "入库时会尝试获取开放 PDF；也可以用站点浏览器核对来源页面。",
      label: "开放 PDF 可用",
      variant: "success",
    };
  }
  if (result.inLibrary) {
    return {
      detail: "库中已有记录；打开阅读器后可确认本地附件。",
      label: "库中记录",
      variant: "neutral",
    };
  }
  if (result.work.doi || result.work.url) {
    return {
      detail: "未发现直接开放 PDF，可先入库，再通过 DOI、出版商页面或机构入口找全文。",
      label: "需站点查找",
      variant: "neutral",
    };
  }
  return {
    detail: "当前源没有提供开放 PDF 或可靠落地页，入库前建议核对标题和作者。",
    label: "未发现全文",
    variant: "warning",
  };
}

export function discoveryImportBusyLabel(result: DiscoveryResultWithLibrary): string {
  return result.work.oaPdfUrl ? "导入并抓取 PDF..." : "导入中...";
}

export function discoveryImportMessage(
  result: DiscoveryResultWithLibrary,
  imported: DiscoveryImportResultSummary,
): string {
  if (imported.deduped) {
    return imported.pdfFetched
      ? `已在库中:${imported.title}，PDF 已可用`
      : `已在库中:${imported.title}`;
  }
  if (imported.pdfFetched) {
    return `已入库:${imported.title}，开放 PDF 已挂载`;
  }
  if (result.work.oaPdfUrl) {
    return `已入库:${imported.title}；开放 PDF 未能自动获取，可去找全文`;
  }
  return `已入库:${imported.title}；暂无开放 PDF，可去找全文`;
}

function normalizeDiscoveryTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
