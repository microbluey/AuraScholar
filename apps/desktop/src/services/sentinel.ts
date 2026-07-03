// Sentinel runner for the desktop app: catch-up poll on startup + periodic
// in-app timer. State transitions write evidence events, fire OS
// notifications, and auto-import the work once formally published.
import { SentinelRepo, type SentinelTaskRow } from "@aurascholar/db/repos/sentinel";
import {
  checkDoi,
  findDoiByTitle,
  isTerminal,
  nextPollInterval,
  STATE_LABEL,
  TITLE_MATCH_THRESHOLD,
  type SentinelState,
} from "@aurascholar/core";
import type { ConnectorContext } from "@aurascholar/connectors";
import { getDb } from "./tauri-db";
import { tauriHttp, tauriNotifier } from "./tauri-platform";

const ctx: ConnectorContext = { http: tauriHttp, mailto: "contact@aurascholar.app" };

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
  return pollTasks(repo, due);
}

export async function runSentinelTaskNow(taskId: string): Promise<SentinelPollSummary> {
  const db = await getDb();
  const repo = new SentinelRepo(db);
  const task = await repo.get(taskId);
  if (!task || task.deleted_at) throw new Error("监控任务不存在或已删除");
  if (task.status !== "active") throw new Error("只能检查监控中的任务");
  return pollTasks(repo, [task]);
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
    const targets: SentinelState[] = task.target_flags ? JSON.parse(task.target_flags) : [];
    const priorEvents = await repo.events(task.id);
    const alreadyReached = priorEvents.map((e) => e.to_state as SentinelState);

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
      await repo.setDoi(task.id, doi);
      await repo.addEvent(task.id, previousState, "registered", match.evidence);
      await tauriNotifier.notify({
        title: "📡 已找到论文 DOI",
        body: `${task.title} → ${doi}`,
        tag: `sentinel:${task.id}`,
      });
    }

    const result = await checkDoi(ctx, doi, previousState, alreadyReached);

    for (const milestone of result.newMilestones) {
      await repo.addEvent(task.id, previousState, milestone.state, milestone.evidence);
      await tauriNotifier.notify({
        title: `📡 ${STATE_LABEL[milestone.state]}`,
        body: task.title,
        tag: `sentinel:${task.id}`,
      });
    }

    const done = isTerminal(result.highestState, targets);
    await repo.recordCheck(task.id, {
      newState: result.highestState !== previousState ? result.highestState : undefined,
      nextPollS: nextPollInterval(result.highestState, 0),
      errored: false,
      done,
    });

    // Formal publication → import into the library automatically.
    const crossedInIssue = result.newMilestones.some(
      (m) => m.state === "in_issue" || m.state === "indexed_openalex",
    );
    if (crossedInIssue && !task.work_id) {
      const { ingestFromInput } = await import("./library");
      const imported = await ingestFromInput(doi).catch(() => null);
      if (imported) {
        await repo.linkWork(task.id, imported.workId);
        await tauriNotifier.notify({
          title: "📚 已自动导入文献库",
          body: task.title,
          tag: `sentinel:${task.id}`,
        });
      }
    }

    return { changes: result.newMilestones.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repo.recordCheck(task.id, {
      nextPollS: nextPollInterval(previousState, task.error_count + 1),
      errored: true,
      error: message,
    });
    return { changes: 0, failure: { taskId: task.id, title: task.title, error: message } };
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
