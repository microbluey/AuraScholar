import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { KnowledgeContentSearchResult } from "../../services/knowledge-search";
import {
  KnowledgeSearchPanel,
  KnowledgeSearchResultCard,
  knowledgeSearchRetrievalPresentation,
  sourceTypesForKnowledgeSearchFilter,
} from "./KnowledgeSearchPanel";
import { knowledgeSearchScopeLabel } from "./knowledge-search-scope";

function result(
  overrides: Partial<KnowledgeContentSearchResult> = {},
): KnowledgeContentSearchResult {
  return {
    anchor: { kind: "pdf", pageIndex: 3, revisionId: "revision:one", version: 1 },
    assetId: "asset:one",
    excerpt: "The quoted content remains tied to its original PDF page.",
    headingPath: ["Results", "Evaluation"],
    id: "content-unit:one",
    language: "en",
    ordinal: 0,
    parentUnitId: null,
    revisionId: "revision:one",
    score: 1,
    sourceId: "evidence:one",
    sourceType: "evidence",
    state: "ready",
    text: "The quoted content remains tied to its original PDF page.",
    tokenCount: 9,
    workId: "work:one",
    workTitle: "Evidence-backed result",
    ...overrides,
  };
}

describe("KnowledgeSearchPanel", () => {
  it("keeps content retrieval distinct from the Library metadata search", () => {
    const markup = renderToStaticMarkup(<KnowledgeSearchPanel enabled onOpenResult={vi.fn()} />);

    expect(markup).toContain("内容检索");
    expect(markup).toContain("PDF、批注和 Evidence");
    expect(markup).toContain("当前为本地关键词检索");
    expect(markup).toContain("整个资料库");
    expect(markup).toContain('aria-label="当前检索范围：整个资料库"');
    expect(markup).toContain('aria-label="当前检索模式：关键词检索"');
    expect(markup).toContain('placeholder="搜索已索引内容，例如研究方法或关键结论"');
    expect(markup).toContain('aria-label="按来源筛选已索引内容"');
    expect(markup).toContain("全部来源");
  });

  it("renders a source-aware open action only when an exact PDF anchor is valid", () => {
    const grounded = renderToStaticMarkup(
      <KnowledgeSearchResultCard opening={false} result={result()} onOpen={vi.fn()} />,
    );
    const unanchored = renderToStaticMarkup(
      <KnowledgeSearchResultCard
        opening={false}
        result={result({
          anchor: { kind: "canvas", nodeId: "node:one", nodeRevision: 1, version: 1 },
        })}
        onOpen={vi.fn()}
      />,
    );

    expect(grounded).toContain("Evidence");
    expect(grounded).toContain("Evidence-backed result");
    expect(grounded).toContain("Results › Evaluation");
    expect(grounded).toContain("定位到第 4 页");
    expect(grounded).toContain('data-knowledge-search-result="content-unit:one"');
    expect(unanchored).toContain("原文定位不可用");
    expect(unanchored).toContain("此片段没有可用的 PDF 锚点。");
    expect(unanchored).not.toContain("定位到第 4 页");
  });

  it("explains why the browser preview cannot query a local durable index", () => {
    const markup = renderToStaticMarkup(
      <KnowledgeSearchPanel enabled={false} onOpenResult={vi.fn()} />,
    );

    expect(markup).toContain("内容检索使用设备上的持久化索引");
    expect(markup).not.toContain("knowledge-search-input");
  });

  it("converts a selected source into the narrow command filter", () => {
    expect(sourceTypesForKnowledgeSearchFilter("all")).toBeUndefined();
    expect(sourceTypesForKnowledgeSearchFilter("pdf")).toEqual(["pdf"]);
    expect(sourceTypesForKnowledgeSearchFilter("annotation")).toEqual(["annotation"]);
    expect(sourceTypesForKnowledgeSearchFilter("evidence")).toEqual(["evidence"]);
  });

  it("presents hybrid and fallback retrieval state without implying relevance certainty", () => {
    expect(
      knowledgeSearchRetrievalPresentation({ mode: "hybrid", semanticStatus: "used" }),
    ).toEqual({
      detail: expect.stringContaining("关键词与语义融合检索"),
      label: "混合检索",
    });
    expect(
      knowledgeSearchRetrievalPresentation({ mode: "fulltext", semanticStatus: "unavailable" }),
    ).toEqual({
      detail: expect.stringContaining("已回退到关键词检索"),
      label: "关键词检索",
    });
  });

  it("makes an applied material-language preference visible without presenting it as a filter", () => {
    expect(
      knowledgeSearchRetrievalPresentation({
        languagePreference: { applied: true, requestedLanguage: "en" },
        mode: "hybrid",
        semanticStatus: "used",
      }),
    ).toEqual({
      detail: expect.stringContaining("其他候选仍保留"),
      label: "混合检索 · 英文优先",
    });
    expect(
      knowledgeSearchRetrievalPresentation({
        languagePreference: { applied: false, requestedLanguage: "zh" },
        mode: "fulltext",
        semanticStatus: "not-configured",
      }),
    ).toEqual({
      detail: expect.stringContaining("未找到可用于中文偏好的语种标记"),
      label: "关键词检索",
    });
  });

  it("keeps the visible project label separate from the strict command scope", () => {
    const markup = renderToStaticMarkup(
      <KnowledgeSearchPanel
        enabled
        onOpenResult={vi.fn()}
        scope={{ kind: "project", projectId: "project:one" }}
        scopeLabel="项目 · 设计研究"
      />,
    );

    expect(markup).toContain("项目 · 设计研究");
    expect(markup).toContain('aria-label="当前检索范围：项目 · 设计研究"');
    expect(knowledgeSearchScopeLabel({ kind: "project", projectId: "project:one" })).toBe(
      "当前项目",
    );
  });
});
