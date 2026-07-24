import { describe, expect, it } from "vitest";
import { createPreviewWorkspace } from "./model";
import { applyIdeaNotePatch, markdownHasEquations } from "./idea-note-edit";

function previewIdeaNote() {
  const document = createPreviewWorkspace();
  const node = document.nodes.find((candidate) => candidate.type === "idea-note");
  expect(node).toBeDefined();
  return { document, node: node! };
}

describe("idea note editing", () => {
  it("patches note fields without replacing spatial placement data", () => {
    const { document, node } = previewIdeaNote();
    const result = applyIdeaNotePatch(
      document,
      document.workspaceId,
      node.id,
      { title: "  新假设  ", contentMarkdown: "## Evidence\n\n- observation" },
      900,
    );

    expect(result.status).toBe("applied");
    const updated = result.document.nodes.find((candidate) => candidate.id === node.id);
    expect(updated).toMatchObject({
      id: node.id,
      type: "idea-note",
      position: node.position,
      dimensions: node.dimensions,
      groupId: node.groupId,
      data: {
        title: "新假设",
        contentMarkdown: "## Evidence\n\n- observation",
        hasEquations: false,
      },
    });
    expect(updated?.updatedAt).toBeGreaterThan(document.updatedAt);
  });

  it("normalizes an empty title while preserving markdown whitespace", () => {
    const { document, node } = previewIdeaNote();
    const markdown = "  indented\n\n";
    const result = applyIdeaNotePatch(
      document,
      document.workspaceId,
      node.id,
      { title: "   ", contentMarkdown: markdown },
      901,
    );
    const updated = result.document.nodes.find((candidate) => candidate.id === node.id);

    expect(result.status).toBe("applied");
    expect(updated?.type === "idea-note" ? updated.data.title : "wrong type").toBeUndefined();
    expect(updated?.type === "idea-note" ? updated.data.contentMarkdown : "").toBe(markdown);
  });

  it("rejects stale workspace, missing-node, and non-note writes", () => {
    const { document, node } = previewIdeaNote();
    const paper = document.nodes.find((candidate) => candidate.type === "paper");
    expect(paper).toBeDefined();

    expect(applyIdeaNotePatch(document, "canvas:other", node.id, { title: "stale" }).status).toBe(
      "workspace-mismatch",
    );
    expect(
      applyIdeaNotePatch(document, document.workspaceId, "missing", { title: "missing" }).status,
    ).toBe("missing-node");
    expect(
      applyIdeaNotePatch(document, document.workspaceId, paper!.id, { title: "paper" }).status,
    ).toBe("not-idea-note");
  });

  it("returns the original document for an unchanged edit", () => {
    const { document, node } = previewIdeaNote();
    const result = applyIdeaNotePatch(document, document.workspaceId, node.id, {
      title: node.type === "idea-note" ? node.data.title : "",
      contentMarkdown: node.type === "idea-note" ? node.data.contentMarkdown : "",
    });

    expect(result).toEqual({ document, status: "unchanged" });
    expect(result.document).toBe(document);
  });

  it("recognizes inline, display, and LaTeX-delimited equations", () => {
    expect(markdownHasEquations("No equation here")).toBe(false);
    expect(markdownHasEquations("Energy is $E = mc^2$.")).toBe(true);
    expect(markdownHasEquations("$$\nE = mc^2\n$$")).toBe(true);
    expect(markdownHasEquations("\\(x+y\\)")).toBe(true);
    expect(markdownHasEquations("\\[\nx+y\n\\]")).toBe(true);
  });
});
