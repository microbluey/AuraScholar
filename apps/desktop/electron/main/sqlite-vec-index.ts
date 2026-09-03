import {
  contentUnitCanonicalVisibilitySql,
  EmbeddingProfilesRepo,
  KnowledgeIndexesRepo,
  type EmbeddingProfileRow,
  type KnowledgeIndexEntryRow,
  type KnowledgeIndexRow,
  type Database,
} from "@aurascholar/db";
import {
  assertEmbeddingVector,
  type CorpusScopeSnapshot,
  type VectorSearchHit,
  type VectorSearchInput,
  type VectorStore,
} from "@aurascholar/knowledge";
import type { LibraryScopeToken } from "../library-read-command-contract";
import {
  assertKnowledgeIndexSnapshot,
  assertLibraryScope,
  normalizeSourceChangeSeq,
} from "./local-semantic-index-snapshot";

const MAX_SOURCE_IDS_PER_KNN_QUERY = 250;
const MAX_VECTOR_WRITE_BATCH_SIZE = 1_000;

export type SqliteVecDatabaseOperation<T> = (database: Database) => Promise<T> | T;

/**
 * Main-process DB boundary. Production injects the coordinator so each native
 * vec0 write and its relational vector_ref update share one SQLite transaction.
 */
export interface SqliteVecIndexStoreDependencies {
  inspect<T>(operation: SqliteVecDatabaseOperation<T>): Promise<T>;
  transaction<T>(commandName: string, operation: SqliteVecDatabaseOperation<T>): Promise<T>;
}

export interface PersistSqliteVecEntriesInput {
  libraryId: string;
  indexId: string;
  sourceChangeSeq: number;
  expectedScope?: LibraryScopeToken;
  entries: readonly {
    contentUnitId: string;
    vector: Float32Array;
  }[];
  now?: number;
}

export interface GarbageCollectSqliteVecIndexInput {
  libraryId: string;
  indexId: string;
  expectedScope?: LibraryScopeToken;
  now?: number;
}

interface NativeVectorRow {
  vector_ref: string | number | bigint;
  content_unit_id: string;
  source_id: string;
  distance: number;
}

interface VectorMappingRow {
  vector_ref: string;
  entry_content_unit_id: string;
  entry_status: string;
  entry_content_hash: string;
  unit_id: string | null;
  unit_library_id: string | null;
  unit_source_id: string | null;
  unit_content_hash: string | null;
  unit_state: string | null;
  unit_deleted_at: number | bigint | null;
}

interface SqliteVecIndexContext {
  index: KnowledgeIndexRow;
  profile: EmbeddingProfileRow;
  tableName: string;
}

/**
 * sqlite-vec-backed implementation of the platform-neutral VectorStore.
 * Every KNN query includes its Library, generation, and source scope in the
 * vec0 WHERE clause; relational validation then suppresses stale rows caused
 * by asynchronous physical cleanup after a source is retired.
 */
export class SqliteVecIndexStore implements VectorStore {
  constructor(private readonly dependencies: SqliteVecIndexStoreDependencies) {}

  /**
   * Stores a batch of vectors and updates their generation entries atomically.
   * A failed reference update rolls back the vec0 insert and vice versa.
   */
  async persist(input: PersistSqliteVecEntriesInput): Promise<readonly KnowledgeIndexEntryRow[]> {
    const libraryId = normalizeId(input.libraryId, "Vector write Library id");
    const indexId = normalizeId(input.indexId, "Vector write index id");
    const sourceChangeSeq = normalizeSourceChangeSeq(input.sourceChangeSeq);
    const entries = normalizeEntries(input.entries);
    if (entries.length === 0) return [];
    const now = normalizeNow(input.now);

    return this.dependencies.transaction("knowledge.vector.persist", async (database) => {
      await assertLibraryScope(database, libraryId, input.expectedScope);
      const context = await loadIndexContext(database, libraryId, indexId, ["building"]);
      await assertKnowledgeIndexSnapshot(
        database,
        libraryId,
        context.index.sourceChangeSeq,
        sourceChangeSeq,
      );
      for (const entry of entries) {
        assertEmbeddingVector(entry.vector, context.profile.dimension, "Knowledge index vector");
      }
      await ensureSqliteVecTable(database, context.tableName, context.profile.dimension);

      const indexes = new KnowledgeIndexesRepo(database, libraryId);
      const persisted: KnowledgeIndexEntryRow[] = [];
      for (const entry of entries) {
        const pending = await indexes.getPendingVectorEntry(indexId, entry.contentUnitId);
        if (!pending) {
          throw new Error("Knowledge vector entry is missing, stale, or already materialized");
        }
        await database.run(
          `INSERT INTO ${context.tableName}
             (embedding, library_id, index_id, source_id, content_unit_id)
           VALUES (?, ?, ?, ?, ?)`,
          [toSqliteBlob(entry.vector), libraryId, indexId, pending.sourceId, entry.contentUnitId],
        );
        const vectorRef = toVectorRef(await database.queryScalar("SELECT last_insert_rowid()"));
        persisted.push(
          await indexes.markVectorReady(indexId, {
            contentUnitId: entry.contentUnitId,
            vectorRef,
            now,
          }),
        );
      }
      return persisted;
    });
  }

