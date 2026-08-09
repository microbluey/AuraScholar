import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  ContentUnitsRepo,
  KnowledgeIndexesRepo,
  type ContentUnit,
  type Database,
} from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import {
  applyRetrievalLanguagePreference,
  assessRetrievalEvaluationQuality,
  createSemanticRetrievalEvaluationRetriever,
  evaluateRetrievalDataset,
  parseRetrievalLanguageIntent,
  type FusedRetrievalRank,
  type RetrievalEvaluationCandidateScope,
  type RetrievalEvaluationContentUnit,
} from "@aurascholar/knowledge";
import { BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1 } from "@aurascholar/knowledge/evaluation-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseCoordinator } from "./database-coordinator";
import {
  LocalSemanticIndexService,
  type LocalSemanticEmbeddingProvider,
} from "./local-semantic-index-service";
import { LocalEmbeddingProvider, LOCAL_EMBEDDING_MODEL_PRESETS } from "./local-embedding-provider";
import { LocalEmbeddingArtifactInstaller } from "./local-embedding-artifact-installer";
import { TransformersJsLocalEmbeddingRuntime } from "./local-embedding-transformers-runtime";
import { SqliteVecIndexStore } from "./sqlite-vec-index";

const requireFromTest = createRequire(import.meta.url);
const sqliteVecLoadablePath = resolveSqliteVecLoadablePath();
const modelEvaluation = process.env.AURASCHOLAR_EMBEDDING_EVALUATION_ROOT ? it : it.skip;

let database: Database;
let coordinator: DatabaseCoordinator;
let libraryId: string;
let provider: LocalSemanticEmbeddingProvider;
let store: SqliteVecIndexStore;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  const loadExtension = database.loadExtension;
  if (!loadExtension) throw new Error("The Node SQLite test driver cannot load sqlite-vec");
  await loadExtension(sqliteVecLoadablePath);
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "local-semantic-retrieval-evaluation",
    deviceName: "Local semantic retrieval evaluation",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
  provider = developmentProjectionProvider();
  store = new SqliteVecIndexStore({
    inspect: (operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  });
});

describe("local semantic retrieval evaluation integration", () => {
  it("scores a real persisted sqlite-vec generation without FTS or human-review gates", async () => {
    const { report } = await evaluateProvider(provider);
    assertEvaluationStructure(report);

    // These are integrity guardrails for the synthetic topic projection: every
    // labelled target must survive the real persisted vector path. They are
    // not release-quality thresholds for a production embedding model.
    expect(metricAt(report.overall.metrics, 10).hitRate).toBe(1);
    expect(metricAt(report.overall.metrics, 20).recall).toBe(1);
    expect(report.bySlice.every((slice) => metricAt(slice.metrics, 10).hitRate === 1)).toBe(true);
    expect(report.queries).toHaveLength(BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1.queries.length);
    expect(
      report.queries.every(
        (result) =>
          result.queryId.length > 0 &&
          result.rankedContentUnitIds.length <= 20 &&
          result.rankedContentUnitIds.includes(primaryTargetId(result.queryId)),
      ),
    ).toBe(true);
    expect(provider.embedDocuments).toHaveBeenCalledTimes(1);
    expect(provider.embedQuery).toHaveBeenCalledTimes(
      BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1.queries.length,
    );
  });

  modelEvaluation(
    "runs the same evaluator with an explicitly installed real local model",
    async () => {
      const root = process.env.AURASCHOLAR_EMBEDDING_EVALUATION_ROOT?.trim();
      if (!root) throw new Error("The real embedding evaluation artifact root is missing");
      const model = LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small;
      const installer = new LocalEmbeddingArtifactInstaller({ rootDirectory: resolve(root) });
      const artifact = await installer.getInstalledArtifact(model);
      if (!artifact) {
        throw new Error("A verified catalog-pinned embedding artifact is required for evaluation");
      }
      const actualProvider = new LocalEmbeddingProvider({
        artifact,
        model,
        runtime: new TransformersJsLocalEmbeddingRuntime(),
      });
      const { report } = await evaluateProvider(actualProvider);
      assertEvaluationStructure(report);
      const quality = assessRetrievalEvaluationQuality(report);
      const { report: languageRoutedReport } = await evaluateProvider(
        actualProvider,
        "full-corpus",
        {
          languagePreference: true,
        },
      );
      assertEvaluationStructure(languageRoutedReport);
      const languageRoutedQuality = assessRetrievalEvaluationQuality(languageRoutedReport);
      // This opt-in calibration gate covers the product's explicit-language
      // routing layer. The raw semantic report above remains visible so a
      // routing pass cannot be mistaken for a stronger embedding model.
      expect(languageRoutedQuality.passed).toBe(true);
      const verbose = process.env.AURASCHOLAR_RETRIEVAL_EVALUATION_VERBOSE === "1";
      const targetLanguageOnly = verbose
        ? await evaluateProvider(actualProvider, "target-language-only")
        : null;
      console.info(
        `AURASCHOLAR_RETRIEVAL_EVALUATION ${JSON.stringify({
          bySlice: report.bySlice,
          dataset: report.dataset,
          embeddingProfile: actualProvider.embeddingProfile,
          overall: report.overall,
          quality,
          languageRouted: {
            bySlice: languageRoutedReport.bySlice,
            overall: languageRoutedReport.overall,
            quality: languageRoutedQuality,
          },
          queries: verbose ? report.queries : undefined,
          targetLanguageOnly: targetLanguageOnly
            ? {
                bySlice: targetLanguageOnly.report.bySlice,
                overall: targetLanguageOnly.report.overall,
                quality: assessRetrievalEvaluationQuality(targetLanguageOnly.report),
              }
            : undefined,
        })}`,
      );
    },
    10 * 60_000,
  );
});

