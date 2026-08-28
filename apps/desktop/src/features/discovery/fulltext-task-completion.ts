import type { FulltextTask } from "../../services/fulltext";

export interface FulltextTaskCompletionActions {
  hideBrowserViews(): Promise<boolean>;
  isCurrent(): boolean;
  navigate(path: string): void;
  onExit(): void;
  onMode(mode: "opensource"): void;
}

export interface OaAttachmentCompletionActions extends FulltextTaskCompletionActions {
  notifyLibraryUpdated(): void;
  onMessage(message: string): void;
}

function afterBrowserViewsHide(
  hideBrowserViews: FulltextTaskCompletionActions["hideBrowserViews"],
  isCurrent: FulltextTaskCompletionActions["isCurrent"],
  complete: () => void,
): void {
  void hideBrowserViews().then(
    (hidden) => {
      if (hidden && isCurrent()) complete();
    },
    () => {},
  );
}

/** Exit a completed task using its already-validated handoff destination. */
export function exitCompletedFulltextTask(
  task: Pick<FulltextTask, "origin" | "returnTo">,
  { hideBrowserViews, isCurrent, navigate, onExit, onMode }: FulltextTaskCompletionActions,
): boolean {
  if (task.returnTo) {
    afterBrowserViewsHide(hideBrowserViews, isCurrent, () => {
      onExit();
      navigate(task.returnTo!);
    });
    return true;
  }
  if (task.origin === "discovery") {
    afterBrowserViewsHide(hideBrowserViews, isCurrent, () => {
      onExit();
      onMode("opensource");
    });
    return true;
  }
  return false;
}

/** Publish a direct OA attachment, then safely exit its originating handoff. */
export function completeAttachedOaFulltextTask(
  task: Pick<FulltextTask, "origin" | "returnTo">,
  { notifyLibraryUpdated, onMessage, ...exitActions }: OaAttachmentCompletionActions,
): boolean {
  onMessage("已找到并挂载开放获取 PDF");
  notifyLibraryUpdated();
  return exitCompletedFulltextTask(task, exitActions);
}