  /**
   * Searches only an active hybrid generation. The source allowlist is chunked
   * solely to stay under SQLite bind limits; each chunk is filtered inside the
   * KNN operation before its candidates are merged.
   */
  async search(input: VectorSearchInput): Promise<readonly VectorSearchHit[]> {
    const libraryId = normalizeId(input.libraryId, "Vector search Library id");
    const indexId = normalizeId(input.indexId, "Vector search index id");
    const limit = normalizeLimit(input.limit);
    assertEmbeddingVector(input.vector, undefined, "Vector search query");
    throwIfAborted(input.signal);

    const allowedSourceIds = normalizeSourceIds(input.allowedSourceIds);
    assertCorpusScope(input.corpusScope, libraryId, allowedSourceIds);
    if (allowedSourceIds.length === 0) return [];

    return this.dependencies.inspect(async (database) => {
      const context = await loadIndexContext(database, libraryId, indexId, ["active"]);
      assertEmbeddingVector(input.vector, context.profile.dimension, "Vector search query");
      await assertSqliteVecTable(database, context.tableName, context.profile.dimension);

      const rawRows: NativeVectorRow[] = [];
      for (const sourceIds of chunk(allowedSourceIds, MAX_SOURCE_IDS_PER_KNN_QUERY)) {
        throwIfAborted(input.signal);
        const placeholders = sourceIds.map(() => "?").join(", ");
        const rows = await database.query<NativeVectorRow>(
          `SELECT CAST(rowid AS TEXT) AS vector_ref, content_unit_id, source_id, distance
           FROM ${context.tableName}
           WHERE embedding MATCH ?
             AND k = ?
             AND library_id = ?
             AND index_id = ?
             AND source_id IN (${placeholders})`,
          [toSqliteBlob(input.vector), limit, libraryId, indexId, ...sourceIds],
        );
        rawRows.push(...rows);
      }
      throwIfAborted(input.signal);
      const mappings = await loadVectorMappings(
        database,
        libraryId,
        indexId,
        rawRows.map((row) => toVectorRef(row.vector_ref)),
      );
      const allowed = new Set(allowedSourceIds);
      const seenContentUnits = new Set<string>();
      const hits: VectorSearchHit[] = [];

      for (const row of rawRows) {
        throwIfAborted(input.signal);
        const vectorRef = toVectorRef(row.vector_ref);
        const mapping = mappings.get(vectorRef);
        // A hard-deleted ContentUnit cascades its relational entry before the
        // derived vec0 row can be collected. Treat the orphan as stale, never
        // as a result that could escape the current canonical corpus.
        if (!mapping || mapping.entry_status !== "ready") continue;
        assertPhysicalMapping(row, mapping, libraryId, allowed);
        if (!isLiveMatchingUnit(mapping)) continue;
        if (seenContentUnits.has(row.content_unit_id)) {
          throw new Error("sqlite-vec returned a duplicate ContentUnit for one generation");
        }
        seenContentUnits.add(row.content_unit_id);
        if (!Number.isFinite(row.distance)) {
          throw new Error("sqlite-vec returned a non-finite vector distance");
        }
        hits.push({
          contentUnitId: row.content_unit_id,
          sourceId: row.source_id,
          distance: row.distance,
        });
      }
      return hits
        .sort((left, right) => {
          if (left.distance !== right.distance) return left.distance - right.distance;
          return compareText(left.contentUnitId, right.contentUnitId);
        })
        .slice(0, limit);
    });
  }

