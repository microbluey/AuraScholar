import {
  assertEvidenceShelfListBudget,
  readEvidenceShelfListBudget,
  type Database,
} from "@aurascholar/db";

/** Tracks imported Shelf projects and validates their commit-time budgets. */
export function createEvidenceShelfBudgetTracker(): {
  add(row: Record<string, unknown>): void;
  assert(database: Database, libraryId: string): Promise<void>;
} {
  const projectIds = new Set<string>();
  return {
    add(row) {
      if (typeof row.project_id === "string" && row.project_id.trim()) {
        projectIds.add(row.project_id);
      }
    },
    async assert(database, libraryId) {
      for (const projectId of projectIds) {
        const budget = await readEvidenceShelfListBudget(database, libraryId, projectId);
        assertEvidenceShelfListBudget(budget);
      }
    },
  };
}
