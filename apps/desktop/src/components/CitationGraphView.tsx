// Reusable citation graph view (timeline layout). Used inside the reader's
// 脉络 tab and the standalone /graph deep-link page.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  buildCitationGraph,
  layoutTimeline,
  type CitationGraph,
  type GraphLayout,
  type PositionedNode,
} from "@aurascholar/core";
import type { ConnectorContext } from "@aurascholar/connectors";
import { Badge, Button } from "@aurascholar/ui";
import { InlineNotice, type InlineNoticeTone } from "./InlineNotice";
import { getDb } from "../services/aura-db";
import { auraHttp, isDesktopRuntime } from "../services/aura-platform";
import { describeSafeError } from "../services/sensitive-text";

const ctx: ConnectorContext = { http: auraHttp, mailto: "contact@aurascholar.app" };

const RELATION_COLOR: Record<string, string> = {
  center: "var(--color-accent)",
  reference: "var(--color-text-faint)",
  citer: "var(--color-warning)",
};

const GRAPH_CACHE_TTL = 7 * 86_400_000;
const MIN_GRAPH_IMPORT_BUSY_MS = 250;
const MIN_GRAPH_ZOOM = 0.55;
const MAX_GRAPH_ZOOM = 2.4;

type GraphFocus = "all" | "reference" | "citer" | "library";

const PREVIEW_CITATION_GRAPH: CitationGraph = {
  centerId: "W-preview-transformer",
  truncated: false,
  nodes: [
    {
      id: "W-preview-transformer",
      title: "Attention Is All You Need",
      year: 2017,
      citedByCount: 128000,
      doi: "10.48550/arXiv.1706.03762",
      venue: "NeurIPS",
      firstAuthor: "Ashish Vaswani",
      relation: "center",
    },
    {
      id: "W-preview-seq2seq",
      title: "Sequence to Sequence Learning with Neural Networks",
      year: 2014,
      citedByCount: 27000,
      doi: "10.48550/arXiv.1409.3215",
      venue: "NeurIPS",
      firstAuthor: "Ilya Sutskever",
      relation: "reference",
    },
    {
      id: "W-preview-bahdanau",
      title: "Neural Machine Translation by Jointly Learning to Align and Translate",
      year: 2015,
      citedByCount: 39000,
      doi: "10.48550/arXiv.1409.0473",
      venue: "ICLR",
      firstAuthor: "Dzmitry Bahdanau",
      relation: "reference",
    },
    {
      id: "W-preview-layernorm",
      title: "Layer Normalization",
      year: 2016,
      citedByCount: 14000,
      doi: "10.48550/arXiv.1607.06450",
      venue: "arXiv",
      firstAuthor: "Jimmy Lei Ba",
      relation: "reference",
    },
    {
      id: "W-preview-bert",
      title: "BERT: Pre-training of Deep Bidirectional Transformers",
      year: 2019,
      citedByCount: 97000,
      doi: "10.48550/arXiv.1810.04805",
      venue: "NAACL",
      firstAuthor: "Jacob Devlin",
      relation: "citer",
    },
    {
      id: "W-preview-gpt3",
      title: "Language Models are Few-Shot Learners",
      year: 2020,
      citedByCount: 45000,
      doi: "10.48550/arXiv.2005.14165",
      venue: "NeurIPS",
      firstAuthor: "Tom B. Brown",
      relation: "citer",
    },
    {
      id: "W-preview-vit",
      title: "An Image is Worth 16x16 Words",
      year: 2021,
      citedByCount: 32000,
      doi: "10.48550/arXiv.2010.11929",
      venue: "ICLR",
      firstAuthor: "Alexey Dosovitskiy",
      relation: "citer",
    },
  ],
  edges: [
    { source: "W-preview-transformer", target: "W-preview-seq2seq" },
    { source: "W-preview-transformer", target: "W-preview-bahdanau" },
    { source: "W-preview-transformer", target: "W-preview-layernorm" },
    { source: "W-preview-bert", target: "W-preview-transformer" },
    { source: "W-preview-gpt3", target: "W-preview-transformer" },
    { source: "W-preview-vit", target: "W-preview-transformer" },
    { source: "W-preview-bert", target: "W-preview-bahdanau" },
    { source: "W-preview-gpt3", target: "W-preview-layernorm" },
  ],
};

