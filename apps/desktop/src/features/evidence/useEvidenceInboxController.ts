import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { EvidenceInboxItemDto } from "@aurascholar/db/repos/evidence-inbox";
import {
  DEFAULT_EVIDENCE_FILTERS,
  toEvidenceSearchFilters,
  type EvidenceInboxFilters,
} from "./model";
import type { EvidenceInboxService, EvidenceProjectOption } from "./evidence-inbox-service";
import {
  EvidenceInboxRequestCoordinator,
  evidenceInboxViewSignature,
  shouldApplyEvidenceMutationPatch,
} from "./evidence-inbox-request-coordinator";

const PAGE_SIZE = 30;

export type EvidenceBusyAction = "assign" | "delete" | "recover" | "remove-project" | "restore";

export interface EvidenceDeleteUndo {
  item: EvidenceInboxItemDto;
}

interface EvidenceMutationLease {
  epoch: number;
  viewSignature: string;
}

export interface EvidenceInboxSnapshot {
  busy: { action: EvidenceBusyAction; evidenceId: string } | null;
  error: string | null;
  filters: EvidenceInboxFilters;
  initialLoading: boolean;
  items: EvidenceInboxItemDto[];
  libraryId: string | null;
  loadingMore: boolean;
  mutationError: string | null;
  projects: EvidenceProjectOption[];
  projectsLoading: boolean;
  refreshing: boolean;
  selectedId: string | null;
  total: number;
  undo: EvidenceDeleteUndo | null;
}

