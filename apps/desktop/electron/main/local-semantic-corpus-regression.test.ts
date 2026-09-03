import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  ContentUnitsRepo,
  KnowledgeIndexesRepo,
  type ContentUnit,
  type Database,
} from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataCommandOutput } from "../data-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import type { DataCommandDependencies } from "./data-command-runtime";
import { executeKnowledgeCommand } from "./knowledge-commands";
import {
  LocalSemanticIndexService,
  type LocalSemanticEmbeddingProvider,
} from "./local-semantic-index-service";
import { LocalSemanticSearchService } from "./local-semantic-search-service";
import { SqliteVecIndexStore } from "./sqlite-vec-index";
import { getActiveLibraryScopeToken } from "./library-scope-token";

const requireFromTest = createRequire(import.meta.url);
const sqliteVecLoadablePath = resolveSqliteVecLoadablePath();

const TOPIC_COUNT = 12;
const NOISE_READY_COUNT = 480;
const CONTEXT_ONLY_COUNT = 48;
const READY_COUNT = TOPIC_COUNT * 2 + NOISE_READY_COUNT;
const VECTOR_DIMENSION = TOPIC_COUNT * 2;
const MAX_INDEX_BUILD_MS = 30_000;
const MAX_QUERY_P95_MS = 2_000;

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
    deviceId: "local-semantic-corpus-regression",
    deviceName: "Local semantic corpus regression",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
  provider = corpusProjectionProvider();
  store = new SqliteVecIndexStore({
    inspect: (operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  });
});

