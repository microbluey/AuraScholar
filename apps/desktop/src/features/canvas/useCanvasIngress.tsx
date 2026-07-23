import type { CanvasWorkspaceSummary } from "@aurascholar/db/repos/canvas";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CanvasTargetPicker } from "./CanvasTargetPicker";
import {
  createCanvasWorkspace,
  listCanvasWorkspaces,
  readLastCanvasWorkspaceId,
} from "./persistence";
import { canvasWorkspaceIngressPath } from "./routes";

export interface CanvasIngressRequest {
  annotationId?: string;
  sourceLabel?: string;
  workId: string;
}

interface CanvasTargetState {
  activeWorkspaceId: string;
  request: CanvasIngressRequest;
  workspaces: CanvasWorkspaceSummary[];
}

export function useCanvasIngress(onError?: (message: string) => void) {
  const navigate = useNavigate();
  const [targetState, setTargetState] = useState<CanvasTargetState | null>(null);

  const navigateToTarget = useCallback(
    (workspaceId: string, request: CanvasIngressRequest) => {
      navigate(
        canvasWorkspaceIngressPath(workspaceId, {
          workId: request.workId,
          annotationId: request.annotationId,
        }),
      );
    },
    [navigate],
  );

  const openInCanvas = useCallback(
    async (request: CanvasIngressRequest): Promise<void> => {
      try {
        const workspaces = await listCanvasWorkspaces();
        const rememberedId = readLastCanvasWorkspaceId();
        const activeWorkspace =
          workspaces.find((workspace) => workspace.workspaceId === rememberedId) ?? workspaces[0];
        if (!activeWorkspace) throw new Error("没有可用的空间白板");
        if (workspaces.length === 1) {
          navigateToTarget(activeWorkspace.workspaceId, request);
          return;
        }
        setTargetState({
          activeWorkspaceId: activeWorkspace.workspaceId,
          request,
          workspaces,
        });
      } catch (error) {
        onError?.(error instanceof Error ? error.message : "无法读取空间白板列表");
      }
    },
    [navigateToTarget, onError],
  );

  const targetPicker = useMemo(
    () => (
      <CanvasTargetPicker
        open={targetState !== null}
        activeWorkspaceId={targetState?.activeWorkspaceId ?? ""}
        workspaces={targetState?.workspaces ?? []}
        sourceLabel={targetState?.request.sourceLabel}
        onCancel={() => setTargetState(null)}
        onConfirm={(workspaceId) => {
          const request = targetState?.request;
          if (!request) return;
          setTargetState(null);
          navigateToTarget(workspaceId, request);
        }}
        onCreateWorkspace={async (name) => {
          const created = await createCanvasWorkspace(name);
          const workspaces = await listCanvasWorkspaces();
          setTargetState((current) =>
            current
              ? {
                  ...current,
                  activeWorkspaceId: created.workspaceId,
                  workspaces,
                }
              : current,
          );
          return created;
        }}
      />
    ),
    [navigateToTarget, targetState],
  );

  return { openInCanvas, targetPicker };
}
