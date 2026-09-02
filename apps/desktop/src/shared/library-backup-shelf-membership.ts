/**
 * Membership checks used by the Evidence Shelf backup graph validator.  The
 * rows are intentionally indexed without filtering deleted memberships: a
 * stale or removed Shelf candidate still needs a safe path through import.
 */
export interface ShelfMembershipTables {
  projectAssets: boolean;
  projectEvidence: boolean;
  projectWorks: boolean;
}

export function assertShelfProjectMembership(
  tables: ShelfMembershipTables,
  projectWorks: ReadonlySet<string>,
  projectAssets: ReadonlySet<string>,
  projectEvidence: ReadonlySet<string>,
  projectId: string,
  workId: string | null,
  assetId: string | null,
  sourceType: string,
  sourceId: string,
  version: number,
): void {
  if (!tables.projectWorks && !tables.projectAssets && !tables.projectEvidence) return;

  const hasWorkMembership =
    tables.projectWorks && workId !== null && projectWorks.has(pairKey(projectId, workId));
  const hasAssetMembership =
    tables.projectAssets && assetId !== null && projectAssets.has(pairKey(projectId, assetId));
  const hasEvidenceMembership =
    sourceType === "evidence" &&
    tables.projectEvidence &&
    projectEvidence.has(pairKey(projectId, sourceId));

  // Keep this in lockstep with the DB repo: Work/Asset membership scopes all
  // source kinds, while an Evidence membership is an additional route.
  if (!hasWorkMembership && !hasAssetMembership && !hasEvidenceMembership) {
    throw new Error(
      `v${version} 备份包含不属于目标 Research Project 的 Evidence Shelf source：project_id+sourceId`,
    );
  }
}

export function pairIndex(
  rows: readonly Record<string, unknown>[],
  leftField: string,
  rightField: string,
): Set<string> {
  return new Set(
    rows.flatMap((row) => {
      const left = stringValue(row[leftField]);
      const right = stringValue(row[rightField]);
      return left && right ? [pairKey(left, right)] : [];
    }),
  );
}

function pairKey(left: string, right: string): string {
  return JSON.stringify([left, right]);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
