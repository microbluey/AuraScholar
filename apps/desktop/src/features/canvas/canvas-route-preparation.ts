export type CanvasEditorPreparationDecision = "cancel" | "ready";
export type CanvasEditorPreparationReason = "app-exit" | "navigation";
export type CanvasEditorPreparationPlan = "cancel" | "prompt" | "ready" | "save";

export interface CanvasEditorPreparationContext {
  reason: CanvasEditorPreparationReason;
}

export type CanvasEditorPreparer = (
  context: CanvasEditorPreparationContext,
) => CanvasEditorPreparationDecision | Promise<CanvasEditorPreparationDecision>;

interface RegisteredCanvasEditorPreparer {
  order: number;
  prepare: CanvasEditorPreparer;
}

interface StableCanvasNavigationPreparation {
  flush: () => Promise<void>;
  getRevision?: () => number;
  maxPasses?: number;
  prepareEditors?: () => Promise<CanvasEditorPreparationDecision>;
}

export interface CanvasBlockedNavigation {
  proceed: () => void;
  reset: () => void;
  state: "blocked";
}

interface SettleLatestCanvasBlockedNavigation {
  getLatest: () => CanvasBlockedNavigation | null;
  onCancel?: () => void;
  onError?: (error: unknown) => void;
  prepare: () => Promise<CanvasEditorPreparationDecision>;
}

const preparers = new Set<RegisteredCanvasEditorPreparer>();
let nextOrder = 0;
let revision = 0;

export function registerCanvasEditorPreparer(prepare: CanvasEditorPreparer): () => void {
  const registered = { order: nextOrder, prepare };
  nextOrder += 1;
  preparers.add(registered);
  revision += 1;
  return () => {
    if (!preparers.delete(registered)) return;
    revision += 1;
  };
}

export function hasCanvasEditorPreparers(): boolean {
  return preparers.size > 0;
}

export function canvasEditorPreparationRevision(): number {
  return revision;
}

export async function prepareCanvasEditors(
  context: CanvasEditorPreparationContext,
): Promise<CanvasEditorPreparationDecision> {
  const snapshot = [...preparers].sort((left, right) => left.order - right.order);
  for (const { prepare } of snapshot) {
    try {
      if ((await prepare(context)) === "cancel") return "cancel";
    } catch {
      return "cancel";
    }
  }
  return "ready";
}

export function planCanvasEditorPreparation({
  composing,
  conflict,
  dirty,
  reason,
  saving,
}: {
  composing: boolean;
  conflict: boolean;
  dirty: boolean;
  reason: CanvasEditorPreparationReason;
  saving: boolean;
}): CanvasEditorPreparationPlan {
  if (composing) return "cancel";
  if (conflict) return reason === "navigation" ? "prompt" : "cancel";
  if (!dirty) return "ready";
  if (saving) return "cancel";
  if (reason === "navigation") return "prompt";
  return "save";
}

/**
 * Repeats editor preparation and persistence until no editor mounted or
 * unmounted during the asynchronous flush.
 */
export async function prepareStableCanvasNavigation({
  flush,
  getRevision = canvasEditorPreparationRevision,
  maxPasses = 16,
  prepareEditors = () => prepareCanvasEditors({ reason: "navigation" }),
}: StableCanvasNavigationPreparation): Promise<CanvasEditorPreparationDecision> {
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const startingRevision = getRevision();
    if ((await prepareEditors()) === "cancel") return "cancel";
    await flush();
    if (getRevision() === startingRevision) return "ready";
  }
  return "cancel";
}

/**
 * Settles whichever router transition is blocked when preparation completes.
 * Reading the blocker at settlement time makes rapid Back/Forward input
 * latest-intent-wins without ever releasing a stale location.
 */
export async function settleLatestCanvasBlockedNavigation({
  getLatest,
  onCancel,
  onError,
  prepare,
}: SettleLatestCanvasBlockedNavigation): Promise<void> {
  let decision: CanvasEditorPreparationDecision;
  try {
    decision = await prepare();
  } catch (error) {
    const latest = getLatest();
    if (!latest) return;
    onError?.(error);
    latest.reset();
    return;
  }

  const latest = getLatest();
  if (!latest) return;
  if (decision === "ready") {
    latest.proceed();
    return;
  }
  onCancel?.();
  latest.reset();
}
