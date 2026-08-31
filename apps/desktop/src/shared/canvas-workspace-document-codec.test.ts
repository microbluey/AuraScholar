import { CANVAS_SCHEMA_VERSION } from "@aurascholar/core";
import {
  MAX_CANVAS_EDGE_LABEL_BYTES as DB_MAX_CANVAS_EDGE_LABEL_BYTES,
  MAX_CANVAS_EDGES as DB_MAX_CANVAS_EDGES,
  MAX_CANVAS_JSON_COLLECTION_ITEMS as DB_MAX_CANVAS_JSON_COLLECTION_ITEMS,
  MAX_CANVAS_JSON_DEPTH as DB_MAX_CANVAS_JSON_DEPTH,
  MAX_CANVAS_JSON_KEY_BYTES as DB_MAX_CANVAS_JSON_KEY_BYTES,
  MAX_CANVAS_JSON_TEXT_BYTES as DB_MAX_CANVAS_JSON_TEXT_BYTES,
  MAX_CANVAS_NODE_TAG_BYTES as DB_MAX_CANVAS_NODE_TAG_BYTES,
  MAX_CANVAS_NODE_TAGS as DB_MAX_CANVAS_NODE_TAGS,
  MAX_CANVAS_NODES as DB_MAX_CANVAS_NODES,
  MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES as DB_MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
  MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES as DB_MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES,
  MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES as DB_MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
  MAX_CANVAS_WORKSPACE_NAME_BYTES as DB_MAX_CANVAS_WORKSPACE_NAME_BYTES,
  STORED_CANVAS_EDGE_RELATIONS,
  STORED_CANVAS_NODE_TYPES,
} from "@aurascholar/db";
import { describe, expect, it } from "vitest";
import type { CanvasWorkspaceDocumentDto } from "../../electron/canvas-command-contract";
import {
  CANVAS_WORKSPACE_EDGE_RELATIONS,
  CANVAS_WORKSPACE_NODE_TYPES,
  decodeCanvasWorkspaceDocument,
  MAX_CANVAS_EDGE_LABEL_BYTES,
  MAX_CANVAS_EDGES,
  MAX_CANVAS_JSON_COLLECTION_ITEMS,
  MAX_CANVAS_JSON_DEPTH,
  MAX_CANVAS_JSON_KEY_BYTES,
  MAX_CANVAS_JSON_TEXT_BYTES,
  MAX_CANVAS_NODE_TAG_BYTES,
  MAX_CANVAS_NODE_TAGS,
  MAX_CANVAS_NODES,
  MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
  MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES,
  MAX_CANVAS_WORKSPACE_NAME_BYTES,
} from "./canvas-workspace-document-codec";
import { MAX_CANVAS_RECORD_ID_BYTES } from "./canvas-workspace-document-limits";

