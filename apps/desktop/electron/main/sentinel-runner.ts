import {
  checkDoi,
  findDoiByTitle,
  isTerminal,
  nextPollInterval,
  STATE_LABEL,
  TITLE_MATCH_THRESHOLD,
  type ResolvedWork,
  type SentinelCheckResult,
  type SentinelState,
  type TitleMatchResult,
} from "@aurascholar/core";
import type { ConnectorContext } from "@aurascholar/connectors";
import type { Database } from "@aurascholar/db";
import {
  SentinelRepo,
  SentinelTaskInactiveError,
  type SentinelCheckUpdate,
  type SentinelEventInput,
} from "@aurascholar/db/repos/sentinel";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { describeSafeError } from "@aurascholar/platform";
import type { SentinelPollTaskSnapshot, SentinelPollTask } from "../sentinel-read-command-contract";
import type { SentinelPollFailure, SentinelPollSummary } from "../sentinel-run-command-contract";
import { withMainDatabase, withMainDatabaseTransaction } from "./db";
import {
  abortError,
  assertActiveSentinelLibrary,
  createMainSentinelConnectorContext,
  isAbortError,
  mainSentinelNotifier,
  resolveMainSentinelAutoIngest,
  throwIfAborted,
} from "./sentinel-runner-helpers";
import {
  normalizeCheckResult,
  parseTargetFlags,
  readExpectedUpdatedAt,
  readMatchedDoi,
  readPollInterval,
  readSentinelState,
  readTaskDoi,
} from "./sentinel-runner-input";
import {
  MAX_SENTINEL_FAILURE_TITLE_BYTES,
  MAX_SENTINEL_SUMMARY_FAILURES,
  normalizeEventEvidence,
  notifyBestEffort,
  requireBoundedPollSummary,
  shortText,
  type MainSentinelNotification,
  type MainSentinelNotifier,
} from "./sentinel-runner-serialization";
import { parseLibraryWorkInput } from "./library-ingest-commands";
import {
  loadMainSentinelDuePollSnapshot,
  loadMainSentinelTaskPollSnapshot,
} from "./sentinel-read-commands";
import { normalizedWorkToMainWorkInput } from "./scholarly-work-input";

const MAX_ACTIVE_SENTINEL_RUNS = 4;
const MAX_PERSISTED_ERROR_BYTES = 16 * 1024;
const MAX_SENTINEL_FAILURE_ERROR_BYTES = 768;
const MAX_SENTINEL_FAILURE_ID_BYTES = 256;

export type {
  MainSentinelNotification,
  MainSentinelNotifier,
} from "./sentinel-runner-serialization";
export {
  createMainSentinelConnectorContext,
  resolveMainSentinelAutoIngest,
} from "./sentinel-runner-helpers";

type SentinelDoiChecker = (
  context: ConnectorContext,
  doi: string,
  previousState: SentinelState,
  reachedStates: SentinelState[],
) => Promise<SentinelCheckResult>;

type SentinelTitleMatcher = (
  context: ConnectorContext,
  title: string,
  hints: { author?: string; venue?: string },
) => Promise<TitleMatchResult | null>;

type SentinelAutoIngestResolver = (
  doi: string,
  signal: AbortSignal,
) => Promise<ResolvedWork | null>;

/**
 * Every dependency remains main-only. Test doubles can replace the two
 * network functions, but no renderer command, renderer callback, arbitrary
 * URL, or caller-selected Library scope crosses this boundary.
 */
export interface MainSentinelRunnerDependencies {
  checkDoi?: SentinelDoiChecker;
  createConnectorContext?: (signal: AbortSignal) => ConnectorContext;
  findDoiByTitle?: SentinelTitleMatcher;
  notifier?: MainSentinelNotifier;
  resolveAutoIngest?: SentinelAutoIngestResolver;
  withDatabase?<T>(operation: (database: Database) => T | Promise<T>): Promise<T>;
  withDatabaseTransaction?<T>(
    commandName: string,
    operation: (database: Database) => T | Promise<T>,
  ): Promise<T>;
}

