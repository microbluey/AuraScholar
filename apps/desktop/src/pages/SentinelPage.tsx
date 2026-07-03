import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { normalizeDoi } from "@aurascholar/db/ids";
import {
  SentinelRepo,
  type SentinelEventRow,
  type SentinelTaskRow,
} from "@aurascholar/db/repos/sentinel";
import { STATE_LABEL, SENTINEL_STATES, stateRank, type SentinelState } from "@aurascholar/core";
import { Badge, Button, Card, Input } from "@aurascholar/ui";
import { getDb } from "../services/tauri-db";
import {
  runDuePollsDetailed,
  runSentinelTaskNow,
  type SentinelPollSummary,
} from "../services/sentinel";
import { useConfirmDialog } from "../components/ConfirmDialog";
import { InlineNotice } from "../components/InlineNotice";
import { downloadBlob } from "../download";
import { isImeComposing } from "../keyboard";

type CreateMode = "doi" | "title";
type SentinelView = "all" | "active" | "due" | "changed" | "title";
type GlobalAction = "add" | "check-all" | null;
type TaskActionType = "check" | "status" | "delete";
type TaskAction = { id: string; type: TaskActionType } | null;

const PIPELINE_STATES = SENTINEL_STATES;
const MIN_SENTINEL_ACTION_BUSY_MS = 250;

function isTauriRuntime(): boolean {
  return "aura" in window;
}

