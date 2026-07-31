import { useCallback, useEffect, useReducer, useRef } from "react";
import { newId } from "@aurascholar/db/ids";
import type { IngestDraft } from "../../services/library-types";

export interface DraftQueueEntry {
  draft: IngestDraft;
  id: string;
}

type DraftQueueAction =
  | { type: "enqueue"; entry: DraftQueueEntry }
  | { type: "dismiss"; draft: IngestDraft }
  | { type: "remove"; draft: IngestDraft };

export function ingestDraftQueueReducer(
  current: DraftQueueEntry[],
  action: DraftQueueAction,
): DraftQueueEntry[] {
  if (action.type === "enqueue") {
    return current.some((entry) => entry.draft === action.entry.draft)
      ? current
      : [...current, action.entry];
  }
  if (action.type === "dismiss") {
    return current[0]?.draft === action.draft ? current.slice(1) : current;
  }
  return current.filter((entry) => entry.draft !== action.draft);
}

/** Serializes confirmation cards so a later download cannot replace an active edit. */
export function useIngestDraftQueue() {
  const [entries, dispatch] = useReducer(ingestDraftQueueReducer, []);
  const entriesRef = useRef(entries);
  const mountedRef = useRef(true);
  const apply = useCallback((action: DraftQueueAction) => {
    if (!mountedRef.current) return false;
    entriesRef.current = ingestDraftQueueReducer(entriesRef.current, action);
    dispatch(action);
    return true;
  }, []);
  const enqueue = useCallback((draft: IngestDraft) => {
    if (!apply({ type: "enqueue", entry: { draft, id: newId() } })) {
      void import("../../services/library-actions")
        .then(({ discardStagedPdf }) => discardStagedPdf(draft.pdf))
        .catch(() => {});
      return false;
    }
    return true;
  }, [apply]);
  const dismiss = useCallback((draft: IngestDraft | null) => {
    if (!draft) return;
    apply({ type: "dismiss", draft });
  }, [apply]);
  const remove = useCallback((draft: IngestDraft) => {
    apply({ type: "remove", draft });
  }, [apply]);
  const snapshot = useCallback(() => entriesRef.current, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const abandoned = entriesRef.current;
      entriesRef.current = [];
      void import("../../services/library-actions")
        .then(({ discardStagedPdf }) =>
          Promise.all(abandoned.map((entry) => discardStagedPdf(entry.draft.pdf))),
        )
        .catch(() => {});
    };
  }, []);
  return {
    activeDraft: entries[0]?.draft ?? null,
    activeKey: entries[0]?.id ?? null,
    dismiss,
    enqueue,
    pendingCount: Math.max(0, entries.length - 1),
    remove,
    snapshot,
  };
}