async function evaluateProvider(
  candidateProvider: LocalSemanticEmbeddingProvider,
  candidateScope: RetrievalEvaluationCandidateScope = "full-corpus",
  options: { languagePreference?: boolean } = {},
) {
  const dataset = BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1;
  await new ContentUnitsRepo(database, libraryId).upsertMany(
    dataset.contentUnits.map(toContentUnit),
  );

  const indexService = new LocalSemanticIndexService({
    ensureVectorRuntime: vi.fn().mockResolvedValue(undefined),
    getEmbeddingProvider: vi.fn().mockResolvedValue(candidateProvider),
    inspect: (operation) => coordinator.execute(operation),
    now: () => 1_738_361_600_000,
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
    vectorWriter: store,
  });
  const queued = await indexService.enqueueBuild(libraryId);
  const materialized = await indexService.materialize(queued.job, new AbortController().signal);

  expect(materialized.progress).toMatchObject({ status: "active", indexedCount: 16 });
  await expect(
    new KnowledgeIndexesRepo(database, libraryId).get(queued.index.id),
  ).resolves.toMatchObject({
    expectedCount: 16,
    indexedCount: 16,
    status: "active",
  });

  const semanticRetrieve = createSemanticRetrievalEvaluationRetriever({
    embeddingProvider: candidateProvider,
    indexId: queued.index.id,
    libraryId,
    vectorStore: store,
  });
  const retrieve = options.languagePreference
    ? languagePreferenceRetriever(semanticRetrieve, dataset.contentUnits)
    : semanticRetrieve;
  const report = await evaluateRetrievalDataset(dataset, retrieve, {
    candidateScope,
    cutoffs: [1, 10, 20],
    runProvenance: {
      chunker: candidateProvider.embeddingProfile.chunkProfileVersion,
      embeddingProfile: candidateProvider.embeddingProfile.fingerprint,
      extractor: "evaluation-content-unit-v1",
      fusion: "none:semantic-only",
      generator: "not-applicable",
      prompt: "not-applicable",
      reranker: options.languagePreference ? "explicit-language-preference-rrf-v1:w2" : "none",
      vectorStore: "sqlite-vec@0.1.7-alpha.10:cosine",
    },
  });
  return { indexId: queued.index.id, report };
}

function languagePreferenceRetriever(
  retrieve: ReturnType<typeof createSemanticRetrievalEvaluationRetriever>,
  contentUnits: readonly RetrievalEvaluationContentUnit[],
) {
  const languageByContentUnitId = new Map(contentUnits.map((unit) => [unit.id, unit.language]));
  return async (input: Parameters<typeof retrieve>[0]): Promise<readonly string[]> => {
    const baseIds = await retrieve(input);
    const intent = parseRetrievalLanguageIntent(input.query.text);
    if (!intent) return baseIds;
    const baseRanks: FusedRetrievalRank[] = baseIds.map((contentUnitId, index) => ({
      contentUnitId,
      ranks: [{ channelId: "vector", rank: index + 1 }],
      score: 1 / (60 + index + 1),
    }));
    return applyRetrievalLanguagePreference(baseRanks, {
      languageByContentUnitId,
      preferredLanguage: intent.language,
    }).candidates.map(({ contentUnitId }) => contentUnitId);
  };
}

function assertEvaluationStructure(report: Awaited<ReturnType<typeof evaluateRetrievalDataset>>) {
  expect(report.candidateScope).toBe("full-corpus");
  expect(report.dataset).toEqual({
    id: "aurascholar-bilingual-development-v1",
    split: "development",
    version: "1.0.0",
  });
  expect(report.overall.queryCount).toBe(32);
  expect(report.bySlice.map((slice) => [slice.slice, slice.queryCount])).toEqual([
    ["zh-zh", 8],
    ["en-en", 8],
    ["zh-en", 8],
    ["en-zh", 8],
  ]);
  expect(report.releaseReadiness.eligible).toBe(false);
  expect(report.releaseReadiness.reasons).toContain("dataset split must be held-out");
  expect(report.queries).toHaveLength(BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1.queries.length);
}

