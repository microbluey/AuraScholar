import { describe, expect, it } from "vitest";
import {
  canvasWorkspaceIngressPath,
  canvasWorkspacePath,
  canvasWorkspaceRedirectPath,
} from "./routes";

describe("canvas RESTful workspace routes", () => {
  it("encodes the workspace id as one path segment", () => {
    expect(canvasWorkspacePath("canvas:研究 / α?%")).toBe(
      "/canvas/canvas%3A%E7%A0%94%E7%A9%B6%20%2F%20%CE%B1%3F%25",
    );
  });

  it("adds encoded work and annotation ingress parameters", () => {
    expect(
      canvasWorkspaceIngressPath("canvas:default", {
        workId: "doi:10.1000/a b&c",
        annotationId: "note/段落?1",
      }),
    ).toBe(
      "/canvas/canvas%3Adefault?workId=doi%3A10.1000%2Fa+b%26c&annotationId=note%2F%E6%AE%B5%E8%90%BD%3F1",
    );
  });

  it("omits the query delimiter when there is no ingress payload", () => {
    expect(canvasWorkspaceIngressPath("canvas:default", {})).toBe("/canvas/canvas%3Adefault");
  });

  it("supports a work-only ingress URL", () => {
    expect(canvasWorkspaceIngressPath("canvas:literature", { workId: "work-42" })).toBe(
      "/canvas/canvas%3Aliterature?workId=work-42",
    );
  });

  it("preserves legacy ingress parameters while redirecting /canvas", () => {
    expect(
      canvasWorkspaceRedirectPath("canvas:default", "?workId=work-42&annotationId=note-7"),
    ).toBe("/canvas/canvas%3Adefault?workId=work-42&annotationId=note-7");
  });
});
