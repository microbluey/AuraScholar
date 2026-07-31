import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ResearchProjectService } from "../../services/research-project-service";
import type { ProjectLibraryWorkOption } from "./model";
import { ProjectSourceSearchController } from "./project-source-search";

export function useProjectSourceSearch(service: ResearchProjectService, projectId: string) {
  const controller = useMemo(() => new ProjectSourceSearchController(service), [service]);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.start(projectId);
    return () => controller.stop();
  }, [controller, projectId]);

  return {
    snapshot,
    clearSelection: useCallback(() => controller.clearSelection(), [controller]),
    search: useCallback((query: string) => controller.search(query), [controller]),
    toggle: useCallback(
      (work: ProjectLibraryWorkOption, selected: boolean) => controller.toggle(work, selected),
      [controller],
    ),
  };
}
