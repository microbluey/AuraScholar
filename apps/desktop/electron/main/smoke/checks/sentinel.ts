import type { SmokeCheck, SmokeRendererResult } from "../contracts";

export function buildSentinelSmokeChecks(renderer: SmokeRendererResult): SmokeCheck[] {
  return [
    {
      name: "sentinel-duplicate-doi-guard",
      pass: renderer.sentinelDuplicateDoiBlocked,
      detail: `message=${renderer.sentinelDuplicateDoiMessageVisible}; count=${renderer.sentinelDuplicateDoiCount}`,
    },
    {
      name: "sentinel-add-busy-feedback",
      pass: renderer.sentinelAddBusyVisible,
      detail: `busy=${renderer.sentinelAddBusyVisible}`,
    },
    {
      name: "sentinel-deleted-doi-restore",
      pass: renderer.sentinelDeletedDoiRestored,
      detail: `count=${renderer.sentinelDeletedDoiRestoredCount}`,
    },
    {
      name: "sentinel-delete-failure-recovers",
      pass:
        renderer.sentinelDeleteFailureVisible &&
        renderer.sentinelDeleteFailureBusyVisible &&
        renderer.sentinelDeleteFailurePreserved &&
        renderer.sentinelDeleteFailureDidNotPersist,
      detail: `visible=${renderer.sentinelDeleteFailureVisible}; busy=${renderer.sentinelDeleteFailureBusyVisible}; preserved=${renderer.sentinelDeleteFailurePreserved}; notPersisted=${renderer.sentinelDeleteFailureDidNotPersist}`,
    },
    {
      name: "sentinel-delete-undo-failure-recovers",
      pass:
        renderer.sentinelDeleteUndoFailureVisible &&
        renderer.sentinelDeleteUndoFailureBusyVisible &&
        renderer.sentinelDeleteUndoFailurePreserved &&
        renderer.sentinelDeleteUndoFailureDidNotPersist,
      detail: `visible=${renderer.sentinelDeleteUndoFailureVisible}; busy=${renderer.sentinelDeleteUndoFailureBusyVisible}; preserved=${renderer.sentinelDeleteUndoFailurePreserved}; notPersisted=${renderer.sentinelDeleteUndoFailureDidNotPersist}`,
    },
    {
      name: "sentinel-delete-undo-recovery",
      pass:
        renderer.sentinelDeleteUndoVisible &&
        renderer.sentinelDeleteUndoBusyVisible &&
        renderer.sentinelDeleteUndoRestored,
      detail: `visible=${renderer.sentinelDeleteUndoVisible}; busy=${renderer.sentinelDeleteUndoBusyVisible}; restored=${renderer.sentinelDeleteUndoRestored}`,
    },
    {
      name: "sentinel-last-error-visible",
      pass: renderer.sentinelLastErrorVisible,
    },
    {
      name: "sentinel-manual-failure-recorded",
      pass:
        renderer.sentinelTaskCheckBusyVisible &&
        renderer.sentinelManualFailureVisible &&
        renderer.sentinelManualFailureRecorded,
      detail: `busy=${renderer.sentinelTaskCheckBusyVisible}; visible=${renderer.sentinelManualFailureVisible}; recorded=${renderer.sentinelManualFailureRecorded}`,
    },
    {
      name: "sentinel-load-retry-recovery",
      pass: renderer.sentinelLoadRetryRecoveryVisible && renderer.sentinelLoadRetryAttempts === 2,
      detail: renderer.sentinelLoadRetryRecoveryDetail,
    },
    {
      name: "sentinel-refresh-race-preserved",
      pass: renderer.sentinelRefreshRacePreserved,
    },
    {
      name: "sentinel-filter-empty-recovery",
      pass: renderer.sentinelFilterEmptyActionRestoresResults,
    },
  ];
}
