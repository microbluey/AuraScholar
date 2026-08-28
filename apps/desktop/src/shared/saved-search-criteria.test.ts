import { describe, expect, it } from "vitest";
import {
  normalizeSavedSearchCriteria,
  parseSavedSearchCriteria,
  savedSearchCriteriaKey,
} from "./saved-search-criteria";

describe("saved-search criteria", () => {
  it("canonicalizes structured discovery conditions", () => {
    expect(
      normalizeSavedSearchCriteria({
        text: "  retrieval   augmented generation ",
        author: "  Vaswani ",
        yearFrom: 2017,
        yearTo: 2024,
        venue: " NeurIPS ",
      }),
    ).toEqual({
      text: "retrieval augmented generation",
      author: "Vaswani",
      yearFrom: 2017,
      yearTo: 2024,
      venue: "NeurIPS",
    });
  });

  it("rejects invalid structured conditions", () => {
    expect(() =>
      normalizeSavedSearchCriteria({ text: "topic", yearFrom: 2025, yearTo: 2024 }),
    ).toThrow("Saved search year range is invalid");
    expect(() => normalizeSavedSearchCriteria({ text: "topic", unknown: true })).toThrow(
      "unsupported field",
    );
  });

  it("keeps persisted conditions within the scholarly command text boundaries", () => {
    expect(() => normalizeSavedSearchCriteria({ text: "x".repeat(8 * 1024 + 1) })).toThrow(
      "Saved search query is too long",
    );
    expect(() => normalizeSavedSearchCriteria({ text: "topic", author: "Ada\u0001" })).toThrow(
      "Saved search author is invalid",
    );
    expect(
      normalizeSavedSearchCriteria({
        text: "topic",
        venue: "测".repeat(Math.floor((2 * 1024) / 3)),
      }).venue,
    ).toHaveLength(Math.floor((2 * 1024) / 3));
  });

  it("falls back safely for legacy, malformed, and mismatched persisted JSON", () => {
    expect(parseSavedSearchCriteria(null, "legacy topic")).toEqual({ text: "legacy topic" });
    expect(parseSavedSearchCriteria("{", "legacy topic")).toEqual({ text: "legacy topic" });
    expect(
      parseSavedSearchCriteria('{"text":"other topic","author":"Ada"}', "legacy topic"),
    ).toEqual({
      text: "legacy topic",
    });
  });

  it("matches equivalent criteria but distinguishes advanced filters", () => {
    expect(savedSearchCriteriaKey({ text: " Graph   Retrieval ", author: "Ada Lovelace" })).toBe(
      savedSearchCriteriaKey({ text: "graph retrieval", author: "ada lovelace" }),
    );
    expect(savedSearchCriteriaKey({ text: "graph retrieval", author: "Ada" })).not.toBe(
      savedSearchCriteriaKey({ text: "graph retrieval", author: "Grace" }),
    );
  });
});
