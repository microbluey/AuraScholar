// One polling cycle for one sentinel task: fetch fresh snapshots, derive
// milestones, diff against the task's known state.
import { crossrefRaw, openalexByDoi, type ConnectorContext } from "@aurascholar/connectors";
import {
  deriveMilestones,
  stateRank,
  type MilestoneEvidence,
  type SentinelState,
} from "./states";

export interface SentinelCheckResult {
  /** Newly crossed milestones (not previously recorded), in rank order. */
  newMilestones: MilestoneEvidence[];
  highestState: SentinelState;
  checkedAt: number;
}

export async function checkDoi(
  ctx: ConnectorContext,
  doi: string,
  previousState: SentinelState,
  alreadyReached: SentinelState[],
): Promise<SentinelCheckResult> {
  const [crossrefResult, openalexResult] = await Promise.all([
    settleSource(() => crossrefRaw(ctx, doi)),
    settleSource(() =>
      openalexByDoi(ctx, doi).then((w) => (w ? (w as unknown as Record<string, unknown>) : null)),
    ),
  ]);

  const crossref = crossrefResult.value;
  const openalex = openalexResult.value;
  assertEvidenceCheckComplete([
    { name: "Crossref", value: crossref, error: crossrefResult.error },
    { name: "OpenAlex", value: openalex, error: openalexResult.error },
  ]);

  const outcome = deriveMilestones({ crossref, openalex });
  const known = new Set<SentinelState>([previousState, ...alreadyReached]);

  // A milestone is "new" if we never recorded it AND it advances beyond the
  // task's current rank (or is a sibling indexed_* milestone).
  const newMilestones = outcome.reached
    .filter((m) => !known.has(m.state))
    .filter(
      (m) =>
        stateRank(m.state) > stateRank(previousState) ||
        (stateRank(m.state) === stateRank(previousState) && m.state !== previousState),
    )
    // One evidence record per state (crossref preferred as primary source).
    .filter((m, i, arr) => arr.findIndex((x) => x.state === m.state) === i)
    .sort((a, b) => stateRank(a.state) - stateRank(b.state));

  const highestState =
    stateRank(outcome.highestState) > stateRank(previousState)
      ? outcome.highestState
      : previousState;

  return { newMilestones, highestState, checkedAt: Date.now() };
}

interface SourceResult<T> {
  value: T | null;
  error: unknown | null;
}

async function settleSource<T>(load: () => Promise<T | null>): Promise<SourceResult<T>> {
  try {
    return { value: await load(), error: null };
  } catch (error) {
    return { value: null, error };
  }
}

function assertEvidenceCheckComplete(
  sources: Array<{ name: string; value: unknown | null; error: unknown | null }>,
): void {
  const hasEvidence = sources.some((source) => source.value);
  if (hasEvidence) return;

  const failures = sources.filter((source) => source.error);
  if (failures.length === 0) return;

  throw new Error(`DOI 检查失败:${failures.map(formatSourceFailure).join("; ")}`);
}

function formatSourceFailure(source: { name: string; error: unknown | null }): string {
  const raw =
    source.error instanceof Error ? source.error.message : String(source.error ?? "未知错误");
  const compact = raw.replace(/\s+/g, " ").trim();
  return `${source.name} ${compact.slice(0, 220)}`;
}
