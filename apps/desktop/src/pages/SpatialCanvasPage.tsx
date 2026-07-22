import {
  CANVAS_SCHEMA_VERSION,
  type CanvasJsonValue,
  type CanvasWorkspaceDocument,
  type ExcerptHighlightColor,
  type ExcerptNode,
} from "@aurascholar/core";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { CircleNotch, Warning } from "@phosphor-icons/react";
import { parseAnnotationAnchorJson } from "@aurascholar/reader";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "@xyflow/react/dist/style.css";
import "katex/dist/katex.min.css";
import { CanvasWorkspace } from "../features/canvas/CanvasWorkspace";
import {
  PREVIEW_LIBRARY_WORKS,
  createCanvasId,
  createPaperNode,
  type CanvasLibraryWork,
} from "../features/canvas/model";
import { loadCanvasWorkspace, saveCanvasWorkspace } from "../features/canvas/persistence";
import { setCanvasSynthesisService } from "../features/canvas/synthesis";
import { getDb } from "../services/aura-db";
import { synthesizeCanvasSelection as desktopSynthesizeCanvasSelection } from "../services/canvas-ai";
import { isDesktopRuntime } from "../services/aura-platform";
import { listWorks } from "../services/library-list";
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

function canvasLibraryWork(row: Awaited<ReturnType<typeof listWorks>>[number]): CanvasLibraryWork {
  return {
    id: row.id,
    title: row.title,
    abstract: row.abstract,
    authorNames: row.authorNames,
    year: row.year,
    venue: row.venue_name,
    doi: row.doi,
    readingStatus: row.reading_status,
  };
}

function nextIngressPosition(document: CanvasWorkspaceDocument): { x: number; y: number } {
  const count = document.nodes.filter((node) => !node.groupId).length;
  return {
    x: 180 + (count % 4) * 356,
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

export function SpatialCanvasPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedWorkId = searchParams.get("workId")?.trim() || "";
  const requestedAnnotationId = searchParams.get("annotationId")?.trim() || "";
  const desktopRuntime = isDesktopRuntime();
  const [document, setDocument] = useState<CanvasWorkspaceDocument | null>(null);
  const [works, setWorks] = useState<CanvasLibraryWork[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [persistenceLabel, setPersistenceLabel] = useState("正在载入…");
  const lastPersistedRef = useRef("");
  const latestDocumentRef = useRef<CanvasWorkspaceDocument | null>(null);
  const pendingSaveRef = useRef<number | null>(null);
  const handledIngressRef = useRef(new Set<string>());

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
    void Promise.allSettled([
      loadCanvasWorkspace(),
      desktopRuntime ? listWorks(undefined, undefined, 500) : Promise.resolve([]),
    ])
      .then(([workspaceResult, libraryResult]) => {
        if (cancelled) return;
        if (workspaceResult.status === "rejected") throw workspaceResult.reason;
        const workspace = workspaceResult.value;
        lastPersistedRef.current = JSON.stringify(workspace);
        latestDocumentRef.current = workspace;
        setDocument(workspace);
        if (libraryResult.status === "fulfilled") {
          setWorks(
            desktopRuntime ? libraryResult.value.map(canvasLibraryWork) : PREVIEW_LIBRARY_WORKS,
          );
          setPersistenceLabel(desktopRuntime ? "已连接本地数据库" : "浏览器预览 · 本地保存");
        } else {
          setWorks([]);
          setPersistenceLabel("画布已载入 · 文献库暂不可用");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "无法打开空间白板");
      })
      .finally(() => {
        if (!cancelled) setLibraryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [desktopRuntime, reloadNonce]);

  useEffect(() => {
    if (!document) return;
    latestDocumentRef.current = document;
    const serialized = JSON.stringify(document);
    if (serialized === lastPersistedRef.current) return;
    setPersistenceLabel("正在保存…");
    if (pendingSaveRef.current !== null) window.clearTimeout(pendingSaveRef.current);
    pendingSaveRef.current = window.setTimeout(() => {
      pendingSaveRef.current = null;
      void saveCanvasWorkspace(document)
        .then(() => {
          lastPersistedRef.current = serialized;
          setPersistenceLabel(desktopRuntime ? "已保存到本地数据库" : "已保存浏览器预览");
        })
        .catch((error) => {
          setPersistenceLabel(`保存失败：${error instanceof Error ? error.message : "请稍后重试"}`);
        });
    }, 420);
  }, [desktopRuntime, document]);

  useEffect(() => {
    const flushLatest = () => {
      if (pendingSaveRef.current !== null) {
        window.clearTimeout(pendingSaveRef.current);
        pendingSaveRef.current = null;
      }
      const latest = latestDocumentRef.current;
      if (!latest) return;
      const serialized = JSON.stringify(latest);
      if (serialized === lastPersistedRef.current) return;
      void saveCanvasWorkspace(latest)
        .then(() => {
          lastPersistedRef.current = serialized;
        })
        .catch(() => {
          // The debounced save path exposes failures while mounted. During
          // pagehide/unmount there is no safe UI target; preserve the snapshot
          // in memory and let the next edit retry instead of leaking a rejection.
        });
    };
    window.addEventListener("pagehide", flushLatest);
    return () => {
      window.removeEventListener("pagehide", flushLatest);
      flushLatest();
    };
  }, []);

  const workspaceId = document?.workspaceId ?? "";

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
  }, [desktopRuntime, requestedAnnotationId, workspaceId]);

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
  }, [desktopRuntime, libraryLoading, requestedAnnotationId, requestedWorkId, workspaceId, works]);

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
    <main className="spatial-canvas-page">
      <CanvasWorkspace
        document={document}
        onDocumentChange={(updater) =>
          setDocument((current) => (current ? updater(current) : current))
        }
        works={works}
        libraryLoading={libraryLoading}
        persistenceLabel={persistenceLabel}
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
  );
}
