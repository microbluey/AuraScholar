import { describe, expect, it } from "vitest";
import type {
  KnowledgeContentIndexStats,
  KnowledgeContentSearchResult,
  KnowledgeSemanticIndexStatus,
} from "../../electron/knowledge-command-contract";
import type { LibraryScopeToken } from "../../electron/library-read-command-contract";
import {
  decodeKnowledgeBuildSemanticIndexResult,
  decodeKnowledgeGetContentStatsResult,
  decodeKnowledgeGetSemanticIndexStatusResult,
  decodeKnowledgeSearchContentResult,
  decodeKnowledgeScopeToken,
} from "./knowledge-command-result-codec";

const SCOPE: LibraryScopeToken = {
  libraryId: "library:knowledge",
  scopeToken: "scope:knowledge",
};

const STATS: KnowledgeContentIndexStats = {
  totalContentUnits: 4,
  readyContentUnits: 3,
  contextOnlyContentUnits: 1,
  sourceCounts: { pdf: 2, annotation: 1, evidence: 1 },
  languageCoverage: { zh: 1, en: 2, other: 0, missing: 1 },
};

const SUMMARY = {
  expectedCount: 4,
  id: "index:knowledge",
  indexedCount: 3,
  stale: false,
  status: "active" as const,
};

const STATUS: KnowledgeSemanticIndexStatus = {
  active: SUMMARY,
  building: null,
  failed: null,
};

const SEARCH_RESULT: KnowledgeContentSearchResult = {
  id: "content-unit:knowledge",
  sourceType: "pdf",
  sourceId: "revision:knowledge",
  workId: "work:knowledge",
  workTitle: "Knowledge paper",
  assetId: "asset:knowledge",
  revisionId: "revision:knowledge",
  parentUnitId: null,
  ordinal: 0,
  headingPath: ["Methods"],
  anchor: { kind: "pdf", pageIndex: 1, version: 1 },
  text: "A grounded passage.",
  language: "en",
  tokenCount: 4,
  state: "ready",
  score: 0.5,
  excerpt: "A grounded passage.",
};

const BUILD_RESULT = {
  created: true,
  index: { ...SUMMARY, status: "building" as const },
  job: { id: "job:knowledge", status: "queued" as const },
  scope: SCOPE,
};

const STATS_RESULT = { stats: STATS, scope: SCOPE };
const STATUS_RESULT = { status: STATUS, scope: SCOPE };
const SEARCH_RESULT_ENVELOPE = {
  results: [SEARCH_RESULT],
  retrieval: { mode: "hybrid" as const, semanticStatus: "used" as const },
  scope: SCOPE,
};

describe("Knowledge command-result scope codec", () => {
  it("decodes each scoped envelope and clones the acknowledged token", () => {
    const build = decodeKnowledgeBuildSemanticIndexResult(BUILD_RESULT, SCOPE);
    const stats = decodeKnowledgeGetContentStatsResult(STATS_RESULT, SCOPE);
    const status = decodeKnowledgeGetSemanticIndexStatusResult(STATUS_RESULT, SCOPE);
    const search = decodeKnowledgeSearchContentResult(SEARCH_RESULT_ENVELOPE, SCOPE);

    expect(build).toEqual(BUILD_RESULT);
    expect(stats).toEqual(STATS_RESULT);
    expect(status).toEqual(STATUS_RESULT);
    expect(search).toEqual(SEARCH_RESULT_ENVELOPE);
    expect(build.scope).not.toBe(SCOPE);
    expect(stats.scope).not.toBe(SCOPE);
    expect(status.scope).not.toBe(SCOPE);
    expect(search.scope).not.toBe(SCOPE);
  });

  it("accepts null-prototype scope records while rejecting malformed tokens", () => {
    const nullPrototypeScope = Object.assign(Object.create(null), SCOPE);
    expect(decodeKnowledgeScopeToken(nullPrototypeScope)).toEqual(SCOPE);

    for (const value of [
      null,
      { libraryId: "library:knowledge" },
      { libraryId: "library:knowledge", scopeToken: "" },
      { libraryId: "library:knowledge", scopeToken: "scope:knowledge", extra: true },
      {
        libraryId: "界".repeat(171),
        scopeToken: "scope:knowledge",
      },
      {
        libraryId: "library:knowledge",
        scopeToken: "界".repeat(65),
      },
    ]) {
      expect(() => decodeKnowledgeScopeToken(value)).toThrow("Knowledge Library");
    }
  });

  it("rejects acknowledgements from a stale or foreign Library generation", () => {
    const decoders = [
      () =>
        decodeKnowledgeBuildSemanticIndexResult(
          { ...BUILD_RESULT, scope: { ...SCOPE, scopeToken: "stale" } },
          SCOPE,
        ),
      () =>
        decodeKnowledgeGetContentStatsResult(
          { ...STATS_RESULT, scope: { ...SCOPE, scopeToken: "stale" } },
          SCOPE,
        ),
      () =>
        decodeKnowledgeGetSemanticIndexStatusResult(
          { ...STATUS_RESULT, scope: { ...SCOPE, libraryId: "library:other" } },
          SCOPE,
        ),
      () =>
        decodeKnowledgeSearchContentResult(
          { ...SEARCH_RESULT_ENVELOPE, scope: { ...SCOPE, libraryId: "library:other" } },
          SCOPE,
        ),
    ];
    for (const decode of decoders) {
      expect(decode).toThrow("Knowledge Library scope does not match the request");
    }
  });

  it("requires exact scoped envelopes", () => {
    expect(() =>
      decodeKnowledgeBuildSemanticIndexResult({ ...BUILD_RESULT, extra: true }, SCOPE),
    ).toThrow("Knowledge semantic-index build result is invalid");
    expect(() => decodeKnowledgeGetContentStatsResult({ stats: STATS }, SCOPE)).toThrow(
      "Knowledge content stats result is invalid",
    );
    expect(() =>
      decodeKnowledgeGetSemanticIndexStatusResult({ status: STATUS, extra: true }, SCOPE),
    ).toThrow("Knowledge semantic-index status result is invalid");
    expect(() =>
      decodeKnowledgeSearchContentResult({ ...SEARCH_RESULT_ENVELOPE, scope: undefined }, SCOPE),
    ).toThrow("Knowledge Library scope");
  });

  it("fails closed on malformed nested projections and sparse arrays", () => {
    expect(() =>
      decodeKnowledgeGetContentStatsResult(
        {
          ...STATS_RESULT,
          stats: { ...STATS, sourceCounts: { ...STATS.sourceCounts, pdf: -1 } },
        },
        SCOPE,
      ),
    ).toThrow("Knowledge PDF source count");
    expect(() =>
      decodeKnowledgeGetSemanticIndexStatusResult(
        { ...STATUS_RESULT, status: { ...STATUS, active: { ...SUMMARY, stale: "no" } } },
        SCOPE,
      ),
    ).toThrow("Knowledge active semantic index is invalid");
    const sparseResults: KnowledgeContentSearchResult[] = [];
    sparseResults.length = 1;
    expect(() =>
      decodeKnowledgeSearchContentResult(
        { ...SEARCH_RESULT_ENVELOPE, results: sparseResults },
        SCOPE,
      ),
    ).toThrow("Knowledge search results are limited");
    expect(() =>
      decodeKnowledgeSearchContentResult(
        {
          ...SEARCH_RESULT_ENVELOPE,
          retrieval: { mode: "hybrid", semanticStatus: "used", unsupported: true },
        },
        SCOPE,
      ),
    ).toThrow("Knowledge search retrieval is invalid");
  });
});