interface ImportNotice {
  message: string;
  tone: InlineNoticeTone;
}

interface CitationGraphSmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_DELAY_MS__?: number;
  __AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_COUNT__?: number;
  __AURASCHOLAR_SMOKE_BUILD_CITATION_GRAPH__?: (input: {
    doi: string;
  }) => CitationGraph | null | undefined | Promise<CitationGraph | null | undefined>;
}

async function waitForMinimumElapsed(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
}

async function waitForGraphSmokeAfterLayoutDelay(): Promise<void> {
  const smokeWindow = window as CitationGraphSmokeWindow;
  const delayMs = Number(smokeWindow.__AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_DELAY_MS__ ?? 0);
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  smokeWindow.__AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_COUNT__ =
    Number(smokeWindow.__AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_COUNT__ ?? 0) + 1;
  await new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

async function smokeBuildCitationGraph(input: {
  doi: string;
}): Promise<CitationGraph | null | undefined> {
  return (window as CitationGraphSmokeWindow).__AURASCHOLAR_SMOKE_BUILD_CITATION_GRAPH__?.(input);
}

function safeParseCachedGraph(payload: string): CitationGraph | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    return isCitationGraph(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isCitationGraph(value: unknown): value is CitationGraph {
  if (!isRecord(value)) return false;
  if (
    typeof value.centerId !== "string" ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges)
  ) {
    return false;
  }
  if (typeof value.truncated !== "boolean") return false;
  return (
    value.nodes.every(isGraphNode) &&
    value.nodes.some((node) => isRecord(node) && node.id === value.centerId) &&
    value.edges.every(isGraphEdge)
  );
}

function isGraphNode(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.title !== "string") return false;
  if (value.relation !== "center" && value.relation !== "reference" && value.relation !== "citer") {
    return false;
  }
  if (!isOptionalFiniteNumber(value.year)) return false;
  if (!isFiniteNumber(value.citedByCount)) return false;
  if (!isOptionalString(value.doi)) return false;
  if (!isOptionalString(value.venue)) return false;
  if (!isOptionalString(value.firstAuthor)) return false;
  return true;
}

