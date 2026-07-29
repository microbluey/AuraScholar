import { type CanvasWorkspaceDocument } from "@aurascholar/core";
import type { CanvasWorkspaceSummary } from "@aurascholar/db/repos/canvas";
import { CircleNotch, Warning } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useBlocker,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
  type BlockerFunction,
} from "react-router-dom";
import "@xyflow/react/dist/style.css";
import "katex/dist/katex.min.css";
import { useConfirmDialog } from "../components/ConfirmDialog";
import { CanvasWorkspace, type CanvasNodeFocusRequest } from "../features/canvas/CanvasWorkspace";
import type { CanvasCitationPaperIdentity } from "../features/canvas/canvas-citation";
import {
  resolveCanvasCitationRelations,
  type CanvasCitationResolution,
} from "../features/canvas/canvas-citation-resolver";
import {
  beginCanvasHistoryTransaction,
  canvasHistoryContentChanged,
  reconcileCanvasHistory,
  recordCanvasHistory,
  redoCanvasHistory,
  rollbackCanvasHistoryTransaction,
  sealCanvasHistory,
  undoCanvasHistory,
  type CanvasDocumentChangeOptions,
  type CanvasHistoryMutation,
  type CanvasHistoryState,
  type CanvasHistoryTransaction,
} from "../features/canvas/canvas-history";
import { clearCanvasNoteDraftsForWorkspace } from "../features/canvas/canvas-note-draft";
import {
  hasCanvasEditorPreparers,
  prepareCanvasEditors,
  prepareStableCanvasNavigation,
  settleLatestCanvasBlockedNavigation,
} from "../features/canvas/canvas-route-preparation";
import {
  applyCanvasAnnotationIngress,
  nextCanvasIngressPosition,
} from "../features/canvas/canvas-annotation-ingress";
import {
  PREVIEW_LIBRARY_WORKS,
  createPaperNode,
  type CanvasLibraryWork,
} from "../features/canvas/model";
import {
  createCanvasWorkspace,
  deleteCanvasWorkspace,
  listCanvasWorkspaces,
  loadCanvasWorkspace,
  readLastCanvasWorkspaceId,
  rememberLastCanvasWorkspaceId,
  renameCanvasWorkspace,
  saveCanvasWorkspace,
} from "../features/canvas/persistence";
import { canvasWorkspacePath, canvasWorkspaceRedirectPath } from "../features/canvas/routes";
import { setCanvasSynthesisService } from "../features/canvas/synthesis";
import {
  flushCanvasWorkspaceCollection,
  flushLatestCanvasWorkspace,
  persistCurrentCanvasWorkspaceSnapshot,
  waitForCanvasWorkspaceLoad,
} from "../features/canvas/workspace-load";
import {
  mergeRenamedCanvasWorkspace,
  planCanvasWorkspaceDeletion,
} from "../features/canvas/workspace-controls";
import { libraryReaderRowToAnnotation } from "../features/reader/library-reader-session";
import {
  loadCanvasActiveWork,
  loadCanvasAnnotationIngressSource,
} from "../services/canvas-page-data";
import { registerExitBarrier } from "../services/exit-barriers";
import { synthesizeCanvasSelection as desktopSynthesizeCanvasSelection } from "../services/canvas-ai";
import { isDesktopRuntime } from "../services/aura-platform";
import {
  listWorks,
  parseWorkMetadataSearch,
  searchWorksByMetadata,
} from "../services/library-list";
import "../features/canvas/canvas.css";

function canvasLibraryWork(
  row: Awaited<ReturnType<typeof listWorks>>[number] & { tagNames?: string[] },
): CanvasLibraryWork {
  return {
    id: row.id,
    title: row.title,
    abstract: row.abstract,
    authorNames: row.authorNames,
    year: row.year,
    venue: row.venue_name,
    doi: row.doi,
    readingStatus: row.reading_status,
    tags: row.tagNames ?? [],
  };
}

export function SpatialCanvasIndexPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [loadError, setLoadError] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void listCanvasWorkspaces()
      .then((workspaces) => {
        if (cancelled) return;
        const rememberedId = readLastCanvasWorkspaceId();
        const target =
          workspaces.find((workspace) => workspace.workspaceId === rememberedId) ?? workspaces[0];
        if (!target) throw new Error("没有可打开的白板");
        navigate(canvasWorkspaceRedirectPath(target.workspaceId, location.search), {
          replace: true,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "无法定位最近使用的白板");
      });
    return () => {
      cancelled = true;
    };
  }, [location.search, navigate, reloadNonce]);

  if (loadError) {
    return (
      <main className="spatial-canvas-page spatial-canvas-page--state">
        <div className="canvas-page-state" role="alert">
          <Warning size={30} weight="duotone" />
          <h1>无法打开空间白板</h1>
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setLoadError("");
              setReloadNonce((value) => value + 1);
            }}
          >
            重新载入
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="spatial-canvas-page spatial-canvas-page--state" aria-busy="true">
      <div className="canvas-page-state" role="status">
        <CircleNotch className="canvas-page-state__spinner" size={30} weight="bold" />
        <h1>正在打开最近使用的白板</h1>
        <p>恢复上次的研究上下文。</p>
      </div>
    </main>
  );
}

