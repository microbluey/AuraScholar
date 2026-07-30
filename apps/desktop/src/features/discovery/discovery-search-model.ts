import type { DiscoverySource } from "@aurascholar/core";
import type {
  DiscoveryResultWithLibrary,
  DiscoverySearchReportWithLibrary,
} from "../../services/discovery";
import { resultSources, sourceLabel } from "./discovery-result-model";

export type DiscoverySourceStatus =
  | "idle"
  | "searching"
  | "done"
  | "empty"
  | "timeout"
  | "error"
  | "rate_limited"
  | "stopped";

export const DISCOVERY_SOURCE_STATUS_ORDER: readonly DiscoverySourceStatus[] = [
  "searching",
  "done",
  "empty",
  "timeout",
  "rate_limited",
  "error",
  "stopped",
  "idle",
];

const DISCOVERY_FAILURE_STATUSES = new Set(["timeout", "error", "rate_limited", "aborted"]);

export function statusLabel(status: DiscoverySourceStatus): string {
  switch (status) {
    case "searching":
      return "检索中";
    case "done":
      return "完成";
    case "empty":
      return "无结果";
    case "timeout":
      return "超时";
    case "error":
      return "失败";
    case "rate_limited":
      return "限流";
    case "stopped":
      return "已停止";
    case "idle":
      return "未启用";
  }
}

export function uiSourceStatus(status: string): DiscoverySourceStatus {
  if (status === "aborted") return "stopped";
  if (status === "timeout" || status === "error" || status === "rate_limited") return status;
  if (status === "done" || status === "empty") return status;
  return "error";
}

export function sourceStatusSummary(
  statuses: Record<DiscoverySource, DiscoverySourceStatus>,
): string {
  const active = DISCOVERY_SOURCE_STATUS_ORDER.find((status) =>
    Object.values(statuses).some((item) => item === status),
  );
  return active ? statusLabel(active) : "待命";
}

function sourceFailureSummary(
  reports: Array<DiscoverySearchReportWithLibrary["sources"][DiscoverySource]>,
): string {
  return reports
    .map((report) => `${sourceLabel(report.source)} ${statusLabel(uiSourceStatus(report.status))}`)
    .join("; ");
}

export function discoverySearchMessage(
  resultCount: number,
  reports: readonly DiscoverySearchReportWithLibrary[],
): string {
  const sourceReports = reports.flatMap((report) => Object.values(report.sources));
  const failed = sourceReports.filter((report) => DISCOVERY_FAILURE_STATUSES.has(report.status));
  const completed = sourceReports.filter(
    (report) => report.status === "done" || report.status === "empty",
  );

  if (resultCount > 0) {
    const suffix = failed.length > 0 ? `；${sourceFailureSummary(failed)} 暂时不可用` : "";
    return `找到 ${resultCount} 条候选结果${suffix}`;
  }
  if (failed.length > 0 && completed.length === 0) {
    return `检索源暂时不可用:${sourceFailureSummary(failed)}`;
  }
  if (failed.length > 0) {
    return `没有找到结果；${sourceFailureSummary(failed)} 暂时不可用，可稍后重试`;
  }
  return "没有找到结果,换个关键词试试";
}

export function mergeDiscoveryStatus(
  fallback: DiscoveryResultWithLibrary | undefined,
  preferred: DiscoveryResultWithLibrary,
): DiscoveryResultWithLibrary {
  const matchedSources = resultSources({
    ...preferred,
    matchedSources: [...(preferred.matchedSources ?? []), ...(fallback?.matchedSources ?? [])],
  });
  return {
    ...preferred,
    inLibrary: preferred.inLibrary || fallback?.inLibrary || false,
    libraryWorkId: preferred.libraryWorkId ?? fallback?.libraryWorkId,
    matchedSources,
    score: Math.max(preferred.score, fallback?.score ?? 0),
  };
}
