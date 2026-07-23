import {
  CANVAS_SCHEMA_VERSION,
  type CanvasJsonValue,
  type CanvasWorkspaceDocument,
  type ExcerptHighlightColor,
  type ExcerptNode,
} from "@aurascholar/core";
import type { CanvasWorkspaceSummary } from "@aurascholar/db/repos/canvas";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { CircleNotch, Warning } from "@phosphor-icons/react";
import { parseAnnotationAnchorJson } from "@aurascholar/reader";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import "@xyflow/react/dist/style.css";
import "katex/dist/katex.min.css";
import { useConfirmDialog } from "../components/ConfirmDialog";
import { CanvasWorkspace } from "../features/canvas/CanvasWorkspace";
import {
  PREVIEW_LIBRARY_WORKS,
  createCanvasId,
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
  applyCanvasWorkspaceUpdate,
  mergeRenamedCanvasWorkspace,
  planCanvasWorkspaceDeletion,
} from "../features/canvas/workspace-controls";
import { getDb } from "../services/aura-db";
import { synthesizeCanvasSelection as desktopSynthesizeCanvasSelection } from "../services/canvas-ai";
import { isDesktopRuntime } from "../services/aura-platform";
import {
  listWorks,
  parseWorkMetadataSearch,
  searchWorksByMetadata,
} from "../services/library-list";
import "../features/canvas/canvas.css";

interface AnnotationCanvasRow {
  anchor_json: string | null;
  attachment_id: string;
  color: string | null;
  content_md: string | null;
  id: string;
  page_index: number;
  work_id: string;
  work_title: string;
}

const HIGHLIGHT_COLOR_MAP: Record<string, ExcerptHighlightColor> = {
  yellow: "yellow",
  "#ffd866": "yellow",
  green: "green",
  "#a9dc76": "green",
  blue: "blue",
  "#78dce8": "blue",
  pink: "pink",
  "#ff6188": "pink",
  purple: "purple",
  "#ab9df2": "purple",
  orange: "orange",
  "#fc9867": "orange",
};

function annotationColor(value: string | null): ExcerptHighlightColor {
  return HIGHLIGHT_COLOR_MAP[value?.trim().toLocaleLowerCase() || ""] || "yellow";
}

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

function nextIngressPosition(document: CanvasWorkspaceDocument): { x: number; y: number } {
  const count = document.nodes.filter((node) => !node.groupId).length;
  return {
    x: 340 + (count % 4) * 356,
    y: 140 + Math.floor(count / 4) * 314,
  };
}

