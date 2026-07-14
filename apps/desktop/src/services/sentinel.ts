// Sentinel runner for the desktop app: catch-up poll on startup + periodic
// in-app timer. State transitions write evidence events, fire OS
// notifications, and auto-import the work once formally published.
import {
  SentinelRepo,
  SentinelTaskInactiveError,
  type SentinelEventInput,
  type SentinelTaskRow,
} from "@aurascholar/db/repos/sentinel";
import {
  checkDoi,
  findDoiByTitle,
  isTerminal,
  nextPollInterval,
  SENTINEL_STATES,
  STATE_LABEL,
  TITLE_MATCH_THRESHOLD,
  type SentinelState,
} from "@aurascholar/core";
import type { ConnectorContext } from "@aurascholar/connectors";
import { getDb } from "./aura-db";
import { auraHttp, auraNotifier } from "./aura-platform";
import { describeSafeError } from "./sensitive-text";

const ctx: ConnectorContext = { http: auraHttp, mailto: "contact@aurascholar.app" };

export interface SentinelPollFailure {
  taskId: string;
  title: string;
  error: string;
}

export interface SentinelPollSummary {
  checked: number;
  changes: number;
  failures: SentinelPollFailure[];
}

/** Polls every due task once. Returns the number of state changes found. */
export async function runDuePolls(): Promise<number> {
  const summary = await runDuePollsDetailed();
  return summary.changes;
}

export async function runDuePollsDetailed(): Promise<SentinelPollSummary> {
  const db = await getDb();
  const repo = new SentinelRepo(db);
  const due = await repo.duePolls();
  const summary = await pollTasks(repo, due);
  notifySentinelUpdated();
  return summary;
}

export async function runSentinelTaskNow(taskId: string): Promise<SentinelPollSummary> {
  const db = await getDb();
  const repo = new SentinelRepo(db);
  const task = await repo.get(taskId);
  if (!task || task.deleted_at) throw new Error("监控任务不存在或已删除");
  if (task.status !== "active") throw new Error("只能检查监控中的任务");
  const summary = await pollTasks(repo, [task]);
  notifySentinelUpdated();
  return summary;
}

function notifySentinelUpdated(): void {
  window.dispatchEvent(new Event("aurascholar:sentinel-updated"));
}

function parseTargetFlags(value: string | null): SentinelState[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new Error("监控目标配置不是有效 JSON 数组");
    }
    return [...new Set(parsed.filter(isSentinelState))];
  } catch (error) {
    throw new Error(`监控目标配置不是有效 JSON:${describeSafeError(error)}`, { cause: error });
  }
}

function isSentinelState(value: unknown): value is SentinelState {
  return typeof value === "string" && (SENTINEL_STATES as readonly string[]).includes(value);
}

async function pollTasks(
  repo: SentinelRepo,
  tasks: SentinelTaskRow[],
): Promise<SentinelPollSummary> {
  let changes = 0;
  const failures: SentinelPollFailure[] = [];

  for (const task of tasks) {
    const result = await pollTask(repo, task);
    changes += result.changes;
    if (result.failure) failures.push(result.failure);
  }
  return { checked: tasks.length, changes, failures };
}

async function pollTask(
  repo: SentinelRepo,
  task: SentinelTaskRow,
): Promise<{ changes: number; failure?: SentinelPollFailure }> {
  const previousState = task.current_state as SentinelState;

  try {
    const targets = parseTargetFlags(task.target_flags);
    const priorEvents = await repo.events(task.id);
    const alreadyReached = priorEvents.map((e) => e.to_state as SentinelState);
    const pendingEvents: SentinelEventInput[] = [];
    const notifications: Array<{ title: string; body: string; tag: string }> = [];

    // Title-monitoring mode: no DOI yet — search Crossref by title (+hints)
    // until a confident match appears, then continue as a DOI task.
    let doi = task.doi;
    if (!doi) {
      const match = await findDoiByTitle(ctx, task.title, {
        venue: task.hint_venue ?? undefined,
        author: task.hint_author ?? undefined,
      });
      if (!match || match.confidence < TITLE_MATCH_THRESHOLD) {
        await repo.recordCheck(task.id, {
          nextPollS: nextPollInterval("accepted", 0),
          errored: false,
        });
        return { changes: 0 };
      }
      doi = match.doi;
      alreadyReached.push("registered");
      pendingEvents.push({
        fromState: previousState,
        toState: "registered",
        evidence: match.evidence,
      });
      notifications.push({
        title: "📡 已找到论文 DOI",
        body: `${task.title} → ${doi}`,
        tag: `sentinel:${task.id}`,
      });
    }

    const result = await checkDoi(ctx, doi, previousState, alreadyReached);

    for (const milestone of result.newMilestones) {
      pendingEvents.push({
        fromState: previousState,
        toState: milestone.state,
        evidence: milestone.evidence,
      });
      notifications.push({
        title: `📡 ${STATE_LABEL[milestone.state]}`,
        body: task.title,
        tag: `sentinel:${task.id}`,
      });
    }

    const done = isTerminal(result.highestState, targets);
    await repo.recordCheckWithEvents(task.id, {
      doi: task.doi ? undefined : doi,
      events: pendingEvents,
      newState: result.highestState !== previousState ? result.highestState : undefined,
      nextPollS: nextPollInterval(result.highestState, 0),
      errored: false,
      done,
    });
    for (const notification of notifications) {
      await notifyBestEffort(notification);
    }

    // Formal publication → import into the library automatically.
    const crossedInIssue = result.newMilestones.some(
      (m) => m.state === "in_issue" || m.state === "indexed_openalex",
    );
    if (crossedInIssue && !task.work_id) {
      const { ingestFromInput } = await import("./library");
      const imported = await ingestFromInput(doi).catch(() => null);
      if (imported) {
        await repo.linkWork(task.id, imported.workId);
        await notifyBestEffort({
          title: "📚 已自动导入文献库",
          body: task.title,
          tag: `sentinel:${task.id}`,
        });
      }
    }

    return { changes: pendingEvents.length };
  } catch (error) {
    if (error instanceof SentinelTaskInactiveError) {
      return { changes: 0 };
    }
    const message = describeSafeError(error);
    try {
      await repo.recordCheck(task.id, {
        nextPollS: nextPollInterval(previousState, task.error_count + 1),
        errored: true,
        error: message,
      });
    } catch (recordError) {
      if (recordError instanceof SentinelTaskInactiveError) {
        return { changes: 0 };
      }
      throw recordError;
    }
    return { changes: 0, failure: { taskId: task.id, title: task.title, error: message } };
  }
}

async function notifyBestEffort(notification: {
  title: string;
  body: string;
  tag: string;
}): Promise<void> {
  try {
    await auraNotifier.notify(notification);
  } catch {
    // Poll state and evidence are already durable; OS notification delivery is best-effort.
  }
}

let started = false;

/** Startup catch-up + hourly re-check while the app is open. */
export function startSentinelLoop(): void {
  if (started) return;
  started = true;
  void runDuePolls();
  setInterval(() => void runDuePolls(), 60 * 60 * 1000);
}