function completeDocument(): CanvasWorkspaceDocumentDto {
  return {
    createdAt: 1,
    description: "A complete Canvas document codec fixture.",
    edges: [
      {
        createdAt: 8,
        id: "canvas-edge:derived",
        label: "synthesized from",
        relationType: "derived-from",
        sourceId: "canvas-node:synth",
        style: { animated: true, stroke: "#7c3aed" },
        targetId: "canvas-node:excerpt",
        updatedAt: 8,
      },
      {
        createdAt: 9,
        id: "canvas-edge:supports",
        relationType: "supports",
        sourceId: "canvas-node:excerpt",
        style: { animated: false },
        targetId: "canvas-node:idea",
        updatedAt: 9,
      },
    ],
    name: "Complete document",
    nodes: [
      {
        createdAt: 2,
        data: { collapsed: false, colorTheme: "violet", title: "Attention lineage" },
        dimensions: { height: 540, width: 900 },
        id: "canvas-node:group",
        position: { x: 20, y: 30 },
        tags: ["related-work"],
        type: "group",
        updatedAt: 2,
      },
      {
        createdAt: 3,
        data: {
          abstractSnippet: "Self-attention replaces recurrence.",
          annotationCount: 1,
          authors: ["Ashish Vaswani"],
          doi: "10.48550/arxiv.1706.03762",
          localPdfPath: "/tmp/attention.pdf",
          oaPdfUrl: "https://example.test/attention.pdf",
          title: "Attention Is All You Need",
          venue: "NeurIPS",
          workId: "work:attention",
          year: 2017,
        },
        dimensions: { height: 220, width: 320 },
        groupId: "canvas-node:group",
        id: "canvas-node:paper",
        position: { x: 80, y: 110 },
        tags: ["transformer", "foundational"],
        type: "paper",
        updatedAt: 3,
      },
      {
        createdAt: 4,
        data: {
          anchor: {
            exact: "The dominant sequence transduction models",
            futureCompatibleAnchorField: ["one", "two"],
          },
          annotationId: "annotation:one",
          attachmentId: "attachment:one",
          extensionMetadata: { source: "legacy-import" },
          highlightColor: "yellow",
          highlightText: "The dominant sequence transduction models...",
          marginNote: "Useful framing",
          pageIndex: 0,
          paperTitle: "Attention Is All You Need",
          workId: "work:attention",
        },
        dimensions: { height: 180, width: 300 },
        groupId: "canvas-node:group",
        id: "canvas-node:excerpt",
        position: { x: 460, y: 110 },
        tags: ["mechanism"],
        type: "excerpt",
        updatedAt: 4,
      },
      {
        createdAt: 5,
        data: {
          contentMarkdown: "Self-attention replaces recurrence.",
          modelName: "test-model",
          sourceNodeIds: ["canvas-node:paper", "canvas-node:excerpt"],
          structuredTable: {
            headers: ["Claim", "Evidence"],
            rows: [["Parallelism", "No recurrence"]],
          },
          synthType: "tldr",
          title: "Core contribution",
        },
        dimensions: { height: 210, width: 340 },
        groupId: "canvas-node:group",
        id: "canvas-node:synth",
        position: { x: 460, y: 340 },
        tags: ["synthesis"],
        type: "ai-synth",
        updatedAt: 5,
      },
      {
        createdAt: 6,
        data: {
          contentMarkdown: "Does sparse attention preserve quality?",
          hasEquations: false,
          title: "Scaling question",
        },
        dimensions: { height: 150, width: 280 },
        groupId: "canvas-node:group",
        id: "canvas-node:idea",
        position: { x: 80, y: 380 },
        tags: ["hypothesis"],
        type: "idea-note",
        updatedAt: 6,
      },
    ],
    schemaVersion: CANVAS_SCHEMA_VERSION,
    updatedAt: 10,
    viewport: { x: -120.5, y: 48.25, zoom: 1.35 },
    workspaceId: "canvas:codec",
  };
}

function nodeData(document: CanvasWorkspaceDocumentDto, nodeId: string): Record<string, unknown> {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || typeof node.data !== "object" || node.data === null || Array.isArray(node.data)) {
    throw new Error(`Missing data for ${nodeId}`);
  }
  return node.data as Record<string, unknown>;
}

