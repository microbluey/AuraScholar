import { useCallback, useEffect, useRef } from "react";
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
 * The controller identity and returned callback remain stable while every
 * operation delegates to the dependencies from the latest render.
 */
export function useLibraryRefreshController<Query, Data>(
  dependencies: LibraryRefreshControllerDependencies<Query, Data>,
): LibraryRefresh<Query, Data> {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;

  const controllerRef = useRef<LibraryRefreshController<Query, Data> | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createLibraryRefreshController({
      getQuery: () => dependenciesRef.current.getQuery(),
      load: (query) => dependenciesRef.current.load(query),
      apply: (data, query) => dependenciesRef.current.apply(data, query),
      get isSameQuery() {
        return dependenciesRef.current.isSameQuery;
      },
      get reportFailure() {
        return dependenciesRef.current.reportFailure;
      },
      get toError() {
        return dependenciesRef.current.toError;
      },
    });
  }
  const controller = controllerRef.current;

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  return useCallback(() => controller.refresh(), [controller]);
}