describe("local semantic corpus-shaped regression", () => {
  it("keeps a mixed local corpus searchable, scoped, language-routable, and within broad local budgets", async () => {
    const corpus = createCorpus(libraryId);
    expect(new Set(corpus.ready.map((unit) => unit.sourceId)).size).toBeGreaterThan(250);
    await new ContentUnitsRepo(database, libraryId).upsertMany([
      ...corpus.ready,
      ...corpus.contextOnly,
    ]);

    // Language coverage is deliberately mixed so the planner and explicit
    // preference path see the same kind of incomplete metadata a Library
    // accumulates in practice. Context-only units stay outside this count.
    await expect(new ContentUnitsRepo(database, libraryId).getIndexStats()).resolves.toMatchObject({
      contextOnly: CONTEXT_ONLY_COUNT,
      languageCoverage: { en: 132, missing: 120, other: 120, zh: 132 },
      ready: READY_COUNT,
      total: READY_COUNT + CONTEXT_ONLY_COUNT,
    });

    const indexStartedAt = performance.now();
    const indexService = new LocalSemanticIndexService({
      assertJobLease: async () => {},
      ensureVectorRuntime: vi.fn().mockResolvedValue(undefined),
      getEmbeddingProvider: vi.fn().mockResolvedValue(provider),
      inspect: (operation) => coordinator.execute(operation),
      now: () => 1_738_361_600_000,
      transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
      vectorWriter: store,
    });
    const queued = await indexService.enqueueBuild(libraryId);
    const materialized = await indexService.materialize(queued.job, new AbortController().signal);
    const indexBuildMs = performance.now() - indexStartedAt;

    expect(materialized.progress).toMatchObject({
      indexedCount: READY_COUNT,
      status: "active",
    });
    await expect(
      new KnowledgeIndexesRepo(database, libraryId).get(queued.index.id),
    ).resolves.toMatchObject({
      expectedCount: READY_COUNT,
      indexedCount: READY_COUNT,
      status: "active",
    });

    const semanticSearch = new LocalSemanticSearchService({
      getActiveHybridIndexId: async (scope) =>
        coordinator.execute(async (connection) => {
          const active = await new KnowledgeIndexesRepo(connection, scope).getActive();
          return active?.id ?? null;
        }),
      getEmbeddingProvider: vi.fn().mockResolvedValue(provider),
      vectorStore: store,
    });
    const dependencies: DataCommandDependencies = {
      inspect: (operation) => coordinator.execute(operation),
      execute: (_commandName, operation) => coordinator.execute(operation),
      transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
    };

    const firstTopic = corpus.topics[0]!;
    const directHits = await store.search({
      allowedSourceIds: corpus.ready.map((unit) => unit.sourceId),
      indexId: queued.index.id,
      libraryId,
      limit: 80,
      vector: projectCorpusText(firstTopic.key),
    });
    expect(directHits.map((hit) => hit.contentUnitId)).toEqual(
      expect.arrayContaining([firstTopic.enId, firstTopic.zhId]),
    );
    const raw = await searchCorpus(dependencies, semanticSearch, {
      libraryId,
      query: `请解释 ${firstTopic.key} 的机制`,
    });
    expect(raw.retrieval).toEqual({ mode: "hybrid", semanticStatus: "used" });
    // The two translated twin units intentionally tie under the deterministic
    // vector fixture. Stable ID order places English first before the user
    // asks for a material language, mirroring the selection issue the
    // language-preference channel is designed to handle.
    expect(raw.results[0]?.id).toBe(firstTopic.enId);

    const queryDurations: number[] = [];
    for (const topic of corpus.topics) {
      const startedAt = performance.now();
      const response = await searchCorpus(dependencies, semanticSearch, {
        libraryId,
        query: `请提供关于 ${topic.key} 的中文资料`,
      });
      queryDurations.push(performance.now() - startedAt);

      expect(response.retrieval).toEqual({
        languagePreference: { applied: true, requestedLanguage: "zh" },
        mode: "hybrid",
        semanticStatus: "used",
      });
      expect(response.results[0]?.id).toBe(topic.zhId);
      expect(response.results.some((result) => corpus.contextOnlyIds.has(result.id))).toBe(false);
    }

    // The full-corpus direct vector query above exercises the >250-source
    // sqlite-vec allowlist chunking path. This call separately verifies that
    // a source-specific request retains its canonical scope after fusion and
    // semantic-row hydration.
    const scoped = await searchCorpus(dependencies, semanticSearch, {
      libraryId,
      query: `请提供关于 ${firstTopic.key} 的中文资料`,
      sourceId: firstTopic.zhSourceId,
    });
    expect(scoped.results.map((result) => result.id)).toEqual([firstTopic.zhId]);
    expect(scoped.retrieval).toEqual({
      languagePreference: { applied: true, requestedLanguage: "zh" },
      mode: "hybrid",
      semanticStatus: "used",
    });

    const queryP95Ms = percentile(queryDurations, 0.95);
    // These intentionally generous budgets catch accidental quadratic work,
    // remote calls, or a lost vector index without pretending to be a
    // machine-independent performance benchmark.
    expect(indexBuildMs).toBeLessThan(MAX_INDEX_BUILD_MS);
    expect(queryP95Ms).toBeLessThan(MAX_QUERY_P95_MS);
    if (process.env.AURASCHOLAR_CORPUS_REGRESSION_VERBOSE === "1") {
      console.info(
        `AURASCHOLAR_CORPUS_REGRESSION ${JSON.stringify({
          contextOnly: CONTEXT_ONLY_COUNT,
          indexBuildMs: round(indexBuildMs),
          queryP95Ms: round(queryP95Ms),
          ready: READY_COUNT,
          sourceCount: new Set(corpus.ready.map((unit) => unit.sourceId)).size,
        })}`,
      );
    }
  }, 60_000);
});

interface CorpusTopic {
  readonly enId: string;
  readonly key: string;
  readonly zhId: string;
  readonly zhSourceId: string;
}

interface CorpusFixture {
  readonly contextOnly: readonly ContentUnit[];
  readonly contextOnlyIds: ReadonlySet<string>;
  readonly ready: readonly ContentUnit[];
  readonly topics: readonly CorpusTopic[];
}

