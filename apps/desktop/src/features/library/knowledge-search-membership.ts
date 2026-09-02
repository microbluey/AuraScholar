import type { KnowledgeContentSearchResult } from "../../services/knowledge-search";
import {
  evidenceShelfSourceIdentityKey,
  evidenceShelfSourceKey,
} from "../../services/evidence-shelf";

/**
 * Checks current ContentUnit ids and backup-safe source keys. The identity-only
 * set is intentionally separate: callers populate it only for previews whose
 * text carries an explicit backup-redaction marker.
 */
export function knowledgeResultHasShelfMembership(
  result: KnowledgeContentSearchResult,
  contentUnitIds?: ReadonlySet<string>,
  sourceKeys?: ReadonlySet<string>,
  identityFallbackKeys?: ReadonlySet<string>,
): boolean {
  return (
    contentUnitIds?.has(result.id) === true ||
    sourceKeys?.has(evidenceShelfSourceKey(result)) === true ||
    identityFallbackKeys?.has(evidenceShelfSourceIdentityKey(result)) === true
  );
}
