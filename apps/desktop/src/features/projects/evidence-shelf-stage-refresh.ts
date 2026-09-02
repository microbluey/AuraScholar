export interface EvidenceShelfStageScope<TService = unknown> {
  previewMode: boolean;
  projectId: string;
  service: TService;
}

/**
 * A stage completion may arrive after the workspace has moved to another
 * project or runtime. Only the scope that dispatched the write may refresh.
 */
export function isEvidenceShelfStageScopeCurrent<TService>(
  expected: EvidenceShelfStageScope<TService>,
  current: EvidenceShelfStageScope<TService> | null,
): boolean {
  return (
    current !== null &&
    expected.previewMode === current.previewMode &&
    expected.projectId === current.projectId &&
    expected.service === current.service
  );
}

interface StageEvidenceShelfWithAbortRefreshRequest<TService, TResult> {
  currentScope: () => EvidenceShelfStageScope<TService> | null;
  expectedScope: EvidenceShelfStageScope<TService>;
  refresh: () => void;
  signal: AbortSignal;
  stage: () => Promise<TResult>;
}

/**
 * Runs a Shelf stage while preserving the post-IPC cancellation invariant.
 *
 * The renderer adapter checks its signal after the IPC promise resolves. The
 * main-process transaction can already have committed by then, so an
 * AbortError does not prove that no Shelf row was written. A guarded refresh
 * keeps that row visible without allowing an old project scope to mutate the
 * current workspace.
 */
export async function stageEvidenceShelfWithAbortRefresh<TService, TResult>({
  currentScope,
  expectedScope,
  refresh,
  signal,
  stage,
}: StageEvidenceShelfWithAbortRefreshRequest<TService, TResult>): Promise<TResult> {
  signal.throwIfAborted();
  let refreshIssued = false;
  const refreshIfCurrent = () => {
    if (refreshIssued || !isEvidenceShelfStageScopeCurrent(expectedScope, currentScope())) return;
    refreshIssued = true;
    refresh();
  };

  try {
    const result = await stage();
    // Refresh before checking the signal: stage() may have committed and then
    // rejected at its own post-IPC abort check.
    refreshIfCurrent();
    signal.throwIfAborted();
    return result;
  } catch (cause) {
    // Covers adapters that reject after their command has committed. The
    // guard makes this harmless when the workspace has since changed scope.
    if (signal.aborted) refreshIfCurrent();
    throw cause;
  }
}