  async discardPhysicalRows(input: {
    libraryId: string;
    indexId: string;
    expectedScope?: LibraryScopeToken;
  }): Promise<number> {
    const libraryId = normalizeId(input.libraryId, "Vector cleanup Library id");
    const indexId = normalizeId(input.indexId, "Vector cleanup index id");
    return this.dependencies.transaction("knowledge.vector.discard", async (database) => {
      await assertLibraryScope(database, libraryId, input.expectedScope);
      const context = await loadIndexContext(database, libraryId, indexId, ["failed", "retired"]);
      if (!(await sqliteVecTableExists(database, context.tableName))) return 0;
      await assertSqliteVecTable(database, context.tableName, context.profile.dimension);
      return database.run(
        `DELETE FROM ${context.tableName} WHERE library_id = ? AND index_id = ?`,
        [libraryId, indexId],
      );
    });
  }

  async garbageCollect(input: GarbageCollectSqliteVecIndexInput): Promise<boolean> {
    const libraryId = normalizeId(input.libraryId, "Vector cleanup Library id");
    const indexId = normalizeId(input.indexId, "Vector cleanup index id");
    const now = normalizeNow(input.now);
    return this.dependencies.transaction("knowledge.vector.garbageCollect", async (database) => {
      await assertLibraryScope(database, libraryId, input.expectedScope);
      const context = await loadIndexContext(database, libraryId, indexId, ["retired", "failed"]);
      if (await sqliteVecTableExists(database, context.tableName)) {
        await assertSqliteVecTable(database, context.tableName, context.profile.dimension);
        await database.run(
          `DELETE FROM ${context.tableName} WHERE library_id = ? AND index_id = ?`,
          [libraryId, indexId],
        );
      }
      return new KnowledgeIndexesRepo(database, libraryId).markGarbageCollected(indexId, { now });
    });
  }
}

/** Dimension-derived, injection-safe namespace shared by compatible profiles. */
export function sqliteVecTableName(dimension: number): string {
  if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 8_192) {
    throw new Error("sqlite-vec dimension must be an integer between 1 and 8192");
  }
  return `knowledge_vectors_d${dimension}`;
}

async function loadIndexContext(
  database: Database,
  libraryId: string,
  indexId: string,
  allowedStatuses: readonly string[],
): Promise<SqliteVecIndexContext> {
  const indexes = new KnowledgeIndexesRepo(database, libraryId);
  const index = await indexes.get(indexId);
  if (!index || !allowedStatuses.includes(index.status)) {
    throw new Error("Knowledge vector generation is missing, inactive, or outside this Library");
  }
  if (index.mode !== "hybrid" || !index.embeddingProfileId) {
    throw new Error("Knowledge vector generation is not a hybrid index");
  }
  const profile = await new EmbeddingProfilesRepo(database).get(index.embeddingProfileId);
  if (!profile) throw new Error("Knowledge vector embedding profile is unavailable");
  if (profile.distanceMetric !== "cosine") {
    throw new Error("The sqlite-vec adapter currently requires cosine distance");
  }
  return { index, profile, tableName: sqliteVecTableName(profile.dimension) };
}

