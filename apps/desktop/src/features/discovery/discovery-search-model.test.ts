import { describe, expect, it } from "vitest";
import type {
  DiscoverySource,
  DiscoverySourceStatus as CoreDiscoverySourceStatus,
} from "@aurascholar/core";
import type {
  DiscoveryResultWithLibrary,
  DiscoverySearchReportWithLibrary,
} from "../../services/discovery";
import {
  DISCOVERY_SOURCE_STATUS_ORDER,
  discoverySearchMessage,
  mergeDiscoveryStatus,
  sourceStatusSummary,
  statusLabel,
  uiSourceStatus,
  type DiscoverySourceStatus,
} from "./discovery-search-model";

function sourceStatuses(
  overrides: Partial<Record<DiscoverySource, DiscoverySourceStatus>> = {},
): Record<DiscoverySource, DiscoverySourceStatus> {
  return {
    arxiv: "idle",
    crossref: "idle",
    openalex: "idle",
    s2: "idle",
    ...overrides,
  };
}

function searchReport(
  entries: Array<[DiscoverySource, CoreDiscoverySourceStatus]>,
): DiscoverySearchReportWithLibrary {
  return {
    cursors: {} as DiscoverySearchReportWithLibrary["cursors"],
    results: [],
    sources: Object.fromEntries(
      entries.map(([source, status]) => [source, { count: 0, source, status }]),
    ) as DiscoverySearchReportWithLibrary["sources"],
  };
}

function discoveryResult({
  matchedSources = ["crossref"],
  result = {},
}: {
  matchedSources?: DiscoverySource[];
  result?: Partial<DiscoveryResultWithLibrary>;
} = {}): DiscoveryResultWithLibrary {
  return {
    id: "result",
    inLibrary: false,
    matchedSources,
    score: 10,
    source: "crossref",
    work: {
      authors: [],
      source: "crossref",
      title: "Example",
    },
    ...result,
  };
}

describe("discovery search model", () => {
  it("keeps the intended source-status summary priority", () => {
    expect(DISCOVERY_SOURCE_STATUS_ORDER).toEqual([
      "searching",
      "done",
      "empty",
      "timeout",
      "rate_limited",
      "error",
      "stopped",
      "idle",
    ]);
    expect(
      sourceStatusSummary(
        sourceStatuses({
          arxiv: "error",
          crossref: "done",
          openalex: "searching",
          s2: "rate_limited",
        }),
      ),
    ).toBe("检索中");
    expect(
      sourceStatusSummary(
        sourceStatuses({
          arxiv: "error",
          crossref: "done",
          openalex: "timeout",
          s2: "rate_limited",
        }),
      ),
    ).toBe("完成");
    expect(
      sourceStatusSummary(
        sourceStatuses({
          arxiv: "error",
          crossref: "stopped",
          openalex: "timeout",
          s2: "rate_limited",
        }),
      ),
    ).toBe("超时");
  });

  it("uses a waiting fallback when no source status is present", () => {
    expect(sourceStatusSummary({} as Record<DiscoverySource, DiscoverySourceStatus>)).toBe("待命");
  });

  it.each([
    ["searching", "检索中"],
    ["done", "完成"],
    ["empty", "无结果"],
    ["timeout", "超时"],
    ["error", "失败"],
    ["rate_limited", "限流"],
    ["stopped", "已停止"],
    ["idle", "未启用"],
  ] satisfies Array<[DiscoverySourceStatus, string]>)("labels %s status as %s", (status, label) => {
    expect(statusLabel(status)).toBe(label);
  });

  it("maps aborted reports to stopped and rejects unknown report statuses", () => {
    expect(uiSourceStatus("aborted")).toBe("stopped");
    expect(uiSourceStatus("done")).toBe("done");
    expect(uiSourceStatus("empty")).toBe("empty");
    expect(uiSourceStatus("timeout")).toBe("timeout");
    expect(uiSourceStatus("rate_limited")).toBe("rate_limited");
    expect(uiSourceStatus("error")).toBe("error");
    expect(uiSourceStatus("unexpected")).toBe("error");
  });

  it("reports successful results without a failure suffix", () => {
    expect(discoverySearchMessage(3, [searchReport([["openalex", "done"]])])).toBe(
      "找到 3 条候选结果",
    );
  });

  it("reports successful results together with degraded sources", () => {
    expect(
      discoverySearchMessage(3, [
        searchReport([
          ["openalex", "done"],
          ["crossref", "timeout"],
          ["s2", "rate_limited"],
        ]),
      ]),
    ).toBe("找到 3 条候选结果；Crossref 超时; Semantic Scholar 限流 暂时不可用");
  });

  it("reports an unavailable search when every reported source failed", () => {
    expect(
      discoverySearchMessage(0, [
        searchReport([
          ["crossref", "error"],
          ["arxiv", "aborted"],
        ]),
      ]),
    ).toBe("检索源暂时不可用:Crossref 失败; arXiv 已停止");
  });

  it("reports partial source failure when completed sources found no result", () => {
    expect(
      discoverySearchMessage(0, [
        searchReport([
          ["openalex", "empty"],
          ["crossref", "timeout"],
        ]),
      ]),
    ).toBe("没有找到结果；Crossref 超时 暂时不可用，可稍后重试");
  });

  it("offers a new query when completed sources returned no result", () => {
    expect(discoverySearchMessage(0, [searchReport([["openalex", "empty"]])])).toBe(
      "没有找到结果,换个关键词试试",
    );
  });

  it("merges library state, source evidence, and the highest score", () => {
    const fallback = discoveryResult({
      matchedSources: ["arxiv", "crossref"],
      result: {
        inLibrary: true,
        libraryWorkId: "library-work",
        score: 84,
        source: "arxiv",
      },
    });
    const preferred = discoveryResult({
      matchedSources: ["s2", "openalex"],
      result: {
        inLibrary: false,
        score: 72,
        source: "s2",
      },
    });

    const merged = mergeDiscoveryStatus(fallback, preferred);

    expect(merged.inLibrary).toBe(true);
    expect(merged.libraryWorkId).toBe("library-work");
    expect(merged.matchedSources).toEqual(["openalex", "crossref", "s2", "arxiv"]);
    expect(merged.score).toBe(84);
    expect(merged.source).toBe("s2");
  });

  it("keeps preferred library identity and score when they are stronger", () => {
    const fallback = discoveryResult({
      result: {
        inLibrary: true,
        libraryWorkId: "fallback-work",
        score: 10,
      },
    });
    const preferred = discoveryResult({
      result: {
        inLibrary: true,
        libraryWorkId: "preferred-work",
        score: 99,
      },
    });

    const merged = mergeDiscoveryStatus(fallback, preferred);

    expect(merged.libraryWorkId).toBe("preferred-work");
    expect(merged.score).toBe(99);
  });
});