function isGraphEdge(value: unknown): boolean {
  return isRecord(value) && typeof value.source === "string" && typeof value.target === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function relationLabel(relation: PositionedNode["relation"]): string {
  if (relation === "center") return "中心论文";
  if (relation === "reference") return "参考文献";
  return "施引文献";
}

function clampGraphZoom(value: number): number {
  return Math.min(MAX_GRAPH_ZOOM, Math.max(MIN_GRAPH_ZOOM, value));
}

function compactGraphTitle(title: string, length = 30): string {
  return title.length > length ? `${title.slice(0, length)}...` : title;
}

export function CitationGraphView({ doi, height = 520 }: { doi: string; height?: number }) {
  // 以此为中心展开 re-centers locally without touching the caller.
  const [centerDoi, setCenterDoi] = useState(doi);
  const [layout, setLayout] = useState<GraphLayout | null>(null);
  const [centerTitle, setCenterTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [hovered, setHovered] = useState<PositionedNode | null>(null);
  const [selected, setSelected] = useState<PositionedNode | null>(null);
  const [inLibrary, setInLibrary] = useState<Set<string>>(new Set());
  const [importingDoi, setImportingDoi] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<ImportNotice | null>(null);
  const [focus, setFocus] = useState<GraphFocus>("all");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [expanded, setExpanded] = useState(false);
  const importingDoiRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);
  const dragRef = useRef<{
    originX: number;
    originY: number;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);

  const desktopRuntime = isDesktopRuntime();

  useEffect(() => {
    setCenterDoi(doi);
  }, [doi]);

  useEffect(() => {
    let cancelled = false;
    const seq = ++loadSeqRef.current;
    const isCurrent = () => !cancelled && loadSeqRef.current === seq;

    async function loadGraph() {
      const requestedDoi = centerDoi.trim();
      if (!requestedDoi) {
        setLayout(null);
        setCenterTitle("");
        setError(null);
        setSelected(null);
        setHovered(null);
        setImportNotice(null);
        setInLibrary(new Set());
        setLoading(false);
        return;
      }
      setFocus("all");
      setZoom(1);
      setPan({ x: 0, y: 0 });
      if (!desktopRuntime) {
        const previewLayout = layoutTimeline(PREVIEW_CITATION_GRAPH);
        setLayout(previewLayout);
        setCenterTitle(previewLayout.nodes.find((node) => node.relation === "center")?.title ?? "");
        setError(null);
        setSelected(null);
        setHovered(null);
        setImportNotice(null);
        setInLibrary(new Set(["10.48550/arXiv.1706.03762"]));
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setSelected(null);
      setHovered(null);
      setImportNotice(null);
      setInLibrary(new Set());
      try {
        const db = await getDb();
        const cached = await db.query<{ payload_json: string; fetched_at: number }>(
          `SELECT payload_json, fetched_at FROM graph_cache WHERE work_id = ?`,
          [requestedDoi],
        );
        let graph: CitationGraph | null = null;
        if (cached[0] && Date.now() - cached[0].fetched_at < GRAPH_CACHE_TTL) {
          graph = safeParseCachedGraph(cached[0].payload_json);
          if (!graph) {
            await db.run(`DELETE FROM graph_cache WHERE work_id = ?`, [requestedDoi]);
          }
        }
        if (!graph) {
          const smokeGraph = await smokeBuildCitationGraph({ doi: requestedDoi });
          const builtGraph =
            smokeGraph !== undefined
              ? smokeGraph
              : await buildCitationGraph(ctx, { doi: requestedDoi });
          graph = isCitationGraph(builtGraph) ? builtGraph : null;
          if (graph) {
            await db.run(
              `INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
              [requestedDoi, JSON.stringify(graph), Date.now()],
            );
          }
        }
        if (!isCurrent()) return;
        if (!graph) {
          setError("OpenAlex 中找不到这篇论文");
          setLayout(null);
          setCenterTitle("");
          return;
        }
        const nextLayout = layoutTimeline(graph);
        await waitForGraphSmokeAfterLayoutDelay();
        if (!isCurrent()) return;
        setLayout(nextLayout);
        setCenterTitle(nextLayout.nodes.find((node) => node.relation === "center")?.title ?? "");
        const dois = nextLayout.nodes.map((node) => node.doi).filter(Boolean) as string[];
        if (dois.length > 0) {
          const placeholders = dois.map(() => "?").join(",");
          const rows = await db.query<{ doi: string }>(
            `SELECT doi FROM works WHERE doi IN (${placeholders}) AND deleted_at IS NULL`,
            dois,
          );
          if (isCurrent()) setInLibrary(new Set(rows.map((row) => row.doi)));
        }
      } catch (e) {
        if (isCurrent()) setError(describeSafeError(e));
      } finally {
        if (isCurrent()) setLoading(false);
      }
    }

    void loadGraph();
    return () => {
      cancelled = true;
    };
  }, [centerDoi, desktopRuntime, reloadNonce]);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  const importNode = useCallback(
    async (node: PositionedNode) => {
      if (!node.doi || !desktopRuntime || importingDoiRef.current) return;
      const startedAt = Date.now();
      importingDoiRef.current = node.doi;
      setImportingDoi(node.doi);
      setImportNotice({ message: `正在将《${node.title}》加入文献库...`, tone: "busy" });
      try {
        const { ingestFromInput } = await import("../services/library");
        const result = await ingestFromInput(node.doi);
        await waitForMinimumElapsed(startedAt, MIN_GRAPH_IMPORT_BUSY_MS);
        if (!result) {
          setImportNotice({
            message: "没有解析出可入库文献，请换一个节点或稍后重试。",
            tone: "danger",
          });
          return;
        }
        setInLibrary((prev) => new Set([...prev, node.doi!]));
        window.dispatchEvent(new Event("aurascholar:library-updated"));
        setImportNotice({
          message: result.deduped
            ? `已在文献库中更新《${result.title}》。`
            : `已加入文献库：《${result.title}》。`,
          tone: "success",
        });
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_GRAPH_IMPORT_BUSY_MS);
        setImportNotice({
          message: `入库失败:${describeSafeError(e)}`,
          tone: "danger",
        });
      } finally {
        importingDoiRef.current = null;
        setImportingDoi(null);
      }
    },
    [desktopRuntime],
  );

  const selectNode = useCallback((node: PositionedNode) => {
    setSelected(node);
    setImportNotice(null);
  }, []);

  const retryGraph = useCallback(() => {
    setReloadNonce((value) => value + 1);
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setZoom((value) => clampGraphZoom(value * factor));
  }, []);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setZoom((value) => clampGraphZoom(value * (event.deltaY > 0 ? 0.9 : 1.1)));
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || (event.target as Element).closest(".citation-graph-node")) return;
      dragRef.current = {
        originX: event.clientX,
        originY: event.clientY,
        pointerId: event.pointerId,
        startX: pan.x,
        startY: pan.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [pan.x, pan.y],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !layout) return;
      const scale = layout.width / Math.max(1, event.currentTarget.clientWidth);
      setPan({
        x: drag.startX + ((event.clientX - drag.originX) * scale) / zoom,
        y: drag.startY + ((event.clientY - drag.originY) * scale) / zoom,
      });
    },
    [layout, zoom],
  );

  const finishPointerDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const selectNodeFromKeyboard = useCallback(
    (event: KeyboardEvent<SVGCircleElement>, node: PositionedNode) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectNode(node);
    },
    [selectNode],
  );

  const visibleNodeIds = useMemo(() => {
    if (!layout) return new Set<string>();
    return new Set(
      layout.nodes
        .filter((node) => {
          if (node.relation === "center" || focus === "all") return true;
          if (focus === "library") return Boolean(node.doi && inLibrary.has(node.doi));
          return node.relation === focus;
        })
        .map((node) => node.id),
    );
  }, [focus, inLibrary, layout]);

  const edgePaths = useMemo(() => {
    if (!layout) return [];
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    return layout.edges.flatMap((edge) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      return source && target && visibleNodeIds.has(source.id) && visibleNodeIds.has(target.id)
        ? [{ source, target, key: `${edge.source}-${edge.target}` }]
        : [];
    });
  }, [layout, visibleNodeIds]);

  const yearRange = useMemo(() => {
    if (!layout) return { min: 2000, max: 2025 };
    const known = layout.nodes.filter((node) => node.year).map((node) => node.year!);
    if (known.length === 0) return { min: 2000, max: 2025 };
    return { min: Math.min(...known), max: Math.max(...known) };
  }, [layout]);

  const counts = useMemo(() => {
    if (!layout) return { references: 0, citers: 0, library: 0 };
    return {
      references: layout.nodes.filter((node) => node.relation === "reference").length,
      citers: layout.nodes.filter((node) => node.relation === "citer").length,
      library: layout.nodes.filter((node) => node.doi && inLibrary.has(node.doi)).length,
    };
  }, [inLibrary, layout]);

  const story = useMemo(() => {
    if (!layout) return { earliestReference: null, latestCiter: null };
    const references = layout.nodes
      .filter((node) => node.relation === "reference")
      .sort((a, b) => (a.year ?? Number.MAX_SAFE_INTEGER) - (b.year ?? Number.MAX_SAFE_INTEGER));
    const citers = layout.nodes
      .filter((node) => node.relation === "citer")
      .sort((a, b) => (b.citedByCount ?? 0) - (a.citedByCount ?? 0));
    return {
      earliestReference: references[0] ?? null,
      latestCiter: citers[0] ?? null,
    };
  }, [layout]);

  const active =
    (selected && visibleNodeIds.has(selected.id) ? selected : null) ??
    (hovered && visibleNodeIds.has(hovered.id) ? hovered : null);
  const activeImporting = Boolean(active?.doi && importingDoi === active.doi);
  const graphActionBusy = importingDoi !== null;

  if (loading && !layout) {
    return (
      <div className="citation-graph-state">
        <Badge variant="neutral">OpenAlex</Badge>
        <h3>构建引文图谱中...</h3>
        <p>正在抓取中心论文、参考文献和施引文献。完成后会缓存一周。</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="citation-graph-state citation-graph-state--error">
        <Badge variant="danger">查询失败</Badge>
        <h3>暂时无法构建图谱</h3>
        <p>{error}</p>
        <div className="citation-graph-state__actions">
          <Button type="button" onClick={retryGraph}>
            重试构建
          </Button>
          {centerDoi !== doi && (
            <Button type="button" variant="secondary" onClick={() => setCenterDoi(doi)}>
              回到本文
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!layout) {
    return (
      <div className="citation-graph-state">
        <Badge variant="neutral">Ready</Badge>
        <h3>等待 DOI</h3>
        <p>输入 DOI 后会展示引用本文和本文引用的论文。</p>
      </div>
    );
  }

  return (
    <div className={`citation-graph-view${expanded ? " citation-graph-view--expanded" : ""}`}>
      <div className="citation-graph-head">
        <div>
          <h3>{centerTitle || centerDoi}</h3>
          <p>{desktopRuntime ? centerDoi : "浏览器预览样例图谱"}</p>
        </div>
        <div className="citation-graph-head__actions">
          {!desktopRuntime && <Badge variant="warning">样例图谱</Badge>}
          {desktopRuntime && centerDoi !== doi && (
            <Button variant="secondary" onClick={() => setCenterDoi(doi)}>
              回到本文
            </Button>
          )}
          <Button variant="secondary" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "退出全屏" : "全屏查看"}
          </Button>
        </div>
      </div>

      <div className="citation-graph-story" aria-label="引文脉络摘要">
        <button
          type="button"
          className={focus === "reference" ? "citation-graph-story__active" : ""}
          onClick={() => setFocus(focus === "reference" ? "all" : "reference")}
        >
          <span>思想来源 · {counts.references}</span>
          <strong>{story.earliestReference?.title ?? "暂无参考文献"}</strong>
          <small>{story.earliestReference?.year ?? "年份未知"}</small>
        </button>
        <button
          type="button"
          className={focus === "all" ? "citation-graph-story__active" : ""}
          onClick={() => setFocus("all")}
        >
          <span>中心论文</span>
          <strong>{centerTitle || centerDoi}</strong>
          <small>连接前序基础与后续影响</small>
        </button>
        <button
          type="button"
          className={focus === "citer" ? "citation-graph-story__active" : ""}
          onClick={() => setFocus(focus === "citer" ? "all" : "citer")}
        >
          <span>关键后续 · {counts.citers}</span>
          <strong>{story.latestCiter?.title ?? "暂无施引文献"}</strong>
          <small>最高被引 {story.latestCiter?.citedByCount ?? 0}</small>
        </button>
      </div>

      <div className="citation-graph-toolbar">
        <div className="citation-graph-focus" aria-label="脉络范围">
          {(
            [
              ["all", "全部"],
              ["reference", `来源 ${counts.references}`],
              ["citer", `后续 ${counts.citers}`],
              ["library", `在库 ${counts.library}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={focus === value ? "citation-graph-focus__active" : ""}
              onClick={() => setFocus(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="citation-graph-zoom" aria-label="图谱缩放">
          <button type="button" aria-label="缩小图谱" onClick={() => zoomBy(0.85)}>
            -
          </button>
          <output aria-live="polite">{Math.round(zoom * 100)}%</output>
          <button type="button" aria-label="放大图谱" onClick={() => zoomBy(1.18)}>
            +
          </button>
          <button type="button" onClick={resetView}>
            适配
          </button>
        </div>
      </div>

      <div
        className={`citation-graph-canvas${dragRef.current ? " citation-graph-canvas--dragging" : ""}`}
        style={{ minHeight: height }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerDrag}
        onPointerCancel={finishPointerDrag}
      >
        {loading && <div className="citation-graph-loading">正在刷新图谱...</div>}
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} aria-label="引文时间线图谱">
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {layout.years.map((year) => {
              const x =
                60 +
                ((year - yearRange.min) / Math.max(1, yearRange.max - yearRange.min)) *
                  (layout.width - 120);
              return (
                <g key={year}>
                  <line
                    x1={x}
                    x2={x}
                    y1={20}
                    y2={layout.height - 30}
                    stroke="var(--color-border)"
                    strokeDasharray="2 4"
                  />
                  <text
                    x={x}
                    y={layout.height - 10}
                    textAnchor="middle"
                    fontSize={12}
                    fill="var(--color-text-muted)"
                    fontFamily="var(--font-mono)"
                  >
                    {year}
                  </text>
                </g>
              );
            })}
            {edgePaths.map(({ source, target, key }) => (
              <line
                key={key}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke="var(--color-border-strong)"
                strokeWidth={source.relation === "center" || target.relation === "center" ? 1.2 : 0.5}
                opacity={hovered && hovered.id !== source.id && hovered.id !== target.id ? 0.15 : 0.6}
              />
            ))}
            {layout.nodes
              .filter((node) => visibleNodeIds.has(node.id))
              .map((node) => {
                const showLabel =
                  node.relation === "center" || selected?.id === node.id || hovered?.id === node.id;
                return (
                  <g key={node.id}>
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.size}
                      fill={RELATION_COLOR[node.relation]}
                      stroke={
                        node.doi && inLibrary.has(node.doi)
                          ? "var(--color-success)"
                          : "var(--color-surface)"
                      }
                      strokeWidth={node.doi && inLibrary.has(node.doi) ? 2.5 : 1}
                      opacity={hovered && hovered.id !== node.id ? 0.5 : 1}
                      className="citation-graph-node"
                      role="button"
                      tabIndex={0}
                      aria-label={`${node.title}，${relationLabel(node.relation)}${
                        node.doi ? `，DOI ${node.doi}` : ""
                      }`}
                      onFocus={() => setHovered(node)}
                      onBlur={() => setHovered(null)}
                      onMouseEnter={() => setHovered(node)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => selectNode(node)}
                      onKeyDown={(event) => selectNodeFromKeyboard(event, node)}
                    />
                    {showLabel && (
                      <text
                        className="citation-graph-node-label"
                        x={node.x}
                        y={node.y + node.size + 14}
                        textAnchor="middle"
                      >
                        {compactGraphTitle(node.title)}
                      </text>
                    )}
                  </g>
                );
              })}
          </g>
        </svg>
      </div>

      <div className="citation-graph-inspector">
        {active ? (
          <div>
            <h4>{active.title}</h4>
            <div className="citation-graph-badges">
              {active.year && <Badge variant="neutral">{active.year}</Badge>}
              <Badge variant="neutral">被引 {active.citedByCount}</Badge>
              <Badge variant={active.relation === "citer" ? "warning" : "neutral"}>
                {relationLabel(active.relation)}
              </Badge>
              {active.doi && inLibrary.has(active.doi) && <Badge variant="success">已在库</Badge>}
            </div>
            <div className="citation-graph-actions">
              {desktopRuntime && active.doi && !inLibrary.has(active.doi) && (
                <Button
                  aria-busy={activeImporting || undefined}
                  disabled={graphActionBusy}
                  onClick={() => void importNode(active)}
                >
                  {activeImporting ? "入库中..." : "加入文献库"}
                </Button>
              )}
              {desktopRuntime && active.doi && active.relation !== "center" && (
                <Button
                  variant="secondary"
                  disabled={graphActionBusy}
                  onClick={() => setCenterDoi(active.doi!)}
                >
                  以此为中心展开
                </Button>
              )}
            </div>
            <InlineNotice
              className="citation-graph-notice"
              message={importNotice?.message}
              tone={importNotice?.tone}
            />
          </div>
        ) : (
          <p>灰色为思想来源，橙色为后续影响，绿圈代表已在文献库。</p>
        )}
      </div>
    </div>
  );
}