function createCorpus(scope: string): CorpusFixture {
  const ready: ContentUnit[] = [];
  const contextOnly: ContentUnit[] = [];
  const topics: CorpusTopic[] = [];
  let ordinal = 0;

  for (let topic = 0; topic < TOPIC_COUNT; topic += 1) {
    const key = topicKey(topic);
    const enId = `content-unit:corpus-shaped:topic:${topic}:en`;
    const zhId = `content-unit:corpus-shaped:topic:${topic}:zh`;
    const enSourceId = `pdf:corpus-shaped:topic:${topic}:en`;
    const zhSourceId = `pdf:corpus-shaped:topic:${topic}:zh`;
    ready.push(
      corpusUnit(scope, enId, {
        language: "en-US",
        ordinal: ordinal++,
        sourceId: enSourceId,
        sourceType: "pdf",
        text: englishTopicText(key, topic),
      }),
      corpusUnit(scope, zhId, {
        language: "zh-CN",
        ordinal: ordinal++,
        sourceId: zhSourceId,
        sourceType: "pdf",
        text: chineseTopicText(key, topic),
      }),
    );
    topics.push({ enId, key, zhId, zhSourceId });
  }

  for (let index = 0; index < NOISE_READY_COUNT; index += 1) {
    const sourceType = sourceTypeFor(index);
    const sourceOrdinal = 24 + (index % 300);
    ready.push(
      corpusUnit(scope, `content-unit:corpus-shaped:noise:${index}`, {
        language: noiseLanguageFor(index),
        ordinal: ordinal++,
        sourceId: `${sourceType}:corpus-shaped:source:${sourceOrdinal}`,
        sourceType,
        text: noiseText(index),
      }),
    );
  }

  for (let index = 0; index < CONTEXT_ONLY_COUNT; index += 1) {
    const topic = index % TOPIC_COUNT;
    contextOnly.push(
      corpusUnit(scope, `content-unit:corpus-shaped:context:${index}`, {
        language: index % 2 === 0 ? "zh" : "en",
        ordinal: ordinal++,
        sourceId: `annotation:corpus-shaped:context:${index}`,
        sourceType: "annotation",
        state: "context-only",
        text: `${index % 2 === 0 ? chineseTopicText(topicKey(topic), topic) : englishTopicText(topicKey(topic), topic)}\n这是仅供上下文使用的片段。`,
      }),
    );
  }

  return {
    contextOnly,
    contextOnlyIds: new Set(contextOnly.map((unit) => unit.id)),
    ready,
    topics,
  };
}

function corpusUnit(
  libraryId: string,
  id: string,
  overrides: Pick<ContentUnit, "language" | "ordinal" | "sourceId" | "sourceType" | "text"> &
    Partial<Pick<ContentUnit, "state">>,
): ContentUnit {
  return {
    anchor: {
      kind: "pdf",
      pageIndex: overrides.ordinal,
      revisionId: overrides.sourceId,
      version: 1,
    },
    assetId: null,
    chunkProfile: "corpus-shaped-regression-v1",
    contentHash: createHash("sha256").update(id).digest("hex"),
    extractorProfile: "corpus-shaped-regression-v1",
    headingPath: ["Corpus-shaped regression", `Chunk ${overrides.ordinal + 1}`],
    id,
    language: overrides.language,
    libraryId,
    ordinal: overrides.ordinal,
    parentUnitId: null,
    revisionId: null,
    sourceId: overrides.sourceId,
    sourceType: overrides.sourceType,
    state: overrides.state ?? "ready",
    text: overrides.text,
    tokenCount: overrides.text.length,
    workId: null,
  };
}

function englishTopicText(key: string, topic: number): string {
  return `${key} records the field mechanism for corpus topic ${topic + 1}. ${variableTail(topic)}`;
}

function chineseTopicText(key: string, topic: number): string {
  return `${key} 说明语料主题 ${topic + 1} 的机制与可核验来源。${variableTail(topic)}`;
}

