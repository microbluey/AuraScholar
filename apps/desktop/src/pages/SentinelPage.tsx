import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { normalizeDoi, SentinelRepo, type SentinelEventRow, type SentinelTaskRow } from "@aurascholar/db";
import { STATE_LABEL, SENTINEL_STATES, stateRank, type SentinelState } from "@aurascholar/core";
import { Badge, Button, Card, Input } from "@aurascholar/ui";
import { getDb } from "../services/tauri-db";
import { runDuePolls } from "../services/sentinel";

export function SentinelPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"doi" | "title">("doi");
  const [doi, setDoi] = useState("");
  const [title, setTitle] = useState("");
  const [hintVenue, setHintVenue] = useState("");
  const [hintAuthor, setHintAuthor] = useState("");
  const [tasks, setTasks] = useState<SentinelTaskRow[]>([]);
  const [eventsByTask, setEventsByTask] = useState<Map<string, SentinelEventRow[]>>(new Map());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!("aura" in window)) {
      setTasks([]);
      setEventsByTask(new Map());
      return;
    }
    const db = await getDb();
    const repo = new SentinelRepo(db);
    const list = await repo.list();
    setTasks(list);
    const map = new Map<string, SentinelEventRow[]>();
    for (const t of list) map.set(t.id, await repo.events(t.id));
    setEventsByTask(map);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAdd = useCallback(async () => {
    const db = await getDb();
    if (mode === "doi") {
      const normalized = normalizeDoi(doi);
      if (!normalized) {
        setMessage("DOI 格式不正确");
        return;
      }
      // Title is optional in DOI mode — fall back to the DOI as display name;
      // the first poll will backfill the real title from Crossref evidence.
      await new SentinelRepo(db).create({
        doi: normalized,
        title: title.trim() || normalized,
      });
    } else {
      if (!title.trim()) {
        setMessage("标题监控模式下必须填写论文标题");
        return;
      }
      await new SentinelRepo(db).create({
        title: title.trim(),
        hintVenue: hintVenue.trim() || undefined,
        hintAuthor: hintAuthor.trim() || undefined,
      });
    }
    setDoi("");
    setTitle("");
    setHintVenue("");
    setHintAuthor("");
    setMessage(
      mode === "doi"
        ? "已添加监控 — 首次检查将立即执行"
        : "已添加标题监控 — 哨兵会持续在 Crossref 搜索,找到匹配的 DOI 后自动转为精确监控",
    );
    await refresh();
    // Kick an immediate check so the user sees fresh state.
    void runDuePolls().then(() => refresh());
  }, [mode, doi, title, hintVenue, hintAuthor, refresh]);

  const handleCheckNow = useCallback(async () => {
    setBusy(true);
    setMessage("检查中…");
    try {
      const changes = await runDuePolls();
      setMessage(changes > 0 ? `发现 ${changes} 个状态变化!` : "已检查 — 暂无新进展");
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const handleForceCheck = useCallback(async (taskId: string) => {
    const db = await getDb();
    // Make it due now, then run.
    await db.run(`UPDATE sentinel_tasks SET next_poll_at = ? WHERE id = ?`, [Date.now(), taskId]);
    setBusy(true);
    try {
      await runDuePolls();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <div className="sentinel-page">
      <p className="app-page-kicker">Publication status radar</p>
      <h1 className="app-page-title">检索哨兵</h1>
      <p className="app-page-subtitle">
        论文被接收后填入 DOI,自动监控 注册 → 在线 → 正式出版 → 数据库收录 全过程
      </p>

      <Card className="sentinel-create-card">
        <div className="au-tablist sentinel-mode-tabs">
          <button
            className={`au-tab ${mode === "doi" ? "au-tab--active" : ""}`}
            onClick={() => setMode("doi")}
          >
            按 DOI 监控
          </button>
          <button
            className={`au-tab ${mode === "title" ? "au-tab--active" : ""}`}
            onClick={() => setMode("title")}
          >
            按标题监控(还没有 DOI)
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {mode === "doi" ? (
            <>
              <Input
                placeholder="DOI(Accept 邮件里的那个),例如 10.1109/TPAMI.2026.12345"
                value={doi}
                onChange={(e) => setDoi(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <Input
                  placeholder="论文标题(可选,用于列表展示)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
                />
                <Button onClick={() => void handleAdd()}>开始监控</Button>
              </div>
            </>
          ) : (
            <>
              <Input
                placeholder="论文标题(必填,哨兵会据此在 Crossref 持续搜索)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <Input
                  placeholder="期刊/会议名(可选,提高匹配准确度)"
                  value={hintVenue}
                  onChange={(e) => setHintVenue(e.target.value)}
                />
                <Input
                  placeholder="第一作者姓氏(可选)"
                  value={hintAuthor}
                  onChange={(e) => setHintAuthor(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
                />
                <Button onClick={() => void handleAdd()}>开始监控</Button>
              </div>
            </>
          )}
          {message && (
            <p style={{ fontSize: 13, margin: 0, color: "var(--color-text-secondary)" }}>
              {message}
            </p>
          )}
        </div>
      </Card>

      <div className="sentinel-toolbar">
        <span className="au-text-muted" style={{ fontSize: 13 }}>
          {tasks.filter((t) => t.status === "active").length} 个监控中 · 应用启动时自动补查,运行期间每小时检查
        </span>
        <Button
          variant="secondary"
          style={{ marginLeft: "auto", fontSize: 13 }}
          onClick={() => void handleCheckNow()}
          disabled={busy || tasks.length === 0}
        >
          {busy ? "检查中…" : "立即检查全部"}
        </Button>
      </div>

      <div className="sentinel-list">
        {tasks.map((task) => {
          const events = eventsByTask.get(task.id) ?? [];
          const currentRank = stateRank(task.current_state as SentinelState);
          return (
            <Card key={task.id} style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <strong style={{ fontFamily: "var(--font-heading)", fontSize: 15, flex: 1 }}>
                  {task.title}
                </strong>
                {task.status === "done" ? (
                  <Badge variant="success">监控完成</Badge>
                ) : task.status === "paused" ? (
                  <Badge variant="neutral">已暂停</Badge>
                ) : (
                  <Badge>{STATE_LABEL[task.current_state as SentinelState] ?? task.current_state}</Badge>
                )}
              </div>
              <p className="au-text-muted" style={{ fontSize: 12, margin: "4px 0 12px", fontFamily: "var(--font-mono)" }}>
                {task.doi ?? `标题监控中${task.hint_venue ? ` · ${task.hint_venue}` : ""}${task.hint_author ? ` · ${task.hint_author}` : ""} — 等待 DOI 出现`}
              </p>

              {/* Progress pipeline */}
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
                {SENTINEL_STATES.filter((s) => s !== "indexed_pubmed").map((s, i) => {
                  const reached = stateRank(s) <= currentRank;
                  return (
                    <div key={s} style={{ display: "flex", alignItems: "center", gap: 4, flex: i === 0 ? undefined : 1 }}>
                      {i > 0 && (
                        <div
                          style={{
                            flex: 1,
                            height: 2,
                            background: reached ? "var(--color-accent)" : "var(--color-border)",
                          }}
                        />
                      )}
                      <span
                        title={STATE_LABEL[s]}
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          flexShrink: 0,
                          background: reached ? "var(--color-accent)" : "var(--color-border)",
                          boxShadow: reached ? "var(--glow-accent)" : undefined,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
                <button
                  className="au-annsidebar__add-comment"
                  onClick={() => setExpanded(expanded === task.id ? null : task.id)}
                >
                  {expanded === task.id ? "收起" : `状态历史(${events.length})`}
                </button>
                {task.status === "active" && (
                  <button
                    className="au-annsidebar__add-comment"
                    onClick={() => void handleForceCheck(task.id)}
                  >
                    单独检查
                  </button>
                )}
                {task.work_id && (
                  <button
                    className="au-annsidebar__add-comment"
                    onClick={() => navigate(`/reader?work=${task.work_id}`)}
                  >
                    打开文献
                  </button>
                )}
                <span className="au-text-muted" style={{ marginLeft: "auto" }}>
                  {task.last_polled_at
                    ? `上次检查 ${new Date(task.last_polled_at).toLocaleString("zh-CN")}`
                    : "尚未检查"}
                </span>
              </div>

              {expanded === task.id && events.length > 0 && (
                <div style={{ marginTop: 12, borderTop: "var(--border-width) solid var(--color-border)", paddingTop: 12 }}>
                  {events.map((e) => (
                    <div key={e.id} style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 6 }}>
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-muted)", flexShrink: 0 }}>
                        {new Date(e.detected_at).toLocaleDateString("zh-CN")}
                      </span>
                      <span>
                        {STATE_LABEL[e.to_state as SentinelState] ?? e.to_state}
                        {e.evidence_json && (
                          <button
                            className="au-annsidebar__add-comment"
                            style={{ marginLeft: 8 }}
                            onClick={() => {
                              const blob = new Blob([e.evidence_json!], { type: "application/json" });
                              const a = document.createElement("a");
                              a.href = URL.createObjectURL(blob);
                              a.download = `证据-${e.to_state}-${new Date(e.detected_at).toISOString().slice(0, 10)}.json`;
                              a.click();
                              URL.revokeObjectURL(a.href);
                            }}
                          >
                            下载证据
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
        {tasks.length === 0 && (
          <p className="au-text-muted">
            还没有监控任务。收到 Accept 邮件后,把 DOI 填进来,剩下的交给哨兵。
          </p>
        )}
      </div>

      <p className="au-text-muted" style={{ fontSize: 12, maxWidth: 720, marginTop: 24 }}>
        ⚠️ 能力边界:免费公开 API 无法直接确认 Web of Science / EI 收录。哨兵追踪的"OpenAlex/PubMed
        收录"与"卷期页齐全"是高相关的前置信号;正式收录证明仍需通过图书馆查证,WoS/Scopus
        官方数据源接入在规划中。
      </p>
    </div>
  );
}