async function waitForMinimumElapsed(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

export function SentinelPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<CreateMode>("doi");
  const [view, setView] = useState<SentinelView>("all");
  const [doi, setDoi] = useState("");
  const [title, setTitle] = useState("");
  const [hintVenue, setHintVenue] = useState("");
  const [hintAuthor, setHintAuthor] = useState("");
  const [tasks, setTasks] = useState<SentinelTaskRow[]>([]);
  const [eventsByTask, setEventsByTask] = useState<Map<string, SentinelEventRow[]>>(new Map());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [globalAction, setGlobalAction] = useState<GlobalAction>(null);
  const [taskAction, setTaskAction] = useState<TaskAction>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();
  const globalBusy = globalAction !== null;
  const taskBusy = taskAction !== null;

  const refresh = useCallback(async () => {
    if (!isTauriRuntime()) {
      setTasks([]);
      setEventsByTask(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const db = await getDb();
      const repo = new SentinelRepo(db);
      const list = await repo.list();
      const eventPairs = await Promise.all(
        list.map(async (task) => [task.id, await repo.events(task.id)] as const),
      );
      setTasks(list);
      setEventsByTask(new Map(eventPairs));
    } catch (e) {
      setMessage(`读取哨兵任务失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const now = Date.now();
    const active = tasks.filter((task) => task.status === "active").length;
    const due = tasks.filter((task) => isTaskDue(task, now)).length;
    const changed = Array.from(eventsByTask.values()).filter((events) => events.length > 0).length;
    const titleMode = tasks.filter((task) => !task.doi).length;
    return { active, due, changed, titleMode, total: tasks.length };
  }, [eventsByTask, tasks]);

  const filteredTasks = useMemo(() => {
    const now = Date.now();
    if (view === "active") return tasks.filter((task) => task.status === "active");
    if (view === "due") return tasks.filter((task) => isTaskDue(task, now));
    if (view === "changed")
      return tasks.filter((task) => (eventsByTask.get(task.id)?.length ?? 0) > 0);
    if (view === "title") return tasks.filter((task) => !task.doi);
    return tasks;
  }, [eventsByTask, tasks, view]);

  const handleAdd = useCallback(async () => {
    if (!isTauriRuntime()) {
      setMessage("浏览器预览无法写入本地数据库，请在桌面应用中创建监控。");
      return;
    }
    if (globalAction || taskAction) return;
    if (mode === "doi" && !normalizeDoi(doi)) {
      setMessage("DOI 格式不正确");
      return;
    }
    if (mode === "title" && !title.trim()) {
      setMessage("标题监控模式下必须填写论文标题");
      return;
    }
    const startedAt = Date.now();
    let finalMessage: string | null = null;
    setGlobalAction("add");
    setMessage("正在创建监控...");
    try {
      const db = await getDb();
      const repo = new SentinelRepo(db);
      let result: Awaited<ReturnType<SentinelRepo["createOrRestore"]>>;
      if (mode === "doi") {
        const normalized = normalizeDoi(doi)!;
        result = await repo.createOrRestore({
          doi: normalized,
          title: title.trim() || normalized,
        });
      } else {
        result = await repo.createOrRestore({
          title: title.trim(),
          hintVenue: hintVenue.trim() || undefined,
          hintAuthor: hintAuthor.trim() || undefined,
        });
      }
      setDoi("");
      setTitle("");
      setHintVenue("");
      setHintAuthor("");
      setExpanded(result.id);
      setView("all");
      finalMessage = sentinelCreateMessage(result.status, result.task.title, mode);
      await refresh();
      if (result.status === "created") {
        void runSentinelTaskNow(result.id)
          .then((summary) => {
            void refresh();
            if (summary.failures.length > 0) {
              setMessage(sentinelPollMessage(summary, "首次检查", "已添加监控，暂无新进展"));
            }
          })
          .catch((e) =>
            setMessage(`监控已创建，首次检查失败:${e instanceof Error ? e.message : String(e)}`),
          );
      }
    } catch (e) {
      finalMessage = `创建监控失败:${e instanceof Error ? e.message : String(e)}`;
    } finally {
      await waitForMinimumElapsed(startedAt, MIN_SENTINEL_ACTION_BUSY_MS);
      if (finalMessage) setMessage(finalMessage);
      setGlobalAction(null);
    }
  }, [doi, globalAction, hintAuthor, hintVenue, mode, refresh, taskAction, title]);

  const handleCheckNow = useCallback(async () => {
    if (!isTauriRuntime()) {
      setMessage("浏览器预览无法执行后台检查，请在桌面应用中使用。");
      return;
    }
    if (globalAction || taskAction) return;
    const startedAt = Date.now();
    let finalMessage: string | null = null;
    setGlobalAction("check-all");
    setMessage("检查中…");
    try {
      const summary = await runDuePollsDetailed();
      finalMessage = sentinelPollMessage(summary, "检查", "已检查，暂无新进展");
      await refresh();
    } catch (e) {
      finalMessage = `检查失败:${e instanceof Error ? e.message : String(e)}`;
    } finally {
      await waitForMinimumElapsed(startedAt, MIN_SENTINEL_ACTION_BUSY_MS);
      if (finalMessage) setMessage(finalMessage);
      setGlobalAction(null);
    }
  }, [globalAction, refresh, taskAction]);

  const handleForceCheck = useCallback(
    async (taskId: string) => {
      if (!isTauriRuntime()) return;
      if (globalAction || taskAction) return;
      const startedAt = Date.now();
      let finalMessage: string | null = null;
      setTaskAction({ id: taskId, type: "check" });
      setMessage("正在检查该监控...");
      try {
        const summary = await runSentinelTaskNow(taskId);
        finalMessage = sentinelPollMessage(summary, "单篇检查", "单篇检查完成，暂无新进展");
        await refresh();
      } catch (e) {
        finalMessage = `单篇检查失败:${e instanceof Error ? e.message : String(e)}`;
      } finally {
        await waitForMinimumElapsed(startedAt, MIN_SENTINEL_ACTION_BUSY_MS);
        if (finalMessage) setMessage(finalMessage);
        setTaskAction(null);
      }
    },
    [globalAction, refresh, taskAction],
  );

  const handleToggleStatus = useCallback(
    async (task: SentinelTaskRow) => {
      if (!isTauriRuntime()) return;
      if (globalAction || taskAction) return;
      const nextStatus = task.status === "paused" ? "active" : "paused";
      const startedAt = Date.now();
      let finalMessage: string | null = null;
      setTaskAction({ id: task.id, type: "status" });
      try {
        const db = await getDb();
        await new SentinelRepo(db).setStatus(task.id, nextStatus);
        finalMessage = nextStatus === "active" ? "已恢复监控" : "已暂停监控";
        await refresh();
      } catch (e) {
        finalMessage = `更新监控状态失败:${e instanceof Error ? e.message : String(e)}`;
      } finally {
        await waitForMinimumElapsed(startedAt, MIN_SENTINEL_ACTION_BUSY_MS);
        if (finalMessage) setMessage(finalMessage);
        setTaskAction(null);
      }
    },
    [globalAction, refresh, taskAction],
  );

  const handleDelete = useCallback(
    async (task: SentinelTaskRow) => {
      if (!isTauriRuntime()) return;
      if (globalAction || taskAction) return;
      const confirmed = await confirm({
        title: "删除哨兵监控？",
        description: `《${task.title}》会从监控列表移除。`,
        details: ["这会同时隐藏该任务的历史证据列表。", "文献库中的论文记录不会被删除。"],
        confirmLabel: "删除监控",
        tone: "warning",
      });
      if (!confirmed) return;
      const startedAt = Date.now();
      let finalMessage: string | null = null;
      setTaskAction({ id: task.id, type: "delete" });
      setMessage("正在删除监控任务...");
      try {
        const db = await getDb();
        await new SentinelRepo(db).softDelete(task.id);
        finalMessage = "已删除监控任务";
        if (expanded === task.id) setExpanded(null);
        await refresh();
      } catch (e) {
        finalMessage = `删除监控失败:${e instanceof Error ? e.message : String(e)}`;
      } finally {
        await waitForMinimumElapsed(startedAt, MIN_SENTINEL_ACTION_BUSY_MS);
        if (finalMessage) setMessage(finalMessage);
        setTaskAction(null);
      }
    },
    [confirm, expanded, globalAction, refresh, taskAction],
  );

  return (
    <div className="sentinel-page">
      <div className="sentinel-hero">
        <div>
          <p className="app-page-kicker">Publication status radar</p>
          <h1 className="app-page-title">检索哨兵</h1>
          <p className="app-page-subtitle">
            跟踪论文从接收、在线发表、卷期页到开放索引的状态变化，并保留可下载证据。
          </p>
        </div>
        <div className="sentinel-summary" aria-label="哨兵总览">
          <SummaryMetric label="监控中" value={stats.active} />
          <SummaryMetric label="待检查" value={stats.due} />
          <SummaryMetric label="有进展" value={stats.changed} />
        </div>
      </div>

      <Card className="sentinel-create-card" aria-busy={globalAction === "add"}>
        <div className="sentinel-create-card__head">
          <div>
            <h2>新增监控</h2>
            <p>
              {mode === "doi"
                ? "已有 DOI 时优先使用精确监控。"
                : "没有 DOI 时用标题和线索持续匹配。"}
            </p>
          </div>
          <div className="au-tablist sentinel-mode-tabs">
            <button
              type="button"
              className={`au-tab ${mode === "doi" ? "au-tab--active" : ""}`}
              disabled={globalBusy || taskBusy}
              onClick={() => setMode("doi")}
            >
              DOI
            </button>
            <button
              type="button"
              className={`au-tab ${mode === "title" ? "au-tab--active" : ""}`}
              disabled={globalBusy || taskBusy}
              onClick={() => setMode("title")}
            >
              标题
            </button>
          </div>
        </div>
        {mode === "doi" ? (
          <div className="sentinel-form-grid sentinel-form-grid--doi">
            <Input
              placeholder="DOI，例如 10.1109/TPAMI.2026.12345"
              value={doi}
              disabled={globalBusy || taskBusy}
              onChange={(e) => setDoi(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" &&
                !isImeComposing(e) &&
                !globalBusy &&
                !taskBusy &&
                void handleAdd()
              }
            />
            <Input
              placeholder="论文标题，可选"
              value={title}
              disabled={globalBusy || taskBusy}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" &&
                !isImeComposing(e) &&
                !globalBusy &&
                !taskBusy &&
                void handleAdd()
              }
            />
            <Button
              onClick={() => void handleAdd()}
              disabled={globalBusy || taskBusy}
              aria-busy={globalAction === "add"}
            >
              {globalAction === "add" ? "创建中…" : "开始监控"}
            </Button>
          </div>
        ) : (
          <div className="sentinel-form-grid">
            <Input
              placeholder="论文标题"
              value={title}
              disabled={globalBusy || taskBusy}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" &&
                !isImeComposing(e) &&
                !globalBusy &&
                !taskBusy &&
                void handleAdd()
              }
            />
            <Input
              placeholder="期刊 / 会议，可选"
              value={hintVenue}
              disabled={globalBusy || taskBusy}
              onChange={(e) => setHintVenue(e.target.value)}
            />
            <Input
              placeholder="第一作者姓氏，可选"
              value={hintAuthor}
              disabled={globalBusy || taskBusy}
              onChange={(e) => setHintAuthor(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" &&
                !isImeComposing(e) &&
                !globalBusy &&
                !taskBusy &&
                void handleAdd()
              }
            />
            <Button
              onClick={() => void handleAdd()}
              disabled={globalBusy || taskBusy}
              aria-busy={globalAction === "add"}
            >
              {globalAction === "add" ? "创建中…" : "开始监控"}
            </Button>
          </div>
        )}
        <InlineNotice className="sentinel-message" message={message} />
      </Card>

      <div className="sentinel-toolbar">
        <div className="sentinel-view-tabs" aria-label="哨兵视图">
          <ViewButton
            label="全部"
            count={stats.total}
            active={view === "all"}
            onClick={() => setView("all")}
          />
          <ViewButton
            label="监控中"
            count={stats.active}
            active={view === "active"}
            onClick={() => setView("active")}
          />
          <ViewButton
            label="待检查"
            count={stats.due}
            active={view === "due"}
            onClick={() => setView("due")}
          />
          <ViewButton
            label="有进展"
            count={stats.changed}
            active={view === "changed"}
            onClick={() => setView("changed")}
          />
          <ViewButton
            label="找 DOI"
            count={stats.titleMode}
            active={view === "title"}
            onClick={() => setView("title")}
          />
        </div>
        <Button
          variant="secondary"
          onClick={() => void handleCheckNow()}
          disabled={globalBusy || taskBusy || tasks.length === 0}
          aria-busy={globalAction === "check-all"}
        >
          {globalAction === "check-all" ? "检查中…" : "立即检查全部"}
        </Button>
      </div>

      <div className="sentinel-list">
        {loading ? (
          <Card className="sentinel-empty">
            <p>读取哨兵任务…</p>
          </Card>
        ) : filteredTasks.length === 0 ? (
          <SentinelEmptyState view={view} hasAnyTasks={tasks.length > 0} />
        ) : (
          filteredTasks.map((task) => {
            const events = eventsByTask.get(task.id) ?? [];
            return (
              <SentinelTaskCard
                key={task.id}
                task={task}
                events={events}
                expanded={expanded === task.id}
                action={taskAction?.id === task.id ? taskAction.type : null}
                controlsDisabled={globalBusy || taskBusy}
                onToggleExpanded={() => setExpanded(expanded === task.id ? null : task.id)}
                onForceCheck={() => void handleForceCheck(task.id)}
                onToggleStatus={() => void handleToggleStatus(task)}
                onDelete={() => void handleDelete(task)}
                onOpenWork={() => task.work_id && navigate(`/reader?work=${task.work_id}`)}
              />
            );
          })
        )}
      </div>

      <p className="sentinel-boundary-note">
        公开 API 目前不能直接证明 Web of Science / EI 收录。这里保留 Crossref、OpenAlex、PubMed
        等开放证据，正式收录证明仍需通过图书馆或数据库平台核验。
      </p>
      {confirmDialog}
    </div>
  );
}

function SentinelTaskCard({
  task,
  events,
  expanded,
  action,
  controlsDisabled,
  onToggleExpanded,
  onForceCheck,
  onToggleStatus,
  onDelete,
  onOpenWork,
}: {
  task: SentinelTaskRow;
  events: SentinelEventRow[];
  expanded: boolean;
  action: TaskActionType | null;
  controlsDisabled: boolean;
  onToggleExpanded: () => void;
  onForceCheck: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
  onOpenWork: () => void;
}) {
  const currentState = task.current_state as SentinelState;
  const currentRank = stateRank(currentState);
  const due = isTaskDue(task);
  const forceCheckBusy = action === "check";
  const statusBusy = action === "status";
  const deleteBusy = action === "delete";
  return (
    <Card className="sentinel-task-card" aria-busy={action !== null}>
      <div className="sentinel-task-card__head">
        <div>
          <h2>{task.title}</h2>
          <p>{task.doi ?? titleMonitoringLabel(task)}</p>
        </div>
        <Badge variant={taskBadgeVariant(task)}>
          {task.status === "done"
            ? "监控完成"
            : task.status === "paused"
              ? "已暂停"
              : (STATE_LABEL[currentState] ?? task.current_state)}
        </Badge>
      </div>

      <div className="sentinel-pipeline" aria-label="出版状态进度">
        {PIPELINE_STATES.map((state) => {
          const reached = stateRank(state) <= currentRank;
          return (
            <div
              key={state}
              className={
                reached
                  ? "sentinel-pipeline__step sentinel-pipeline__step--reached"
                  : "sentinel-pipeline__step"
              }
              title={STATE_LABEL[state]}
            >
              <span />
              <small>{shortStateLabel(state)}</small>
            </div>
          );
        })}
      </div>

      <div className="sentinel-task-card__meta">
        <StatusChip
          label={due ? "需要检查" : "下次检查"}
          value={due ? "现在" : formatRelative(task.next_poll_at)}
        />
        <StatusChip
          label="上次检查"
          value={task.last_polled_at ? formatRelative(task.last_polled_at) : "尚未检查"}
        />
        <StatusChip label="证据" value={`${events.length} 条`} />
        {task.error_count > 0 && (
          <StatusChip label="连续错误" value={`${task.error_count} 次`} tone="warning" />
        )}
        {task.error_count > 0 && task.last_error && (
          <StatusChip label="最近失败" value={task.last_error} tone="warning" />
        )}
      </div>

      <div className="sentinel-task-card__actions">
        <button type="button" onClick={onToggleExpanded} disabled={controlsDisabled}>
          {expanded ? "收起证据" : `证据时间线(${events.length})`}
        </button>
        {task.status === "active" && (
          <button
            type="button"
            onClick={onForceCheck}
            disabled={controlsDisabled}
            aria-busy={forceCheckBusy}
          >
            {forceCheckBusy ? "检查中…" : "单独检查"}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleStatus}
          disabled={controlsDisabled || task.status === "done"}
          aria-busy={statusBusy}
        >
          {statusBusy ? (task.status === "paused" ? "恢复中…" : "暂停中…") : task.status === "paused" ? "恢复" : "暂停"}
        </button>
        {task.work_id && (
          <button type="button" onClick={onOpenWork} disabled={controlsDisabled}>
            打开文献
          </button>
        )}
        <button
          type="button"
          className="sentinel-task-card__danger"
          onClick={onDelete}
          disabled={controlsDisabled}
          aria-busy={deleteBusy}
        >
          {deleteBusy ? "删除中…" : "删除"}
        </button>
      </div>

      {expanded && (
        <div className="sentinel-evidence-list">
          {events.length === 0 ? (
            <p>还没有状态变化证据。</p>
          ) : (
            events.map((event) => <EvidenceRow event={event} key={event.id} />)
          )}
        </div>
      )}
    </Card>
  );
}

function EvidenceRow({ event }: { event: SentinelEventRow }) {
  return (
    <div className="sentinel-evidence-row">
      <time>{formatDate(event.detected_at)}</time>
      <span>
        {STATE_LABEL[event.from_state as SentinelState] ?? event.from_state} →{" "}
        {STATE_LABEL[event.to_state as SentinelState] ?? event.to_state}
      </span>
      {event.evidence_json && (
        <button
          type="button"
          onClick={() => {
            const blob = new Blob([event.evidence_json!], { type: "application/json" });
            downloadBlob(
              blob,
              `证据-${event.to_state}-${new Date(event.detected_at).toISOString().slice(0, 10)}.json`,
            );
          }}
        >
          下载证据
        </button>
      )}
    </div>
  );
}

function SentinelEmptyState({ view, hasAnyTasks }: { view: SentinelView; hasAnyTasks: boolean }) {
  const title = hasAnyTasks ? "当前视图没有任务" : "还没有哨兵任务";
  const copy = hasAnyTasks
    ? "切换视图可以查看其他监控状态。"
    : "收到接收通知后，用 DOI 或题名创建第一条监控。";
  return (
    <Card className="sentinel-empty">
      <Badge variant={hasAnyTasks ? "neutral" : "accent"}>
        {view === "all" ? "Sentinel" : "Filtered"}
      </Badge>
      <p>{title}</p>
      <small>{copy}</small>
    </Card>
  );
}

function sentinelCreateMessage(
  status: "created" | "existing" | "restored",
  title: string,
  mode: CreateMode,
): string {
  if (status === "existing") return `监控已存在:《${title}》`;
  if (status === "restored") return `已恢复监控:《${title}》`;
  return mode === "doi" ? "已添加 DOI 监控" : "已添加标题监控";
}

function sentinelPollMessage(
  summary: SentinelPollSummary,
  label: string,
  emptyMessage: string,
): string {
  if (summary.failures.length > 0) {
    const first = summary.failures[0];
    if (!first) return `${label}失败`;
    const more = summary.failures.length > 1 ? `等 ${summary.failures.length} 个任务` : "该任务";
    const progress = summary.changes > 0 ? `，同时发现 ${summary.changes} 个状态变化` : "";
    return `${label}失败${progress}:${more}《${first.title}》 - ${first.error}`;
  }
  if (summary.changes > 0) return `发现 ${summary.changes} 个状态变化`;
  if (summary.checked === 0) return "当前没有待检查的监控任务";
  return emptyMessage;
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <strong>{value.toLocaleString("zh-CN")}</strong>
      <small>{label}</small>
    </span>
  );
}

function ViewButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "sentinel-view-tab sentinel-view-tab--active" : "sentinel-view-tab"}
      onClick={onClick}
    >
      {label} <span>{count.toLocaleString("zh-CN")}</span>
    </button>
  );
}

function StatusChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <span
      className={
        tone === "warning"
          ? "sentinel-status-chip sentinel-status-chip--warning"
          : "sentinel-status-chip"
      }
    >
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function taskBadgeVariant(task: SentinelTaskRow): "accent" | "neutral" | "success" | "warning" {
  if (task.status === "done") return "success";
  if (task.status === "paused") return "neutral";
  if (task.error_count > 0) return "warning";
  return "accent";
}

function titleMonitoringLabel(task: SentinelTaskRow) {
  const hints = [task.hint_venue, task.hint_author].filter(Boolean).join(" · ");
  return hints ? `标题监控 · ${hints}` : "标题监控 · 等待 DOI";
}

function shortStateLabel(state: SentinelState) {
  if (state === "accepted") return "接收";
  if (state === "registered") return "注册";
  if (state === "online") return "在线";
  if (state === "in_issue") return "出版";
  if (state === "indexed_openalex") return "OpenAlex";
  return "PubMed";
}

function isTaskDue(task: SentinelTaskRow, now = Date.now()) {
  return task.status === "active" && task.next_poll_at <= now;
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRelative(value: number) {
  const diff = value - Date.now();
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "后" : "前";
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return diff >= 0 ? "现在" : "刚刚";
  if (abs < hour) return `${Math.round(abs / minute)} 分钟${suffix}`;
  if (abs < day) return `${Math.round(abs / hour)} 小时${suffix}`;
  return `${Math.round(abs / day)} 天${suffix}`;
}
