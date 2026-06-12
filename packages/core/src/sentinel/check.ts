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
  const [crossref, openalex] = await Promise.all([
    crossrefRaw(ctx, doi).catch(() => null),
    openalexByDoi(ctx, doi)
      .then((w) => (w ? (w as unknown as Record<string, unknown>) : null))
      .catch(() => null),
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
