import { CANVAS_SCHEMA_VERSION } from "@aurascholar/core";
import { describe, expect, it } from "vitest";
import type { CanvasWorkspaceDocumentDto } from "../../electron/canvas-command-contract";
import {
  decodeCanvasWorkspaceCreateResult,
  decodeCanvasWorkspaceDeleteResult,
  decodeCanvasWorkspaceLoadResult,
  decodeCanvasWorkspaceRenameResult,
  decodeCanvasWorkspaceSaveResult,
} from "./canvas-workspace-command-result-codec";

function workspace(
  overrides: Partial<CanvasWorkspaceDocumentDto> = {},
): CanvasWorkspaceDocumentDto {
  return {
    createdAt: 1,
    edges: [],
    name: "Research canvas",
    nodes: [],
    schemaVersion: CANVAS_SCHEMA_VERSION,
    updatedAt: 2,
    viewport: { x: 0, y: 0, zoom: 1 },
    workspaceId: "canvas:workspace-1",
    ...overrides,
  };
}

type DocumentResultDecoder = (value: unknown) => {
  workspace: CanvasWorkspaceDocumentDto | null;
};

const documentResultDecoders: readonly [string, DocumentResultDecoder][] = [
  ["load", decodeCanvasWorkspaceLoadResult],
  ["create", decodeCanvasWorkspaceCreateResult],
  ["rename", decodeCanvasWorkspaceRenameResult],
];

describe("Canvas workspace command-result codec", () => {
  it("accepts the exact nullable load envelope", () => {
    expect(decodeCanvasWorkspaceLoadResult({ workspace: null })).toEqual({ workspace: null });
  });

  it("clones and fully validates every non-null workspace result", () => {
    for (const [label, decode] of documentResultDecoders) {
      const source = workspace({ workspaceId: `canvas:${label}` });
      const decoded = decode({ workspace: source }).workspace;

      expect(decoded).toEqual(source);
      expect(decoded).not.toBeNull();
      expect(decoded).not.toBe(source);
      expect(decoded!.nodes).not.toBe(source.nodes);
      expect(decoded!.edges).not.toBe(source.edges);

      expect(() => decode({ workspace: workspace({ viewport: { x: 0, y: 0, zoom: 0 } }) })).toThrow(
        "Canvas viewport.zoom must be > 0",
      );
    }
  });

  it("rejects null create and rename results", () => {
    expect(() => decodeCanvasWorkspaceCreateResult({ workspace: null })).toThrow(
      "Canvas workspace document is invalid",
    );
    expect(() => decodeCanvasWorkspaceRenameResult({ workspace: null })).toThrow(
      "Canvas workspace document is invalid",
    );
  });

  it("rejects missing and extra outer result fields", () => {
    const source = workspace();
    const invalidResults = [
      () => decodeCanvasWorkspaceLoadResult({}),
      () => decodeCanvasWorkspaceCreateResult({}),
      () => decodeCanvasWorkspaceRenameResult({}),
      () => decodeCanvasWorkspaceDeleteResult({}),
      () => decodeCanvasWorkspaceSaveResult({}),
      () => decodeCanvasWorkspaceLoadResult({ extra: true, workspace: null }),
      () => decodeCanvasWorkspaceCreateResult({ extra: true, workspace: source }),
      () => decodeCanvasWorkspaceRenameResult({ extra: true, workspace: source }),
      () => decodeCanvasWorkspaceDeleteResult({ deleted: true, extra: true }),
      () => decodeCanvasWorkspaceSaveResult({ extra: true, saved: true }),
    ];

    for (const decode of invalidResults) {
      expect(decode).toThrow("is invalid");
    }
  });

  it("accepts only boolean delete results", () => {
    expect(decodeCanvasWorkspaceDeleteResult({ deleted: true })).toEqual({ deleted: true });
    expect(decodeCanvasWorkspaceDeleteResult({ deleted: false })).toEqual({ deleted: false });

    for (const deleted of [1, "true", null, undefined]) {
      expect(() => decodeCanvasWorkspaceDeleteResult({ deleted })).toThrow(
        "Canvas workspace delete result is invalid",
      );
    }
  });

  it("accepts only an explicit saved true result", () => {
    expect(decodeCanvasWorkspaceSaveResult({ saved: true })).toEqual({ saved: true });

    for (const saved of [false, 1, "true", null, undefined]) {
      expect(() => decodeCanvasWorkspaceSaveResult({ saved })).toThrow(
        "Canvas workspace save result is invalid",
      );
    }
  });
});
