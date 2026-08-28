import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { newId } from "@aurascholar/db/ids";
import { ezproxyRewrite } from "../../services/discovery-sites";
import {
  bindFulltextTaskToTab,
  createFulltextTask,
  type FulltextLandingTarget,
  type FulltextTask,
} from "../../services/fulltext";
import { describeSafeError } from "../../services/sensitive-text";
import { completeAttachedOaFulltextTask } from "./fulltext-task-completion";

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
  hideBrowserViews(): Promise<boolean>;
  initialTask: FulltextTask | null;
  navigate(path: string): void;
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
export function useFulltextTaskController({
  clearSearch,
  desktopRuntime,
  ezproxy,
  hideBrowserViews,
  initialTask,
  navigate,
  onMessage,
  onMode,
  onQuery,
  openResearchTab,
  proxy,
}: UseFulltextTaskControllerOptions): FulltextTaskController {
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
      if (taskRef.current !== current) return;
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
          if (taskRef.current !== current) return;
          setTask((active) => {
            if (active !== current) return active;
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
        onMessage(`已保留《${current.title}》的补全文目标；浏览器预览不会打开内置站点浏览器。`);
        return;
      }

      onMode("browser");
      onMessage(`正在为《${current.title}》检查开放获取全文...`);
      void import("../../services/library-oa")
        .then(({ ensureOaPdfAttachment }) => ensureOaPdfAttachment(current.id))
        .then((attached) => {
          if (taskRef.current !== current) return;
          if (!attached) {
            openBrowser(current);
            return;
          }
          const exits = completeAttachedOaFulltextTask(current, {
            hideBrowserViews,
            isCurrent: () => taskRef.current === current,
            navigate,
            notifyLibraryUpdated: () =>
              window.dispatchEvent(new Event("aurascholar:library-updated")),
            onExit: () => replace(null),
            onMessage,
            onMode,
          });
          if (!exits) replace(null);
        })
        .catch((error) => {
          openBrowser(current, `开放全文检查失败:${describeSafeError(error)}`);
        });
    },
    [
      clearSearch,
      desktopRuntime,
      hideBrowserViews,
      navigate,
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
