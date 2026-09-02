import type { Database } from "@aurascholar/db";
import {
  ContentUnitSearchRepo,
  KnowledgeCorpusScopeRepo,
  type ContentUnitSearchResult,
  type KnowledgeCorpusScopeResolution,
} from "@aurascholar/db/repos/knowledge";
import { createCorpusScopeSnapshot, type CorpusScopeSnapshot } from "@aurascholar/knowledge";
import { assertActiveLocalLibrary, type DataCommandDependencies } from "./data-command-runtime";
import type { ParsedSearchKnowledgeContentInput } from "./knowledge-command-input";

/**
 * Resolves the renderer's selection once, then freezes the canonical source
 * identities used by every retrieval channel in this operation. Membership
 * changes after this point cannot silently broaden a running query.
 */
export async function resolveKnowledgeCorpusScope(
  input: ParsedSearchKnowledgeContentInput,
  dependencies: DataCommandDependencies,
): Promise<CorpusScopeSnapshot> {
  if (!dependencies.inspect) {
    throw new Error("Main-process database query execution is unavailable");
  }
  const resolution = await dependencies.inspect((database) =>
    resolveCorpusScopeInDatabase(database, input),
  );
  return createCorpusScopeSnapshotFromResolution(input, resolution);
}

/** Resolves a scope and performs the FTS read under one lease. */
export async function resolveKnowledgeCorpusAndFullText(
  input: ParsedSearchKnowledgeContentInput,
  dependencies: DataCommandDependencies,
  limit: number,
): Promise<{ scope: CorpusScopeSnapshot; rows: ContentUnitSearchResult[] }> {
  if (!dependencies.inspect) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.inspect(async (database) => {
    const resolution = await resolveCorpusScopeInDatabase(database, input);
    const scope = await createCorpusScopeSnapshotFromResolution(input, resolution);
    const rows = await new ContentUnitSearchRepo(database, input.libraryId).search({
      query: input.query,
      limit,
      allowedSourceIds: scope.allowedSourceIds,
      sourceTypes: input.sourceTypes,
      sourceId: input.sourceId,
      workId: input.workId,
      assetId: input.assetId,
      revisionId: input.revisionId,
      includeContextOnly: input.includeContextOnly,
    });
    return { rows, scope };
  });
}

async function resolveCorpusScopeInDatabase(
  database: Database,
  input: ParsedSearchKnowledgeContentInput,
): Promise<KnowledgeCorpusScopeResolution> {
  await assertActiveLocalLibrary(database, input.libraryId);
  return new KnowledgeCorpusScopeRepo(database, input.libraryId).resolve(input.scope);
}

async function createCorpusScopeSnapshotFromResolution(
  input: ParsedSearchKnowledgeContentInput,
  resolution: KnowledgeCorpusScopeResolution,
): Promise<CorpusScopeSnapshot> {
  return createCorpusScopeSnapshot({
    capturedAt: Date.now(),
    allowedSourceIds: resolution.allSourceIds,
    libraryId: input.libraryId,
    scope: input.scope,
  });
}
