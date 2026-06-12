// Citation graph view: timeline layout, hover details, click-to-ingest.
// SVG rendering — the one-hop neighborhood is ≤ ~100 nodes, well within SVG
// territory; sigma.js/WebGL is reserved for future multi-hop views.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { buildCitationGraph, layoutTimeline, type GraphLayout, type PositionedNode } from "@aurascholar/core";
import type { ConnectorContext } from "@aurascholar/connectors";
import { WorksRepo } from "@aurascholar/db";
import { Badge, Button, Card, Input } from "@aurascholar/ui";
import { getDb } from "../services/tauri-db";
import { tauriHttp } from "../services/tauri-platform";
import { ingestFromInput } from "../services/library";

const ctx: ConnectorContext = { http: tauriHttp, mailto: "contact@aurascholar.app" };

const RELATION_COLOR: Record<string, string> = {
  center: "var(--color-accent)",
  reference: "var(--color-text-faint)",
  citer: "var(--color-warning)",
};

const GRAPH_CACHE_TTL = 7 * 86_400_000;

export function GraphPage() {
  const [params] = useSearchParams();
  const [doi, setDoi] = useState(params.get("doi") ?? "");
  const [layout, setLayout] = useState<GraphLayout | null>(null);
  const [centerTitle, setCenterTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<PositionedNode | null>(null);
  const [selected, setSelected] = useState<PositionedNode | null>(null);
  const [inLibrary, setInLibrary] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const load = useCallback(async (doiInput: string) => {
    const normalized = doiInput.trim();
    if (!normalized) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const db = await getDb();
      // Serve from cache when fresh.
      const cached = await db.query<{ payload_json: string; fetched_at: number }>(
        `SELECT payload_json, fetched_at FROM graph_cache WHERE work_id = ?`,
        [normalized],
      );
      let graph;
      if (cached[0] && Date.now() - cached[0].fetched_at < GRAPH_CACHE_TTL) {
        graph = JSON.parse(cached[0].payload_json);
      } else {
        graph = await buildCitationGraph(ctx, { doi: normalized });
        if (graph) {
          await db.run(
            `INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
            [normalized, JSON.stringify(graph), Date.now()],
          );
        }
      }
      if (!graph) {
        setError("OpenAlex 中找不到这篇论文 — 检查 DOI 是否正确");
        setLayout(null);
        return;
      }
      const l = layoutTimeline(graph);
      setLayout(l);
      setCenterTitle(l.nodes.find((n) => n.relation === "center")?.title ?? "");
      // Mark which graph nodes are already in the library.
      const dois = l.nodes.map((n) => n.doi).filter(Boolean) as string[];
      if (dois.length) {
        const placeholders = dois.map(() => "?").join(",");
        const rows = await db.query<{ doi: string }>(
          `SELECT doi FROM works WHERE doi IN (${placeholders}) AND deleted_at IS NULL`,
          dois,
        );
        setInLibrary(new Set(rows.map((r) => r.doi)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load when arriving with ?doi=
  useEffect(() => {
    const initial = params.get("doi");
    if (initial) void load(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const importNode = useCallback(
    async (node: PositionedNode) => {
      if (!node.doi) return;
      setImporting(true);
      try {
        await ingestFromInput(node.doi);
        setInLibrary((prev) => new Set([...prev, node.doi!]));
      } finally {
        setImporting(false);
      }
    },
    [],
  );

  const edgePaths = useMemo(() => {
    if (!layout) return [];
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    return layout.edges.flatMap((e) => {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      return s && t ? [{ s, t, key: `${e.source}-${e.target}` }] : [];
    });
  }, [layout]);

  return (
    <div>
      <h1 className="app-page-title">引文脉络</h1>
      <p className="app-page-subtitle">
        横轴 = 发表年份 · 节点大小 = 被引量 · 灰色 = 它引用的 · 橙色 = 引用它的
      </p>

      <Card style={{ maxWidth: 720, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <Input
            placeholder="输入 DOI,例如 10.48550/arxiv.1706.03762"
            value={doi}
            onChange={(e) => setDoi(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void load(doi)}
          />
          <Button onClick={() => void load(doi)} disabled={loading}>
            {loading ? "构建中…" : "生成图谱"}
          </Button>
        </div>
        {error && (
          <p style={{ color: "var(--color-danger)", fontSize: 13, margin: "8px 0 0" }}>{error}</p>
        )}
      </Card>

      {layout && (
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <Card style={{ flex: 1, padding: 8, overflow: "hidden" }}>
            <p
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 14,
                margin: "4px 8px 8px",
              }}
            >
              {centerTitle}
            </p>
            <svg
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              style={{ width: "100%", height: "auto", display: "block" }}
            >
              {/* Year gridlines */}
              {layout.years.map((year) => {
                const known = layout.nodes.filter((n) => n.year);
                const minY = Math.min(...known.map((n) => n.year!));
                const maxY = Math.max(...known.map((n) => n.year!));
                const x =
                  60 + ((year - minY) / Math.max(1, maxY - minY)) * (layout.width - 120);
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
              {/* Edges */}
              {edgePaths?.map(({ s, t, key }) => (
                <line
                  key={key}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke="var(--color-border-strong)"
                  strokeWidth={s.relation === "center" || t.relation === "center" ? 1.2 : 0.5}
                  opacity={
                    hovered && hovered.id !== s.id && hovered.id !== t.id ? 0.15 : 0.6
                  }
                />
              ))}
              {/* Nodes */}
              {layout.nodes.map((n) => (
                <circle
                  key={n.id}
                  cx={n.x}
                  cy={n.y}
                  r={n.size}
                  fill={RELATION_COLOR[n.relation]}
                  stroke={
                    n.doi && inLibrary.has(n.doi)
                      ? "var(--color-success)"
                      : "var(--color-surface)"
                  }
                  strokeWidth={n.doi && inLibrary.has(n.doi) ? 2.5 : 1}
                  opacity={hovered && hovered.id !== n.id ? 0.5 : 1}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHovered(n)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => setSelected(n)}
                />
              ))}
            </svg>
          </Card>

          <Card style={{ width: 280, flexShrink: 0 }}>
            {selected ?? hovered ? (
              <NodeDetails
                node={(selected ?? hovered)!}
                inLibrary={!!(selected ?? hovered)!.doi && inLibrary.has((selected ?? hovered)!.doi!)}
                importing={importing}
                onImport={importNode}
                onExplore={(n) => {
                  if (n.doi) {
                    setDoi(n.doi);
                    void load(n.doi);
                  }
                }}
              />
            ) : (
              <p className="au-text-muted" style={{ fontSize: 13, margin: 0 }}>
                悬停查看论文信息,点击固定选择
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function NodeDetails({
  node,
  inLibrary,
  importing,
  onImport,
  onExplore,
}: {
  node: PositionedNode;
  inLibrary: boolean;
  importing: boolean;
  onImport: (n: PositionedNode) => void;
  onExplore: (n: PositionedNode) => void;
}) {
  return (
    <div>
      <p style={{ fontFamily: "var(--font-heading)", fontSize: 14, marginTop: 0 }}>{node.title}</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {node.year && <Badge variant="neutral">{node.year}</Badge>}
        <Badge variant="neutral">被引 {node.citedByCount}</Badge>
        {node.relation === "reference" && <Badge variant="neutral">参考文献</Badge>}
        {node.relation === "citer" && <Badge variant="warning">施引文献</Badge>}
        {inLibrary && <Badge variant="success">已在库</Badge>}
      </div>
      {node.firstAuthor && (
        <p className="au-text-muted" style={{ fontSize: 13, margin: "0 0 4px" }}>
          {node.firstAuthor} 等{node.venue && ` · ${node.venue}`}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
        {node.doi && !inLibrary && (
          <Button
            style={{ fontSize: 13 }}
            disabled={importing}
            onClick={() => onImport(node)}
          >
            {importing ? "入库中…" : "📚 加入文献库"}
          </Button>
        )}
        {node.doi && node.relation !== "center" && (
          <Button variant="secondary" style={{ fontSize: 13 }} onClick={() => onExplore(node)}>
            🕸️ 以此为中心展开
          </Button>
        )}
      </div>
    </div>
  );
}
