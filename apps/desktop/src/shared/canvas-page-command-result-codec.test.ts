import type { CanvasCitationRelation } from "@aurascholar/core";
import { describe, expect, it } from "vitest";
import type {
  CanvasActiveWork,
  CanvasAnnotationIngressSource,
  CanvasIngressAnnotation,
  CanvasIngressWork,
} from "../../electron/canvas-command-contract";
import type { LibraryScopeToken } from "../../electron/library-read-command-contract";
import { CITATION_GRAPH_PROVIDER } from "./citation-graph-provenance";
import {
  decodeCanvasGetActiveWorkResult,
  decodeCanvasGetAnnotationIngressSourceResult,
  decodeCanvasGetCitationRelationsResult,
  decodeCanvasPersistCitationRelationsResult,
  MAX_CANVAS_CITATION_RESULT_RELATIONS,
} from "./canvas-page-command-result-codec";

function activeWork(overrides: Partial<CanvasActiveWork> = {}): CanvasActiveWork {
  return {
    abstract: null,
    authorNames: ["Researcher"],
    doi: null,
    id: "work-1",
    reading_status: "reading",
    title: "Scoped paper",
    venue_name: null,
    year: 2025,
    ...overrides,
  };
}

function annotation(overrides: Partial<CanvasIngressAnnotation> = {}): CanvasIngressAnnotation {
  return {
    anchor_json: null,
    attachment_id: "attachment-1",
    color: null,
    content_md: null,
    id: "annotation-1",
    orphaned: 0,
    page_index: 0,
    type: "highlight",
    work_id: "work-1",
    ...overrides,
  };
}

function ingressWork(overrides: Partial<CanvasIngressWork> = {}): CanvasIngressWork {
  return { ...activeWork(), deleted_at: null, ...overrides };
}

function ingressSource(
  overrides: Partial<CanvasAnnotationIngressSource> = {},
): CanvasAnnotationIngressSource {
  return { annotation: annotation(), work: ingressWork(), ...overrides };
}

function relation(overrides: Partial<CanvasCitationRelation> = {}): CanvasCitationRelation {
  return { citedWorkId: "work-2", citingWorkId: "work-1", ...overrides };
}

const SCOPE: LibraryScopeToken = { libraryId: "library:active", scopeToken: "scope-token" };