describe("Canvas workspace document codec", () => {
  it("preserves every supported field and compatible JSON extension field", () => {
    const source = completeDocument();
    const decoded = decodeCanvasWorkspaceDocument(source);

    expect(decoded).toMatchObject({
      description: source.description,
      edges: source.edges,
      name: source.name,
      viewport: source.viewport,
      workspaceId: source.workspaceId,
    });
    expect(JSON.parse(JSON.stringify(decoded))).toEqual(source);
    expect(decoded.nodes).toHaveLength(5);
    expect(nodeData(decoded, "canvas-node:paper")).toMatchObject({
      localPdfPath: "/tmp/attention.pdf",
      oaPdfUrl: "https://example.test/attention.pdf",
    });
    expect(nodeData(decoded, "canvas-node:excerpt")).toMatchObject({
      anchor: {
        exact: "The dominant sequence transduction models",
        futureCompatibleAnchorField: ["one", "two"],
      },
      extensionMetadata: { source: "legacy-import" },
    });
    expect(nodeData(decoded, "canvas-node:synth")).toMatchObject({
      modelName: "test-model",
      structuredTable: {
        headers: ["Claim", "Evidence"],
        rows: [["Parallelism", "No recurrence"]],
      },
    });
    expect(nodeData(decoded, "canvas-node:idea")).toMatchObject({ hasEquations: false });
    expect(nodeData(decoded, "canvas-node:group")).toMatchObject({ collapsed: false });
    expect(decoded.edges[1]).toMatchObject({ style: { animated: false } });
    expect(decoded).not.toBe(source);
    expect(decoded.nodes).not.toBe(source.nodes);
    expect(nodeData(decoded, "canvas-node:excerpt")).not.toBe(
      nodeData(source, "canvas-node:excerpt"),
    );
  });

  it("keeps the pure decoder's shared limits aligned with bounded DB reads", () => {
    expect({
      description: MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
      document: MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES,
      edgeLabel: MAX_CANVAS_EDGE_LABEL_BYTES,
      edges: MAX_CANVAS_EDGES,
      jsonCollection: MAX_CANVAS_JSON_COLLECTION_ITEMS,
      jsonDepth: MAX_CANVAS_JSON_DEPTH,
      jsonKey: MAX_CANVAS_JSON_KEY_BYTES,
      jsonText: MAX_CANVAS_JSON_TEXT_BYTES,
      name: MAX_CANVAS_WORKSPACE_NAME_BYTES,
      nodeTag: MAX_CANVAS_NODE_TAG_BYTES,
      nodeTags: MAX_CANVAS_NODE_TAGS,
      nodes: MAX_CANVAS_NODES,
      recordId: MAX_CANVAS_RECORD_ID_BYTES,
    }).toEqual({
      description: DB_MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
      document: DB_MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES,
      edgeLabel: DB_MAX_CANVAS_EDGE_LABEL_BYTES,
      edges: DB_MAX_CANVAS_EDGES,
      jsonCollection: DB_MAX_CANVAS_JSON_COLLECTION_ITEMS,
      jsonDepth: DB_MAX_CANVAS_JSON_DEPTH,
      jsonKey: DB_MAX_CANVAS_JSON_KEY_BYTES,
      jsonText: DB_MAX_CANVAS_JSON_TEXT_BYTES,
      name: DB_MAX_CANVAS_WORKSPACE_NAME_BYTES,
      nodeTag: DB_MAX_CANVAS_NODE_TAG_BYTES,
      nodeTags: DB_MAX_CANVAS_NODE_TAGS,
      nodes: DB_MAX_CANVAS_NODES,
      recordId: DB_MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
    });
  });

  it("keeps its accepted node and edge enum values aligned with storage", () => {
    expect(CANVAS_WORKSPACE_NODE_TYPES).toEqual(STORED_CANVAS_NODE_TYPES);
    expect(CANVAS_WORKSPACE_EDGE_RELATIONS).toEqual(STORED_CANVAS_EDGE_RELATIONS);
  });

  it("uses the database-compatible UTF-8 budget for Canvas table identifiers", () => {
    const exactLimit = "文".repeat(170) + "ab";
    const accepted = completeDocument();
    accepted.workspaceId = exactLimit;
    expect(() => decodeCanvasWorkspaceDocument(accepted)).not.toThrow();

    const oversized = completeDocument();
    oversized.workspaceId = "文".repeat(171);
    expect(() => decodeCanvasWorkspaceDocument(oversized)).toThrow(
      "Canvas workspace id is too long",
    );

    const nestedExternalRecordId = completeDocument();
    nodeData(nestedExternalRecordId, "canvas-node:paper").workId = "文".repeat(512);
    expect(() => decodeCanvasWorkspaceDocument(nestedExternalRecordId)).not.toThrow();
  });

  it("rejects a structurally valid document once its serialized payload exceeds the shared budget", () => {
    const document = completeDocument();
    const contentMarkdown = "x".repeat(MAX_CANVAS_JSON_TEXT_BYTES);
    document.edges = [];
    document.nodes = Array.from({ length: 8 }, (_, index) => ({
      createdAt: index,
      data: { contentMarkdown, hasEquations: false },
      dimensions: { height: 100, width: 200 },
      id: `canvas-node:large-${index}`,
      position: { x: index, y: index },
      tags: [],
      type: "idea-note" as const,
      updatedAt: index,
    }));

    expect(() => decodeCanvasWorkspaceDocument(document)).toThrow(
      `Canvas workspace payload is limited to ${MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES} bytes`,
    );
  });

  it.each([
    [
      "rejects a non-positive viewport zoom",
      () => {
        const document = completeDocument();
        document.viewport.zoom = 0;
        return document;
      },
    ],
    [
      "rejects unsafe JSON extension keys",
      () => {
        const document = completeDocument();
        Object.defineProperty(nodeData(document, "canvas-node:excerpt"), "__proto__", {
          configurable: true,
          enumerable: true,
          value: "unsafe",
        });
        return document;
      },
    ],
    [
      "rejects malformed optional paper fields",
      () => {
        const document = completeDocument();
        nodeData(document, "canvas-node:paper").oaPdfUrl = 42;
        return document;
      },
    ],
    [
      "rejects non-JSON extension values",
      () => {
        const document = completeDocument();
        nodeData(document, "canvas-node:excerpt").anchor = () => "not JSON";
        return document;
      },
    ],
    [
      "rejects invalid edge styles",
      () => {
        const document = completeDocument();
        document.edges[0]!.style = { animated: "yes" as unknown as boolean };
        return document;
      },
    ],
    [
      "rejects duplicate nodes",
      () => {
        const document = completeDocument();
        document.nodes[1]!.id = document.nodes[0]!.id;
        return document;
      },
    ],
    [
      "rejects edges outside the document topology",
      () => {
        const document = completeDocument();
        document.edges[0]!.targetId = "canvas-node:missing";
        return document;
      },
    ],
  ])("%s", (_label, createInvalidDocument) => {
    expect(() => decodeCanvasWorkspaceDocument(createInvalidDocument())).toThrow();
  });

  it("rejects node and edge collections before mapping their contents", () => {
    const tooManyNodes = completeDocument();
    tooManyNodes.nodes = Array.from({ length: MAX_CANVAS_NODES + 1 }, () => ({}) as never);
    expect(() => decodeCanvasWorkspaceDocument(tooManyNodes)).toThrow(
      `Canvas nodes are limited to ${MAX_CANVAS_NODES}`,
    );

    const tooManyEdges = completeDocument();
    tooManyEdges.edges = Array.from({ length: MAX_CANVAS_EDGES + 1 }, () => ({}) as never);
    expect(() => decodeCanvasWorkspaceDocument(tooManyEdges)).toThrow(
      `Canvas edges are limited to ${MAX_CANVAS_EDGES}`,
    );
  });

  it("rejects sparse document and JSON arrays before they can serialize as null", () => {
    const sparseNodes = completeDocument();
    sparseNodes.nodes = Array<CanvasWorkspaceDocumentDto["nodes"][number]>(1);
    expect(() => decodeCanvasWorkspaceDocument(sparseNodes)).toThrow();

    const sparseTags = completeDocument();
    sparseTags.nodes[0]!.tags = Array<string>(1);
    expect(() => decodeCanvasWorkspaceDocument(sparseTags)).toThrow();

    const sparseDataArray = completeDocument();
    nodeData(sparseDataArray, "canvas-node:synth").sourceNodeIds = Array<string>(1);
    expect(() => decodeCanvasWorkspaceDocument(sparseDataArray)).toThrow();
  });
});