interface ResolvedMainSentinelRunnerDependencies {
  checkDoi: SentinelDoiChecker;
  createConnectorContext: (signal: AbortSignal) => ConnectorContext;
  findDoiByTitle: SentinelTitleMatcher;
  notifier: MainSentinelNotifier;
  resolveAutoIngest: SentinelAutoIngestResolver;
  withDatabase<T>(operation: (database: Database) => T | Promise<T>): Promise<T>;
  withDatabaseTransaction<T>(
    commandName: string,
    operation: (database: Database) => T | Promise<T>,
  ): Promise<T>;
}

interface SentinelCheckCommit {
  committed: boolean;
  updatedAt: number | null;
}

interface SentinelTaskPollResult {
  changes: number;
  failure?: SentinelPollFailure;
}

/**
 * Bounded, request-id keyed cancellation for renderer-initiated runs. A
 * cancellation is best-effort: network calls receive the signal, while an
 * already-open short transaction is allowed to finish atomically.
 */
export class MainSentinelRunRegistry {
  private readonly runs = new Map<string, AbortController>();

  begin(requestId: string): AbortSignal {
    if (this.runs.has(requestId)) {
      throw new Error("Sentinel request id is already active");
    }
    if (this.runs.size >= MAX_ACTIVE_SENTINEL_RUNS) {
      throw new Error(`At most ${MAX_ACTIVE_SENTINEL_RUNS} Sentinel requests may run at once`);
    }
    const controller = new AbortController();
    this.runs.set(requestId, controller);
    return controller.signal;
  }

