import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ResearchProjectService } from "../../services/research-project-service";
import { ResearchProjectController } from "./research-project-controller";

export function useResearchProjectController(service: ResearchProjectService) {
  const controller = useMemo(() => new ResearchProjectController(service), [service]);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  return {
    snapshot,
    addWorks: useCallback(
      (workIds: readonly string[]) => controller.addWorks(workIds),
      [controller],
    ),
    createProject: useCallback((name: string) => controller.createProject(name), [controller]),
    dismissFeedback: useCallback(() => controller.dismissFeedback(), [controller]),
    loadIndex: useCallback(() => controller.loadIndex(), [controller]),
    loadProject: useCallback(
      (projectId: string) => controller.loadProject(projectId),
      [controller],
    ),
    removeWork: useCallback((workId: string) => controller.removeWork(workId), [controller]),
    renameProject: useCallback((name: string) => controller.renameProject(name), [controller]),
  };
}
