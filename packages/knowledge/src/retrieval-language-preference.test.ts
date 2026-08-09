import { describe, expect, it } from "vitest";
import type { FusedRetrievalRank } from "./hybrid-ranking.js";
import { BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1 } from "./retrieval-evaluation-development-corpus.js";
import {
  applyRetrievalLanguagePreference,
  normalizeRetrievalPreferenceLanguage,
  parseRetrievalLanguageIntent,
} from "./retrieval-language-preference.js";

describe("retrieval language preference", () => {
  it("recognizes common stored language labels without guessing unknown values", () => {
    expect(normalizeRetrievalPreferenceLanguage("zh-CN")).toBe("zh");
    expect(normalizeRetrievalPreferenceLanguage("Chinese")).toBe("zh");
    expect(normalizeRetrievalPreferenceLanguage("eng")).toBe("en");
    expect(normalizeRetrievalPreferenceLanguage(" English ")).toBe("en");
    expect(normalizeRetrievalPreferenceLanguage("French")).toBeNull();
    expect(normalizeRetrievalPreferenceLanguage(null)).toBeNull();
  });

  it("parses affirmative material-language requests while leaving answer-language prompts neutral", () => {
    expect(parseRetrievalLanguageIntent("在英文流行病学资料里找新发病例的解释")).toMatchObject({
      language: "en",
    });
    expect(
      parseRetrievalLanguageIntent("Which Chinese sources explain contact tracing?"),
    ).toMatchObject({
      language: "zh",
    });
    expect(
      parseRetrievalLanguageIntent("Which Chinese-described method rotates held-out data?"),
    ).toMatchObject({
      language: "zh",
    });
    expect(
      parseRetrievalLanguageIntent("What Chinese archival principle preserves provenance?"),
    ).toMatchObject({
      language: "zh",
    });
    expect(
      parseRetrievalLanguageIntent("Which Chinese environmental explanation describes heat?"),
    ).toMatchObject({
      language: "zh",
    });
    expect(parseRetrievalLanguageIntent("show papers written in English")).toMatchObject({
      language: "en",
    });
    expect(parseRetrievalLanguageIntent("请用英文回答交叉验证的问题")).toBeNull();
    expect(parseRetrievalLanguageIntent("不要英文资料，只找研究方法")).toBeNull();
    expect(parseRetrievalLanguageIntent("English language models")).toBeNull();
    expect(parseRetrievalLanguageIntent("中文资料或 English sources 都可以")).toBeNull();
  });

  it("recognizes every explicit cross-language request in the development calibration corpus", () => {
    const crossLanguageQueries = BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1.queries.filter(
      (query) => query.language !== query.targetLanguage,
    );
    expect(crossLanguageQueries).toHaveLength(16);
    for (const query of crossLanguageQueries) {
      expect(parseRetrievalLanguageIntent(query.text), query.id).toMatchObject({
        language: query.targetLanguage,
      });
    }
  });

  it("adds an inspectable strong preference channel without removing other candidates", () => {
    const candidates: FusedRetrievalRank[] = [
      rank("content-unit:english-top", 0.033, 1),
      rank("content-unit:chinese-target", 0.03, 2),
      rank("content-unit:unknown", 0.02, 3),
    ];
    const result = applyRetrievalLanguagePreference(candidates, {
      languageByContentUnitId: new Map([
        ["content-unit:english-top", "en"],
        ["content-unit:chinese-target", "zh-Hans"],
        ["content-unit:unknown", null],
      ]),
      preferredLanguage: "zh",
    });

    expect(result).toMatchObject({ applied: true, matchedCandidateCount: 1 });
    expect(result.candidates.map(({ contentUnitId }) => contentUnitId)).toEqual([
      "content-unit:chinese-target",
      "content-unit:english-top",
      "content-unit:unknown",
    ]);
    expect(result.candidates[0]).toMatchObject({
      ranks: [
        { channelId: "vector", rank: 2 },
        { channelId: "language-preference", rank: 1 },
      ],
    });
    expect(candidates[1]!.ranks).toEqual([{ channelId: "vector", rank: 2 }]);
  });

  it("preserves the original rank when no candidate has a recognized requested language", () => {
    const candidates = [rank("content-unit:one", 0.03, 1), rank("content-unit:two", 0.02, 2)];
    const result = applyRetrievalLanguagePreference(candidates, {
      languageByContentUnitId: new Map([
        ["content-unit:one", "French"],
        ["content-unit:two", null],
      ]),
      preferredLanguage: "en",
    });

    expect(result).toEqual({ applied: false, candidates, matchedCandidateCount: 0 });
  });
});

function rank(contentUnitId: string, score: number, rankPosition: number): FusedRetrievalRank {
  return {
    contentUnitId,
    ranks: [{ channelId: "vector", rank: rankPosition }],
    score,
  };
}