  cancel(requestId: string): boolean {
    const controller = this.runs.get(requestId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  end(requestId: string): void {
    this.runs.delete(requestId);
  }
}

/**
 * Runs Sentinel egress entirely in Electron main. Snapshot reads and every
 * write lease are short; Crossref/OpenAlex/title-resolution calls always run
 * outside a database transaction and use the allowlisted scholarly transport.
 */
export class MainSentinelRunner {
  private readonly requests: MainSentinelRunRegistry;

  constructor(
    private readonly dependencies: MainSentinelRunnerDependencies = {},
    requests: MainSentinelRunRegistry = new MainSentinelRunRegistry(),
  ) {
    this.requests = requests;
  }

  cancel(requestId: string): boolean {
    return this.requests.cancel(requestId);
  }

  runDuePolls(requestId: string): Promise<SentinelPollSummary> {
    return this.runWithRequest(requestId, (signal, dependencies) =>
      this.runDuePollsWithSignal(signal, dependencies),
    );
  }

  runTaskNow(taskId: string, requestId: string): Promise<SentinelPollSummary> {
    return this.runWithRequest(requestId, (signal, dependencies) =>
      this.runTaskNowWithSignal(taskId, signal, dependencies),
    );
  }

  private async runWithRequest(
    requestId: string,
    operation: (
      signal: AbortSignal,
      dependencies: ResolvedMainSentinelRunnerDependencies,
    ) => Promise<SentinelPollSummary>,
  ): Promise<SentinelPollSummary> {
    const signal = this.requests.begin(requestId);
    try {
      throwIfAborted(signal);
      return await operation(signal, this.resolvedDependencies());
    } finally {
      this.requests.end(requestId);
    }
  }

  private async runDuePollsWithSignal(
    signal: AbortSignal,
    dependencies: ResolvedMainSentinelRunnerDependencies,
  ): Promise<SentinelPollSummary> {
    throwIfAborted(signal);
    const snapshot = await dependencies.withDatabase((database) =>
      loadMainSentinelDuePollSnapshot(database),
    );
    throwIfAborted(signal);
    return this.pollTasks(snapshot.libraryId, snapshot.tasks, signal, dependencies);
  }

  private async runTaskNowWithSignal(
    taskId: string,
    signal: AbortSignal,
    dependencies: ResolvedMainSentinelRunnerDependencies,
  ): Promise<SentinelPollSummary> {
    throwIfAborted(signal);
    const snapshot = await dependencies.withDatabase((database) =>
      loadMainSentinelTaskPollSnapshot(database, taskId),
    );
    throwIfAborted(signal);
    if (!snapshot.task) throw new Error("监控任务不存在或已删除");
    if (snapshot.task.status !== "active") throw new Error("只能检查监控中的任务");
    return this.pollTasks(
      snapshot.libraryId,
      [{ reachedStates: snapshot.reachedStates, task: snapshot.task }],
      signal,
      dependencies,
    );
  }

  private async pollTasks(
    libraryId: string,
    tasks: SentinelPollTaskSnapshot[],
    signal: AbortSignal,
    dependencies: ResolvedMainSentinelRunnerDependencies,
  ): Promise<SentinelPollSummary> {
    let changes = 0;
    let failed = 0;
    const failures: SentinelPollFailure[] = [];

    for (const taskSnapshot of tasks) {
      throwIfAborted(signal);
      const result = await this.pollTask(libraryId, taskSnapshot, signal, dependencies);
      changes += result.changes;
      if (result.failure) {
        failed += 1;
        if (failures.length < MAX_SENTINEL_SUMMARY_FAILURES) failures.push(result.failure);
      }
    }

    return requireBoundedPollSummary({ checked: tasks.length, changes, failed, failures });
  }

  private async pollTask(
    libraryId: string,
    snapshot: SentinelPollTaskSnapshot,
    signal: AbortSignal,
    dependencies: ResolvedMainSentinelRunnerDependencies,
  ): Promise<SentinelTaskPollResult> {
    const { task } = snapshot;
    const previousState = readSentinelState(task.current_state);

    try {
      throwIfAborted(signal);
      const targets = parseTargetFlags(task.target_flags);
      const alreadyReached = [...snapshot.reachedStates.map(readSentinelState)];
      const pendingEvents: SentinelEventInput[] = [];
      const notifications: MainSentinelNotification[] = [];
      const connectorContext = dependencies.createConnectorContext(signal);

      let doi = readTaskDoi(task.doi);
      if (!doi) {
        const match = await dependencies.findDoiByTitle(connectorContext, task.title, {
          ...(task.hint_author ? { author: task.hint_author } : {}),
          ...(task.hint_venue ? { venue: task.hint_venue } : {}),
        });
        throwIfAborted(signal);
        if (!match || match.confidence < TITLE_MATCH_THRESHOLD) {
          await this.commitCheck(
            libraryId,
            task.id,
            {
              expectedUpdatedAt: readExpectedUpdatedAt(task.updated_at),
              errored: false,
              nextPollS: readPollInterval(nextPollInterval("accepted", 0)),
            },
            dependencies,
          );
          return { changes: 0 };
        }
        doi = readMatchedDoi(match.doi);
        alreadyReached.push("registered");
        pendingEvents.push({
          evidence: normalizeEventEvidence(match.evidence),
          fromState: previousState,
          toState: "registered",
        });
        notifications.push({
          body: `${shortText(task.title, MAX_SENTINEL_FAILURE_TITLE_BYTES)} → ${doi}`,
          tag: `sentinel:${task.id}`,
          title: "📡 已找到论文 DOI",
        });
      }

      const result = await dependencies.checkDoi(
        connectorContext,
        doi,
        previousState,
        alreadyReached,
      );
      throwIfAborted(signal);
      const checked = normalizeCheckResult(result, previousState);

      for (const milestone of checked.newMilestones) {
        pendingEvents.push({
          evidence: normalizeEventEvidence(milestone.evidence),
          fromState: previousState,
          toState: milestone.state,
        });
        notifications.push({
          body: shortText(task.title, MAX_SENTINEL_FAILURE_TITLE_BYTES),
          tag: `sentinel:${task.id}`,
          title: `📡 ${STATE_LABEL[milestone.state]}`,
        });
      }

      const commit = await this.commitCheck(
        libraryId,
        task.id,
        {
          ...(task.doi ? {} : { doi }),
          done: isTerminal(checked.highestState, targets),
          errored: false,
          events: pendingEvents,
          expectedUpdatedAt: readExpectedUpdatedAt(task.updated_at),
          ...(checked.highestState === previousState ? {} : { newState: checked.highestState }),
          nextPollS: readPollInterval(nextPollInterval(checked.highestState, 0)),
        },
        dependencies,
      );
      if (!commit.committed || commit.updatedAt === null) return { changes: 0 };

      for (const notification of notifications) {
        await notifyBestEffort(dependencies.notifier, notification);
      }

      const crossedInIssue = checked.newMilestones.some(
        (milestone) => milestone.state === "in_issue" || milestone.state === "indexed_openalex",
      );
      if (crossedInIssue && !task.work_id) {
        await this.autoIngestAndLink(libraryId, task, doi, commit.updatedAt, signal, dependencies);
      }

      return { changes: pendingEvents.length };
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw abortError();
      const message = shortText(describeSafeError(error), MAX_PERSISTED_ERROR_BYTES);
      const commit = await this.commitCheck(
        libraryId,
        task.id,
        {
          error: message,
          errored: true,
          expectedUpdatedAt: readExpectedUpdatedAt(task.updated_at),
          nextPollS: readPollInterval(nextPollInterval(previousState, task.error_count + 1)),
        },
        dependencies,
      );
      if (!commit.committed) return { changes: 0 };
      return {
        changes: 0,
        failure: {
          error: shortText(message, MAX_SENTINEL_FAILURE_ERROR_BYTES),
          taskId: shortText(task.id, MAX_SENTINEL_FAILURE_ID_BYTES),
          title: shortText(task.title, MAX_SENTINEL_FAILURE_TITLE_BYTES),
        },
      };
    }
  }

  private async commitCheck(
    libraryId: string,
    taskId: string,
    update: SentinelCheckUpdate & { expectedUpdatedAt: number },
    dependencies: ResolvedMainSentinelRunnerDependencies,
  ): Promise<SentinelCheckCommit> {
    return dependencies.withDatabaseTransaction("sentinel.runCheck", async (database) => {
      await assertActiveSentinelLibrary(database, libraryId);
      try {
        const repository = new SentinelRepo(database, libraryId);
        await repository.recordCheckWithEvents(taskId, update);
        const current = await repository.get(taskId);
        if (!current) throw new Error("Committed Sentinel task is unavailable");
        return { committed: true, updatedAt: current.updated_at };
      } catch (error) {
        if (error instanceof SentinelTaskInactiveError) {
          return { committed: false, updatedAt: null };
        }
        throw error;
      }
    });
  }

  private async autoIngestAndLink(
    libraryId: string,
    task: SentinelPollTask,
    doi: string,
    expectedUpdatedAt: number,
    signal: AbortSignal,
    dependencies: ResolvedMainSentinelRunnerDependencies,
  ): Promise<void> {
    throwIfAborted(signal);
    // This is network work, intentionally outside any database transaction.
    const resolved = await dependencies.resolveAutoIngest(doi, signal);
    throwIfAborted(signal);
    if (!resolved) return;

    const workInput = parseLibraryWorkInput(normalizedWorkToMainWorkInput(resolved.work));
    await dependencies.withDatabaseTransaction("sentinel.autoIngest", async (database) => {
      throwIfAborted(signal);
      await assertActiveSentinelLibrary(database, libraryId);
      const work = await new WorksRepo(database, libraryId).upsert(workInput);
      return new SentinelRepo(database, libraryId).linkWorkIfCurrent(
        task.id,
        work.id,
        expectedUpdatedAt,
      );
    });
    // Keep the existing behavior: metadata import is durable even if a
    // concurrent task edit makes the follow-up CAS link a no-op. The user is
    // still notified that the formally published work entered the Library.
    await notifyBestEffort(dependencies.notifier, {
      body: shortText(task.title, MAX_SENTINEL_FAILURE_TITLE_BYTES),
      tag: `sentinel:${task.id}`,
      title: "📚 已自动导入文献库",
    });
  }

  private resolvedDependencies(): ResolvedMainSentinelRunnerDependencies {
    return {
      checkDoi: this.dependencies.checkDoi ?? checkDoi,
      createConnectorContext:
        this.dependencies.createConnectorContext ?? createMainSentinelConnectorContext,
      findDoiByTitle: this.dependencies.findDoiByTitle ?? findDoiByTitle,
      notifier: this.dependencies.notifier ?? mainSentinelNotifier,
      resolveAutoIngest: this.dependencies.resolveAutoIngest ?? resolveMainSentinelAutoIngest,
      withDatabase: this.dependencies.withDatabase ?? withMainDatabase,
      withDatabaseTransaction:
        this.dependencies.withDatabaseTransaction ?? withMainDatabaseTransaction,
    };
  }
}

export const mainSentinelRunner = new MainSentinelRunner();
