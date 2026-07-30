import { describe, expect, it } from "vitest";
import type { DiscoverySource } from "@aurascholar/core";
import type { DiscoveryResultWithLibrary } from "../../services/discovery";
import {
  DISCOVERY_SOURCE_LABELS,
  DISCOVERY_SOURCE_ORDER,
  discoveryImportBusyLabel,
  discoveryImportMessage,
  discoveryResultIdentityKeys,
  fulltextProfile,
  identifierSignals,
  resultConfidence,
  resultSources,
  sourceLabel,
} from "./discovery-result-model";

function discoveryResult({
  matchedSources = ["crossref"],
  result = {},
  work = {},
}: {
  matchedSources?: DiscoverySource[];
  result?: Partial<Omit<DiscoveryResultWithLibrary, "matchedSources" | "work">>;
  work?: Partial<DiscoveryResultWithLibrary["work"]>;
} = {}): DiscoveryResultWithLibrary {
  return {
    id: "result-1",
    inLibrary: false,
    matchedSources,
    score: 10,
    source: "crossref",
    ...result,
    work: {
      authors: [],
      source: "crossref",
      title: "Example paper",
      ...work,
    },
  };
}

describe("discovery result model", () => {
  it("keeps source labels and result sources in the product-defined order", () => {
    const result = discoveryResult({
      matchedSources: ["arxiv", "crossref", "s2", "crossref", "openalex"],
    });

    expect(DISCOVERY_SOURCE_ORDER).toEqual(["openalex", "crossref", "s2", "arxiv"]);
    expect(DISCOVERY_SOURCE_LABELS).toEqual({
      arxiv: "arXiv",
      crossref: "Crossref",
      openalex: "OpenAlex",
      s2: "Semantic Scholar",
    });
    expect(resultSources(result)).toEqual(["openalex", "crossref", "s2", "arxiv"]);
    expect(sourceLabel("s2")).toBe("Semantic Scholar");
  });

  it("falls back to the primary source when no matched source is recorded", () => {
    expect(
      resultSources(
        discoveryResult({
          matchedSources: [],
          result: { source: "arxiv" },
          work: { source: "arxiv" },
        }),
      ),
    ).toEqual(["arxiv"]);
  });

  it("describes all stable identifier signals in a predictable order", () => {
    const signals = identifierSignals(
      discoveryResult({
        work: {
          arxivId: "2401.00001",
          doi: "10.1000/example",
          openalexId: "W123",
          pmid: "123456",
          s2Id: "S2-123",
        },
      }).work,
    );

    expect(signals).toEqual([
      "DOI 10.1000/example",
      "arXiv 2401.00001",
      "OpenAlex ID",
      "Semantic Scholar ID",
      "PMID 123456",
    ]);
  });

  it("builds normalized identity keys that survive cross-source result id changes", () => {
    const result = discoveryResult({
      work: {
        arxivId: "2401.00001",
        doi: "10.1000/EXAMPLE",
        openalexId: "W123",
        pmid: "PMID-1",
        s2Id: "S2-123",
        title: "  Graphs, Agents & Science!  ",
        year: 2025,
      },
    });

    expect(discoveryResultIdentityKeys(result)).toEqual([
      "doi:10.1000/example",
      "arxiv:2401.00001",
      "openalex:w123",
      "s2:s2-123",
      "pmid:pmid-1",
      "title:graphs agents science:2025",
    ]);
  });

  it.each([
    {
      expected: {
        badge: "可信度强",
        label: "强",
        tier: "strong",
        variant: "success",
      },
      name: "strong",
      result: discoveryResult({
        matchedSources: ["openalex", "crossref"],
        work: {
          abstract: "Abstract",
          authors: [{ displayName: "Ada", position: 0 }],
          doi: "10.1000/strong",
          oaPdfUrl: "https://example.test/paper.pdf",
          venueName: "CHI",
          year: 2025,
        },
      }),
    },
    {
      expected: {
        badge: "可信度中",
        label: "中",
        tier: "medium",
        variant: "neutral",
      },
      name: "medium",
      result: discoveryResult({
        work: { doi: "10.1000/medium" },
      }),
    },
    {
      expected: {
        badge: "需核对",
        label: "需核对",
        tier: "low",
        variant: "warning",
      },
      name: "low",
      result: discoveryResult(),
    },
  ])("classifies $name-confidence results", ({ expected, result }) => {
    expect(resultConfidence(result)).toMatchObject(expected);
  });

  it("includes the strongest evidence in confidence detail", () => {
    const confidence = resultConfidence(
      discoveryResult({
        matchedSources: ["openalex", "crossref", "s2"],
        work: {
          abstract: "Abstract",
          doi: "10.1000/evidence",
        },
      }),
    );

    expect(confidence.detail).toBe("稳定标识 · 3 个数据源佐证 · 有摘要");
  });

  it.each([
    {
      expectedDetail: "开放 PDF 未能自动挂载",
      expectedLabel: "待补全文",
      expectedVariant: "warning",
      result: discoveryResult({
        result: { inLibrary: true, needsFulltext: true },
        work: { oaPdfUrl: "https://example.test/paper.pdf" },
      }),
    },
    {
      expectedDetail: "入库时会尝试获取开放 PDF",
      expectedLabel: "开放 PDF 可用",
      expectedVariant: "success",
      result: discoveryResult({
        work: { oaPdfUrl: "https://example.test/paper.pdf" },
      }),
    },
    {
      expectedDetail: "库中已有记录",
      expectedLabel: "库中记录",
      expectedVariant: "neutral",
      result: discoveryResult({ result: { inLibrary: true } }),
    },
    {
      expectedDetail: "通过 DOI、出版商页面或机构入口找全文",
      expectedLabel: "需站点查找",
      expectedVariant: "neutral",
      result: discoveryResult({ work: { doi: "10.1000/landing" } }),
    },
    {
      expectedDetail: "当前源没有提供开放 PDF 或可靠落地页",
      expectedLabel: "未发现全文",
      expectedVariant: "warning",
      result: discoveryResult(),
    },
  ])(
    "profiles fulltext state as $expectedLabel",
    ({ expectedDetail, expectedLabel, expectedVariant, result }) => {
      const profile = fulltextProfile(result);
      expect(profile.label).toBe(expectedLabel);
      expect(profile.variant).toBe(expectedVariant);
      expect(profile.detail).toContain(expectedDetail);
    },
  );

  it("uses the available-fulltext signal in the import busy label", () => {
    expect(
      discoveryImportBusyLabel(
        discoveryResult({ work: { oaPdfUrl: "https://example.test/paper.pdf" } }),
      ),
    ).toBe("导入并抓取 PDF...");
    expect(discoveryImportBusyLabel(discoveryResult())).toBe("导入中...");
  });

  it.each([
    {
      imported: { deduped: true, pdfFetched: true, title: "Existing with PDF" },
      result: discoveryResult(),
      text: "已在库中:Existing with PDF，PDF 已可用",
    },
    {
      imported: { deduped: true, pdfFetched: false, title: "Existing" },
      result: discoveryResult(),
      text: "已在库中:Existing",
    },
    {
      imported: { deduped: false, pdfFetched: true, title: "Imported with PDF" },
      result: discoveryResult(),
      text: "已入库:Imported with PDF，开放 PDF 已挂载",
    },
    {
      imported: { deduped: false, pdfFetched: false, title: "OA fallback" },
      result: discoveryResult({ work: { oaPdfUrl: "https://example.test/paper.pdf" } }),
      text: "已入库:OA fallback；开放 PDF 未能自动获取，可去找全文",
    },
    {
      imported: { deduped: false, pdfFetched: false, title: "Metadata only" },
      result: discoveryResult(),
      text: "已入库:Metadata only；暂无开放 PDF，可去找全文",
    },
  ])("formats import feedback as $text", ({ imported, result, text }) => {
    expect(discoveryImportMessage(result, imported)).toBe(text);
  });
});
