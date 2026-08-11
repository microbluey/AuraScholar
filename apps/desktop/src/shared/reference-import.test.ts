import { describe, expect, it } from "vitest";
import {
  parseImportableReferences,
  parseReferenceImport,
  referenceItemsToWorkInputs,
} from "./reference-import";

describe("shared reference import transformation", () => {
  it("filters empty parsed records and maps CSL authors and editors into a single work input", () => {
    const items = parseImportableReferences(
      JSON.stringify([
        { id: "empty", type: "article-journal" },
        {
          DOI: "https://doi.org/10.4242/shared-reference-import",
          author: [{ family: "Lovelace", given: "Ada" }],
          editor: [{ literal: "Royal Society" }],
          id: "complete",
          issued: { "date-parts": [[1843]] },
          title: "Shared parser",
          type: "paper-conference",
        },
      ]),
      "csljson",
    );

    expect(items).toHaveLength(1);
    expect(referenceItemsToWorkInputs(items)).toEqual([
      expect.objectContaining({
        authors: [
          { displayName: "Ada Lovelace", orcid: undefined, position: 0, role: "author" },
          { displayName: "Royal Society", orcid: undefined, position: 1, role: "editor" },
        ],
        doi: "10.4242/shared-reference-import",
        title: "Shared parser",
        type: "conference",
        year: 1843,
      }),
    ]);
  });

  it("parses only once when the main process needs preview items and work inputs together", () => {
    const parsed = parseReferenceImport(
      ["TY  - JOUR", "TI  - One-pass import", "DO  - 10.4242/one-pass", "ER  -"].join("\n"),
      "ris",
    );

    expect(parsed.items).toHaveLength(1);
    expect(parsed.workInputs).toEqual([
      expect.objectContaining({ doi: "10.4242/one-pass", title: "One-pass import" }),
    ]);
  });
});
