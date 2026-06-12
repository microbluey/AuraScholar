// Sentinel runner for the desktop app: catch-up poll on startup + periodic
// in-app timer. State transitions write evidence events, fire OS
// notifications, and auto-import the work once formally published.
import { SentinelRepo, type SentinelTaskRow } from "@aurascholar/db";
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
import { ingestFromInput } from "./library";

const ctx: ConnectorContext = { http: tauriHttp, mailto: "contact@aurascholar.app" };

/** Polls every due task once. Returns the number of state changes found. */
export async function runDuePolls(): Promise<number> {
  const db = await getDb();
  const repo = new SentinelRepo(db);
  const due = await repo.duePolls();
  let changes = 0;

  for (const task of due) {
    changes += await pollTask(repo, task);
  }
  return changes;
}

async function pollTask(repo: SentinelRepo, task: SentinelTaskRow): Promise<number> {
  const previousState = task.current_state as SentinelState;
  const targets: SentinelState[] = task.target_flags ? JSON.parse(task.target_flags) : [];
  const priorEvents = await repo.events(task.id);
  const alreadyReached = priorEvents.map((e) => e.to_state as SentinelState);

  try {
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
        return 0;
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

    return result.newMilestones.length;
  } catch {
    await repo.recordCheck(task.id, {
      nextPollS: nextPollInterval(previousState, task.error_count + 1),
      errored: true,
    });
    return 0;
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
