import type { EvidenceShelfItem } from "../../services/evidence-shelf";

export interface EvidenceShelfPromotionReconcileScope<TService = unknown> {
  enabled: boolean;
  generation: number;
  projectId: string;
  refreshToken: string | number;
  service: TService;
}

interface ReconcileAfterAbortRequest<
  TService,
  TSelection extends {
    item: EvidenceShelfItem;
    projectId: string;
    refreshToken: string | number;
    service: TService;
  },
> {
  expectedScope: EvidenceShelfPromotionReconcileScope<TService>;
  currentScope: () => EvidenceShelfPromotionReconcileScope<TService>;
  itemId: string;
  list: () => Promise<EvidenceShelfItem[]>;
  updateItems: (items: EvidenceShelfItem[]) => void;
  setSelection: (updater: (current: TSelection | null) => TSelection | null) => void;
  selectionScope: Pick<TSelection, "projectId" | "refreshToken" | "service">;
  setError: (error: string) => void;
  setNotice: (notice: string) => void;
}

/** Guards a late reconciliation from clobbering a newer action or scope. */
export function isEvidenceShelfPromotionReconcileCurrent<TService>(
  expected: EvidenceShelfPromotionReconcileScope<TService>,
  current: EvidenceShelfPromotionReconcileScope<TService>,
): boolean {
  return (
    expected.enabled &&
    expected.generation === current.generation &&
    expected.enabled === current.enabled &&
    expected.projectId === current.projectId &&
    Object.is(expected.refreshToken, current.refreshToken) &&
    expected.service === current.service
  );
}

/** Performs the uncancelled, project-scoped read for a dispatched promotion. */
export async function reconcileEvidenceShelfPromotionAfterAbort<
  TService,
  TSelection extends {
    item: EvidenceShelfItem;
    projectId: string;
    refreshToken: string | number;
    service: TService;
  },
>({
  expectedScope,
  currentScope,
  itemId,
  list,
  updateItems,
  setSelection,
  selectionScope,
  setError,
  setNotice,
}: ReconcileAfterAbortRequest<TService, TSelection>): Promise<void> {
  if (!isEvidenceShelfPromotionReconcileCurrent(expectedScope, currentScope())) return;
  let freshItems: EvidenceShelfItem[];
  try {
    freshItems = await list();
  } catch {
    if (isEvidenceShelfPromotionReconcileCurrent(expectedScope, currentScope())) {
      setError("Evidence 保存结果待确认，请刷新 Shelf 后重试");
    }
    return;
  }
  if (!isEvidenceShelfPromotionReconcileCurrent(expectedScope, currentScope())) return;
  const reconciled = reconcileEvidenceShelfPromotion(freshItems, itemId);
  if (!isEvidenceShelfPromotionReconcileCurrent(expectedScope, currentScope())) return;
  updateItems(reconciled.items);
  if (!isEvidenceShelfPromotionReconcileCurrent(expectedScope, currentScope())) return;
  setSelection((current) => {
    if (!isEvidenceShelfPromotionReconcileCurrent(expectedScope, currentScope())) return current;
    if (
      !current ||
      current.item.id !== itemId ||
      current.projectId !== selectionScope.projectId ||
      !Object.is(current.refreshToken, selectionScope.refreshToken) ||
      current.service !== selectionScope.service
    )
      return current;
    return reconciled.selection ? { ...current, item: reconciled.selection } : null;
  });
  if (!isEvidenceShelfPromotionReconcileCurrent(expectedScope, currentScope())) return;
  if (!reconciled.selection) setNotice("已核验并保存为 Evidence");
}

/**
 * Reconcile a promotion whose IPC response arrived after its AbortSignal.
 *
 * The fresh project-scoped list is authoritative: a missing row means that
 * the durable promotion committed, while a present row must be kept (and
 * handed back to the dialog) with its latest optimistic-CAS metadata.
 */
export function reconcileEvidenceShelfPromotion(
  freshItems: readonly EvidenceShelfItem[],
  itemId: string,
): { items: EvidenceShelfItem[]; selection: EvidenceShelfItem | null } {
  const items = [...freshItems];
  return {
    items,
    selection: items.find((item) => item.id === itemId) ?? null,
  };
}
