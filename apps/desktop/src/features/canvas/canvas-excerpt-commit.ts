import type { CanvasWorkspaceDocument } from "@aurascholar/core";
import type { CanvasExcerptDropResult } from "./canvas-excerpt-dnd";

export type CanvasExcerptDocumentUpdate = (
  updater: (current: CanvasWorkspaceDocument) => CanvasWorkspaceDocument,
) => boolean;

export type CanvasExcerptCommitResult =
  | {
      status: "committed";
      accepted: boolean;
      changed: boolean;
      document: CanvasWorkspaceDocument;
      result: CanvasExcerptDropResult;
    }
  | {
      status: "failed";
      error: unknown;
    }
  | {
      status: "rejected";
    };

/**
 * Applies an excerpt drop only against the document owned by the accepting
 * update boundary. UI feedback must use this committed result rather than a
 * plan calculated from an older render snapshot.
 */
export function commitCanvasExcerptDrop(
  applyUpdate: CanvasExcerptDocumentUpdate,
  applyDrop: (current: CanvasWorkspaceDocument) => CanvasExcerptDropResult,
  finalizeDocument: (
    result: CanvasExcerptDropResult,
    current: CanvasWorkspaceDocument,
  ) => CanvasWorkspaceDocument = (result) => result.document,
): CanvasExcerptCommitResult {
  let updaterRan = false;
  let dropResult: CanvasExcerptDropResult | undefined;
  let committedDocument: CanvasWorkspaceDocument | undefined;
  let changed = false;
  let applyError: unknown;
  let applyFailed = false;

  let accepted: boolean;
  try {
    accepted = applyUpdate((current) => {
      updaterRan = true;
      try {
        dropResult = applyDrop(current);
        committedDocument = finalizeDocument(dropResult, current);
        changed = committedDocument !== current;
        return committedDocument;
      } catch (error) {
        applyFailed = true;
        applyError = error;
        return current;
      }
    });
  } catch (error) {
    return { status: "failed", error };
  }

  if (applyFailed) return { status: "failed", error: applyError };
  if (!updaterRan || !dropResult || !committedDocument || (changed && !accepted)) {
    return { status: "rejected" };
  }
  return {
    status: "committed",
    accepted,
    changed,
    document: committedDocument,
    result: dropResult,
  };
}
