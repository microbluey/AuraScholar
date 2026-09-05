import type { AIProvider } from "@aurascholar/ai";
import {
  ContentUnitSearchRepo,
  ContentUnitsRepo,
  KnowledgeCorpusScopeRepo,
  type ContentUnitSearchResult,
  type Database,
} from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import {
  buildGroundingPack,
  createCorpusScopeSnapshot,
  runGroundedSynthesis,
  type ContentUnit,
  type GroundingPack,
  type GroundingPackItem,
  type ValidatedGroundedAnswer,
} from "@aurascholar/knowledge";
import type {
  AiSynthesizeDocumentCommandInput,
  AiSynthesizeDocumentCommandResult,
} from "../ai-command-contract";
import { assertActiveLocalLibrary } from "./data-command-runtime";
import {
  generateGroundedAnswerFromProvider,
  resolveGroundedClaimRelationsFromProvider,
} from "./grounded-synthesis-provider";

const MAX_DOCUMENT_RETRIEVAL_RESULTS = 64;
const DOCUMENT_SCOPE = "works" as const;

export interface GroundedDocumentSynthesisRuntime {
  createProvider(): Promise<AIProvider>;
  execute<T>(operation: (database: Database) => T | Promise<T>): Promise<T>;
  run<T>(requestId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
  assertNotAborted(signal: AbortSignal): void;
}

interface CapturedGrounding {
  readonly libraryId: string;
  readonly pack: GroundingPack;
  readonly scope: { readonly kind: typeof DOCUMENT_SCOPE; readonly workIds: readonly string[] };
}

interface AssetRevisionSnapshot {
  readonly currentRevisionId: string | null;
  readonly sourceContentHash: string | null;
}

/**
 * Runs an ephemeral, Work-scoped answer. Main owns all source resolution and
 * revision proofs; the renderer never chooses a Library, source ID, citation,
 * provider target, model, or durable destination.
 */
export async function synthesizeGroundedDocumentInMain(
  input: AiSynthesizeDocumentCommandInput,
  runtime: GroundedDocumentSynthesisRuntime,
): Promise<AiSynthesizeDocumentCommandResult> {
  return runtime.run(input.requestId, async (signal) => {
    const captured = await runtime.execute((database) => captureGrounding(database, input, signal));
    runtime.assertNotAborted(signal);

    if (captured.pack.citations.length === 0) {
      const answer = await runGroundedSynthesis({
        generate: () => {
          throw new Error("Empty grounding packs must not contact a provider");
        },
        pack: captured.pack,
        query: input.query,
        resolveClaimRelations: () => {
          throw new Error("Empty grounding packs must not resolve relations");
        },
        signal,
      });
      await runtime.execute((database) => assertGroundingStillCurrent(database, captured, signal));
      return toCommandResult(answer, null);
    }

    const provider = await runtime.createProvider();
    runtime.assertNotAborted(signal);
    const answer = await runGroundedSynthesis({
      generate: ({ prompt, signal: generationSignal }) =>
        generateGroundedAnswerFromProvider(provider, prompt, generationSignal),
      pack: captured.pack,
      query: input.query,
      resolveClaimRelations: (relationInput) =>
        resolveGroundedClaimRelationsFromProvider(provider, relationInput),
      signal,
    });
    runtime.assertNotAborted(signal);
    await runtime.execute((database) => assertGroundingStillCurrent(database, captured, signal));
    runtime.assertNotAborted(signal);
    return toCommandResult(answer, provider.model);
  });
}

async function captureGrounding(
  database: Database,
  input: AiSynthesizeDocumentCommandInput,
  signal: AbortSignal,
): Promise<CapturedGrounding> {
  throwIfAborted(signal);
  const libraryId = await requireActiveLocalLibraryId(database);
  const scope = { kind: DOCUMENT_SCOPE, workIds: [input.workId] } as const;
  const scopeResolution = await new KnowledgeCorpusScopeRepo(database, libraryId).resolve(scope);
  throwIfAborted(signal);
  const corpusScope = await createCorpusScopeSnapshot({
    allowedSourceIds: scopeResolution.allSourceIds,
    capturedAt: Date.now(),
    libraryId,
    scope,
  });
  const matches = await new ContentUnitSearchRepo(database, libraryId).search({
    allowedSourceIds: corpusScope.allowedSourceIds,
    limit: MAX_DOCUMENT_RETRIEVAL_RESULTS,
    query: input.query,
  });
  throwIfAborted(signal);
  const candidates = matches.filter((row) => row.revisionId !== null);
  const assetSnapshots = await readAssetRevisionSnapshots(
    database,
    libraryId,
    candidates.flatMap((row) => (row.assetId === null ? [] : [row.assetId])),
  );
  const currentRevisionIds = Object.fromEntries(
    [...assetSnapshots.entries()].map(([assetId, snapshot]) => [assetId, snapshot.currentRevisionId]),
  );
  const pack = await buildGroundingPack({
    candidates: candidates.map((row, index) => toGroundingCandidate(row, index, assetSnapshots)),
    corpusScope,
    currentRevisionIds,
    libraryId,
    retrievalRunId: `retrieval:${input.requestId}`,
    runId: input.requestId,
  });
  return { libraryId, pack, scope };
}

function toGroundingCandidate(
  row: ContentUnitSearchResult,
  index: number,
  assetSnapshots: ReadonlyMap<string, AssetRevisionSnapshot>,
) {
  const asset = row.assetId === null ? undefined : assetSnapshots.get(row.assetId);
  return {
    authority: row.sourceType === "pdf" ? ("published-source" as const) : undefined,
    contentUnit: toGroundingContentUnit(row),
    currentRevisionId: asset?.currentRevisionId,
    rank: index + 1,
    sourceContentHash:
      row.sourceType === "evidence"
        ? row.contentHash
        : (asset?.sourceContentHash ?? null),
    sourceTitle: row.workTitle,
  };
}

function toGroundingContentUnit(row: ContentUnitSearchResult): ContentUnit {
  return {
    anchor: row.anchor as ContentUnit["anchor"],
    assetId: row.assetId,
    chunkProfile: row.chunkProfile,
    contentHash: row.contentHash,
    extractorProfile: row.extractorProfile,
    headingPath: row.headingPath,
    id: row.id,
    language: row.language,
    libraryId: row.libraryId,
    ordinal: row.ordinal,
    parentUnitId: row.parentUnitId,
    revisionId: row.revisionId,
    sourceId: row.sourceId,
    sourceType: row.sourceType,
    state: row.state,
    text: row.text,
    tokenCount: row.tokenCount,
    workId: row.workId,
  };
}

async function assertGroundingStillCurrent(
  database: Database,
  captured: CapturedGrounding,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  try {
    const libraryId = await requireActiveLocalLibraryId(database);
    if (libraryId !== captured.libraryId) throw new Error("Library changed");
    const sourceResolution = await new KnowledgeCorpusScopeRepo(database, libraryId).resolve(
      captured.scope,
    );
    const allowedSources = new Set(sourceResolution.allSourceIds);
    const units = new ContentUnitsRepo(database, libraryId);
    for (const item of captured.pack.items) {
      await assertPackItemStillCurrent(item, units, allowedSources);
    }
    const assetSnapshots = await readAssetRevisionSnapshots(
      database,
      libraryId,
      captured.pack.items.flatMap((item) => (item.assetId === null ? [] : [item.assetId])),
    );
    for (const item of captured.pack.items) {
      if (item.assetId === null) continue;
      if (assetSnapshots.get(item.assetId)?.currentRevisionId !== item.revisionId) {
        throw new Error("Document revision changed");
      }
    }
    throwIfAborted(signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error("Document evidence changed while synthesis was running; please retry", {
      cause: error,
    });
  }
}

async function assertPackItemStillCurrent(
  item: GroundingPackItem,
  units: ContentUnitsRepo,
  allowedSources: ReadonlySet<string>,
): Promise<void> {
  for (const contentUnitId of item.contentUnitIds) {
    const unit = await units.get(contentUnitId);
    if (
      !unit ||
      !allowedSources.has(unit.sourceId) ||
      unit.assetId !== item.assetId ||
      unit.contentHash !== item.contentHash ||
      unit.revisionId !== item.revisionId ||
      unit.workId !== item.workId ||
      !item.sourceIds.includes(unit.sourceId) ||
      !item.sourceTypes.includes(unit.sourceType)
    ) {
      throw new Error("Grounding source changed");
    }
  }
}

async function readAssetRevisionSnapshots(
  database: Database,
  libraryId: string,
  rawAssetIds: readonly string[],
): Promise<Map<string, AssetRevisionSnapshot>> {
  const assetIds = [...new Set(rawAssetIds)];
  const snapshots = new Map<string, AssetRevisionSnapshot>(
    assetIds.map((assetId) => [assetId, { currentRevisionId: null, sourceContentHash: null }]),
  );
  if (assetIds.length === 0) return snapshots;
  const rows = await database.query<{
    blob_sha256: string | null;
    current_revision_id: string | null;
    id: string;
  }>(
    `SELECT asset.id, asset.current_revision_id, revision.blob_sha256
     FROM document_assets asset
     LEFT JOIN document_revisions revision
       ON revision.id = asset.current_revision_id
      AND revision.asset_id = asset.id
      AND revision.deleted_at IS NULL
     WHERE asset.library_id = ?
       AND asset.deleted_at IS NULL
       AND asset.id IN (${assetIds.map(() => "?").join(", ")})`,
    [libraryId, ...assetIds],
  );
  for (const row of rows) {
    snapshots.set(row.id, {
      currentRevisionId: row.current_revision_id,
      sourceContentHash: isSha256(row.blob_sha256) ? row.blob_sha256 : null,
    });
  }
  return snapshots;
}

function toCommandResult(
  answer: ValidatedGroundedAnswer,
  modelName: string | null,
): AiSynthesizeDocumentCommandResult {
  return {
    answerMarkdown: answer.answerMarkdown,
    claims: answer.claims.map((claim) => ({
      citationIds: [...claim.citationIds],
      citationRelations: { ...claim.citationRelations },
      citations: claim.citations.map((citation) => ({
        ...citation,
        anchorSnapshot: citation.anchorSnapshot,
      })),
      claimKey: claim.claimKey,
      coverage: claim.coverage,
      kind: claim.kind,
      text: claim.text,
    })),
    modelName,
    packHash: answer.packHash,
    status: answer.status,
  };
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("Grounded synthesis cancelled");
  error.name = "AbortError";
  throw error;
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}

function isSha256(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{64}$/.test(value);
}