function annotationNode(row: AnnotationCanvasRow, document: CanvasWorkspaceDocument): ExcerptNode {
  const now = Date.now();
  const parsed = parseAnnotationAnchorJson(row.anchor_json, row.page_index).anchor;
  const exact = parsed.quote?.exact?.trim();
  const note = row.content_md?.trim();
  return {
    id: createCanvasId(),
    type: "excerpt",
    position: nextIngressPosition(document),
    dimensions: { width: 300, height: 216 },
    tags: [],
    createdAt: now,
    updatedAt: now,
    data: {
      workId: row.work_id,
      paperTitle: row.work_title,
      highlightText: exact || note || `第 ${row.page_index + 1} 页批注`,
      highlightColor: annotationColor(row.color),
      pageIndex: row.page_index,
      annotationId: row.id,
      attachmentId: row.attachment_id,
      anchor: JSON.parse(JSON.stringify(parsed)) as CanvasJsonValue,
      marginNote: exact && note ? note : undefined,
    },
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
  const [persistenceLabel, setPersistenceLabel] = useState("正在载入…");
  const { confirm, confirmDialog } = useConfirmDialog();
  const activeDocumentRef = useRef<CanvasWorkspaceDocument | null>(null);
  const latestDocumentsRef = useRef(new Map<string, CanvasWorkspaceDocument>());
  const lastPersistedRef = useRef(new Map<string, string>());
  const pendingSaveRef = useRef(new Map<string, number>());
  const saveChainsRef = useRef(new Map<string, Promise<void>>());
  const retiredWorkspaceIdsRef = useRef(new Set<string>());
  const loadRequestRef = useRef(0);
  const handledIngressRef = useRef(new Set<string>());

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

  const persistDocument = useCallback(
    (snapshot: CanvasWorkspaceDocument): Promise<void> => {
      const workspaceId = snapshot.workspaceId;
      if (retiredWorkspaceIdsRef.current.has(workspaceId)) return Promise.resolve();
      const serialized = JSON.stringify(snapshot);
      const previous = saveChainsRef.current.get(workspaceId) ?? Promise.resolve();
      const run = previous
        .catch(() => undefined)
        .then(() => saveCanvasWorkspace(snapshot))
        .then(() => {
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
    async (workspaceId: string): Promise<void> => {
      const pending = pendingSaveRef.current.get(workspaceId);
      if (pending !== undefined) {
        window.clearTimeout(pending);
        pendingSaveRef.current.delete(workspaceId);
      }
      if (retiredWorkspaceIdsRef.current.has(workspaceId)) {
        await saveChainsRef.current.get(workspaceId)?.catch(() => undefined);
        return;
      }
      const latest = latestDocumentsRef.current.get(workspaceId);
      if (!latest) {
        await saveChainsRef.current.get(workspaceId);
        return;
      }
      const serialized = JSON.stringify(latest);
      if (lastPersistedRef.current.get(workspaceId) === serialized) {
        await saveChainsRef.current.get(workspaceId);
        return;
      }
      await persistDocument(latest);
    },
    [persistDocument],
  );

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

    void (async () => {
      await Promise.resolve();
      if (requestId !== loadRequestRef.current) return;
      setLoadError("");
      setPersistenceLabel(previousWorkspaceId ? "正在切换白板…" : "正在载入…");
      setDocument(null);
      if (previousWorkspaceId && previousWorkspaceId !== routeWorkspaceId) {
        await flushWorkspace(previousWorkspaceId);
      }
      const [workspace, summaries] = await Promise.all([
        loadCanvasWorkspace(routeWorkspaceId),
        listCanvasWorkspaces(),
      ]);
      if (requestId !== loadRequestRef.current) return;
      const serialized = JSON.stringify(workspace);
      activeDocumentRef.current = workspace;
      latestDocumentsRef.current.set(workspace.workspaceId, workspace);
      lastPersistedRef.current.set(workspace.workspaceId, serialized);
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
  }, [desktopRuntime, flushWorkspace, navigate, reloadNonce, routeWorkspaceId]);

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
      const latest = latestDocumentsRef.current.get(workspaceId);
      if (!latest) return;
      void persistDocument(latest).catch(() => undefined);
    }, 420);
    pendingSaveRef.current.set(workspaceId, timer);
  }, [document, persistDocument]);

  useEffect(() => {
    const flushAll = () => {
      for (const [workspaceId, timer] of pendingSaveRef.current) {
        window.clearTimeout(timer);
        pendingSaveRef.current.delete(workspaceId);
      }
      for (const latest of latestDocumentsRef.current.values()) {
        if (retiredWorkspaceIdsRef.current.has(latest.workspaceId)) continue;
        if (JSON.stringify(latest) === lastPersistedRef.current.get(latest.workspaceId)) continue;
        void persistDocument(latest).catch(() => undefined);
      }
    };
    window.addEventListener("pagehide", flushAll);
    return () => {
      window.removeEventListener("pagehide", flushAll);
      flushAll();
    };
  }, [persistDocument]);

  const workspaceId = document?.workspaceId ?? "";

  const handleSelectWorkspace = useCallback(
    (nextWorkspaceId: string) => {
      if (!nextWorkspaceId || nextWorkspaceId === activeDocumentRef.current?.workspaceId) return;
      navigate(canvasWorkspacePath(nextWorkspaceId));
    },
    [navigate],
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
      if (activeDocumentRef.current?.workspaceId === targetWorkspaceId) {
        setDocument((current) => {
          if (!current || current.workspaceId !== targetWorkspaceId) return current;
          const merged = mergeRenamedCanvasWorkspace(current, renamed);
          activeDocumentRef.current = merged;
          latestDocumentsRef.current.set(targetWorkspaceId, merged);
          return merged;
        });
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
        await saveChainsRef.current.get(targetWorkspaceId)?.catch(() => undefined);
        deleted = await deleteCanvasWorkspace(targetWorkspaceId);
        if (!deleted) throw new Error("白板不存在或已被删除");

        latestDocumentsRef.current.delete(targetWorkspaceId);
        lastPersistedRef.current.delete(targetWorkspaceId);
        saveChainsRef.current.delete(targetWorkspaceId);
        for (const ingressKey of handledIngressRef.current) {
          if (ingressKey.startsWith(`${targetWorkspaceId}:`)) {
            handledIngressRef.current.delete(ingressKey);
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
            void persistDocument(latest).catch(() => undefined);
          }
        }
        throw error;
      }
    },
    [confirm, navigate, persistDocument, routeWorkspaceId, workspaces],
  );

  useEffect(() => {
    if (!workspaceId || !requestedAnnotationId) return;
    const ingressKey = `${workspaceId}:annotation:${requestedAnnotationId}`;
    const handledIngress = handledIngressRef.current;
    if (handledIngress.has(ingressKey)) return;
    handledIngress.add(ingressKey);

    if (!desktopRuntime) {
      const noticeId = window.setTimeout(
        () => setPersistenceLabel("浏览器预览无法读取桌面批注"),
        0,
      );
      return () => window.clearTimeout(noticeId);
    }

    let cancelled = false;
    let settled = false;
    void getDb()
      .then((db) =>
        db.query<AnnotationCanvasRow>(
          `SELECT an.id, an.attachment_id, an.work_id, an.color, an.page_index,
                  an.anchor_json, an.content_md, w.title AS work_title
           FROM annotations an
           JOIN works w ON w.id = an.work_id AND w.deleted_at IS NULL
           JOIN attachments at ON at.id = an.attachment_id AND at.deleted_at IS NULL
           WHERE an.id = ? AND an.deleted_at IS NULL LIMIT 1`,
          [requestedAnnotationId],
        ),
      )
      .then((rows) => {
        if (cancelled) return;
        const row = rows[0];
        if (!row) throw new Error("没有找到这条批注，可能已被移除");
        setDocument((current) => {
          if (!current || current.workspaceId !== workspaceId) return current;
          if (
            current.nodes.some(
              (node) => node.type === "excerpt" && node.data.annotationId === row.id,
            )
          ) {
            return current;
          }
          const node = annotationNode(row, current);
          return {
            ...current,
            schemaVersion: CANVAS_SCHEMA_VERSION,
            nodes: [...current.nodes, node],
            updatedAt: Date.now(),
          };
        });
        settled = true;
        navigate(canvasWorkspacePath(workspaceId), { replace: true });
      })
      .catch((error) => {
        if (cancelled) return;
        handledIngress.delete(ingressKey);
        setPersistenceLabel(`添加摘录失败：${error instanceof Error ? error.message : "未知错误"}`);
      });
    return () => {
      cancelled = true;
      if (!settled) handledIngress.delete(ingressKey);
    };
  }, [desktopRuntime, navigate, requestedAnnotationId, workspaceId]);

  useEffect(() => {
    if (!workspaceId || libraryLoading || !requestedWorkId || requestedAnnotationId) {
      return;
    }
    const ingressKey = `${workspaceId}:work:${requestedWorkId}`;
    const handledIngress = handledIngressRef.current;
    if (handledIngress.has(ingressKey)) return;
    handledIngress.add(ingressKey);

    let cancelled = false;
    let settled = false;
    const listed = works.find((candidate) => candidate.id === requestedWorkId);
    const resolveWork = listed
      ? Promise.resolve(listed)
      : desktopRuntime
        ? getDb().then(async (db) => {
            const row = await new WorksRepo(db).get(requestedWorkId);
            return row && row.deleted_at === null ? canvasLibraryWork(row) : null;
          })
        : Promise.resolve(null);

    void resolveWork
      .then((work) => {
        if (cancelled) return;
        if (!work) throw new Error("未在文献库中找到请求添加的文献");
        setDocument((current) => {
          if (!current || current.workspaceId !== workspaceId) return current;
          if (current.nodes.some((node) => node.type === "paper" && node.data.workId === work.id)) {
            return current;
          }
          const node = createPaperNode(work, nextIngressPosition(current));
          return { ...current, nodes: [...current.nodes, node], updatedAt: Date.now() };
        });
        settled = true;
        navigate(canvasWorkspacePath(workspaceId), { replace: true });
      })
      .catch((error) => {
        if (cancelled) return;
        handledIngress.delete(ingressKey);
        setPersistenceLabel(error instanceof Error ? error.message : "添加文献失败");
      });

    return () => {
      cancelled = true;
      if (!settled) handledIngress.delete(ingressKey);
    };
  }, [
    desktopRuntime,
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
          <p>读取卡片、关系与上次浏览位置。</p>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="spatial-canvas-page">
        <CanvasWorkspace
          key={document.workspaceId}
          document={document}
          onDocumentChange={(updater) => {
            const sourceWorkspaceId = document.workspaceId;
            if (retiredWorkspaceIdsRef.current.has(sourceWorkspaceId)) return;
            setDocument((current) =>
              applyCanvasWorkspaceUpdate(current, sourceWorkspaceId, updater),
            );
          }}
          works={works}
          searchWorks={searchCanvasWorks}
          workspaces={workspaces}
          libraryLoading={libraryLoading}
          persistenceLabel={persistenceLabel}
          onCreateWorkspace={handleCreateWorkspace}
          onDeleteWorkspace={handleDeleteWorkspace}
          onSelectWorkspace={handleSelectWorkspace}
          onRenameWorkspace={handleRenameWorkspace}
          onExit={() => navigate("/library")}
          onOpenPaper={(workId) => navigate(`/reader?work=${encodeURIComponent(workId)}`)}
          onOpenExcerpt={(workId, annotationId, pageIndex, attachmentId) => {
            const annotationSuffix = annotationId
              ? `&annotation=${encodeURIComponent(annotationId)}`
              : "";
            const pageSuffix = typeof pageIndex === "number" ? `&page=${pageIndex + 1}` : "";
            const attachmentSuffix = attachmentId
              ? `&attachment=${encodeURIComponent(attachmentId)}`
              : "";
            navigate(
              `/reader?work=${encodeURIComponent(workId)}&tab=annotations${annotationSuffix}${pageSuffix}${attachmentSuffix}`,
            );
          }}
        />
      </main>
      {confirmDialog}
    </>
  );
}
