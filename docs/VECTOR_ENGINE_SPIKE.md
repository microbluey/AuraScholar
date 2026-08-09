# Local vector-engine spike

> Status: provisional engine-selection evidence, not a release acceptance
>
> Date: 2026-08-05
>
> Environment: macOS 26.4.1 arm64, Node 25.9.0

## Decision

Use [`sqlite-vec`](https://alexgarcia.xyz/sqlite-vec/) as AuraScholar's first
embedded `VectorStore` adapter candidate for a modest local corpus. It keeps the
derived index in AuraScholar's existing SQLite file, supports query-time
Library/index filtering, and adds a roughly 0.15 MiB native extension in the
tested macOS arm64 install.

This decision is deliberately bounded:

- Enable it only for an active generation with at most **50k ready
  ContentUnits** until the real-corpus and supported-platform checks below pass.
- Keep FTS as a working fallback. A missing, incompatible, or unloadable native
  extension makes semantic indexing unavailable; it never prevents Library
  startup or full-text search.
- Reopen the engine decision before enabling a corpus above 50k units, if the
  measured vector-query P95 approaches 120 ms on the reference machine, or when
  filtering/index lifecycle needs ANN behavior.
- Keep LanceDB as the escalation candidate. Its HNSW index was faster in this
  synthetic test, but its macOS arm64 native binary alone was about 120 MiB and
  its persisted data is a sidecar directory rather than the existing SQLite
  file.
- Do not use Chroma as the first embedded TypeScript desktop backend. Its
  TypeScript client communicates with a Chroma server over HTTP, which would add
  a process lifecycle and local-server boundary to the desktop application.

`sqlite-vec` currently performs brute-force KNN scans rather than ANN, and its
Node binding is pre-v1. Those are reasons for the threshold and the release
checks, not reasons to make vectors unavailable for a small local corpus.

## What was measured

The reproducible harness is
[`apps/desktop/scripts/vector-engine-benchmark.mjs`](../apps/desktop/scripts/vector-engine-benchmark.mjs).
It creates an empty temporary directory, uses deterministic normalized
`Float32` vectors, applies one `library_id` plus `index_id` filter, executes 30
warm cosine top-10 queries, and removes its temporary data unless `--keep` is
passed. It never opens AuraScholar's user-data directory or reads ContentUnits.

The measurements test storage and engine mechanics only. Synthetic self-match
Recall@10 is **not** semantic retrieval quality and cannot select an embedding
model. The table below is the original v1 storage comparison (30 measured
queries). The current v2 runner preserves those fields and additionally emits
the first-query latency, warm P50/P95/P99, sample and warm-up counts, process
RSS peak, source-filter selectivity, and a schema version so later runs are not
compared ambiguously with this initial snapshot.

| Engine                  | Vector shape | Entries |    Build / insert | Persisted data |  Query P50 / P95 | Index result         |
| ----------------------- | -----------: | ------: | ----------------: | -------------: | ---------------: | -------------------- |
| sqlite-vec exact cosine |          384 |     10k |         167.14 ms |       15.8 MiB |  9.91 / 11.27 ms | n/a                  |
| sqlite-vec exact cosine |          384 |     50k |         801.66 ms |       77.4 MiB | 51.52 / 52.51 ms | n/a                  |
| sqlite-vec exact cosine |          768 |     10k |         701.75 ms |       30.8 MiB | 16.25 / 17.12 ms | n/a                  |
| sqlite-vec exact cosine |          768 |     50k |        3272.72 ms |      151.0 MiB | 81.82 / 86.39 ms | n/a                  |
| LanceDB exact cosine    |          384 |     50k |        1188.34 ms |       73.8 MiB |  9.87 / 12.28 ms | n/a                  |
| LanceDB HNSW-SQ cosine  |          384 |     50k | +3447.33 ms index |      104.3 MiB |   5.53 / 5.99 ms | self Recall@10 = 1.0 |
| LanceDB exact cosine    |          768 |     50k |        2148.09 ms |      147.0 MiB | 16.72 / 36.74 ms | n/a                  |
| LanceDB HNSW-SQ cosine  |          768 |     50k | +6719.92 ms index |      196.0 MiB |  6.11 / 10.50 ms | self Recall@10 = 1.0 |

The `sqlite-vec` macOS arm64 extension measured 161,704 bytes. The LanceDB
macOS arm64 native module measured 125,718,864 bytes before the surrounding
package and index data are considered.

## Desktop integration boundary

The desktop main process now treats the extension as an optional capability:

- [`packages/db/src/database.ts`](../packages/db/src/database.ts) exposes an
  optional extension-loading hook only for Node-backed drivers.
- [`apps/desktop/electron/main/sqlite-vec-runtime.ts`](../apps/desktop/electron/main/sqlite-vec-runtime.ts)
  loads and verifies `vec_version()` in the trusted main process, reports only a
  safe availability state, and maps an Electron `app.asar` path to the unpacked
  native file.
- [`apps/desktop/package.json`](../apps/desktop/package.json) pins
  `sqlite-vec` to `0.1.7-alpha.10` and unpacks the platform extension from ASAR.

No `vec0` table or user embedding is created at application startup or during a
portable schema migration. The first part of the lifecycle is SQLite schema v22:
it stores embedding-profile fingerprints, generation snapshots, and vector
references, while a ContentUnit retirement automatically retires its old
generation entry.

The trusted desktop `SqliteVecIndexStore` now owns the next, native-only step.
An explicit vector-write transaction lazily creates a dimension-specific `vec0`
table, stores the Library, generation, source, and ContentUnit identifiers with
each vector, and atomically records its durable `vector_ref`. Its KNN query
filters the Library, generation, and allowed source IDs inside sqlite-vec before
candidate selection; relational validation then suppresses rows whose canonical
ContentUnit was retired. Retired or failed generations can delete their physical
rows before their metadata is garbage-collected. No embedding provider,
background materialization job, or user-facing semantic-search switch invokes
this adapter yet.

The provisional local model/runtime boundary is tracked separately in [the
local embedding runtime spike](./LOCAL_EMBEDDING_RUNTIME_SPIKE.md). It keeps
model installation explicit and prevents structural ContentUnits from being
silently truncated to a model context window.

## Reproduce

After the normal workspace install, run the first-adapter check from the
repository root:

```sh
pnpm --filter @aurascholar/desktop benchmark:vector -- --engine sqlite-vec --count 50000 --dimensions 384 --queries 30
```

For the performance baseline, use a fixed, production-shaped source filter
and enough warm samples to make the tail percentiles meaningful. `source-count`
splits the synthetic corpus into deterministic source IDs, while
`allowed-source-count` applies the same `source_id IN (...)` predicate used by
the production adapter.

```sh
pnpm --filter @aurascholar/desktop benchmark:vector -- --engine sqlite-vec --count 50000 --dimensions 384 --queries 1000 --warmup 50 --source-count 100 --allowed-source-count 10
```

The runner accepts both direct npm arguments and the `--` separator used by
pnpm. It writes JSON only and removes its temporary database unless `--keep`
is supplied; `peakRssBytes` is the whole Node process, so it is a repeatable
regression signal rather than a claim about the vector extension alone.

Current v2 reference run on the documented machine (Node 25.9.0, macOS arm64,
sqlite-vec 0.1.7-alpha.10) with 50k vectors, 384 dimensions, 100 source IDs,
10% source selectivity, 50 warm-ups, and 1,000 measured queries:

| Insert build | Persisted data | First query |     Warm P50 / P95 / P99 | Peak RSS | Self Recall@10 |
| -----------: | -------------: | ----------: | -----------------------: | -------: | -------------: |
|  1,040.87 ms |       78.2 MiB |   106.07 ms | 39.86 / 46.62 / 60.40 ms | 74.3 MiB |            1.0 |

This is an engine/storage baseline, not a semantic-quality score. The warm
P95 is below the provisional 120 ms vector-query re-evaluation threshold in
this environment; the first query is reported separately because it includes
the initial vector-engine/cache path.

LanceDB remains a comparison-only dependency. Install it in a separate temporary
directory and pass its module directory to avoid changing product dependencies:

```sh
npm install --prefix /tmp/aurascholar-vector-bench --ignore-scripts --no-audit --no-fund sqlite-vec@0.1.7-alpha.10 @lancedb/lancedb@0.33.0
AURA_VECTOR_BENCH_NODE_MODULES=/tmp/aurascholar-vector-bench/node_modules node apps/desktop/scripts/vector-engine-benchmark.mjs --engine lancedb --count 50000 --dimensions 384 --queries 30
```

## Required before release acceptance

1. Build and smoke-test the unpacked extension in macOS arm64/x64, Windows, and
   Linux Electron packages; verify normal install, upgrade, and missing-native
   fallback behavior.
2. Connect the generation-pinned adapter to a selected local embedding runtime:
   index/reindex, revision replacement, crash recovery, full rebuild, and
   observable progress/error states.
3. Choose and package a local bilingual embedding profile, then evaluate the
   actual Chinese/English corpus for the RFC's Recall/nDCG, scope isolation, and
   end-to-end latency gates.
4. Repeat the storage/performance test with 5k, 50k, and 500k real ContentUnits
   and representative filter selectivity before changing the 50k threshold.

## Primary references

- [sqlite-vec Node guide](https://alexgarcia.xyz/sqlite-vec/js.html)
- [sqlite-vec KNN and filtering guide](https://alexgarcia.xyz/sqlite-vec/features/knn.html)
- [sqlite-vec metadata release: brute-force KNN and planned ANN](https://alexgarcia.xyz/blog/2024/sqlite-vec-metadata-release/index.html)
- [sqlite-vec versioning policy](https://alexgarcia.xyz/sqlite-vec/versioning.html)
- [LanceDB JavaScript local connection](https://lancedb.github.io/lancedb/js/functions/connect/)
- [LanceDB JavaScript indexes](https://lancedb.github.io/lancedb/js/classes/Index/)
- [Chroma client/server mode](https://docs.trychroma.com/docs/run-chroma/client-server)