function noiseText(index: number): string {
  const key = `noise-slate-${String(index % TOPIC_COUNT).padStart(2, "0")}`;
  const language = index % 2 === 0 ? "背景资料" : "background material";
  return `${key} ${language} ${index + 1}. ${variableTail(index)}`;
}

function variableTail(seed: number): string {
  const sentence =
    seed % 2 === 0 ? "来源片段保留定位信息。" : "The source chunk retains its anchor.";
  return Array.from({ length: 2 + (seed % 6) }, () => sentence).join(" ");
}

function noiseLanguageFor(index: number): string | null {
  switch (index % 4) {
    case 0:
      return "zh-Hans";
    case 1:
      return "en-GB";
    case 2:
      return "fr";
    default:
      return null;
  }
}

function sourceTypeFor(index: number): ContentUnit["sourceType"] {
  const remainder = index % 10;
  if (remainder < 7) return "pdf";
  if (remainder < 9) return "annotation";
  return "evidence";
}

function corpusProjectionProvider(): LocalSemanticEmbeddingProvider {
  return {
    dimension: VECTOR_DIMENSION,
    egressMode: "local",
    embedDocuments: vi.fn(async (texts: readonly string[]) => texts.map(projectCorpusText)),
    embedQuery: vi.fn(async (text: string) => projectCorpusText(text)),
    embeddingProfile: {
      chunkProfileVersion: "corpus-shaped-regression-v1",
      dimension: VECTOR_DIMENSION,
      distanceMetric: "cosine",
      egressMode: "local",
      fingerprint: "local:corpus-shaped-regression-v1",
      modelId: "test/corpus-shaped-projection",
      modelRevision: "test@1",
      normalization: "l2",
      providerKind: "local-test-corpus-regression",
    },
    id: "local:corpus-shaped-regression",
    model: "test/corpus-shaped-projection",
  };
}

function projectCorpusText(text: string): Float32Array {
  const vector = new Float32Array(VECTOR_DIMENSION);
  const topic = topicOrdinalFromText(text);
  if (topic === null) {
    vector[0] = 1;
    return vector;
  }
  vector[topic] = 1;
  return vector;
}

function topicOrdinalFromText(text: string): number | null {
  const topicMatch = /signal-orchid-(\d{2})/u.exec(text);
  if (topicMatch) {
    const topic = Number(topicMatch[1]);
    return topic >= 0 && topic < TOPIC_COUNT ? topic : null;
  }
  const noiseMatch = /noise-slate-(\d{2})/u.exec(text);
  if (noiseMatch) {
    const topic = Number(noiseMatch[1]);
    return topic >= 0 && topic < TOPIC_COUNT ? TOPIC_COUNT + topic : null;
  }
  return null;
}

function topicKey(topic: number): string {
  return `signal-orchid-${String(topic).padStart(2, "0")}`;
}

async function searchCorpus(
  dependencies: DataCommandDependencies,
  semanticSearch: LocalSemanticSearchService,
  input: { libraryId: string; query: string; sourceId?: string },
): Promise<DataCommandOutput<"knowledge.searchContent">> {
  const expectedScope = await getActiveLibraryScopeToken(database);
  return executeKnowledgeCommand(
    {
      input: {
        expectedScope,
        query: input.query,
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      },
      name: "knowledge.searchContent",
    },
    dependencies,
    {
      semanticSearch,
    },
  );
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) throw new Error("Cannot calculate a percentile without samples");
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index]!;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveSqliteVecLoadablePath(): string {
  const sqliteVec = requireFromTest("sqlite-vec") as { getLoadablePath: () => unknown };
  const loadablePath = sqliteVec.getLoadablePath();
  if (typeof loadablePath !== "string" || !loadablePath.trim()) {
    throw new Error("sqlite-vec did not provide a loadable extension path");
  }
  return loadablePath;
}
