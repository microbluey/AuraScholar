import type {
  ContentUnitIndexStats,
  ContentUnitSearchResult,
} from "@aurascholar/db/repos/knowledge";
import type {
  BuildKnowledgeSemanticIndexResult,
  KnowledgeContentIndexStats,
  KnowledgeContentSearchResult,
  KnowledgeSemanticIndexStatus,
  KnowledgeSemanticIndexSummary,
} from "../data-command-contract";
import type { LibraryScopeToken } from "../library-read-command-contract";
import type {
  EnqueueLocalSemanticIndexBuildResult,
  LocalSemanticIndexStatus,
} from "./local-semantic-index-service";

export function toKnowledgeContentSearchResult(
  row: ContentUnitSearchResult,
): KnowledgeContentSearchResult {
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    workId: row.workId,
    workTitle: row.workTitle,
    assetId: row.assetId,
    revisionId: row.revisionId,
    parentUnitId: row.parentUnitId,
    ordinal: row.ordinal,
    headingPath: row.headingPath,
    anchor: row.anchor,
    text: row.text,
    language: row.language,
    tokenCount: row.tokenCount,
    state: row.state,
    score: row.score,
    excerpt: row.excerpt,
  };
}

export function toKnowledgeContentIndexStats(
  stats: ContentUnitIndexStats,
): KnowledgeContentIndexStats {
  return {
    totalContentUnits: stats.total,
    readyContentUnits: stats.ready,
    contextOnlyContentUnits: stats.contextOnly,
    sourceCounts: stats.sourceCounts,
    languageCoverage: stats.languageCoverage,
  };
}

export function toBuildSemanticIndexResult(
  result: EnqueueLocalSemanticIndexBuildResult,
  scope: LibraryScopeToken,
): BuildKnowledgeSemanticIndexResult {
  const status = result.job.status;
  if (
    status !== "queued" &&
    status !== "leased" &&
    status !== "running" &&
    status !== "retry-wait"
  ) {
    throw new Error("Semantic index job cannot be presented safely");
  }
  const indexStatus = requirePresentableSemanticIndexStatus(result.index.status);
  return {
    created: result.created,
    index: toKnowledgeSemanticIndexSummary({
      ...result.index,
      stale: false,
      status: indexStatus,
    }),
    job: { id: result.job.id, status },
    scope: { ...scope },
  };
}

export function toKnowledgeSemanticIndexStatus(
  status: LocalSemanticIndexStatus,
): KnowledgeSemanticIndexStatus {
  return {
    active: status.active ? toKnowledgeSemanticIndexSummary(status.active) : null,
    building: status.building ? toKnowledgeSemanticIndexSummary(status.building) : null,
    failed: status.failed ? toKnowledgeSemanticIndexSummary(status.failed) : null,
  };
}

function requirePresentableSemanticIndexStatus(
  status: string,
): KnowledgeSemanticIndexSummary["status"] {
  if (status === "active" || status === "building" || status === "failed") return status;
  throw new Error("Semantic index is not in a presentable state");
}

function toKnowledgeSemanticIndexSummary(summary: {
  expectedCount: number;
  id: string;
  indexedCount: number;
  stale: boolean;
  status: "active" | "building" | "failed";
}): KnowledgeSemanticIndexSummary {
  return { ...summary };
}
