import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasWorkspaceSummaryDto } from "../../../electron/data-command-contract";
import { useNavigate } from "react-router-dom";
import { CanvasTargetPicker } from "./CanvasTargetPicker";
import {
  createCanvasWorkspace,
  listCanvasWorkspaces,
  readLastCanvasWorkspaceId,
} from "./persistence";
import { isCanvasIngressRequestCurrent } from "./canvas-ingress-lifecycle";
import { canvasWorkspaceIngressPath } from "./routes";

export interface CanvasIngressRequest {
  annotationId?: string;
  sourceLabel?: string;
  workId: string;
}

export interface CanvasIngressOptions {
  signal?: AbortSignal;
}

interface CanvasTargetState {
  activeWorkspaceId: string;
  request: CanvasIngressRequest;
  requestSequence: number;
  signal?: AbortSignal;
  workspaces: CanvasWorkspaceSummaryDto[];
}

export function useCanvasIngress(onError?: (message: string) => void) {
  const navigate = useNavigate();
  const [targetState, setTargetState] = useState<CanvasTargetState | null>(null);
  const requestSequenceRef = useRef(0);

  const cancelCanvasIngress = useCallback(() => {
    requestSequenceRef.current += 1;
    setTargetState(null);
  }, []);

  useEffect(
    () => () => {
      requestSequenceRef.current += 1;
    },
    [],
  );

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
    async (request: CanvasIngressRequest, options: CanvasIngressOptions = {}): Promise<void> => {
      const requestSequence = ++requestSequenceRef.current;
      setTargetState(null);
      const isCurrent = () =>
        isCanvasIngressRequestCurrent(requestSequenceRef.current, requestSequence, options.signal);
      if (!isCurrent()) return;
      try {
        const workspaces = await listCanvasWorkspaces();
        if (!isCurrent()) return;
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
          requestSequence,
          signal: options.signal,
          workspaces,
        });
      } catch (error) {
        if (isCurrent()) {
          onError?.(error instanceof Error ? error.message : "无法读取空间白板列表");
        }
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
        onCancel={cancelCanvasIngress}
        onConfirm={(workspaceId) => {
          const target = targetState;
          if (
            !target ||
            !isCanvasIngressRequestCurrent(
              requestSequenceRef.current,
              target.requestSequence,
              target.signal,
            )
          ) {
            cancelCanvasIngress();
            return;
          }
          requestSequenceRef.current += 1;
          setTargetState(null);
          navigateToTarget(workspaceId, target.request);
        }}
        onCreateWorkspace={async (name) => {
          const target = targetState;
          if (
            !target ||
            !isCanvasIngressRequestCurrent(
              requestSequenceRef.current,
              target.requestSequence,
              target.signal,
            )
          ) {
            throw new DOMException("Canvas ingress cancelled", "AbortError");
          }
          const created = await createCanvasWorkspace(name);
          if (
            !isCanvasIngressRequestCurrent(
              requestSequenceRef.current,
              target.requestSequence,
              target.signal,
            )
          ) {
            return created;
          }
          const workspaces = await listCanvasWorkspaces();
          if (
            !isCanvasIngressRequestCurrent(
              requestSequenceRef.current,
              target.requestSequence,
              target.signal,
            )
          ) {
            return created;
          }
          setTargetState((current) =>
            current?.requestSequence === target.requestSequence
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
    [cancelCanvasIngress, navigateToTarget, targetState],
  );

  return { cancelCanvasIngress, openInCanvas, targetPicker };
}