export function SpatialCanvasPage() {
  const navigate = useNavigate();
  const { workspaceId: routeWorkspaceIdParam = "" } = useParams<{ workspaceId: string }>();
  const routeWorkspaceId = routeWorkspaceIdParam.trim();
  const [searchParams] = useSearchParams();
  const requestedWorkId = searchParams.get("workId")?.trim() || "";
  const requestedAnnotationId = searchParams.get("annotationId")?.trim() || "";
  const desktopRuntime = isDesktopRuntime();
  const [document, setDocument] = useState<CanvasWorkspaceDocument | null>(null);
  const [workspaces, setWorkspaces] = useState<CanvasWorkspaceSummary[]>([]);
  const [works, setWorks] = useState<CanvasLibraryWork[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [documentTransactionEpoch, setDocumentTransactionEpoch] = useState(0);
  const [persistenceLabel, setPersistenceLabel] = useState("正在载入…");
  const [focusRequest, setFocusRequest] = useState<CanvasNodeFocusRequest | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();
  const activeDocumentRef = useRef<CanvasWorkspaceDocument | null>(null);
  const latestDocumentsRef = useRef(new Map<string, CanvasWorkspaceDocument>());
  const lastPersistedRef = useRef(new Map<string, string>());
  const pendingSaveRef = useRef(new Map<string, number>());
  const saveChainsRef = useRef(new Map<string, Promise<void>>());
  const flushRequestsRef = useRef(new Map<string, Promise<void>>());
  const retiredWorkspaceIdsRef = useRef(new Set<string>());
  const exitPreparationRequestIdRef = useRef<string | null>(null);
  const navigationPreparationRef = useRef<Promise<"cancel" | "ready"> | null>(null);
  const blockedNavigationRequestRef = useRef(0);
  const loadRequestRef = useRef(0);
  const focusRequestSequenceRef = useRef(0);
  const inFlightIngressRef = useRef(new Set<string>());
  const historyByWorkspaceRef = useRef(new Map<string, CanvasHistoryState>());
  const activeDocumentTransactionRef = useRef<CanvasHistoryTransaction | null>(null);
  const [historyStatus, setHistoryStatus] = useState({
    workspaceId: "",
    canUndo: false,
    canRedo: false,
  });

  const refreshHistoryStatus = useCallback((targetWorkspaceId: string) => {
    const history = historyByWorkspaceRef.current.get(targetWorkspaceId);
    const next = {
      workspaceId: targetWorkspaceId,
      canUndo: Boolean(history?.past.length),
      canRedo: Boolean(history?.future.length),
    };
    setHistoryStatus((current) =>
      current.workspaceId === next.workspaceId &&
      current.canUndo === next.canUndo &&
      current.canRedo === next.canRedo
        ? current
        : next,
    );
  }, []);

  const applyActiveDocumentUpdate = useCallback(
    (
      sourceWorkspaceId: string,
      updater: (current: CanvasWorkspaceDocument) => CanvasWorkspaceDocument,
      options: CanvasDocumentChangeOptions = {},
    ): boolean => {
      if (exitPreparationRequestIdRef.current !== null) return false;
      if (retiredWorkspaceIdsRef.current.has(sourceWorkspaceId)) return false;
      if (activeDocumentTransactionRef.current?.afterDocument.workspaceId === sourceWorkspaceId) {
        return false;
      }
      const current = activeDocumentRef.current;
      if (!current || current.workspaceId !== sourceWorkspaceId) return false;
      const next = updater(current);
      if (next === current || next.workspaceId !== sourceWorkspaceId) return false;

      if (options.history !== false && canvasHistoryContentChanged(current, next)) {
        const mutation = options.history ?? { label: "编辑白板" };
        const history = recordCanvasHistory(
          historyByWorkspaceRef.current.get(sourceWorkspaceId),
          current,
          next,
          mutation,
        );
        historyByWorkspaceRef.current.set(sourceWorkspaceId, history);
        refreshHistoryStatus(sourceWorkspaceId);
      }

      activeDocumentRef.current = next;
      latestDocumentsRef.current.set(sourceWorkspaceId, next);
      setDocument(next);
      return true;
    },
    [refreshHistoryStatus],
  );

  const runHistoryCommand = useCallback(
    (command: "undo" | "redo"): string | null => {
      if (exitPreparationRequestIdRef.current !== null) return null;
      const current = activeDocumentRef.current;
      if (!current || retiredWorkspaceIdsRef.current.has(current.workspaceId)) return null;
      if (activeDocumentTransactionRef.current?.afterDocument.workspaceId === current.workspaceId) {
        return null;
      }
      const history = reconcileCanvasHistory(
        historyByWorkspaceRef.current.get(current.workspaceId),
        current,
      );
      const result =
        command === "undo"
          ? undoCanvasHistory(history, current)
          : redoCanvasHistory(history, current);
      if (!result) {
        historyByWorkspaceRef.current.set(current.workspaceId, history);
        refreshHistoryStatus(current.workspaceId);
        return null;
      }
      historyByWorkspaceRef.current.set(current.workspaceId, result.history);
      activeDocumentRef.current = result.document;
      latestDocumentsRef.current.set(current.workspaceId, result.document);
      setDocument(result.document);
      refreshHistoryStatus(current.workspaceId);
      return result.label;
    },
    [refreshHistoryStatus],
  );

  const applyActiveDocumentTransaction = useCallback(
    (
      sourceWorkspaceId: string,
      updater: (current: CanvasWorkspaceDocument) => CanvasWorkspaceDocument,
      mutation: CanvasHistoryMutation,
    ) => {
      if (exitPreparationRequestIdRef.current !== null) return null;
      if (retiredWorkspaceIdsRef.current.has(sourceWorkspaceId)) return null;
      if (activeDocumentTransactionRef.current !== null) return null;
      const current = activeDocumentRef.current;
      if (!current || current.workspaceId !== sourceWorkspaceId) return null;
      const next = updater(current);
      if (
        next === current ||
        next.workspaceId !== sourceWorkspaceId ||
        !canvasHistoryContentChanged(current, next)
      ) {
        return null;
      }
      const transaction = beginCanvasHistoryTransaction(
        historyByWorkspaceRef.current.get(sourceWorkspaceId),
        current,
        next,
        mutation,
      );
      if (!transaction) return null;

      activeDocumentTransactionRef.current = transaction;
      historyByWorkspaceRef.current.set(sourceWorkspaceId, transaction.afterHistory);
      activeDocumentRef.current = next;
      latestDocumentsRef.current.set(sourceWorkspaceId, next);
      setDocument(next);
      refreshHistoryStatus(sourceWorkspaceId);

      return {
        commit: (): boolean => {
          if (activeDocumentTransactionRef.current !== transaction) return false;
          activeDocumentTransactionRef.current = null;
          setDocumentTransactionEpoch((value) => value + 1);
          return (
            activeDocumentRef.current?.workspaceId === sourceWorkspaceId &&
            historyByWorkspaceRef.current.get(sourceWorkspaceId) === transaction.afterHistory
          );
        },
        rollback: (
          rollbackUpdater: (currentDocument: CanvasWorkspaceDocument) => CanvasWorkspaceDocument,
        ): boolean => {
          if (
            retiredWorkspaceIdsRef.current.has(sourceWorkspaceId) ||
            activeDocumentTransactionRef.current !== transaction
          ) {
            if (activeDocumentTransactionRef.current === transaction) {
              activeDocumentTransactionRef.current = null;
              setDocumentTransactionEpoch((value) => value + 1);
            }
            return false;
          }
          const liveDocument = activeDocumentRef.current;
          if (!liveDocument || liveDocument.workspaceId !== sourceWorkspaceId) {
            activeDocumentTransactionRef.current = null;
            setDocumentTransactionEpoch((value) => value + 1);
            return false;
          }
          const restoredDocument = rollbackUpdater(liveDocument);
          if (restoredDocument === liveDocument) {
            activeDocumentTransactionRef.current = null;
            setDocumentTransactionEpoch((value) => value + 1);
            return false;
          }
          const rollback = rollbackCanvasHistoryTransaction(
            transaction,
            historyByWorkspaceRef.current.get(sourceWorkspaceId),
            liveDocument,
            restoredDocument,
          );
          if (!rollback) {
            activeDocumentTransactionRef.current = null;
            setDocumentTransactionEpoch((value) => value + 1);
            return false;
          }
          activeDocumentTransactionRef.current = null;
          setDocumentTransactionEpoch((value) => value + 1);
          historyByWorkspaceRef.current.set(sourceWorkspaceId, rollback.history);
          activeDocumentRef.current = rollback.document;
          latestDocumentsRef.current.set(sourceWorkspaceId, rollback.document);
          setDocument(rollback.document);
          refreshHistoryStatus(sourceWorkspaceId);
          return true;
        },
      };
    },
    [refreshHistoryStatus],
  );

  const searchCanvasWorks = useCallback(
    async (query: string): Promise<CanvasLibraryWork[]> => {
      if (desktopRuntime) {
        const rows = await searchWorksByMetadata(query, 40);
        return rows.map(canvasLibraryWork);
      }
      const { normalized, tokens } = parseWorkMetadataSearch(query);
      if (!normalized) return PREVIEW_LIBRARY_WORKS.slice(0, 40);
      if (tokens.length === 0) return [];
      return PREVIEW_LIBRARY_WORKS.filter((work) => {
        const haystack = [
          work.title,
          work.abstract ?? "",
          work.authorNames.join(" "),
          work.venue ?? "",
          work.year ? String(work.year) : "",
          ...(work.tags ?? []),
        ]
          .join(" ")
          .toLocaleLowerCase();
        return tokens.every((token) => haystack.includes(token));
      }).slice(0, 40);
    },
    [desktopRuntime],
  );

  const resolveCanvasCitations = useCallback(
    (
      selectedPapers: readonly CanvasCitationPaperIdentity[],
      signal: AbortSignal,
    ): Promise<CanvasCitationResolution> => {
      if (!desktopRuntime) {
        return Promise.resolve({
          graphCount: 0,
          relations: [],
          source: "none",
          truncated: false,
        });
      }
      return resolveCanvasCitationRelations(selectedPapers, { signal });
    },
    [desktopRuntime],
  );

  const persistDocument = useCallback(
    (snapshot: CanvasWorkspaceDocument): Promise<void> => {
      const workspaceId = snapshot.workspaceId;
      if (retiredWorkspaceIdsRef.current.has(workspaceId)) return Promise.resolve();
      const serialized = JSON.stringify(snapshot);
      const previous = saveChainsRef.current.get(workspaceId) ?? Promise.resolve();
      const run = previous
        .then(() =>
          persistCurrentCanvasWorkspaceSnapshot({
            snapshot,
            getLatestDocument: () => latestDocumentsRef.current.get(workspaceId),
            isRetired: () => retiredWorkspaceIdsRef.current.has(workspaceId),
            persist: saveCanvasWorkspace,
          }),
        )
        .then((status) => {
          if (status === "superseded") return;
          lastPersistedRef.current.set(workspaceId, serialized);
          const active = activeDocumentRef.current;
          const latest = latestDocumentsRef.current.get(workspaceId);
          if (
            active?.workspaceId === workspaceId &&
            latest &&
            JSON.stringify(latest) === serialized
          ) {
            setPersistenceLabel(desktopRuntime ? "已保存到本地数据库" : "已保存浏览器预览");
          }
        })
        .catch((error) => {
          if (activeDocumentRef.current?.workspaceId === workspaceId) {
            setPersistenceLabel(
              `保存失败：${error instanceof Error ? error.message : "请稍后重试"}`,
            );
          }
          throw error;
        });
      saveChainsRef.current.set(workspaceId, run);
      void run
        .finally(() => {
          if (saveChainsRef.current.get(workspaceId) === run) {
            saveChainsRef.current.delete(workspaceId);
          }
        })
        .catch(() => undefined);
      return run;
    },
    [desktopRuntime],
  );

  const flushWorkspace = useCallback(
    (workspaceId: string): Promise<void> => {
      const existing = flushRequestsRef.current.get(workspaceId);
      if (existing) return existing;
      const run = flushLatestCanvasWorkspace({
        cancelPendingSave: () => {
          const pending = pendingSaveRef.current.get(workspaceId);
          if (pending === undefined) return;
          window.clearTimeout(pending);
          pendingSaveRef.current.delete(workspaceId);
        },
        getInFlightSave: () => saveChainsRef.current.get(workspaceId),
        getLastPersisted: () => lastPersistedRef.current.get(workspaceId),
        getLatestDocument: () => latestDocumentsRef.current.get(workspaceId),
        isRetired: () => retiredWorkspaceIdsRef.current.has(workspaceId),
        persistDocument,
      });
      flushRequestsRef.current.set(workspaceId, run);
      void run
        .finally(() => {
          if (flushRequestsRef.current.get(workspaceId) === run) {
            flushRequestsRef.current.delete(workspaceId);
          }
        })
        .catch(() => undefined);
      return run;
    },
    [persistDocument],
  );

  const flushAllWorkspaces = useCallback(async (): Promise<void> => {
    for (const [workspaceId, timer] of pendingSaveRef.current) {
      window.clearTimeout(timer);
      pendingSaveRef.current.delete(workspaceId);
    }
    await flushCanvasWorkspaceCollection({
      workspaceIds: [...latestDocumentsRef.current.keys()].filter(
        (workspaceId) => !retiredWorkspaceIdsRef.current.has(workspaceId),
      ),
      flushWorkspace,
    });
  }, [flushWorkspace]);

  const hasPendingCanvasPersistence = useCallback((): boolean => {
    for (const [workspaceId, latest] of latestDocumentsRef.current) {
      if (retiredWorkspaceIdsRef.current.has(workspaceId)) continue;
      if (JSON.stringify(latest) !== lastPersistedRef.current.get(workspaceId)) return true;
      if (
        pendingSaveRef.current.has(workspaceId) ||
        saveChainsRef.current.has(workspaceId) ||
        flushRequestsRef.current.has(workspaceId)
      ) {
        return true;
      }
    }
    return false;
  }, []);

  const prepareForCanvasNavigation = useCallback((): Promise<"cancel" | "ready"> => {
    const existing = navigationPreparationRef.current;
    if (existing) return existing;
    const run = prepareStableCanvasNavigation({ flush: flushAllWorkspaces });
    navigationPreparationRef.current = run;
    void run
      .finally(() => {
        if (navigationPreparationRef.current === run) {
          navigationPreparationRef.current = null;
        }
      })
      .catch(() => undefined);
    return run;
  }, [flushAllWorkspaces]);

  const shouldBlockCanvasNavigation = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => {
      const routeChanged =
        currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash;
      return routeChanged && (hasCanvasEditorPreparers() || hasPendingCanvasPersistence());
    },
    [hasPendingCanvasPersistence],
  );
  // React Router supports one active blocker per router. Canvas editors join
  // the preparation registry above instead of installing child blockers.
  const navigationBlocker = useBlocker(shouldBlockCanvasNavigation);
  const latestBlockedNavigationRef = useRef<typeof navigationBlocker | null>(null);

  useEffect(() => {
    if (navigationBlocker.state !== "blocked") {
      if (navigationBlocker.state === "unblocked") {
        latestBlockedNavigationRef.current = null;
      }
      return;
    }
    latestBlockedNavigationRef.current = navigationBlocker;
    blockedNavigationRequestRef.current += 1;
    const requestId = blockedNavigationRequestRef.current;
    void settleLatestCanvasBlockedNavigation({
      getLatest: () => {
        if (blockedNavigationRequestRef.current !== requestId) return null;
        const latest = latestBlockedNavigationRef.current;
        return latest?.state === "blocked" ? latest : null;
      },
      onCancel: () => {
        setPersistenceLabel("导航已取消 · 草稿仍在编辑");
      },
      onError: (error) => {
        const detail = error instanceof Error ? error.message : "请稍后重试";
        setPersistenceLabel(`保存失败：${detail}`);
      },
      prepare: prepareForCanvasNavigation,
    }).catch(() => undefined);
  }, [navigationBlocker, prepareForCanvasNavigation]);

  useEffect(() => {
    if (!desktopRuntime) {
      setCanvasSynthesisService(null);
      return () => setCanvasSynthesisService(null);
    }
    setCanvasSynthesisService({
      synthesize: ({ sourceNodes, synthType }) =>
        desktopSynthesizeCanvasSelection(sourceNodes, synthType),
    });
    return () => setCanvasSynthesisService(null);
  }, [desktopRuntime]);

  useEffect(() => {
    let cancelled = false;
    const workRequest = desktopRuntime
      ? listWorks(undefined, undefined, 500).then((rows) => rows.map(canvasLibraryWork))
      : Promise.resolve(PREVIEW_LIBRARY_WORKS);
    void workRequest
      .then((nextWorks) => {
        if (!cancelled) setWorks(nextWorks);
      })
      .catch(() => {
        if (!cancelled) setWorks([]);
      })
      .finally(() => {
        if (!cancelled) setLibraryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [desktopRuntime]);

  useEffect(() => {
    if (!routeWorkspaceId) {
      navigate("/canvas", { replace: true });
      return;
    }
    const requestId = ++loadRequestRef.current;
    const previousWorkspaceId = activeDocumentRef.current?.workspaceId;
    if (previousWorkspaceId) {
      const previousHistory = historyByWorkspaceRef.current.get(previousWorkspaceId);
      if (previousHistory) {
        historyByWorkspaceRef.current.set(previousWorkspaceId, sealCanvasHistory(previousHistory));
      }
    }

    void (async () => {
      await Promise.resolve();
      if (requestId !== loadRequestRef.current) return;
      setLoadError("");
      setPersistenceLabel(previousWorkspaceId ? "正在切换白板…" : "正在载入…");
      setDocument(null);
      const readyToLoad = await waitForCanvasWorkspaceLoad({
        ...(previousWorkspaceId ? { previousWorkspaceId } : {}),
        targetWorkspaceId: routeWorkspaceId,
        flushWorkspace,
        isCurrentRequest: () => requestId === loadRequestRef.current,
      });
      if (!readyToLoad) return;
      const [workspace, summaries] = await Promise.all([
        loadCanvasWorkspace(routeWorkspaceId),
        listCanvasWorkspaces(),
      ]);
      if (requestId !== loadRequestRef.current) return;
      const serialized = JSON.stringify(workspace);
      activeDocumentRef.current = workspace;
      latestDocumentsRef.current.set(workspace.workspaceId, workspace);
      lastPersistedRef.current.set(workspace.workspaceId, serialized);
      historyByWorkspaceRef.current.set(
        workspace.workspaceId,
        reconcileCanvasHistory(historyByWorkspaceRef.current.get(workspace.workspaceId), workspace),
      );
      refreshHistoryStatus(workspace.workspaceId);
      setWorkspaces(summaries);
      setDocument(workspace);
      setPersistenceLabel(desktopRuntime ? "已连接本地数据库" : "浏览器预览 · 本地保存");
      try {
        rememberLastCanvasWorkspaceId(workspace.workspaceId);
      } catch {
        // Remembering the last route is a convenience; the workspace itself is already loaded.
      }
    })().catch((error) => {
      if (requestId !== loadRequestRef.current) return;
      setLoadError(error instanceof Error ? error.message : "无法打开空间白板");
    });
  }, [
    desktopRuntime,
    flushWorkspace,
    navigate,
    refreshHistoryStatus,
    reloadNonce,
    routeWorkspaceId,
  ]);

  useEffect(() => {
    if (!document) return;
    if (retiredWorkspaceIdsRef.current.has(document.workspaceId)) return;
    activeDocumentRef.current = document;
    latestDocumentsRef.current.set(document.workspaceId, document);
    const serialized = JSON.stringify(document);
    if (serialized === lastPersistedRef.current.get(document.workspaceId)) return;
    setPersistenceLabel("正在保存…");
    const previousTimer = pendingSaveRef.current.get(document.workspaceId);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    const workspaceId = document.workspaceId;
    const timer = window.setTimeout(() => {
      pendingSaveRef.current.delete(workspaceId);
      if (retiredWorkspaceIdsRef.current.has(workspaceId)) return;
      void flushWorkspace(workspaceId).catch(() => undefined);
    }, 420);
    pendingSaveRef.current.set(workspaceId, timer);
  }, [document, flushWorkspace]);

  useEffect(() => {
    const flushBestEffort = () => {
      void flushAllWorkspaces().catch(() => undefined);
    };
    window.addEventListener("pagehide", flushBestEffort);
    return () => {
      window.removeEventListener("pagehide", flushBestEffort);
      flushBestEffort();
    };
  }, [flushAllWorkspaces]);

  useEffect(() => {
    return registerExitBarrier(() => prepareCanvasEditors({ reason: "app-exit" }), { priority: 0 });
  }, []);

  useEffect(() => {
    const unregisterBarrier = registerExitBarrier(
      async (request) => {
        exitPreparationRequestIdRef.current = request.requestId;
        setPersistenceLabel("正在保存并退出…");
        try {
          await flushAllWorkspaces();
          return exitPreparationRequestIdRef.current === request.requestId ? "ready" : "cancel";
        } catch (error) {
          if (exitPreparationRequestIdRef.current !== request.requestId) return "cancel";
          const detail = error instanceof Error ? error.message : "请稍后重试";
          setPersistenceLabel(`保存失败：${detail}`);
          const promptHeld = desktopRuntime
            ? await window.aura.lifecycle.holdClose(request.requestId).catch(() => false)
            : true;
          if (!promptHeld || exitPreparationRequestIdRef.current !== request.requestId) {
            return "cancel";
          }
          const force = await confirm({
            cancelLabel: "留在白板",
            confirmLabel: "仍然退出",
            description: "最后一次白板修改尚未保存。现在退出可能丢失这些修改。",
            details: [`保存错误：${detail}`, "留在白板后，再次关闭应用即可重试保存。"],
            eyebrow: "保存失败",
            title: "仍然退出 AuraScholar？",
            tone: "danger",
          });
          if (exitPreparationRequestIdRef.current !== request.requestId) return "cancel";
          if (!force) exitPreparationRequestIdRef.current = null;
          return force ? "force" : "cancel";
        }
      },
      { priority: 100 },
    );
    const unregisterCancellation = desktopRuntime
      ? window.aura.lifecycle.onCloseCancelled((request) => {
          if (exitPreparationRequestIdRef.current !== request.requestId) return;
          exitPreparationRequestIdRef.current = null;
          const active = activeDocumentRef.current;
          if (!active) return;
          const latest = latestDocumentsRef.current.get(active.workspaceId);
          const saved = lastPersistedRef.current.get(active.workspaceId);
          setPersistenceLabel(
            latest && JSON.stringify(latest) === saved
              ? "退出已取消 · 修改已保存"
              : "退出已取消 · 等待保存",
          );
        })
      : undefined;
    return () => {
      unregisterCancellation?.();
      unregisterBarrier();
      exitPreparationRequestIdRef.current = null;
    };
  }, [confirm, desktopRuntime, flushAllWorkspaces]);

  const workspaceId = document?.workspaceId ?? "";

  const requestCanvasNavigation = useCallback(
    (to: string, options?: { replace?: boolean }): void => {
      navigate(to, options);
    },
    [navigate],
  );

  const handleFocusRequestHandled = useCallback((requestId: string) => {
    setFocusRequest((current) => (current?.requestId === requestId ? null : current));
  }, []);

  const handleSelectWorkspace = useCallback(
    (nextWorkspaceId: string) => {
      if (!nextWorkspaceId || nextWorkspaceId === activeDocumentRef.current?.workspaceId) return;
      requestCanvasNavigation(canvasWorkspacePath(nextWorkspaceId));
    },
    [requestCanvasNavigation],
  );

  const handleCreateWorkspace = useCallback(
    async (name: string) => {
      const activeWorkspaceId = activeDocumentRef.current?.workspaceId;
      if (activeWorkspaceId) await flushWorkspace(activeWorkspaceId);
      const created = await createCanvasWorkspace(name);
      setWorkspaces(await listCanvasWorkspaces());
      return created;
    },
    [flushWorkspace],
  );

  const handleRenameWorkspace = useCallback(
    async (targetWorkspaceId: string, name: string) => {
      if (latestDocumentsRef.current.has(targetWorkspaceId)) {
        await flushWorkspace(targetWorkspaceId);
      }
      const renamed = await renameCanvasWorkspace(targetWorkspaceId, name);
      lastPersistedRef.current.set(targetWorkspaceId, JSON.stringify(renamed));
      const active = activeDocumentRef.current;
      if (active?.workspaceId === targetWorkspaceId) {
        const merged = mergeRenamedCanvasWorkspace(active, renamed);
        activeDocumentRef.current = merged;
        latestDocumentsRef.current.set(targetWorkspaceId, merged);
        setDocument(merged);
      } else {
        latestDocumentsRef.current.set(targetWorkspaceId, renamed);
      }
      setWorkspaces(await listCanvasWorkspaces());
    },
    [flushWorkspace],
  );

  const handleDeleteWorkspace = useCallback(
    async (targetWorkspaceId: string) => {
      const deletionPlan = planCanvasWorkspaceDeletion(
        workspaces,
        activeDocumentRef.current?.workspaceId ?? routeWorkspaceId,
        targetWorkspaceId,
      );
      if (!deletionPlan.targetExists) throw new Error("白板不存在或已被删除");
      if (!deletionPlan.canDelete) throw new Error("至少需要保留一个白板");
      const target =
        latestDocumentsRef.current.get(targetWorkspaceId) ??
        (await loadCanvasWorkspace(targetWorkspaceId));
      const fallbackBeforeDelete = workspaces.find(
        (workspace) => workspace.workspaceId === deletionPlan.nextActiveWorkspaceId,
      );
      if (!fallbackBeforeDelete) throw new Error("至少需要保留一个白板");

      const approved = await confirm({
        title: `删除白板“${target.name}”？`,
        eyebrow: "删除空间白板",
        description: `该白板包含 ${target.nodes.length} 张卡片。删除后，该白板的卡片与连线将无法恢复。`,
        details: [
          `即将永久删除“${target.name}”及其中的 ${target.nodes.length} 张卡片。`,
          "主文献库中的论文条目、批注与 PDF 源文件不会被删除。",
        ],
        confirmLabel: "删除白板",
        cancelLabel: "保留白板",
        tone: "danger",
      });
      if (!approved) return;

      const wasActive = deletionPlan.deletingActiveWorkspace;
      retiredWorkspaceIdsRef.current.add(targetWorkspaceId);
      const pending = pendingSaveRef.current.get(targetWorkspaceId);
      if (pending !== undefined) {
        window.clearTimeout(pending);
        pendingSaveRef.current.delete(targetWorkspaceId);
      }

      let deleted = false;
      try {
        await Promise.all([
          saveChainsRef.current.get(targetWorkspaceId)?.catch(() => undefined),
          flushRequestsRef.current.get(targetWorkspaceId)?.catch(() => undefined),
        ]);
        deleted = await deleteCanvasWorkspace(targetWorkspaceId);
        if (!deleted) throw new Error("白板不存在或已被删除");
        clearCanvasNoteDraftsForWorkspace(targetWorkspaceId);

        latestDocumentsRef.current.delete(targetWorkspaceId);
        lastPersistedRef.current.delete(targetWorkspaceId);
        saveChainsRef.current.delete(targetWorkspaceId);
        flushRequestsRef.current.delete(targetWorkspaceId);
        historyByWorkspaceRef.current.delete(targetWorkspaceId);
        for (const ingressKey of inFlightIngressRef.current) {
          if (ingressKey.startsWith(`${targetWorkspaceId}:`)) {
            inFlightIngressRef.current.delete(ingressKey);
          }
        }

        const remaining = await listCanvasWorkspaces().catch(() =>
          workspaces.filter((workspace) => workspace.workspaceId !== targetWorkspaceId),
        );
        const fallback = remaining[0] ?? fallbackBeforeDelete;
        setWorkspaces(remaining);
        setPersistenceLabel(`已删除白板“${target.name}”`);

        if (wasActive) {
          loadRequestRef.current += 1;
          activeDocumentRef.current = null;
          setDocument(null);
          setHistoryStatus({ workspaceId: "", canUndo: false, canRedo: false });
          navigate(canvasWorkspacePath(fallback.workspaceId), { replace: true });
          try {
            rememberLastCanvasWorkspaceId(fallback.workspaceId);
          } catch {
            // The RESTful route is authoritative; storage is only a future
            // no-parameter redirect hint and must not block this navigation.
          }
        }
      } catch (error) {
        if (!deleted) {
          retiredWorkspaceIdsRef.current.delete(targetWorkspaceId);
          const latest = latestDocumentsRef.current.get(targetWorkspaceId);
          if (
            latest &&
            JSON.stringify(latest) !== lastPersistedRef.current.get(targetWorkspaceId)
          ) {
            void flushWorkspace(targetWorkspaceId).catch(() => undefined);
          }
        }
        throw error;
      }
    },
    [confirm, flushWorkspace, navigate, routeWorkspaceId, workspaces],
  );

  useEffect(() => {
    if (!workspaceId || !requestedAnnotationId) return;
    if (!requestedWorkId) {
      const noticeId = window.setTimeout(
        () => setPersistenceLabel("添加摘录失败：缺少来源文献"),
        0,
      );
      return () => window.clearTimeout(noticeId);
    }
    const ingressKey = `${workspaceId}:annotation:${requestedAnnotationId}:${requestedWorkId}`;
    const inFlightIngress = inFlightIngressRef.current;
    if (inFlightIngress.has(ingressKey)) return;
    inFlightIngress.add(ingressKey);

    if (!desktopRuntime) {
      const noticeId = window.setTimeout(
        () => setPersistenceLabel("浏览器预览无法读取桌面批注"),
        0,
      );
      return () => {
        window.clearTimeout(noticeId);
        inFlightIngress.delete(ingressKey);
      };
    }

    const controller = new AbortController();
    void loadCanvasAnnotationIngressSource(
      requestedAnnotationId,
      requestedWorkId,
      controller.signal,
    )
      .then(({ annotation, work: sourceWork }) => {
        if (controller.signal.aborted) return;
        const work = canvasLibraryWork(sourceWork);
        let updaterRan = false;
        let changed = false;
        let ingressResult: ReturnType<typeof applyCanvasAnnotationIngress> | undefined;
        const applied = applyActiveDocumentUpdate(
          workspaceId,
          (current) => {
            updaterRan = true;
            ingressResult = applyCanvasAnnotationIngress(current, {
              annotation: libraryReaderRowToAnnotation(annotation),
              attachmentId: annotation.attachment_id,
              expectedWorkId: requestedWorkId || undefined,
              workId: annotation.work_id,
              work,
              workspaceId,
            });
            changed = ingressResult.document !== current;
            return ingressResult.document;
          },
          { history: { label: "加入文献摘录" } },
        );
        if (!updaterRan || !ingressResult || (changed && !applied)) {
          inFlightIngress.delete(ingressKey);
          return;
        }
        const message = ingressResult.createdPaper
          ? ingressResult.createdNode
            ? "已创建来源文献卡和摘录卡，并建立来源连线。"
            : "已恢复来源文献卡和来源连线，并定位已有摘录。"
          : ingressResult.createdNode
            ? "已创建摘录卡，并建立来源连线。"
            : ingressResult.createdEdge
              ? "摘录卡已存在，已补回来源连线。"
              : "这条批注已在白板中，已为你定位。";
        focusRequestSequenceRef.current += 1;
        setFocusRequest({
          message,
          nodeId: ingressResult.node.id,
          requestId: `${ingressKey}:${focusRequestSequenceRef.current}`,
          workspaceId,
        });
        inFlightIngress.delete(ingressKey);
        navigate(canvasWorkspacePath(workspaceId), { replace: true });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        inFlightIngress.delete(ingressKey);
        setPersistenceLabel(`添加摘录失败：${error instanceof Error ? error.message : "未知错误"}`);
      });
    return () => {
      controller.abort();
      inFlightIngress.delete(ingressKey);
    };
  }, [
    applyActiveDocumentUpdate,
    desktopRuntime,
    documentTransactionEpoch,
    navigate,
    requestedAnnotationId,
    requestedWorkId,
    workspaceId,
  ]);

  useEffect(() => {
    if (!workspaceId || libraryLoading || !requestedWorkId || requestedAnnotationId) {
      return;
    }
    const ingressKey = `${workspaceId}:work:${requestedWorkId}`;
    const inFlightIngress = inFlightIngressRef.current;
    if (inFlightIngress.has(ingressKey)) return;
    inFlightIngress.add(ingressKey);

    const controller = new AbortController();
    const listed = works.find((candidate) => candidate.id === requestedWorkId);
    const resolveWork = listed
      ? Promise.resolve(listed)
      : desktopRuntime
        ? loadCanvasActiveWork(requestedWorkId, controller.signal).then((row) =>
            row ? canvasLibraryWork(row) : null,
          )
        : Promise.resolve(null);

    void resolveWork
      .then((work) => {
        if (controller.signal.aborted) return;
        if (!work) throw new Error("未在文献库中找到请求添加的文献");
        let alreadyPresent = false;
        const applied = applyActiveDocumentUpdate(
          workspaceId,
          (current) => {
            if (
              current.nodes.some((node) => node.type === "paper" && node.data.workId === work.id)
            ) {
              alreadyPresent = true;
              return current;
            }
            const node = createPaperNode(work, nextCanvasIngressPosition(current));
            return { ...current, nodes: [...current.nodes, node], updatedAt: Date.now() };
          },
          { history: { label: "加入文献" } },
        );
        if (!applied && !alreadyPresent) {
          inFlightIngress.delete(ingressKey);
          return;
        }
        navigate(canvasWorkspacePath(workspaceId), { replace: true });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        inFlightIngress.delete(ingressKey);
        setPersistenceLabel(error instanceof Error ? error.message : "添加文献失败");
      });

    return () => {
      controller.abort();
      inFlightIngress.delete(ingressKey);
    };
  }, [
    desktopRuntime,
    applyActiveDocumentUpdate,
    documentTransactionEpoch,
    libraryLoading,
    navigate,
    requestedAnnotationId,
    requestedWorkId,
    workspaceId,
    works,
  ]);

  if (loadError) {
    return (
      <main className="spatial-canvas-page spatial-canvas-page--state">
        <div className="canvas-page-state" role="alert">
          <Warning size={30} weight="duotone" />
          <h1>无法打开空间白板</h1>
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setLoadError("");
              setLibraryLoading(true);
              setPersistenceLabel("正在载入…");
              setReloadNonce((value) => value + 1);
            }}
          >
            重新载入
          </button>
        </div>
      </main>
    );
  }

  if (!document) {
    return (
      <main className="spatial-canvas-page spatial-canvas-page--state" aria-busy="true">
        <div className="canvas-page-state" role="status">
          <CircleNotch className="canvas-page-state__spinner" size={30} weight="bold" />
          <h1>正在展开研究空间</h1>
          <p>读取卡片、连线与上次浏览位置。</p>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="spatial-canvas-page">
        <CanvasWorkspace
          key={document.workspaceId}
          canRedo={historyStatus.workspaceId === document.workspaceId && historyStatus.canRedo}
          canUndo={historyStatus.workspaceId === document.workspaceId && historyStatus.canUndo}
          document={document}
          focusRequest={focusRequest}
          onDocumentChange={(updater, options) =>
            applyActiveDocumentUpdate(document.workspaceId, updater, options)
          }
          onDocumentTransaction={(updater, mutation) =>
            applyActiveDocumentTransaction(document.workspaceId, updater, mutation)
          }
          onFlushDocument={flushWorkspace}
          onFocusRequestHandled={handleFocusRequestHandled}
          onRedo={() => runHistoryCommand("redo")}
          onUndo={() => runHistoryCommand("undo")}
          works={works}
          searchWorks={searchCanvasWorks}
          citationLookupAvailable={desktopRuntime}
          resolveCitationRelations={resolveCanvasCitations}
          workspaces={workspaces}
          libraryLoading={libraryLoading}
          persistenceLabel={persistenceLabel}
          onCreateWorkspace={handleCreateWorkspace}
          onDeleteWorkspace={handleDeleteWorkspace}
          onSelectWorkspace={handleSelectWorkspace}
          onRenameWorkspace={handleRenameWorkspace}
          onExit={() => {
            requestCanvasNavigation("/library");
          }}
          onOpenPaper={(workId) => {
            requestCanvasNavigation(`/reader?work=${encodeURIComponent(workId)}`);
          }}
          onOpenExcerpt={(workId, annotationId, pageIndex, attachmentId) => {
            const annotationSuffix = annotationId
              ? `&annotation=${encodeURIComponent(annotationId)}`
              : "";
            const pageSuffix = typeof pageIndex === "number" ? `&page=${pageIndex + 1}` : "";
            const attachmentSuffix = attachmentId
              ? `&attachment=${encodeURIComponent(attachmentId)}`
              : "";
            requestCanvasNavigation(
              `/reader?work=${encodeURIComponent(workId)}&tab=annotations${annotationSuffix}${pageSuffix}${attachmentSuffix}`,
            );
          }}
        />
      </main>
      {confirmDialog}
    </>
  );
}
