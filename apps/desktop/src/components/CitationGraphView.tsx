// Reusable citation graph view (timeline layout). Used inside the reader's
// 脉络 tab and the standalone /graph deep-link page.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildCitationGraph,
  layoutTimeline,
  type GraphLayout,
  type PositionedNode,
} from "@aurascholar/core";
import type { ConnectorContext } from "@aurascholar/connectors";
import { Badge, Button } from "@aurascholar/ui";
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
  const [importing, setImporting] = useState(false);

  useEffect(() => setCenterDoi(doi), [doi]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      setSelected(null);
      try {
        const db = await getDb();
        const cached = await db.query<{ payload_json: string; fetched_at: number }>(
          `SELECT payload_json, fetched_at FROM graph_cache WHERE work_id = ?`,
          [centerDoi],
        );
        let graph;
        if (cached[0] && Date.now() - cached[0].fetched_at < GRAPH_CACHE_TTL) {
          graph = JSON.parse(cached[0].payload_json);
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
        const l = layoutTimeline(graph);
        setLayout(l);
        setCenterTitle(l.nodes.find((n) => n.relation === "center")?.title ?? "");
        const dois = l.nodes.map((n) => n.doi).filter(Boolean) as string[];
        if (dois.length) {
          const placeholders = dois.map(() => "?").join(",");
          const rows = await db.query<{ doi: string }>(
            `SELECT doi FROM works WHERE doi IN (${placeholders}) AND deleted_at IS NULL`,
            dois,
          );
          if (!cancelled) setInLibrary(new Set(rows.map((r) => r.doi)));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [centerDoi]);

  const importNode = useCallback(async (node: PositionedNode) => {
    if (!node.doi) return;
    setImporting(true);
    try {
      await ingestFromInput(node.doi);
      setInLibrary((prev) => new Set([...prev, node.doi!]));
    } finally {
      setImporting(false);
    }
  }, []);

  const edgePaths = useMemo(() => {
    if (!layout) return [];
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    return layout.edges.flatMap((e) => {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      return s && t ? [{ s, t, key: `${e.source}-${e.target}` }] : [];
    });
  }, [layout]);

  if (loading && !layout) {
    return <p className="au-text-muted" style={{ padding: 24, fontSize: 13 }}>构建引文图谱中…</p>;
  }
  if (error) {
    return <p style={{ padding: 24, fontSize: 13, color: "var(--color-danger)" }}>{error}</p>;
  }
  if (!layout) return null;

  const active = selected ?? hovered;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <p style={{ fontFamily: "var(--font-heading)", fontSize: 13, margin: "8px 12px", flexShrink: 0 }}>
        {centerTitle}
        {centerDoi !== doi && (
          <button className="au-annsidebar__add-comment" style={{ marginLeft: 8 }} onClick={() => setCenterDoi(doi)}>
            ← 回到本文
          </button>
        )}
      </p>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ width: "100%", minHeight: height, display: "block" }}>
          {layout.years.map((year) => {
            const known = layout.nodes.filter((n) => n.year);
            const minY = Math.min(...known.map((n) => n.year!));
            const maxY = Math.max(...known.map((n) => n.year!));
            const x = 60 + ((year - minY) / Math.max(1, maxY - minY)) * (layout.width - 120);
            return (
              <g key={year}>
                <line x1={x} x2={x} y1={20} y2={layout.height - 30} stroke="var(--color-border)" strokeDasharray="2 4" />
                <text x={x} y={layout.height - 10} textAnchor="middle" fontSize={12} fill="var(--color-text-muted)" fontFamily="var(--font-mono)">
                  {year}
                </text>
              </g>
            );
          })}
          {edgePaths.map(({ s, t, key }) => (
            <line
              key={key}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke="var(--color-border-strong)"
              strokeWidth={s.relation === "center" || t.relation === "center" ? 1.2 : 0.5}
              opacity={hovered && hovered.id !== s.id && hovered.id !== t.id ? 0.15 : 0.6}
            />
          ))}
          {layout.nodes.map((n) => (
            <circle
              key={n.id}
              cx={n.x}
              cy={n.y}
              r={n.size}
              fill={RELATION_COLOR[n.relation]}
              stroke={n.doi && inLibrary.has(n.doi) ? "var(--color-success)" : "var(--color-surface)"}
              strokeWidth={n.doi && inLibrary.has(n.doi) ? 2.5 : 1}
              opacity={hovered && hovered.id !== n.id ? 0.5 : 1}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered(n)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setSelected(n)}
            />
          ))}
        </svg>
      </div>
      <div
        style={{
          flexShrink: 0,
          borderTop: "var(--border-width) solid var(--color-border)",
          padding: 12,
          minHeight: 96,
          background: "var(--color-surface)",
        }}
      >
        {active ? (
          <div>
            <p style={{ fontFamily: "var(--font-heading)", fontSize: 13, margin: "0 0 6px" }}>{active.title}</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {active.year && <Badge variant="neutral">{active.year}</Badge>}
              <Badge variant="neutral">被引 {active.citedByCount}</Badge>
              {active.relation === "reference" && <Badge variant="neutral">参考文献</Badge>}
              {active.relation === "citer" && <Badge variant="warning">施引文献</Badge>}
              {active.doi && inLibrary.has(active.doi) && <Badge variant="success">已在库</Badge>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {active.doi && !inLibrary.has(active.doi) && (
                <Button style={{ fontSize: 12, padding: "5px 10px" }} disabled={importing} onClick={() => void importNode(active)}>
                  {importing ? "入库中…" : "📚 加入文献库"}
                </Button>
              )}
              {active.doi && active.relation !== "center" && (
                <Button variant="secondary" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => setCenterDoi(active.doi!)}>
                  🕸️ 以此为中心展开
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="au-text-muted" style={{ fontSize: 12, margin: 0 }}>
            悬停查看 · 点击固定 · 灰=本文引用的 · 橙=引用本文的 · 绿圈=已在库
          </p>
        )}
      </div>
    </div>
  );
}
