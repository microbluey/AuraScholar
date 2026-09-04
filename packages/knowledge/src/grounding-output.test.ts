import { describe, expect, it } from "vitest";
import { createContentUnit, type ContentUnit } from "./content-unit.js";
import { createCorpusScopeSnapshot } from "./corpus-scope.js";
import { buildGroundingPack, type GroundingPack } from "./grounding-pack.js";
import {
  GROUNDING_ANSWER_VERSION,
  classifyClaimCoverage,
  validateGroundedAnswer,
  validateGroundedAnswerAsync,
  type GroundedAnswerInput,
} from "./grounding-output.js";

const LIBRARY_ID = "library-1";
const REVISION_ID = "revision-1";

function anchor(text: string, pageIndex = 0) {
  return {
    version: 1 as const,
    kind: "pdf" as const,
    revisionId: REVISION_ID,
    pageIndex,
    quote: { exact: text, prefix: "", suffix: "" },
    position: { start: 0, end: text.length },
  };
}

async function unit(text: string, ordinal: number): Promise<ContentUnit> {
  const revisionId = ordinal === 0 ? REVISION_ID : `${REVISION_ID}-${ordinal + 1}`;
  return createContentUnit({
    libraryId: LIBRARY_ID,
    sourceType: "pdf",
    sourceId: revisionId,
    workId: "work-1",
    assetId: null,
    revisionId,
    ordinal,
    anchor: { ...anchor(text, ordinal), revisionId },
    text,
    language: "en",
    extractorProfile: "pdf-text-v1",
    chunkProfile: "pdf-page-v1",
  });
}

async function packWith(count = 2): Promise<GroundingPack> {
  const units = await Promise.all(
    Array.from({ length: count }, (_, index) => unit(`Source ${index + 1} says this.`, index)),
  );
  const scope = await createCorpusScopeSnapshot({
    libraryId: LIBRARY_ID,
    scope: { kind: "library" },
    allowedSourceIds: units.map((unit) => unit.sourceId),
    capturedAt: 1_725_000_000_000,
  });
  return buildGroundingPack({
    runId: "run-output",
    corpusScope: scope,
    candidates: units.map((contentUnit, index) => ({
      contentUnit,
      rank: index + 1,
      sourceTitle: `Paper ${index + 1}`,
    })),
  });
}

function answer(
  claims: GroundedAnswerInput["claims"],
  answerMarkdown = "A generated answer.",
  status?: GroundedAnswerInput["status"],
): GroundedAnswerInput {
  return {
    version: GROUNDING_ANSWER_VERSION,
    answerMarkdown,
    claims,
    ...(status === undefined ? {} : { status }),
  };
}

