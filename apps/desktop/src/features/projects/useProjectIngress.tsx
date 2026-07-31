import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { ProjectTargetPicker } from "./ProjectTargetPicker";
import { projectIngressGateway } from "./project-ingress-adapter";
import {
  ProjectIngressController,
  type ProjectIngressOpenOptions,
  type ProjectIngressOutcome,
} from "./project-ingress-controller";
import type { ProjectIngressGateway } from "./project-ingress-gateway";
import type { ProjectIngressRequest } from "./project-ingress-model";

export interface ProjectIngressAddedResult {
  projectId: string;
  updated: number;
}

export interface UseProjectIngressOptions {
  activeProjectId?: string | null;
  gateway?: ProjectIngressGateway;
  onAdded?: (result: ProjectIngressAddedResult) => void;
  onError?: (error: Error) => void;
}

export interface OpenProjectIngressOptions {
  signal?: AbortSignal;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("加入研究项目失败，请重试。");
}

export function useProjectIngress({
  activeProjectId = null,
  gateway = projectIngressGateway,
  onAdded,
  onError,
}: UseProjectIngressOptions = {}) {
  const controller = useMemo(() => new ProjectIngressController(gateway), [gateway]);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => () => controller.dispose(), [controller]);

  const reportError = useCallback(
    (error: Error) => {
      try {
        onError?.(error);
      } catch {
        // Observer failures must not change ingress state or its durable outcome.
      }
    },
    [onError],
  );

  const settle = useCallback(
    async (operation: Promise<ProjectIngressOutcome>): Promise<ProjectIngressOutcome> => {
      try {
        const outcome = await operation;
        if (outcome.status === "added") {
          try {
            onAdded?.(outcome);
          } catch (cause) {
            reportError(asError(cause));
          }
        }
        return outcome;
      } catch (cause) {
        const error = asError(cause);
        reportError(error);
        throw error;
      }
    },
    [onAdded, reportError],
  );

  const openProjectIngress = useCallback(
    (
      request: ProjectIngressRequest,
      options: OpenProjectIngressOptions = {},
    ): Promise<ProjectIngressOutcome> => {
      const controllerOptions: ProjectIngressOpenOptions = {
        activeProjectId,
        signal: options.signal,
      };
      return settle(controller.open(request, controllerOptions));
    },
    [activeProjectId, controller, settle],
  );

  const confirmProjectTarget = useCallback(
    (projectId: string) => settle(controller.confirm(projectId)),
    [controller, settle],
  );

  const createProjectTarget = useCallback(
    async (name: string) => {
      try {
        return await controller.createProject(name);
      } catch (cause) {
        const error = asError(cause);
        reportError(error);
        throw error;
      }
    },
    [controller, reportError],
  );

  const cancelProjectIngress = useCallback(() => controller.cancel(), [controller]);

  const projectTargetPicker = snapshot.dialog ? (
    <ProjectTargetPicker
      key={snapshot.dialog.requestId}
      defaultProjectId={snapshot.dialog.defaultProjectId}
      onCancel={cancelProjectIngress}
      onConfirm={confirmProjectTarget}
      onCreateProject={createProjectTarget}
      open
      projects={snapshot.dialog.projects}
      sourceLabel={snapshot.dialog.sourceLabel}
      workCount={snapshot.dialog.workCount}
    />
  ) : null;

  return {
    cancelProjectIngress,
    openProjectIngress,
    pending: snapshot.pending,
    projectTargetPicker,
  };
}
