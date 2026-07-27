import {
  type CanvasPoint,
  type CanvasWorkspaceDocument,
  type ExcerptNode,
  type PaperNode,
} from "@aurascholar/core";
import type { ReaderAnnotation } from "@aurascholar/reader";
import {
  CANVAS_EXCERPT_DRAG_VERSION,
  CanvasExcerptDropError,
  applyCanvasExcerptDrop,
  type CanvasExcerptDropOptions,
  type CanvasExcerptDropResult,
} from "./canvas-excerpt-dnd";
import { createPaperNode, type CanvasLibraryWork } from "./model";

export interface CanvasAnnotationIngressInput {
  annotation: ReaderAnnotation;
  attachmentId: string;
  /** Optional route constraint supplied by the Library or Reader handoff. */
  expectedWorkId?: string;
  /** Authoritative work id stored on the annotation row. */
  workId: string;
  /** Authoritative Library metadata loaded for workId. */
  work: CanvasLibraryWork;
  /** Workspace captured when the Reader/Library handoff began. */
  workspaceId: string;
}

export interface CanvasAnnotationIngressOptions extends CanvasExcerptDropOptions {
  createPaper?: (work: CanvasLibraryWork, position: CanvasPoint) => PaperNode;
}

export interface CanvasAnnotationIngressResult extends CanvasExcerptDropResult {
  createdPaper: boolean;
  paper: PaperNode;
}

export function nextCanvasIngressPosition(document: CanvasWorkspaceDocument): CanvasPoint {
  const count = document.nodes.filter((node) => !node.groupId).length;
  return {
    x: 340 + (count % 4) * 356,
    y: 140 + Math.floor(count / 4) * 314,
  };
}

function assertIngressWorkIdentity(input: CanvasAnnotationIngressInput): void {
  if (input.workId !== input.work.id) {
    throw new CanvasExcerptDropError(
      "source-work-mismatch",
      "批注与文献库中的来源文献不一致，本次加入已取消",
    );
  }
  if (input.expectedWorkId && input.expectedWorkId !== input.workId) {
    throw new CanvasExcerptDropError(
      "source-work-mismatch",
      "批注不属于请求加入的文献，本次加入已取消",
    );
  }
}

function validateCreatedPaper(
  document: CanvasWorkspaceDocument,
  paper: PaperNode,
  workId: string,
): void {
  if (paper.data.workId !== workId) {
    throw new CanvasExcerptDropError(
      "source-work-mismatch",
      "新建文献卡与批注来源不一致，本次加入已取消",
    );
  }
  if (document.nodes.some((node) => node.id === paper.id)) {
    throw new CanvasExcerptDropError("id-collision", "无法为来源文献卡生成唯一标识");
  }
}

/**
 * Atomically ensures the complete Library → Paper → Excerpt provenance chain
 * for an annotation handoff. No partial PaperNode can escape when creating the
 * ExcerptNode or its derived-from edge fails.
 */
export function applyCanvasAnnotationIngress(
  document: CanvasWorkspaceDocument,
  input: CanvasAnnotationIngressInput,
  options: CanvasAnnotationIngressOptions = {},
): CanvasAnnotationIngressResult {
  if (document.workspaceId !== input.workspaceId) {
    throw new CanvasExcerptDropError(
      "workspace-mismatch",
      "批注请求返回前白板已经切换，本次加入已取消",
    );
  }
  assertIngressWorkIdentity(input);

  const existingExcerpt = document.nodes.find(
    (node): node is ExcerptNode =>
      node.type === "excerpt" && node.data.annotationId === input.annotation.id,
  );
  if (existingExcerpt && existingExcerpt.data.workId !== input.workId) {
    throw new CanvasExcerptDropError("annotation-conflict", "同一批注标识已被另一篇文献使用");
  }
  const linkedPaper = existingExcerpt
    ? document.edges
        .filter(
          (edge) => edge.targetId === existingExcerpt.id && edge.relationType === "derived-from",
        )
        .map((edge) => document.nodes.find((node) => node.id === edge.sourceId))
        .find(
          (node): node is PaperNode => node?.type === "paper" && node.data.workId === input.workId,
        )
    : undefined;
  let paper =
    linkedPaper ??
    document.nodes.find(
      (node): node is PaperNode => node.type === "paper" && node.data.workId === input.workId,
    );
  let workingDocument = document;
  let createdPaper = false;

  if (!paper) {
    paper = (options.createPaper ?? createPaperNode)(
      input.work,
      nextCanvasIngressPosition(document),
    );
    validateCreatedPaper(document, paper, input.workId);
    workingDocument = {
      ...document,
      nodes: [...document.nodes, paper],
      updatedAt: Math.max(document.updatedAt, paper.updatedAt),
    };
    createdPaper = true;
  }

  const result = applyCanvasExcerptDrop(
    workingDocument,
    {
      version: CANVAS_EXCERPT_DRAG_VERSION,
      workspaceId: document.workspaceId,
      sourceNodeId: paper.id,
      workId: input.workId,
      attachmentId: input.attachmentId,
      paperTitle: paper.data.title,
      annotation: input.annotation,
    },
    nextCanvasIngressPosition(workingDocument),
    options,
  );

  return { ...result, paper, createdPaper };
}
