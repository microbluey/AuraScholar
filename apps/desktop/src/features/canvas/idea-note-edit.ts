import type { CanvasWorkspaceDocument, IdeaNoteNodeData } from "@aurascholar/core";

export interface IdeaNotePatch {
  contentMarkdown?: string;
  title?: string;
}

export interface IdeaNotePatchOptions {
  expectedValue?: {
    contentMarkdown: string;
    title: string;
  };
  timestamp?: number;
}

export type IdeaNotePatchStatus =
  | "applied"
  | "content-mismatch"
  | "missing-node"
  | "not-idea-note"
  | "unchanged"
  | "workspace-mismatch";

export interface IdeaNotePatchResult {
  document: CanvasWorkspaceDocument;
  status: IdeaNotePatchStatus;
}

const INLINE_EQUATION_PATTERN = /\$[^$\n]+\$|\\\([^]*?\\\)/;
const DISPLAY_EQUATION_PATTERN = /\$\$[^]*?\$\$|\\\[[^]*?\\\]/;

export function markdownHasEquations(markdown: string): boolean {
  return INLINE_EQUATION_PATTERN.test(markdown) || DISPLAY_EQUATION_PATTERN.test(markdown);
}

export function applyIdeaNotePatch(
  document: CanvasWorkspaceDocument,
  workspaceId: string,
  nodeId: string,
  patch: IdeaNotePatch,
  options: IdeaNotePatchOptions | number = {},
): IdeaNotePatchResult {
  const timestamp = typeof options === "number" ? options : (options.timestamp ?? Date.now());
  if (document.workspaceId !== workspaceId) {
    return { document, status: "workspace-mismatch" };
  }

  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return { document, status: "missing-node" };
  }
  if (node.type !== "idea-note") {
    return { document, status: "not-idea-note" };
  }

  const hasTitlePatch = Object.prototype.hasOwnProperty.call(patch, "title");
  const hasContentPatch = Object.prototype.hasOwnProperty.call(patch, "contentMarkdown");
  const nextTitle = hasTitlePatch ? normalizeIdeaNoteTitle(patch.title) : node.data.title;
  const nextContentMarkdown = hasContentPatch
    ? (patch.contentMarkdown ?? "")
    : node.data.contentMarkdown;
  const nextData: IdeaNoteNodeData = {
    ...node.data,
    title: nextTitle,
    contentMarkdown: nextContentMarkdown,
    hasEquations: markdownHasEquations(nextContentMarkdown),
  };

  if (
    nextData.title === node.data.title &&
    nextData.contentMarkdown === node.data.contentMarkdown &&
    nextData.hasEquations === node.data.hasEquations
  ) {
    return { document, status: "unchanged" };
  }

  const expectedValue = typeof options === "number" ? undefined : options.expectedValue;
  if (
    expectedValue &&
    (normalizeIdeaNoteTitle(expectedValue.title) !== normalizeIdeaNoteTitle(node.data.title) ||
      expectedValue.contentMarkdown !== node.data.contentMarkdown)
  ) {
    return { document, status: "content-mismatch" };
  }

  const updatedAt = Math.max(timestamp, document.updatedAt + 1, node.updatedAt + 1);
  return {
    status: "applied",
    document: {
      ...document,
      nodes: document.nodes.map((candidate) =>
        candidate.id === node.id
          ? {
              ...node,
              data: nextData,
              updatedAt,
            }
          : candidate,
      ),
      updatedAt,
    },
  };
}

function normalizeIdeaNoteTitle(title: string | undefined): string | undefined {
  return title?.trim() || undefined;
}
