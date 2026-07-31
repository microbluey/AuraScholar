import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { FulltextTask } from "../../services/fulltext";
import type { IngestDraft } from "../../services/library-types";
import type { DraftQueueEntry } from "./useIngestDraftQueue";

export interface FulltextImportCompletionOptions {
  dismissDraft(draft: IngestDraft | null): void;
  hideBrowserViews(): Promise<boolean>;
  markWorkReady(workId: string): void;
  mode: "browser" | "home" | "opensource";
  navigate(path: string): void;
  onMessage(message: string): void;
  onMode(mode: "opensource"): void;
  openTaskBrowser(task: FulltextTask, prefix?: string): void;
  queueSnapshot(): DraftQueueEntry[];
  replaceTask(task: FulltextTask | null): void;
  restoreActiveBrowserTab(): void;
  taskRef: MutableRefObject<FulltextTask | null>;
}

/** Coordinates staged-PDF cleanup, queued confirmations, and the safe return route. */
export function useFulltextImportCompletion({
  dismissDraft,
  hideBrowserViews,
  markWorkReady,
  mode,
  navigate,
  onMessage,
  onMode,
  openTaskBrowser,
  queueSnapshot,
  replaceTask,
  restoreActiveBrowserTab,
  taskRef,
}: FulltextImportCompletionOptions) {
  const deferredExitRef = useRef<
    Pick<FulltextTask, "handoffId" | "origin" | "returnTo"> | null
  >(null);
  const deferredBrowserRef = useRef<FulltextTask | null>(null);
  const mountedRef = useRef(true);
  const modeRef = useRef(mode);
  const leavingRef = useRef(false);
  useEffect(() => {
    modeRef.current = mode;
    if (mode === "browser") leavingRef.current = false;
  }, [mode]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const markLeaving = useCallback(() => {
    leavingRef.current = true;
    modeRef.current = "home";
  }, []);

  const exitCompletedTask = useCallback(
    (task: Pick<FulltextTask, "origin" | "returnTo">) => {
      if (task.returnTo) {
        markLeaving();
        void hideBrowserViews();
        navigate(task.returnTo);
        return true;
      }
      if (task.origin === "discovery") {
        markLeaving();
        void hideBrowserViews();
        onMode("opensource");
        return true;
      }
      return false;
    },
    [hideBrowserViews, markLeaving, navigate, onMode],
  );

  const resumeIfQueueEmpty = useCallback(() => {
    if (!mountedRef.current || leavingRef.current) return;
    if (queueSnapshot().length > 0) return;
    const deferredBrowser = deferredBrowserRef.current;
    deferredBrowserRef.current = null;
    if (deferredBrowser && taskRef.current?.handoffId === deferredBrowser.handoffId) {
      openTaskBrowser(deferredBrowser, "已跳过当前开放副本");
      return;
    }
    const deferredExit = deferredExitRef.current;
    deferredExitRef.current = null;
    if (
      deferredExit &&
      (!taskRef.current || taskRef.current.handoffId === deferredExit.handoffId) &&
      exitCompletedTask(deferredExit)
    ) {
      return;
    }
    if (mountedRef.current && modeRef.current === "browser") restoreActiveBrowserTab();
  }, [
    exitCompletedTask,
    openTaskBrowser,
    queueSnapshot,
    restoreActiveBrowserTab,
    taskRef,
  ]);

  const finish = useCallback(
    (draft: IngestDraft | null, completedWorkId?: string) => {
      void import("../../services/library-actions")
        .then(({ discardStagedPdf }) => discardStagedPdf(draft?.pdf))
        .catch(() => {});
      if (!mountedRef.current || leavingRef.current) return;
      const queue = queueSnapshot();
      const remainingCount = Math.max(0, queue.length - (queue[0]?.draft === draft ? 1 : 0));
      dismissDraft(draft);

      const task = taskRef.current;
      const completesTask =
        Boolean(completedWorkId) &&
        Boolean(draft?.targetHandoffId) &&
        draft?.targetHandoffId === task?.handoffId &&
        completedWorkId === task?.id;
      if (completesTask && completedWorkId) {
        markWorkReady(completedWorkId);
        replaceTask(null);
        if (remainingCount > 0) {
          deferredExitRef.current = {
            handoffId: task?.handoffId,
            origin: task?.origin,
            returnTo: task?.returnTo,
          };
          onMessage(`全文已挂载；还有 ${remainingCount} 个下载等待核对`);
          return;
        }
        if (task && exitCompletedTask(task)) return;
      }
      if (remainingCount > 0) return;
      resumeIfQueueEmpty();
    },
    [
      dismissDraft,
      exitCompletedTask,
      markWorkReady,
      onMessage,
      queueSnapshot,
      replaceTask,
      resumeIfQueueEmpty,
      taskRef,
    ],
  );

  const deferBrowserFallback = useCallback((task: FulltextTask) => {
    deferredBrowserRef.current = task;
  }, []);

  return { deferBrowserFallback, finish, markLeaving, resumeIfQueueEmpty };
}
