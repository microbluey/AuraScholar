import { describe, expect, it } from "vitest";
import type { DiscoveryResultWithLibrary } from "../../services/discovery";
import { mergeDiscoverySearchResults } from "./useDiscoverySearchController";

function result(
  id: string,
  { citations, score, year }: { citations: number; score: number; year: number },
): DiscoveryResultWithLibrary {
  return {
    id,
    inLibrary: false,
    matchedSources: ["openalex"],
    score,
    source: "openalex",
    work: {
      authors: [],
      citedByCount: citations,
      source: "openalex",
      title: id,
      year,
    },
  };
}

describe("mergeDiscoverySearchResults", () => {
  const results = [
    result("highest-score", { citations: 5, score: 100, year: 2020 }),
    result("newest", { citations: 10, score: 20, year: 2024 }),
    result("most-cited", { citations: 100, score: 50, year: 2022 }),
  ];

  it.each([
    ["relevance", ["highest-score", "most-cited", "newest"]],
    ["year", ["newest", "most-cited", "highest-score"]],
    ["citations", ["most-cited", "newest", "highest-score"]],
  ] as const)("keeps %s ordering when results are re-merged", (sort, expected) => {
    expect(
      mergeDiscoverySearchResults(results, {
        query: { text: "graph" },
        sort,
      }).map((item) => item.id),
    ).toEqual(expected);
  });
});
