// Reusable citation graph view (timeline layout). Used inside the reader's
// 脉络 tab and the standalone /graph deep-link page.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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

const ctx: ConnectorContext = { http: auraHttp, mailto: "contact@aurascholar.app" };

const RELATION_COLOR: Record<string, string> = {
  center: "var(--color-accent)",
  reference: "var(--color-text-faint)",
  citer: "var(--color-warning)",
};

const GRAPH_CACHE_TTL = 7 * 86_400_000;
const MIN_GRAPH_IMPORT_BUSY_MS = 250;

interface ImportNotice {
  message: string;
  tone: InlineNoticeTone;
}


async function waitForMinimumElapsed(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
}

function relationLabel(relation: PositionedNode["relation"]): string {
  if (relation === "center") return "中心论文";
  if (relation === "reference") return "参考文献";
  return "施引文献";
}

export function CitationGraphView({ doi, height = 520 }: { doi: string; height?: number }) {
  // 以此为中心展开 re-centers locally without touching the caller.
  const [centerDoi, setCenterDoi] = useState(doi);
  const [layout, setLayout] = useState<GraphLayout | null>(null);
  const [centerTitle, setCenterTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<PositionedNode | null>(null);
  const [selected, setSelected] = useState<PositionedNode | null>(null);
  const [inLibrary, setInLibrary] = useState<Set<string>>(new Set());
  const [importingDoi, setImportingDoi] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<ImportNotice | null>(null);
  const importingDoiRef = useRef<string | null>(null);

  const desktopRuntime = isDesktopRuntime();

  useEffect(() => setCenterDoi(doi), [doi]);

  useEffect(() => {
    let cancelled = false;

    async function loadGraph() {
      if (!centerDoi.trim()) {
        setLayout(null);
        setCenterTitle("");
        return;
      }
      if (!desktopRuntime) {
        setLayout(null);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      setSelected(null);
      setImportNotice(null);
      setInLibrary(new Set());
      try {
        const db = await getDb();
        const cached = await db.query<{ payload_json: string; fetched_at: number }>(
          `SELECT payload_json, fetched_at FROM graph_cache WHERE work_id = ?`,
          [centerDoi],
        );
        let graph: CitationGraph | null = null;
        if (cached[0] && Date.now() - cached[0].fetched_at < GRAPH_CACHE_TTL) {
          graph = JSON.parse(cached[0].payload_json) as CitationGraph;
        } else {
          graph = await buildCitationGraph(ctx, { doi: centerDoi });
          if (graph) {
            await db.run(
              `INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
              [centerDoi, JSON.stringify(graph), Date.now()],
            );
          }
        }
        if (cancelled) return;
        if (!graph) {
          setError("OpenAlex 中找不到这篇论文");
          setLayout(null);
          return;
        }
        const nextLayout = layoutTimeline(graph);
        setLayout(nextLayout);
        setCenterTitle(nextLayout.nodes.find((node) => node.relation === "center")?.title ?? "");
        const dois = nextLayout.nodes.map((node) => node.doi).filter(Boolean) as string[];
        if (dois.length > 0) {
          const placeholders = dois.map(() => "?").join(",");
          const rows = await db.query<{ doi: string }>(
            `SELECT doi FROM works WHERE doi IN (${placeholders}) AND deleted_at IS NULL`,
            dois,
          );
          if (!cancelled) setInLibrary(new Set(rows.map((row) => row.doi)));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadGraph();
    return () => {
      cancelled = true;
    };
  }, [centerDoi, desktopRuntime]);

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
        setImportNotice({
          message: result.deduped
            ? `已在文献库中更新《${result.title}》。`
            : `已加入文献库：《${result.title}》。`,
          tone: "success",
        });
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_GRAPH_IMPORT_BUSY_MS);
        setImportNotice({
          message: `入库失败:${e instanceof Error ? e.message : String(e)}`,
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

  const selectNodeFromKeyboard = useCallback(
    (event: KeyboardEvent<SVGCircleElement>, node: PositionedNode) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectNode(node);
    },
    [selectNode],
  );

  const edgePaths = useMemo(() => {
    if (!layout) return [];
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    return layout.edges.flatMap((edge) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      return source && target ? [{ source, target, key: `${edge.source}-${edge.target}` }] : [];
    });
  }, [layout]);

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

  const active = selected ?? hovered;
  const activeImporting = Boolean(active?.doi && importingDoi === active.doi);
  const graphActionBusy = importingDoi !== null;

  if (!desktopRuntime) {
    return (
      <div className="citation-graph-state citation-graph-state--preview">
        <Badge variant="warning">浏览器预览</Badge>
        <h3>桌面应用中构建引文图谱</h3>
        <p>图谱需要访问本地缓存数据库和 OpenAlex 网络接口，浏览器预览只展示界面边界。</p>
      </div>
    );
  }

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
    <div className="citation-graph-view">
      <div className="citation-graph-head">
        <div>
          <h3>{centerTitle || centerDoi}</h3>
          <p>{centerDoi}</p>
        </div>
        {centerDoi !== doi && (
          <Button variant="secondary" onClick={() => setCenterDoi(doi)}>
            回到本文
          </Button>
        )}
      </div>

      <div className="citation-graph-metrics">
        <span>
          <strong>{counts.references}</strong>
          <small>参考文献</small>
        </span>
        <span>
          <strong>{counts.citers}</strong>
          <small>施引文献</small>
        </span>
        <span>
          <strong>{counts.library}</strong>
          <small>已在库</small>
        </span>
      </div>

      <div className="citation-graph-canvas" style={{ minHeight: height }}>
        {loading && <div className="citation-graph-loading">正在刷新图谱...</div>}
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} aria-label="引文时间线图谱">
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
          {layout.nodes.map((node) => (
            <circle
              key={node.id}
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
          ))}
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
              {active.doi && !inLibrary.has(active.doi) && (
                <Button
                  aria-busy={activeImporting || undefined}
                  disabled={graphActionBusy}
                  onClick={() => void importNode(active)}
                >
                  {activeImporting ? "入库中..." : "加入文献库"}
                </Button>
              )}
              {active.doi && active.relation !== "center" && (
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
          <p>悬停查看，点击固定。灰色为参考文献，橙色为施引文献，绿圈代表已在文献库。</p>
        )}
      </div>
    </div>
  );
}