export function useEvidenceInboxController(service: EvidenceInboxService) {
  const [filters, setFiltersState] = useState<EvidenceInboxFilters>(DEFAULT_EVIDENCE_FILTERS);
  const deferredQuery = useDeferredValue(filters.query);
  const [items, setItems] = useState<EvidenceInboxItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [libraryId, setLibraryId] = useState<string | null>(null);
  const [projects, setProjects] = useState<EvidenceProjectOption[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busy, setBusy] = useState<EvidenceInboxSnapshot["busy"]>(null);
  const [undo, setUndo] = useState<EvidenceDeleteUndo | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const loadedOnceRef = useRef(false);
  const requestCoordinator = useMemo(() => new EvidenceInboxRequestCoordinator(), []);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const viewSignature = evidenceInboxViewSignature(filters);
  const filtersRef = useRef(filters);
  const viewSignatureRef = useRef(viewSignature);
  filtersRef.current = filters;
  viewSignatureRef.current = viewSignature;
  const setFilters = useCallback(
    (update: EvidenceInboxFilters | ((current: EvidenceInboxFilters) => EvidenceInboxFilters)) => {
      const current = filtersRef.current;
      const next = typeof update === "function" ? update(current) : update;
      const nextViewSignature = evidenceInboxViewSignature(next);
      if (nextViewSignature !== viewSignatureRef.current) {
        requestCoordinator.invalidatePendingReads();
        setLoadingMore(false);
      }
      filtersRef.current = next;
      viewSignatureRef.current = nextViewSignature;
      setFiltersState(next);
    },
    [requestCoordinator],
  );

  const effectiveFilters = useMemo(
    () => toEvidenceSearchFilters({ ...filters, query: deferredQuery }),
    [deferredQuery, filters.evidenceKind, filters.scope, filters.source],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestCoordinator.abortAll();
    };
  }, [requestCoordinator]);

  useEffect(() => {
    const controller = new AbortController();
    setProjectsLoading(true);
    void service
      .listProjects(controller.signal)
      .then((nextProjects) => {
        setProjects(nextProjects);
        setFilters((current) => {
          const projectId = current.scope.kind === "project" ? current.scope.projectId : null;
          if (!projectId || nextProjects.some((project) => project.id === projectId)) {
            return current;
          }
          return { ...current, scope: { kind: "inbox" } };
        });
      })
      .catch((cause) => {
        if (!isAbortError(cause)) setMutationError(describeError(cause, "研究项目列表载入失败"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setProjectsLoading(false);
      });
    return () => controller.abort();
  }, [service, setFilters]);

  useEffect(() => {
    const lease = requestCoordinator.beginBaseRequest();
    setLoadingMore(false);
    if (loadedOnceRef.current) setRefreshing(true);
    else setInitialLoading(true);
    setError(null);
    void service
      .search({ ...effectiveFilters, limit: PAGE_SIZE, offset: 0 }, lease.controller.signal)
      .then((result) => {
        if (!requestCoordinator.isCurrentBase(lease)) return;
        loadedOnceRef.current = true;
        setItems(result.items);
        setTotal(result.total);
        setLibraryId(result.libraryId);
        setSelectedId((current) =>
          current && result.items.some((item) => item.evidence.id === current)
            ? current
            : (result.items[0]?.evidence.id ?? null),
        );
      })
      .catch((cause) => {
        if (!isAbortError(cause) && requestCoordinator.isCurrentBase(lease)) {
          setError(describeError(cause, "证据载入失败，请重试"));
        }
      })
      .finally(() => {
        if (requestCoordinator.settleBase(lease) && mountedRef.current) {
          setInitialLoading(false);
          setRefreshing(false);
        }
      });
    return () => lease.controller.abort();
  }, [effectiveFilters, requestCoordinator, retryVersion, service]);

  const loadMore = useCallback(async () => {
    if (busyRef.current || initialLoading || refreshing || loadingMore || items.length >= total)
      return;
    const lease = requestCoordinator.beginLoadMoreRequest();
    setLoadingMore(true);
    setError(null);
    try {
      const result = await service.search(
        {
          ...effectiveFilters,
          limit: PAGE_SIZE,
          offset: items.length,
        },
        lease.controller.signal,
      );
      if (!requestCoordinator.isCurrentLoadMore(lease)) return;
      setItems((current) => mergeEvidence(current, result.items));
      setTotal(result.total);
      setLibraryId(result.libraryId);
    } catch (cause) {
      if (
        !isAbortError(cause) &&
        mountedRef.current &&
        requestCoordinator.isCurrentLoadMore(lease)
      ) {
        setError(describeError(cause, "更多证据载入失败，请重试"));
      }
    } finally {
      if (requestCoordinator.settleLoadMore(lease) && mountedRef.current) setLoadingMore(false);
    }
  }, [
    effectiveFilters,
    initialLoading,
    items.length,
    loadingMore,
    refreshing,
    requestCoordinator,
    service,
    total,
  ]);

  const beginMutation = useCallback(
    (action: EvidenceBusyAction, evidenceId: string): EvidenceMutationLease | null => {
      if (busyRef.current) return null;
      busyRef.current = true;
      const epoch = requestCoordinator.invalidatePendingReads();
      setLoadingMore(false);
      setBusy({ action, evidenceId });
      return { epoch, viewSignature: viewSignatureRef.current };
    },
    [requestCoordinator],
  );

  const completeMutationAndRefetch = useCallback(
    (mutation: EvidenceMutationLease): boolean => {
      const applyOptimisticPatch = shouldApplyEvidenceMutationPatch({
        currentEpoch: requestCoordinator.getCurrentEpoch(),
        currentViewSignature: viewSignatureRef.current,
        startedEpoch: mutation.epoch,
        startedViewSignature: mutation.viewSignature,
      });
      requestCoordinator.invalidatePendingReads();
      setLoadingMore(false);
      if (loadedOnceRef.current) setRefreshing(true);
      else setInitialLoading(true);
      setRetryVersion((value) => value + 1);
      return applyOptimisticPatch;
    },
    [requestCoordinator],
  );

  const addToProject = useCallback(
    async (item: EvidenceInboxItemDto, projectId: string) => {
      if (!libraryId) return false;
      const mutation = beginMutation("assign", item.evidence.id);
      if (!mutation) return false;
      setMutationError(null);
      try {
        await service.addToProject(libraryId, item.evidence.id, projectId);
        if (!mountedRef.current) return true;
        const applyOptimisticPatch = completeMutationAndRefetch(mutation);
        if (!applyOptimisticPatch) return true;
        const project = projects.find((candidate) => candidate.id === projectId);
        if (filters.scope.kind === "inbox") {
          setItems((current) =>
            current.filter((candidate) => candidate.evidence.id !== item.evidence.id),
          );
          setTotal((current) => Math.max(0, current - 1));
          setSelectedId((current) =>
            current === item.evidence.id ? nextEvidenceId(items, item.evidence.id) : current,
          );
        } else if (project) {
          setItems((current) =>
            current.map((candidate) =>
              candidate.evidence.id !== item.evidence.id ||
              candidate.projectMemberships.some((membership) => membership.projectId === projectId)
                ? candidate
                : {
                    ...candidate,
                    projectMemberships: [
                      ...candidate.projectMemberships,
                      { projectId, projectName: project.name },
                    ],
                  },
            ),
          );
        }
        return true;
      } catch (cause) {
        if (mountedRef.current) {
          completeMutationAndRefetch(mutation);
          setMutationError(describeError(cause, "加入研究项目失败，请重试"));
        }
        return false;
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setBusy(null);
      }
    },
    [
      beginMutation,
      completeMutationAndRefetch,
      filters.scope.kind,
      items,
      libraryId,
      projects,
      service,
    ],
  );

  const removeFromCurrentProject = useCallback(
    async (item: EvidenceInboxItemDto) => {
      if (!libraryId || filters.scope.kind !== "project") return false;
      const projectId = filters.scope.projectId;
      const mutation = beginMutation("remove-project", item.evidence.id);
      if (!mutation) return false;
      setMutationError(null);
      try {
        await service.removeFromProject(libraryId, item.evidence.id, projectId);
        if (!mountedRef.current) return true;
        if (!completeMutationAndRefetch(mutation)) return true;
        setItems((current) =>
          current.filter((candidate) => candidate.evidence.id !== item.evidence.id),
        );
        setTotal((current) => Math.max(0, current - 1));
        setSelectedId((current) =>
          current === item.evidence.id ? nextEvidenceId(items, item.evidence.id) : current,
        );
        return true;
      } catch (cause) {
        if (mountedRef.current) {
          completeMutationAndRefetch(mutation);
          setMutationError(describeError(cause, "移出研究项目失败，请重试"));
        }
        return false;
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setBusy(null);
      }
    },
    [beginMutation, completeMutationAndRefetch, filters.scope, items, libraryId, service],
  );

  const softDelete = useCallback(
    async (item: EvidenceInboxItemDto) => {
      if (!libraryId) return false;
      const mutation = beginMutation("delete", item.evidence.id);
      if (!mutation) return false;
      setMutationError(null);
      try {
        const removed = await service.softDelete(
          libraryId,
          item.evidence.id,
          item.evidence.updatedAt,
        );
        if (!mountedRef.current) return true;
        const applyOptimisticPatch = completeMutationAndRefetch(mutation);
        setUndo({ item: { ...item, evidence: removed } });
        if (!applyOptimisticPatch) return true;
        setItems((current) =>
          current.filter((candidate) => candidate.evidence.id !== item.evidence.id),
        );
        setTotal((current) => Math.max(0, current - 1));
        setSelectedId((current) =>
          current === item.evidence.id ? nextEvidenceId(items, item.evidence.id) : current,
        );
        return true;
      } catch (cause) {
        if (mountedRef.current) {
          completeMutationAndRefetch(mutation);
          setMutationError(describeError(cause, "移除 Evidence 失败，请重试"));
        }
        return false;
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setBusy(null);
      }
    },
    [beginMutation, completeMutationAndRefetch, items, libraryId, service],
  );

  const restoreDeleted = useCallback(async () => {
    if (!libraryId || !undo) return false;
    const mutation = beginMutation("restore", undo.item.evidence.id);
    if (!mutation) return false;
    setMutationError(null);
    try {
      await service.restore(libraryId, undo.item.evidence.id, undo.item.evidence.updatedAt);
      if (!mountedRef.current) return true;
      const applyOptimisticPatch = completeMutationAndRefetch(mutation);
      if (applyOptimisticPatch) setSelectedId(undo.item.evidence.id);
      setUndo(null);
      return true;
    } catch (cause) {
      if (mountedRef.current) {
        completeMutationAndRefetch(mutation);
        setMutationError(describeError(cause, "撤销移除失败，请重试"));
      }
      return false;
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
  }, [beginMutation, completeMutationAndRefetch, libraryId, service, undo]);

  const recoverSource = useCallback(
    async (item: EvidenceInboxItemDto, file: File) => {
      if (!libraryId) return false;
      const mutation = beginMutation("recover", item.evidence.id);
      if (!mutation) return false;
      setMutationError(null);
      try {
        await service.recoverSource(libraryId, item.evidence.id, file);
        if (!mountedRef.current) return true;
        completeMutationAndRefetch(mutation);
        return true;
      } catch (cause) {
        if (mountedRef.current) {
          completeMutationAndRefetch(mutation);
          setMutationError(describeError(cause, "原始来源恢复失败，请确认文件版本"));
        }
        return false;
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setBusy(null);
      }
    },
    [beginMutation, completeMutationAndRefetch, libraryId, service],
  );

  const snapshot: EvidenceInboxSnapshot = {
    busy,
    error,
    filters,
    initialLoading,
    items,
    libraryId,
    loadingMore,
    mutationError,
    projects,
    projectsLoading,
    refreshing,
    selectedId,
    total,
    undo,
  };

  return {
    addToProject,
    clearMutationError: () => setMutationError(null),
    clearUndo: () => setUndo(null),
    loadMore,
    recoverSource,
    removeFromCurrentProject,
    restoreDeleted,
    retry: () => setRetryVersion((value) => value + 1),
    setFilters,
    setSelectedId,
    snapshot,
    softDelete,
  };
}

function mergeEvidence(
  current: EvidenceInboxItemDto[],
  incoming: EvidenceInboxItemDto[],
): EvidenceInboxItemDto[] {
  const ids = new Set(current.map((item) => item.evidence.id));
  return [...current, ...incoming.filter((item) => !ids.has(item.evidence.id))];
}

function nextEvidenceId(items: EvidenceInboxItemDto[], removedId: string): string | null {
  return items.find((item) => item.evidence.id !== removedId)?.evidence.id ?? null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
