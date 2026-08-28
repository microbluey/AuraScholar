import type { DiscoverySource } from "@aurascholar/core";

const SOURCE_FAILURE_STATUSES = new Set(["timeout", "error", "rate_limited", "aborted"]);

type DiscoverySearchSourceReport = {
  source: DiscoverySource;
  status: string;
  error?: string;
};

type DiscoverySearchReportSources = Partial<Record<DiscoverySource, DiscoverySearchSourceReport>>;

export function isSavedSearchReportUnavailable(report: {
  sources: DiscoverySearchReportSources;
}): boolean {
  const sources = sourceReports(report.sources);
  return (
    sources.length > 0 && sources.every((source) => SOURCE_FAILURE_STATUSES.has(source.status))
  );
}

export function savedSearchReportErrorMessage(report: {
  sources: DiscoverySearchReportSources;
}): string {
  const details = sourceReports(report.sources)
    .filter((source) => SOURCE_FAILURE_STATUSES.has(source.status))
    .map((source) => `${sourceLabel(source.source)} ${sourceStatusLabel(source.status)}`)
    .join("; ");
  return details ? `检索源暂时不可用:${details}` : "检索源暂时不可用";
}

function sourceReports(sources: DiscoverySearchReportSources): DiscoverySearchSourceReport[] {
  return Object.values(sources).filter((source): source is DiscoverySearchSourceReport =>
    Boolean(source),
  );
}

function sourceLabel(source: DiscoverySource): string {
  switch (source) {
    case "crossref":
      return "Crossref";
    case "openalex":
      return "OpenAlex";
    case "s2":
      return "Semantic Scholar";
    case "arxiv":
      return "arXiv";
  }
}

function sourceStatusLabel(status: string): string {
  if (status === "timeout") return "超时";
  if (status === "rate_limited") return "限流";
  if (status === "aborted") return "已停止";
  return "失败";
}