async function ensureSqliteVecTable(
  database: Database,
  tableName: string,
  dimension: number,
): Promise<void> {
  await database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(
      embedding float[${dimension}] distance_metric=cosine,
      library_id TEXT PARTITION KEY,
      index_id TEXT,
      source_id TEXT,
      content_unit_id TEXT
    )
  `);
  await assertSqliteVecTable(database, tableName, dimension);
}

async function assertSqliteVecTable(
  database: Database,
  tableName: string,
  dimension: number,
): Promise<void> {
  const rows = await database.query<{ sql: string | null }>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    [tableName],
  );
  const sql = rows[0]?.sql?.toLowerCase().replace(/\s+/g, " ");
  const expectedEmbedding = `embedding float[${dimension}]`;
  if (
    !sql ||
    !sql.includes("using vec0") ||
    !sql.includes(expectedEmbedding) ||
    !sql.includes("library_id text partition key") ||
    !sql.includes("index_id text") ||
    !sql.includes("source_id text") ||
    !sql.includes("content_unit_id text")
  ) {
    throw new Error("sqlite-vec namespace has an incompatible schema");
  }
}

async function sqliteVecTableExists(database: Database, tableName: string): Promise<boolean> {
  const rows = await database.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    [tableName],
  );
  return rows.length > 0;
}

async function loadVectorMappings(
  database: Database,
  libraryId: string,
  indexId: string,
  vectorRefs: readonly string[],
): Promise<ReadonlyMap<string, VectorMappingRow>> {
  const mappings = new Map<string, VectorMappingRow>();
  for (const refs of chunk([...new Set(vectorRefs)], MAX_VECTOR_WRITE_BATCH_SIZE)) {
    if (refs.length === 0) continue;
    const placeholders = refs.map(() => "?").join(", ");
    const rows = await database.query<VectorMappingRow>(
      `SELECT entry.vector_ref,
              entry.content_unit_id AS entry_content_unit_id,
              entry.status AS entry_status,
              entry.content_hash AS entry_content_hash,
              unit.id AS unit_id,
              unit.library_id AS unit_library_id,
              unit.source_id AS unit_source_id,
              unit.content_hash AS unit_content_hash,
              unit.state AS unit_state,
              unit.deleted_at AS unit_deleted_at
       FROM knowledge_index_entries entry
       JOIN knowledge_indexes index_generation
         ON index_generation.id = entry.index_id
        AND index_generation.library_id = ?
       JOIN content_units unit ON unit.id = entry.content_unit_id
       WHERE entry.index_id = ?
         AND entry.vector_ref IN (${placeholders})
         AND ${contentUnitCanonicalVisibilitySql()}`,
      [libraryId, indexId, ...refs],
    );
    for (const row of rows) {
      if (mappings.has(row.vector_ref)) {
        throw new Error("Knowledge vector references are not unique inside one generation");
      }
      mappings.set(row.vector_ref, row);
    }
  }
  return mappings;
}

function assertPhysicalMapping(
  row: NativeVectorRow,
  mapping: VectorMappingRow,
  libraryId: string,
  allowedSourceIds: ReadonlySet<string>,
): void {
  if (mapping.entry_content_unit_id !== row.content_unit_id) {
    throw new Error("sqlite-vec ContentUnit does not match its durable generation entry");
  }
  if (mapping.unit_id !== row.content_unit_id || mapping.unit_library_id !== libraryId) {
    throw new Error("sqlite-vec ContentUnit is outside the requested Library");
  }
  if (mapping.unit_source_id !== row.source_id || !allowedSourceIds.has(row.source_id)) {
    throw new Error("sqlite-vec returned a source outside the requested scope");
  }
}

function isLiveMatchingUnit(mapping: VectorMappingRow): boolean {
  return (
    mapping.unit_deleted_at === null &&
    mapping.unit_state === "ready" &&
    mapping.unit_content_hash === mapping.entry_content_hash
  );
}

function normalizeEntries(
  entries: PersistSqliteVecEntriesInput["entries"],
): readonly { contentUnitId: string; vector: Float32Array }[] {
  if (!Array.isArray(entries)) throw new Error("Knowledge vector entries must be an array");
  if (entries.length > MAX_VECTOR_WRITE_BATCH_SIZE) {
    throw new Error(
      `Knowledge vector write batch must contain at most ${MAX_VECTOR_WRITE_BATCH_SIZE} entries`,
    );
  }
  const seen = new Set<string>();
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Knowledge vector entry must be an object");
    }
    const contentUnitId = normalizeId(entry.contentUnitId, "Knowledge vector ContentUnit id");
    if (seen.has(contentUnitId)) {
      throw new Error("Knowledge vector write batch contains a duplicate ContentUnit id");
    }
    seen.add(contentUnitId);
    return { contentUnitId, vector: entry.vector };
  });
}

function normalizeSourceIds(sourceIds: readonly string[]): string[] {
  if (!Array.isArray(sourceIds)) throw new Error("Allowed vector source ids must be an array");
  const normalized = [
    ...new Set(sourceIds.map((sourceId) => normalizeId(sourceId, "Allowed vector source id"))),
  ];
  return normalized;
}

function assertCorpusScope(
  scope: CorpusScopeSnapshot | undefined,
  libraryId: string,
  allowedSourceIds: readonly string[],
): void {
  if (!scope) return;
  if (scope.libraryId !== libraryId) {
    throw new Error("Corpus scope belongs to a different Library");
  }
  const snapshotSources = new Set(scope.allowedSourceIds);
  if (allowedSourceIds.some((sourceId) => !snapshotSources.has(sourceId))) {
    throw new Error("Vector source is outside the captured corpus scope");
  }
}

function normalizeId(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty`);
  return value.trim();
}

function normalizeLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Vector search limit must be an integer between 1 and 1000");
  }
  return limit;
}

function normalizeNow(value: number | undefined): number {
  const now = value ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0)
    throw new Error("Timestamp must be a non-negative integer");
  return now;
}

function toSqliteBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength).slice();
}

function toVectorRef(value: string | number | bigint | unknown): string {
  const ref = String(value);
  if (!/^[1-9]\d*$/.test(ref))
    throw new Error("sqlite-vec did not return a positive integer rowid");
  return ref;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    chunks.push(values.slice(index, index + size));
  return chunks;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