describe("Canvas page command-result codec", () => {
  it("accepts exact nullable read envelopes", () => {
    expect(decodeCanvasGetActiveWorkResult({ work: null }, "work-1")).toEqual({ work: null });
    expect(
      decodeCanvasGetAnnotationIngressSourceResult({ source: null }, "annotation-1", "work-1"),
    ).toEqual({ source: null });
  });

  it("clones exact active-work and annotation-ingress responses", () => {
    const work = activeWork();
    const source = ingressSource();
    const decodedWork = decodeCanvasGetActiveWorkResult({ work }, "work-1").work;
    const decodedSource = decodeCanvasGetAnnotationIngressSourceResult(
      { source },
      "annotation-1",
      "work-1",
    ).source;

    expect(decodedWork).toEqual(work);
    expect(decodedWork).not.toBe(work);
    expect(decodedWork?.authorNames).not.toBe(work.authorNames);
    expect(decodedSource).toEqual(source);
    expect(decodedSource).not.toBe(source);
    expect(decodedSource?.annotation).not.toBe(source.annotation);
    expect(decodedSource?.work).not.toBe(source.work);
    expect(decodedSource?.work.authorNames).not.toBe(source.work.authorNames);
  });

  it("rejects malformed outer command envelopes", () => {
    const invalid = [
      () => decodeCanvasGetActiveWorkResult({}, "work-1"),
      () => decodeCanvasGetActiveWorkResult({ extra: true, work: null }, "work-1"),
      () => decodeCanvasGetAnnotationIngressSourceResult({}, "annotation-1", "work-1"),
      () =>
        decodeCanvasGetAnnotationIngressSourceResult(
          { extra: true, source: null },
          "annotation-1",
          "work-1",
        ),
      () => decodeCanvasGetCitationRelationsResult({}, ["work-1"], SCOPE),
      () =>
        decodeCanvasGetCitationRelationsResult({ extra: true, relations: [] }, ["work-1"], SCOPE),
      () => decodeCanvasPersistCitationRelationsResult({}, 1, SCOPE, CITATION_GRAPH_PROVIDER),
      () =>
        decodeCanvasPersistCitationRelationsResult(
          { extra: true, persisted: 0 },
          1,
          SCOPE,
          CITATION_GRAPH_PROVIDER,
        ),
    ];

    for (const decode of invalid) expect(decode).toThrow("is invalid");
  });

  it("rejects invalid ingress fields, oversized payloads, and mismatched request identities", () => {
    const sparseAuthors = new Array<string>(1);
    const invalid = [
      () =>
        decodeCanvasGetActiveWorkResult(
          { work: activeWork({ authorNames: sparseAuthors }) },
          "work-1",
        ),
      () => decodeCanvasGetActiveWorkResult({ work: { ...activeWork(), extra: true } }, "work-1"),
      () =>
        decodeCanvasGetActiveWorkResult(
          {
            work: activeWork({
              authorNames: Array.from({ length: 101 }, (_, index) => `Author ${index}`),
            }),
          },
          "work-1",
        ),
      () => decodeCanvasGetActiveWorkResult({ work: activeWork({ id: "work-2" }) }, "work-1"),
      () =>
        decodeCanvasGetAnnotationIngressSourceResult(
          { source: ingressSource({ annotation: annotation({ id: "annotation-2" }) }) },
          "annotation-1",
          "work-1",
        ),
      () =>
        decodeCanvasGetAnnotationIngressSourceResult(
          {
            source: {
              annotation: { ...annotation(), extra: true },
              work: ingressWork(),
            },
          },
          "annotation-1",
          "work-1",
        ),
      () =>
        decodeCanvasGetAnnotationIngressSourceResult(
          { source: ingressSource({ annotation: annotation({ work_id: "work-2" }) }) },
          "annotation-1",
          "work-1",
        ),
      () =>
        decodeCanvasGetAnnotationIngressSourceResult(
          { source: ingressSource({ work: ingressWork({ id: "work-2" }) }) },
          "annotation-1",
          "work-1",
        ),
      () =>
        decodeCanvasGetActiveWorkResult(
          {
            work: activeWork({
              authorNames: Array.from({ length: 100 }, () => "x".repeat(8 * 1024)),
            }),
          },
          "work-1",
        ),
    ];

    for (const decode of invalid) expect(decode).toThrow();
  });

  it("validates citation relations against the requested dense selection", () => {
    const source = relation();
    const relations = [source];
    const decoded = decodeCanvasGetCitationRelationsResult(
      { relations, scope: SCOPE },
      ["work-1", "work-2"],
      SCOPE,
    );
    expect(decoded).toEqual({ relations, scope: SCOPE });
    expect(decoded.relations).not.toBe(relations);
    expect(decoded.relations[0]).not.toBe(source);

    const sparse = new Array<CanvasCitationRelation>(1);
    const invalid = [
      () =>
        decodeCanvasGetCitationRelationsResult(
          { relations: sparse, scope: SCOPE },
          ["work-1", "work-2"],
          SCOPE,
        ),
      () =>
        decodeCanvasGetCitationRelationsResult(
          {
            relations: Array.from(
              { length: MAX_CANVAS_CITATION_RESULT_RELATIONS + 1 },
              (_, index) => relation({ citedWorkId: `work-${index + 2}` }),
            ),
            scope: SCOPE,
          },
          Array.from(
            { length: MAX_CANVAS_CITATION_RESULT_RELATIONS + 2 },
            (_, index) => `work-${index + 1}`,
          ),
          SCOPE,
        ),
      () =>
        decodeCanvasGetCitationRelationsResult(
          {
            relations: [{ citedWorkId: "work-2", citingWorkId: "work-1", extra: true }],
            scope: SCOPE,
          },
          ["work-1", "work-2"],
          SCOPE,
        ),
      () =>
        decodeCanvasGetCitationRelationsResult(
          { relations: [relation({ citedWorkId: "work-1" })], scope: SCOPE },
          ["work-1", "work-2"],
          SCOPE,
        ),
      () =>
        decodeCanvasGetCitationRelationsResult(
          { relations: [source, source], scope: SCOPE },
          ["work-1", "work-2"],
          SCOPE,
        ),
      () =>
        decodeCanvasGetCitationRelationsResult(
          { relations: [relation({ citedWorkId: "work-outside" })], scope: SCOPE },
          ["work-1", "work-2"],
          SCOPE,
        ),
    ];

    for (const decode of invalid) expect(decode).toThrow();
  });

  it("accepts only feasible exact persistence acknowledgements", () => {
    expect(
      decodeCanvasPersistCitationRelationsResult(
        { persisted: 0, provider: CITATION_GRAPH_PROVIDER, scope: SCOPE },
        1,
        SCOPE,
        CITATION_GRAPH_PROVIDER,
      ),
    ).toEqual({
      persisted: 0,
      provider: CITATION_GRAPH_PROVIDER,
      scope: SCOPE,
    });
    expect(
      decodeCanvasPersistCitationRelationsResult(
        { persisted: 2, provider: CITATION_GRAPH_PROVIDER, scope: SCOPE },
        2,
        SCOPE,
        CITATION_GRAPH_PROVIDER,
      ),
    ).toEqual({
      persisted: 2,
      provider: CITATION_GRAPH_PROVIDER,
      scope: SCOPE,
    });

    for (const persisted of [-1, 1.5, 3, Number.MAX_SAFE_INTEGER + 1, "1", true, null]) {
      expect(() =>
        decodeCanvasPersistCitationRelationsResult(
          { persisted, provider: CITATION_GRAPH_PROVIDER, scope: SCOPE },
          2,
          SCOPE,
          CITATION_GRAPH_PROVIDER,
        ),
      ).toThrow("Canvas persist citation relations result is invalid");
    }
  });

  it("validates the provider acknowledgement against the request", () => {
    expect(() =>
      decodeCanvasPersistCitationRelationsResult(
        { persisted: 0, provider: "unknown-provider", scope: SCOPE },
        0,
        SCOPE,
        CITATION_GRAPH_PROVIDER,
      ),
    ).toThrow("Canvas citation provider is invalid");
    expect(() =>
      decodeCanvasPersistCitationRelationsResult(
        { persisted: 0, provider: "semantic-scholar", scope: SCOPE },
        0,
        SCOPE,
        CITATION_GRAPH_PROVIDER,
      ),
    ).toThrow("Canvas citation provider does not match the request");
    expect(() =>
      decodeCanvasPersistCitationRelationsResult(
        { persisted: 0, provider: CITATION_GRAPH_PROVIDER, scope: SCOPE },
        0,
        SCOPE,
        "semantic-scholar",
      ),
    ).toThrow("Canvas citation provider does not match the request");
  });

  it("rejects a citation scope acknowledgement that differs from the request", () => {
    expect(() =>
      decodeCanvasGetCitationRelationsResult(
        { relations: [], scope: { ...SCOPE, scopeToken: "other-scope" } },
        [],
        SCOPE,
      ),
    ).toThrow("Canvas Library scope does not match the request");
    expect(() =>
      decodeCanvasPersistCitationRelationsResult(
        {
          persisted: 0,
          provider: CITATION_GRAPH_PROVIDER,
          scope: { ...SCOPE, libraryId: "library:other" },
        },
        0,
        SCOPE,
        CITATION_GRAPH_PROVIDER,
      ),
    ).toThrow("Canvas Library scope does not match the request");
  });
});