const TOPIC_KEYWORDS: readonly (readonly string[])[] = [
  ["validation", "验证", "泛化", "留出", "fitting", "拟合", "error", "误差"],
  ["bootstrap", "resampling", "重采样", "自助法", "uncertainty", "不确定性"],
  ["incidence", "prevalence", "发病率", "患病率", "new cases", "新病例", "已有病例"],
  ["contact tracing", "接触者", "追踪", "exposures", "密切接触", "随访", "follow-up"],
  ["carbon budget", "碳预算", "carbon-dioxide", "二氧化碳", "warming", "升温", "排放"],
  ["urban heat", "城市热岛", "pavement", "铺装", "vegetation", "植被", "built-up", "城区"],
  ["provenance", "来源原则", "creator", "形成者", "arrangement", "排列", "档案"],
  ["ocr", "optical-character", "文字识别", "旧字体", "scan noise", "扫描噪声", "版面"],
];

function developmentProjectionProvider(): LocalSemanticEmbeddingProvider {
  return {
    dimension: TOPIC_KEYWORDS.length,
    egressMode: "local",
    embedDocuments: vi.fn(async (texts: readonly string[]) => texts.map(projectText)),
    embedQuery: vi.fn(async (text: string) => projectText(text)),
    embeddingProfile: {
      chunkProfileVersion: "evaluation-topic-projection-v1",
      dimension: TOPIC_KEYWORDS.length,
      distanceMetric: "cosine",
      egressMode: "local",
      fingerprint: "local:evaluation-topic-projection-v1",
      modelId: "test/bilingual-topic-projection",
      modelRevision: "test@1",
      normalization: "l2",
      providerKind: "local-test-evaluation",
    },
    id: "local:test-evaluation-topic-projection",
    model: "test/bilingual-topic-projection",
  };
}

function projectText(text: string): Float32Array {
  const normalized = text.toLocaleLowerCase();
  const vector = new Float32Array(TOPIC_KEYWORDS.length);
  for (let topic = 0; topic < TOPIC_KEYWORDS.length; topic += 1) {
    const keywords = TOPIC_KEYWORDS[topic]!;
    vector[topic] = keywords.reduce(
      (score, keyword) => score + (normalized.includes(keyword) ? 1 : 0),
      0,
    );
  }
  if (vector.every((value) => value === 0)) vector[0] = 1;
  let magnitudeSquared = 0;
  for (const value of vector) magnitudeSquared += value * value;
  const inverseMagnitude = 1 / Math.sqrt(magnitudeSquared);
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = (vector[index] ?? 0) * inverseMagnitude;
  }
  return vector;
}

function toContentUnit(unit: RetrievalEvaluationContentUnit, ordinal: number): ContentUnit {
  return {
    anchor: { kind: "pdf", pageIndex: ordinal, revisionId: unit.sourceId, version: 1 },
    assetId: null,
    chunkProfile: "evaluation-content-unit-v1",
    contentHash: createHash("sha256").update(unit.id).digest("hex"),
    extractorProfile: "evaluation-extractor-v1",
    headingPath: null,
    id: unit.id,
    language: unit.language,
    libraryId,
    ordinal,
    parentUnitId: null,
    revisionId: null,
    sourceId: unit.sourceId,
    sourceType: "pdf",
    state: "ready",
    text: unit.text,
    tokenCount: unit.text.length,
    workId: null,
  };
}

function primaryTargetId(queryId: string): string {
  const [prefix, dataset, topicId, languagePair] = queryId.split(":");
  const targetLanguage = languagePair?.split("-")[1];
  if (
    prefix !== "query" ||
    dataset !== "development" ||
    !topicId ||
    (targetLanguage !== "zh" && targetLanguage !== "en")
  ) {
    throw new Error(`Unexpected development query id: ${queryId}`);
  }
  return `unit:development:${topicId}:${targetLanguage}`;
}

function metricAt(
  metrics: readonly { readonly k: number; readonly hitRate: number; readonly recall: number }[],
  cutoff: number,
) {
  const metric = metrics.find((candidate) => candidate.k === cutoff);
  if (!metric) throw new Error(`Missing evaluation metric at cutoff ${cutoff}`);
  return metric;
}

function resolveSqliteVecLoadablePath(): string {
  const sqliteVec = requireFromTest("sqlite-vec") as { getLoadablePath: () => unknown };
  const loadablePath = sqliteVec.getLoadablePath();
  if (typeof loadablePath !== "string" || !loadablePath.trim()) {
    throw new Error("sqlite-vec did not provide a loadable extension path");
  }
  return loadablePath;
}
