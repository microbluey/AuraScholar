import type { FulltextTask } from "../../services/fulltext";
import type { IngestDraft } from "../../services/library-types";

export type FulltextDownloadPlan =
  | { kind: "attach-dedup"; draft: IngestDraft }
  | { kind: "confirm"; draft: IngestDraft };

/**
 * Resolves an analyzed browser PDF against the immutable full-text task bound
 * to its source tab. A task from another tab is intentionally invisible.
 *
 * The user's explicit target wins as intent, while a conflicting DOI/content
 * dedup is preserved as evidence for confirmation instead of silently changing
 * the destination work.
 */
export function planFulltextDownload(
  task: FulltextTask | null,
  ownerTabId: string,
  draft: IngestDraft,
): FulltextDownloadPlan {
  const belongsToTask = Boolean(task?.targetTabId && task.targetTabId === ownerTabId);
  if (!task || !belongsToTask) {
    return { kind: draft.dedup ? "attach-dedup" : "confirm", draft };
  }

  const targetedDraft: IngestDraft = {
    ...draft,
    targetHandoffId: task.handoffId,
    targetTitle: task.title,
    targetWorkId: task.id,
  };
  if (draft.dedup?.workId === task.id) {
    return { kind: "attach-dedup", draft: targetedDraft };
  }
  if (draft.dedup) targetedDraft.targetConflict = draft.dedup;
  return { kind: "confirm", draft: targetedDraft };
}
