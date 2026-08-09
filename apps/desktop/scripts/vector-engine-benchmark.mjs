#!/usr/bin/env node
/**
 * Isolated synthetic-vector benchmark for local engine selection. It never
 * opens AuraScholar's userData directory or reads ContentUnits. Install test
 * engines in a separate node_modules directory, then pass it with
 * --node-modules or AURA_VECTOR_BENCH_NODE_MODULES.
 *
 * Examples:
 *   node scripts/vector-engine-benchmark.mjs --engine sqlite-vec --count 50000 --dimensions 384
 *   node scripts/vector-engine-benchmark.mjs --engine lancedb --node-modules /tmp/vector-bench/node_modules
 */
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const LIBRARY_ID = "library:benchmark";
const INDEX_ID = "index:benchmark-v1";

if (isMainModule()) {
  runVectorEngineBenchmark()
    .then(printResult)
    .catch((error) => {
      console.error(error instanceof Error ? (error.stack ?? error.message) : error);
      process.exitCode = 1;
    });
}

export async function runVectorEngineBenchmark(argumentsList = process.argv.slice(2)) {
  const config = parseConfig(argumentsList);
  const packageRequire = createRequire(join(dirname(config.nodeModules), "vector-benchmark.cjs"));
  const directory = mkdtempSync(join(tmpdir(), `aurascholar-${config.engine}-`));

  try {
    const result =
      config.engine === "sqlite-vec"
        ? runSqliteVecBenchmark(config, directory, packageRequire)
        : await runLanceDbBenchmark(config, directory, packageRequire);
    return {
      ...result,
      allowedSourceCount: config.allowedSourceCount,
      benchmarkVersion: 2,
      dimensions: config.dimensions,
      engine: config.engine,
      filterSelectivity: round(queryableVectorCount(config) / config.count),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      queries: config.queries,
      sourceCount: config.sourceCount,
      queryableVectors: queryableVectorCount(config),
      vectors: config.count,
      warmupQueries: config.warmupQueries,
    };
  } finally {
    if (!config.keep) rmSync(directory, { force: true, recursive: true });
    else console.error(`Kept benchmark data at ${directory}`);
  }
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

function runSqliteVecBenchmark(benchmark, dataDirectory, packageRequire) {
  const sqliteVec = packageRequire("sqlite-vec");
  const databasePath = join(dataDirectory, "vector-benchmark.sqlite");
  const database = new DatabaseSync(databasePath, { allowExtension: true });
  try {
    database.exec("PRAGMA journal_mode = DELETE");
    sqliteVec.load(database);
    database.enableLoadExtension(false);
    const version = database.prepare("SELECT vec_version() AS version").get().version;
    database.exec(`
      CREATE VIRTUAL TABLE vector_entries USING vec0(
        embedding float[${benchmark.dimensions}] distance_metric=cosine,
        library_id TEXT PARTITION KEY,
        index_id TEXT,
        source_id TEXT
      )
    `);
    const insert = database.prepare(
      "INSERT INTO vector_entries(rowid, embedding, library_id, index_id, source_id) VALUES (?, ?, ?, ?, ?)",
    );
    const buildStartedAt = performance.now();
    let peakRss = rssBytes();
    database.exec("BEGIN IMMEDIATE");
    try {
      for (let id = 1; id <= benchmark.count; id += 1) {
        insert.run(
          BigInt(id),
          vectorBytes(vectorForId(id, benchmark.dimensions)),
          LIBRARY_ID,
          INDEX_ID,
          sourceIdForId(id, benchmark.sourceCount),
        );
        if (id % 1_000 === 0) peakRss = Math.max(peakRss, rssBytes());
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    const buildMs = performance.now() - buildStartedAt;
    const query = database.prepare(
      `SELECT rowid, distance
       FROM vector_entries
       WHERE embedding MATCH ? AND k = ? AND library_id = ? AND index_id = ?
         AND source_id IN (${sourcePlaceholders(benchmark.allowedSourceCount)})`,
    );
    const measurements = measureSyncQueries(query, benchmark);
    database.exec("VACUUM");
    return {
      databaseBytes: sumFileBytes(dataDirectory),
      extensionBytes: statSync(sqliteVec.getLoadablePath()).size,
      insertBuildMs: round(buildMs),
      ...measurements,
      peakRssBytes: Math.max(peakRss, measurements.peakRssBytes, rssBytes()),
      sqliteVecVersion: version,
    };
  } finally {
    database.close();
  }
}

async function runLanceDbBenchmark(benchmark, dataDirectory, packageRequire) {
  const lancedb = packageRequire("@lancedb/lancedb");
  const database = await lancedb.connect(dataDirectory);
  try {
    const buildStartedAt = performance.now();
    const table = await database.createTable("vector_entries", [lanceEntryForId(1, benchmark)]);
    for (let startId = 2; startId <= benchmark.count; startId += 1_000) {
      const entries = [];
      const endId = Math.min(benchmark.count, startId + 999);
      for (let id = startId; id <= endId; id += 1) {
        entries.push(lanceEntryForId(id, benchmark));
      }
      await table.add(entries);
    }
    const insertBuildMs = performance.now() - buildStartedAt;
    const exact = await measureLanceQueries(table, benchmark, true);
    const databaseBytesBeforeIndex = sumFileBytes(dataDirectory);

    const indexStartedAt = performance.now();
    await table.createIndex("vector", {
      config: lancedb.Index.hnswSq({
        distanceType: "cosine",
        efConstruction: 100,
        m: 20,
        numPartitions: 1,
      }),
      waitTimeoutSeconds: 300,
    });
    const indexBuildMs = performance.now() - indexStartedAt;
    const indexed = await measureLanceQueries(table, benchmark, false);
    return {
      databaseBytesAfterIndex: sumFileBytes(dataDirectory),
      databaseBytesBeforeIndex,
      exact,
      index: "hnsw-sq",
      indexBuildMs: round(indexBuildMs),
      indexed,
      peakRssBytes: Math.max(exact.peakRssBytes, indexed.peakRssBytes, rssBytes()),
      insertBuildMs: round(insertBuildMs),
    };
  } finally {
    await database.close();
  }
}

async function measureLanceQueries(table, benchmark, bypassVectorIndex) {
  const queryIdsForRun = queryIds(benchmark);
  const sourceFilter = sourceFilterForLance(benchmark);
  const run = async (id) => {
    const query = table
      .vectorSearch(vectorForId(id, benchmark.dimensions))
      .distanceType("cosine")
      .where(`library_id = '${LIBRARY_ID}' AND index_id = '${INDEX_ID}' AND ${sourceFilter}`)
      .select(["id", "_distance"])
      .limit(10);
    if (bypassVectorIndex) query.bypassVectorIndex();
    else query.fastSearch().ef(100);
    const startedAt = performance.now();
    const rows = await query.toArray();
    return { elapsedMs: performance.now() - startedAt, rows };
  };
  const first = await run(queryIdsForRun[0]);
  assertSelfMatch(first.rows, queryIdsForRun[0]);
  const peakBeforeQueries = rssBytes();
  for (const id of queryIds(benchmark, benchmark.warmupQueries, 1)) {
    const result = await run(id);
    assertSelfMatch(result.rows, id);
  }
  const measurements = [];
  let selfMatches = 0;
  for (const id of queryIdsForRun) {
    const result = await run(id);
    measurements.push(result.elapsedMs);
    if (result.rows.some((row) => Number(row.id) === id)) selfMatches += 1;
  }
  return {
    peakRssBytes: Math.max(peakBeforeQueries, rssBytes()),
    queryFirstMs: round(first.elapsedMs),
    queryMedianMs: percentile(measurements, 0.5),
    queryP95Ms: percentile(measurements, 0.95),
    queryP99Ms: percentile(measurements, 0.99),
    querySamples: measurements.length,
    queryWarmupCount: benchmark.warmupQueries,
    selfRecallAt10: selfMatches / benchmark.queries,
  };
}

function lanceEntryForId(id, benchmark) {
  return {
    id,
    index_id: INDEX_ID,
    library_id: LIBRARY_ID,
    source_id: sourceIdForId(id, benchmark.sourceCount),
    vector: Array.from(vectorForId(id, benchmark.dimensions)),
  };
}

function vectorForId(id, dimensions) {
  const vector = new Float32Array(dimensions);
  let state = (id * 2_654_435_761) >>> 0;
  let magnitudeSquared = 0;
  for (let index = 0; index < vector.length; index += 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const value = state / 0x8000_0000 - 1;
    vector[index] = value;
    magnitudeSquared += value * value;
  }
  const inverseMagnitude = 1 / Math.sqrt(magnitudeSquared);
  for (let index = 0; index < vector.length; index += 1) vector[index] *= inverseMagnitude;
  return vector;
}

function vectorBytes(vector) {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

function queryIds(benchmark, queryCount = benchmark.queries, ordinalOffset = 0) {
  const eligible = queryableVectorIds(benchmark);
  if (eligible.length === 0) throw new Error("Benchmark source filter leaves no queryable vectors");
  return Array.from(
    { length: queryCount },
    (_value, ordinal) => eligible[((ordinal + ordinalOffset) * 1_541) % eligible.length],
  );
}

function queryableVectorIds(benchmark) {
  const eligible = [];
  for (let id = 1; id <= benchmark.count; id += 1) {
    const sourceOrdinal = id % benchmark.sourceCount;
    if (sourceOrdinal < benchmark.allowedSourceCount) eligible.push(id);
  }
  return eligible;
}

function queryableVectorCount(benchmark) {
  return queryableVectorIds(benchmark).length;
}

function assertSelfMatch(rows, id) {
  if (!rows.some((row) => Number(row.rowid ?? row.id) === id)) {
    throw new Error(`Expected exact self-match for row ${id}`);
  }
}

function measureSyncQueries(query, benchmark) {
  const queryIdsForRun = queryIds(benchmark);
  const run = (id) => {
    const startedAt = performance.now();
    const rows = query.all(
      vectorBytes(vectorForId(id, benchmark.dimensions)),
      10,
      LIBRARY_ID,
      INDEX_ID,
      ...sourceIds(benchmark),
    );
    return { elapsedMs: performance.now() - startedAt, rows };
  };
  const first = run(queryIdsForRun[0]);
  assertSelfMatch(first.rows, queryIdsForRun[0]);
  let peak = rssBytes();
  for (const id of queryIds(benchmark, benchmark.warmupQueries, 1)) {
    const result = run(id);
    assertSelfMatch(result.rows, id);
    peak = Math.max(peak, rssBytes());
  }
  const measurements = [];
  let selfMatches = 0;
  for (const id of queryIdsForRun) {
    const result = run(id);
    measurements.push(result.elapsedMs);
    if (result.rows.some((row) => Number(row.rowid) === id)) selfMatches += 1;
    peak = Math.max(peak, rssBytes());
  }
  return {
    peakRssBytes: peak,
    queryFirstMs: round(first.elapsedMs),
    queryMedianMs: percentile(measurements, 0.5),
    queryP95Ms: percentile(measurements, 0.95),
    queryP99Ms: percentile(measurements, 0.99),
    querySamples: measurements.length,
    queryWarmupCount: benchmark.warmupQueries,
    selfRecallAt10: selfMatches / benchmark.queries,
  };
}

function sourceIds(benchmark) {
  return Array.from(
    { length: benchmark.allowedSourceCount },
    (_value, ordinal) => `source:${ordinal}`,
  );
}

function sourceIdForId(id, sourceCount) {
  return `source:${id % sourceCount}`;
}

function sourcePlaceholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function sourceFilterForLance(benchmark) {
  return `source_id IN (${sourceIds(benchmark)
    .map((sourceId) => `'${sourceId}'`)
    .join(", ")})`;
}

function sumFileBytes(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const path = join(directory, entry.name);
    return total + (entry.isDirectory() ? sumFileBytes(path) : statSync(path).size);
  }, 0);
}

function percentile(values, percentileValue) {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.ceil(ordered.length * percentileValue) - 1);
  return round(ordered[index]);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

export function parseConfig(argumentsList) {
  const options = new Map();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--") continue;
    if (!argument.startsWith("--")) throw new Error(`Unsupported argument: ${argument}`);
    const [name, inlineValue] = argument.slice(2).split("=", 2);
    if (name === "keep") {
      options.set(name, "true");
      continue;
    }
    const value = inlineValue ?? argumentsList[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
    options.set(name, value);
  }
  const engine = options.get("engine") ?? "sqlite-vec";
  if (engine !== "sqlite-vec" && engine !== "lancedb") {
    throw new Error("--engine must be sqlite-vec or lancedb");
  }
  const count = parsePositiveInteger(options.get("count"), 50_000);
  const sourceCount = parsePositiveInteger(options.get("source-count"), 1);
  if (sourceCount > count) {
    throw new Error(`Source count cannot exceed vector count (${count})`);
  }
  const allowedSourceCount = parsePositiveInteger(options.get("allowed-source-count"), sourceCount);
  if (allowedSourceCount > sourceCount) {
    throw new Error(`Allowed source count cannot exceed source count (${sourceCount})`);
  }
  return {
    allowedSourceCount,
    count,
    dimensions: parsePositiveInteger(options.get("dimensions"), 384),
    engine,
    keep: options.get("keep") === "true",
    nodeModules: resolve(
      options.get("node-modules") ??
        process.env.AURA_VECTOR_BENCH_NODE_MODULES ??
        join(process.cwd(), "node_modules"),
    ),
    queries: parsePositiveInteger(options.get("queries"), 30),
    sourceCount,
    warmupQueries: parseNonNegativeInteger(options.get("warmup"), 10),
  };
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received ${JSON.stringify(value)}`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received ${JSON.stringify(value)}`);
  }
  return parsed;
}

function rssBytes() {
  return process.memoryUsage().rss;
}

function isMainModule() {
  return (
    process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}
