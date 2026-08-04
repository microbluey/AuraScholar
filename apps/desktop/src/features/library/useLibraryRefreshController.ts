import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  createLibraryRefreshController,
  type LibraryRefreshController,
  type LibraryRefreshControllerDependencies,
  type LibraryRefreshResult,
} from "./library-refresh-controller";

export type LibraryRefresh<Query, Data> = () => Promise<LibraryRefreshResult<Query, Data>>;

/**
 * React lifecycle adapter for the framework-agnostic refresh controller.
 *
 * The controller identity and returned callback remain stable while its
 * dependencies are refreshed before page-level effects request new work.
 */
export function useLibraryRefreshController<Query, Data>(
  dependencies: LibraryRefreshControllerDependencies<Query, Data>,
): LibraryRefresh<Query, Data> {
  const [controller] = useState<LibraryRefreshController<Query, Data>>(() =>
    createLibraryRefreshController(dependencies),
  );

  useLayoutEffect(() => {
    controller.updateDependencies(dependencies);
  }, [controller, dependencies]);

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  return useCallback(() => controller.refresh(), [controller]);
}
