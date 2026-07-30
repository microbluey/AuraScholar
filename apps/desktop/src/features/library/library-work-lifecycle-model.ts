declare const mutationLeaseTokenBrand: unique symbol;

export type MutationLeaseToken = symbol & {
  readonly [mutationLeaseTokenBrand]: true;
};

export interface MutationLeaseGrant<Action> {
  readonly action: Action;
  readonly token: MutationLeaseToken;
}

/**
 * A synchronous, single-owner guard for UI mutations.
 *
 * Acquisition records the owner before returning, so duplicate handlers fired
 * in the same event-loop tick cannot both start a mutation. Releasing requires
 * the exact grant; a stale completion cannot unlock a newer operation.
 */
export class MutationLease<Action> {
  private activeGrant: MutationLeaseGrant<Action> | null = null;

  tryAcquire(action: Action): MutationLeaseGrant<Action> | null {
    if (this.activeGrant) return null;

    const grant = Object.freeze({
      action,
      token: Symbol("library-mutation") as MutationLeaseToken,
    });
    this.activeGrant = grant;
    return grant;
  }

  release(grant: MutationLeaseGrant<Action>): boolean {
    const activeGrant = this.activeGrant;
    if (
      !activeGrant ||
      activeGrant.token !== grant.token ||
      !Object.is(activeGrant.action, grant.action)
    ) {
      return false;
    }

    this.activeGrant = null;
    return true;
  }

  get current(): MutationLeaseGrant<Action> | null {
    return this.activeGrant;
  }
}

export interface LibraryTrashUndoState {
  count: number;
  ids: string[];
  message: string;
}

/**
 * Limits a selection to rows that are currently actionable.
 *
 * Iterating the visible IDs (rather than the selection) preserves the current
 * view order and prevents stale or hidden selections from reaching a mutation.
 */
export function scopeSelectedIds(
  selectedIds: Iterable<string>,
  visibleWorkIds: Iterable<string>,
): string[] {
  const selected = new Set(selectedIds);
  const scoped: string[] = [];
  const seen = new Set<string>();

  for (const workId of visibleWorkIds) {
    if (!selected.has(workId) || seen.has(workId)) continue;
    seen.add(workId);
    scoped.push(workId);
  }

  return scoped;
}

/**
 * Removes only committed work IDs from the active trash undo.
 *
 * An unrelated undo is returned by identity. A partially consumed undo keeps
 * its original ordering and wording while updating any "<count> 篇" phrase to
 * reflect the remaining actionable records.
 */
export function reconcileTrashUndo(
  undo: LibraryTrashUndoState | null,
  committedIds: Iterable<string>,
): LibraryTrashUndoState | null {
  if (!undo) return null;

  const committed = new Set(committedIds);
  if (committed.size === 0 || !undo.ids.some((workId) => committed.has(workId))) {
    return undo;
  }

  const remainingIds = undo.ids.filter((workId) => !committed.has(workId));

  if (remainingIds.length === 0) return null;

  const countPhrase = new RegExp(`(^|\\D)${undo.count}(?=\\s*篇)`);
  const message = undo.message.replace(
    countPhrase,
    (match, prefix: string) => `${prefix}${remainingIds.length}`,
  );

  return {
    count: remainingIds.length,
    ids: remainingIds,
    message,
  };
}