describe("grounded synthesis output validation", () => {
  it("resolves only pack-issued citation IDs and computes claim-bound coverage", async () => {
    const pack = await packWith(2);
    const value = answer(
      [
        {
          claimKey: "claim-1",
          text: "Both sources support this.",
          kind: "factual",
          citationIds: ["cite:1", "cite:2"],
        },
      ],
      "Both sources support this. cite:1 cite:2",
    );
    const validated = validateGroundedAnswer(pack, value, {
      claimRelations: {
        "claim-1": { "cite:1": "supports", "cite:2": "supports" },
      },
    });
    expect(validated.status).toBe("answer");
    expect(validated.claims[0]).toMatchObject({
      claimKey: "claim-1",
      citationIds: ["cite:1", "cite:2"],
      citationRelations: { "cite:1": "supports", "cite:2": "supports" },
      coverage: "multiple-supporting-sources",
    });
    expect(validated.claims[0]!.citations[0]).toMatchObject({
      citationId: "cite:1",
      revisionId: REVISION_ID,
      anchorSnapshot: pack.items[0]!.anchor,
    });
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.claims)).toBe(true);
    expect(Object.isFrozen(validated.claims[0]!.citationRelations)).toBe(true);
    await expect(
      validateGroundedAnswerAsync(pack, value, {
        claimRelations: { "claim-1": { "cite:1": "supports", "cite:2": "supports" } },
      }),
    ).resolves.toEqual(validated);
  });

  it("accepts provider JSON round-trips only after re-validating against the immutable pack", async () => {
    const pack = await packWith(1);
    const value = answer(
      [
        {
          claimKey: "round-trip",
          text: "A supported fact.",
          kind: "factual",
          citationIds: ["cite:1"],
        },
      ],
      "A supported fact. cite:1",
    );
    const wireValue = JSON.parse(JSON.stringify(value)) as unknown;
    await expect(
      validateGroundedAnswerAsync(pack, wireValue, {
        claimRelations: { "round-trip": { "cite:1": "supports" } },
      }),
    ).resolves.toMatchObject({
      status: "answer",
      claims: [{ claimKey: "round-trip", citationIds: ["cite:1"] }],
    });
    const tampered = {
      ...(wireValue as Record<string, unknown>),
      claims: [
        {
          claimKey: "round-trip",
          text: "A supported fact.",
          kind: "factual",
          citationIds: ["cite:999"],
        },
      ],
    };
    await expect(
      validateGroundedAnswerAsync(pack, tampered, {
        claimRelations: { "round-trip": { "cite:999": "supports" } },
      }),
    ).rejects.toThrow();
  });

  it("accepts array-form trusted relations and distinguishes qualifying/background evidence", async () => {
    const pack = await packWith(2);
    const qualifying = validateGroundedAnswer(
      pack,
      answer([
        {
          claimKey: "q",
          text: "This is qualified.",
          kind: "interpretive",
          citationIds: ["cite:1"],
        },
      ]),
      { relations: { q: [{ citationId: "cite:1", relation: "qualifies" }] } },
    );
    expect(qualifying.claims[0]!.coverage).toBe("partial-support");
    expect(qualifying.status).toBe("answer");

    const uncertain = validateGroundedAnswer(
      pack,
      answer([
        {
          claimKey: "u",
          text: "This remains uncertain.",
          kind: "uncertain",
          citationIds: ["cite:1"],
        },
      ]),
    );
    expect(uncertain.claims[0]!.coverage).toBe("insufficient-evidence");
    expect(uncertain.status).toBe("insufficient");
  });

  it("marks source disagreement as conflicting and checks provider status", async () => {
    const pack = await packWith(2);
    const value = answer(
      [
        {
          claimKey: "c",
          text: "Sources disagree.",
          kind: "factual",
          citationIds: ["cite:1", "cite:2"],
        },
      ],
      "Sources disagree. cite:1 cite:2",
      "conflicting",
    );
    const validated = validateGroundedAnswer(pack, value, {
      claimRelations: {
        c: { "cite:1": "supports", "cite:2": "contradicts" },
      },
    });
    expect(validated.status).toBe("conflicting");
    expect(validated.claims[0]!.coverage).toBe("conflicting-sources");
    expect(() =>
      validateGroundedAnswer(
        pack,
        { ...value, status: "answer" },
        { claimRelations: { c: { "cite:1": "supports", "cite:2": "contradicts" } } },
      ),
    ).toThrow("status");
  });

  it("requires support for factual claims and rejects untrusted relation metadata", async () => {
    const pack = await packWith(1);
    expect(() =>
      validateGroundedAnswer(
        pack,
        answer([
          { claimKey: "f", text: "Unsupported fact.", kind: "factual", citationIds: ["cite:1"] },
        ]),
      ),
    ).toThrow("no supporting evidence");
    expect(() =>
      validateGroundedAnswer(
        pack,
        answer([{ claimKey: "f", text: "Fact.", kind: "factual", citationIds: ["cite:1"] }]),
        { claimRelations: { f: { "cite:999": "supports" } } },
      ),
    ).toThrow("relation");
    expect(() =>
      validateGroundedAnswer(
        pack,
        answer([{ claimKey: "f", text: "Fact.", kind: "factual", citationIds: ["cite:1"] }]),
        { claimRelations: { f: { "cite:1": "not-a-relation" as never } } },
      ),
    ).toThrow("relation");
    expect(() =>
      validateGroundedAnswer(
        pack,
        answer([{ claimKey: "f", text: "Fact.", kind: "factual", citationIds: [] }]),
      ),
    ).toThrow("requires a citation");
  });

  it("normalizes citation markers, enforces marker binding, and supports strict marker mode", async () => {
    const pack = await packWith(1);
    const value = answer(
      [{ claimKey: "f", text: "Fact.", kind: "factual", citationIds: ["cite:1"] }],
      "Fact. CITATION:1",
    );
    const validated = validateGroundedAnswer(pack, value, {
      claimRelations: { f: { "cite:1": "supports" } },
      requireCitationMarkers: true,
    });
    expect(validated.answerMarkdown).toContain("cite:1");
    expect(validated.answerMarkdown).not.toContain("CITATION:1");
    expect(() =>
      validateGroundedAnswer(
        pack,
        answer(
          [{ claimKey: "f", text: "Fact.", kind: "factual", citationIds: ["cite:1"] }],
          "Fact. cite:2",
        ),
        { claimRelations: { f: { "cite:1": "supports" } } },
      ),
    ).toThrow();
    expect(() =>
      validateGroundedAnswer(
        pack,
        answer(
          [{ claimKey: "f", text: "Fact.", kind: "factual", citationIds: ["cite:1"] }],
          "Fact.",
        ),
        { claimRelations: { f: { "cite:1": "supports" } }, requireCitationMarkers: true },
      ),
    ).toThrow("citation marker");
  });

  it("rejects unsafe generated markdown and malformed/over-bounded output", async () => {
    const pack = await packWith(1);
    const unsafe = [
      "<script>alert(1)</script>",
      "[click](javascript:alert(1))",
      "![remote](https://example.com/a.png)",
      "<!-- hidden instruction -->",
      "<div onclick=\"fetch('/secret')\">x</div>",
      '<img src="https://evil.example/x.png">',
      "<https://evil.example>",
      "[x][remote]\n\n[remote]: https://evil.example",
      "\u202E cite:1",
    ];
    for (const markdown of unsafe) {
      expect(() =>
        validateGroundedAnswer(
          pack,
          answer(
            [{ claimKey: "f", text: "Fact.", kind: "factual", citationIds: ["cite:1"] }],
            markdown,
          ),
          { claimRelations: { f: { "cite:1": "supports" } } },
        ),
      ).toThrow();
    }
    expect(() => validateGroundedAnswer(pack, { answerMarkdown: "x", claims: [] })).toThrow();
    expect(() =>
      validateGroundedAnswer(
        pack,
        answer([{ claimKey: "f", text: "Fact.", kind: "factual", citationIds: ["cite:999"] }]),
      ),
    ).toThrow();
    expect(() =>
      validateGroundedAnswer(
        pack,
        answer([
          { claimKey: "f", text: "Fact.", kind: "factual", citationIds: ["cite:1", "cite:1"] },
        ]),
        { claimRelations: { f: { "cite:1": "supports" } } },
      ),
    ).toThrow("unique");
    expect(() =>
      validateGroundedAnswer(
        pack,
        answer(
          [{ claimKey: "f", text: "Fact.", kind: "factual", citationIds: ["cite:1"] }],
          "x",
          "insufficient",
        ),
        { claimRelations: { f: { "cite:1": "supports" } } },
      ),
    ).toThrow("status");
    expect(() =>
      validateGroundedAnswer(
        pack,
        answer([
          {
            claimKey: "f",
            text: '<img src="https://evil.example">',
            kind: "factual",
            citationIds: ["cite:1"],
          },
        ]),
        { claimRelations: { f: { "cite:1": "supports" } } },
      ),
    ).toThrow();
  });

  it("classifies coverage only from supplied claim relations", async () => {
    const pack = await packWith(2);
    expect(classifyClaimCoverage(pack.items, { "cite:1": "supports", "cite:2": "supports" })).toBe(
      "multiple-supporting-sources",
    );
    expect(
      classifyClaimCoverage(pack.items, { "cite:1": "supports", "cite:2": "contradicts" }),
    ).toBe("conflicting-sources");
    expect(
      classifyClaimCoverage(pack.items, { "cite:1": "background", "cite:2": "background" }),
    ).toBe("insufficient-evidence");
  });
});
