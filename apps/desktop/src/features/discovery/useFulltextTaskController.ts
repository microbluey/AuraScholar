import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { newId } from "@aurascholar/db/ids";
import { ezproxyRewrite } from "../../services/discovery-sites";
import {
  bindFulltextTaskToTab,
  createFulltextTask,
  type FulltextLandingTarget,
  type FulltextTask,
} from "../../services/fulltext";
import type { IngestDraft } from "../../services/library-types";
import { describeSafeError } from "../../services/sensitive-text";

type FulltextMode = "browser" | "opensource";

interface ResearchTabOpenOptions {
  keepBrowserOnFailure?: boolean;
  onOpened?: (tabId: string) => void;
  reuseExisting?: boolean;
}

export interface UseFulltextTaskControllerOptions {
  clearSearch(): void;
  desktopRuntime: boolean;
  ezproxy: string;
  initialTask: FulltextTask | null;
  onConfirmDraft(draft: IngestDraft): void;
  onMessage(message: string): void;
  onMode(mode: FulltextMode): void;
  onQuery(query: string): void;
  openResearchTab(
    siteId: string,
    url: string,
    proxy?: string,
    options?: ResearchTabOpenOptions,
  ): void;
  proxy: string;
}

export interface FulltextTaskController {
  openBrowser(task: FulltextTask, prefix?: string): void;
  openTarget(target: FulltextLandingTarget): void;
  replace(task: FulltextTask | null): void;
  start(task: FulltextTask): void;
  task: FulltextTask | null;
  taskRef: MutableRefObject<FulltextTask | null>;
}

/**
 * Owns the lifetime of one full-text handoff. Async OA work publishes only
 * while its handoffId is current, and browser downloads can inherit the target
 * only after the opened research tab is immutably bound to that task.
 */
export function useFulltextTaskController(
  {
    clearSearch,
    desktopRuntime,
    ezproxy,
    initialTask,
    onConfirmDraft,
    onMessage,
    onMode,
    onQuery,
    openResearchTab,
    proxy,
  }: UseFulltextTaskControllerOptions,
): FulltextTaskController {
  const [task, setTask] = useState<FulltextTask | null>(initialTask);
  const taskRef = useRef(task);

  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  useEffect(
    () => () => {
      taskRef.current = null;
    },
    [],
  );

  const replace = useCallback((next: FulltextTask | null) => {
    taskRef.current = next;
    setTask(next);
  }, []);

  const openBrowser = useCallback(
    (current: FulltextTask, prefix?: string) => {
      if (taskRef.current?.handoffId !== current.handoffId) return;
      onMessage(
        prefix
          ? `${prefix}，正在打开《${current.title}》的全文来源...`
          : `未找到可直接验证的开放 PDF，正在打开《${current.title}》的全文来源...`,
      );
      const destination = ezproxy.trim()
        ? (ezproxyRewrite(ezproxy, current.landingUrl) ?? current.landingUrl)
        : current.landingUrl;
      openResearchTab("_fulltext", destination, proxy, {
        keepBrowserOnFailure: true,
        reuseExisting: false,
        onOpened: (tabId) => {
          if (taskRef.current?.handoffId !== current.handoffId) return;
          setTask((active) => {
            if (!active || active.handoffId !== current.handoffId) return active;
            const bound = bindFulltextTaskToTab(active, tabId);
            taskRef.current = bound;
            return bound;
          });
        },
      });
    },
    [ezproxy, onMessage, openResearchTab, proxy],
  );

  const start = useCallback(
    (incoming: FulltextTask) => {
      const current = incoming.handoffId ? incoming : { ...incoming, handoffId: newId() };
      replace(current);
      if (!desktopRuntime) {
        onMode("opensource");
        onQuery(current.title);
        clearSearch();
        onMessage(
          `已保留《${current.title}》的补全文目标；浏览器预览不会打开内置站点浏览器。`,
        );
        return;
      }

      onMode("browser");
      onMessage(`正在为《${current.title}》检查开放获取全文...`);
      void import("../../services/library")
        .then(({ analyzeOaPdf }) =>
          analyzeOaPdf({
            arxivId: current.arxivId,
            doi: current.doi,
            oaPdfUrl: current.url,
            title: current.title,
          }),
        )
        .then((draft) => {
          if (taskRef.current?.handoffId !== current.handoffId) return;
          if (!draft) {
            openBrowser(current);
            return;
          }
          onMessage("已找到开放获取 PDF，请核对后挂载");
          onConfirmDraft({
            ...draft,
            targetHandoffId: current.handoffId,
            targetTitle: current.title,
            targetWorkId: current.id,
          });
        })
        .catch((error) => {
          openBrowser(current, `开放全文检查失败:${describeSafeError(error)}`);
        });
    },
    [
      clearSearch,
      desktopRuntime,
      onConfirmDraft,
      onMessage,
      onMode,
      onQuery,
      openBrowser,
      replace,
    ],
  );

  const openTarget = useCallback(
    (target: FulltextLandingTarget) => {
      start(createFulltextTask(target, { handoffId: newId(), origin: "discovery" }));
    },
    [start],
  );

  return { openBrowser, openTarget, replace, start, task, taskRef };
}
