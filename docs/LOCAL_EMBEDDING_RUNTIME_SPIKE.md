# Local embedding runtime spike

> Status: local artifact, runtime, durable-index, and hybrid-search vertical
> slice implemented. The macOS arm64 runtime packaging smoke is complete; the
> fixed model's real ONNX inference smoke remains environment-dependent because
> the Hugging Face CDN is not reachable from every runner. Human review is
> optional and is not a product or indexing gate.
>
> Date: 2026-08-07

## Provisional baseline

Use `intfloat/multilingual-e5-small` as the first evaluation baseline, with a
locally installed ONNX artifact compatible with a future offline runtime. It is
MIT licensed, has 384-dimensional embeddings, supports multilingual retrieval
(including Chinese training data), and explicitly requires `query: ` and
`passage: ` prefixes for asymmetric retrieval. This matches the initial
sqlite-vec capacity envelope better than a 1024-dimensional model.

The baseline is an evaluation candidate, not a silent product default. The
downloaded artifact must be explicitly chosen by the user, pinned to a revision,
checked by a complete-manifest SHA-256, and stored outside the application
bundle. A missing artifact means semantic retrieval remains unavailable and FTS
continues to work.

`BAAI/bge-m3` remains the high-quality escalation candidate: it supports more
than 100 languages, 1024 dimensions, and up to 8192 tokens. Its larger vector
footprint and model/runtime cost mean it must first pass the same packaging and
bilingual retrieval checks before becoming a supported profile.

## Input compatibility rule

The current structural PDF unit may hold up to 12,000 characters, while
multilingual E5 has a 512-token limit. Passing a ContentUnit directly to an
embedding runtime would silently discard the tail on many sources. That is not
an acceptable index policy.

`LocalEmbeddingProvider` therefore declares the deterministic
`embedding-window-mean-v1` policy:

1. A model-owned tokenizer splits unprefixed document text into 448-token
   windows with 64-token overlap.
2. Each window is prefixed with `passage: ` and embedded without truncation.
3. Windows are individually L2-normalized, mean-pooled per ContentUnit, then
   L2-normalized again.
4. Query text receives `query: ` and must fit without truncation.

The model, ONNX artifact revision, complete artifact-manifest digest, runtime
version, dimension, and window policy all enter the immutable embedding-profile
fingerprint. A model/runtime/pooling change therefore requires a fresh index
generation.

## Runtime packaging spike (macOS arm64)

Transformers.js can load from a local model path with remote model loading
disabled, and its feature-extraction pipeline supports mean pooling plus
normalization. Its Node path uses `onnxruntime-node`.

On 2026-08-05, a disposable Electron 33.4.11 macOS arm64 application was built
with `electron-builder --dir`, `@huggingface/transformers@3.8.1`, and
`onnxruntime-node@1.21.0`. The main process successfully imported both packages
and, with `env.allowRemoteModels = false`, a missing model failed locally rather
than falling back to a network request. `electron-builder` also completed its
native-dependency rebuild step successfully.

All measurements exclude any embedding model artifact:

| Fixture                                               |  App size | Increment over Electron baseline |
| ----------------------------------------------------- | --------: | -------------------------------: |
| Electron 33.4.11 baseline                             | 243.2 MiB |                                — |
| Runtime with every `onnxruntime-node` platform binary | 535.3 MiB |                        292.1 MiB |
| Runtime retaining only macOS arm64 ONNX binaries      | 437.5 MiB |                        194.3 MiB |

The package initially contains six platform/architecture binary trees. The
targeted macOS arm64 package still loaded after only
`bin/napi-v3/darwin/arm64` remained; its unpacked `onnxruntime-node` footprint
fell from 143.4 MiB to 31.4 MiB, saving 97.7 MiB from the complete `.app`.
`electron-builder` automatically placed the native package in
`app.asar.unpacked` during the spike. AuraScholar nevertheless registers an
explicit `asarUnpack` pattern for the package, so the future pruning contract
does not depend on that implicit behavior.

The target-aware contract now lives in
[`prune-onnxruntime-platform.mjs`](../apps/desktop/scripts/prune-onnxruntime-platform.mjs)
and is registered as the desktop `afterPack` hook. It is a safe no-op until
`onnxruntime-node` becomes a product dependency; once present, it retains only
the matching target tree and fails packaging if that tree is missing or the
target is unsupported. Universal builds are intentionally rejected until they
receive a separate dual-architecture policy.

The hook was exercised through real Electron Builder directory packages:

| Target      | Packaging/layout check                                | Runtime check                                                                 |
| ----------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| macOS arm64 | Only `darwin/arm64` remained                          | Passed in the packaged Electron main process                                  |
| macOS x64   | Only `darwin/x64` remained                            | Needs a native x64 runner; it did not produce smoke output on this arm64 host |
| Windows x64 | Only `win32/x64` remained; PE architecture inspected  | Needs a Windows runner                                                        |
| Linux x64   | Only `linux/x64` remained; ELF architecture inspected | Needs a Linux runner                                                          |

This is a packaging-layout result, not a release-ready cross-platform runtime
claim. Each target still needs a real-package smoke test on its native platform
before the runtime can be enabled. The unpruned package size rules out adding
this runtime indiscriminately to the base desktop bundle.

### Native CI smoke contract

[`embedding-runtime-package-smoke.mjs`](../apps/desktop/scripts/embedding-runtime-package-smoke.mjs)
now creates a disposable package outside the repository, installs only
`@huggingface/transformers` and Electron, applies the production `afterPack`
hook, asserts that exactly one ONNX target tree remains, then starts the staged
application. The staged application imports ONNX Runtime and proves that a
missing model fails locally with remote model loading disabled. It never
downloads a model artifact.

The [manual GitHub Actions workflow](../.github/workflows/embedding-runtime-smoke.yml)
keeps this high-cost check out of normal pull requests. When explicitly enabled,
it runs the smoke on macOS arm64, macOS x64, Windows x64, and Linux x64. The
workflow has been validated locally on macOS arm64; its remote target runs remain
an execution step after the workflow is merged.

### Package-size signal

A registry metadata probe on 2026-08-05 reported an unpacked size of about 46 MiB for
`@huggingface/transformers@3.8.1` and about 208 MiB for its Node runtime dependency
`onnxruntime-node@1.21.0`. `sharp` and platform-specific optional binaries add more
variables. These figures were an early warning, not an Electron application-size
measurement; the empirical macOS result above confirms the packaging concern.

The current adapter is runtime-injected and contains neither an HTTP client nor
a model URL. It ensures that an implementation must explicitly supply a local
artifact, tokenizer splitting, and inference session; it cannot turn a local
profile into a remote request through configuration.

## Offline artifact installer boundary

The trusted main process now owns a generic local-artifact installer. It is
deliberately not a downloader: there is no model URL, no renderer-provided file
path, and no remote fallback. The settings flow must first display the model
license and collect separate license acceptance and download approval. Only then
can its no-argument IPC request ask the trusted catalog for a private staging
directory.

The installer accepts a catalog-pinned canonical manifest that includes the
model identity, source/artifact IDs, revision, runtime version, and every file's
relative path, size, and SHA-256. It verifies the manifest digest before
creating a stage, enforces a 1 GiB artifact quota by default, then verifies the
staged directory has exactly the expected regular files and bytes. On success
it writes durable consent metadata and atomically replaces the deterministic
`userData/models/embedding/installed/<model-id>` directory. A failed stage never
becomes available to inference; a failed replacement attempts to restore the
previous verified revision.

On startup or before runtime use, the installer re-checks the stored manifest
and every artifact file. Its safe status is one of `not-installed`, `ready`, or
`corrupt`; neither the status nor the renderer bridge exposes the local absolute
model path. The bridge permits inspecting/removing the fixed
`multilingual-e5-small` target plus a no-argument install request. That request
cannot supply a model ID, URL, manifest, file path, clock value, or consent
record: the main process creates both consent timestamps and obtains the plan
and source only from the immutable catalog. It rejects the request before
opening the installer or downloader unless the catalog status is `available`.

The main-process downloader accepts only a Hugging Face repository identifier,
an immutable 40-character commit, and a pre-validated manifest supplied by
trusted code. It generates the file URLs itself, streams one file at a time
into the private stage, and bounds each HTTP Range response to 1 MiB so a
transient proxy/socket close cannot invalidate a large artifact transfer. It
checks the full file byte length and SHA-256 while writing, and aborts the stage
on any network, cancellation, or integrity failure. The installer then performs
its independent second verification before publishing. No model is downloaded
merely by importing or starting the desktop application, or while the catalog
remains incomplete.

Before it creates that private stage, the downloader also requires the source
repository and immutable commit to exactly match `artifactModelId` and
`modelRevision` in the catalog manifest. This prevents a future caller from
pairing a verified file list with a different repository or revision.

### Candidate source record (complete manifest; explicit installation only)

The first candidate source has been inspected without downloading any model
file: `Xenova/multilingual-e5-small` at immutable commit
`761b726dd34fb83930e26aab4e9ac3899aa1fa78`. It is a public, non-gated ONNX
conversion of `intfloat/multilingual-e5-small`; the base model declares MIT.
Transformers.js v3 documents the expected local layout as `config.json`,
`tokenizer.json`, `tokenizer_config.json`, and an ONNX file under `onnx/`.
The likely resource-constrained baseline is the repository's
`onnx/model_quantized.onnx` (118,308,185 bytes; SHA-256
`f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193`) with
`tokenizer.json` (17,082,730 bytes; SHA-256
`0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39`).

The regular `config.json` (658 bytes; SHA-256
`cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1`) and
`tokenizer_config.json` (443 bytes; SHA-256
`a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b`) were
read at that exact commit and hashed locally after explicit approval. No ONNX
weight or tokenizer payload was read to obtain this record; their size/digest
values are the repository's LFS SHA-256 metadata. The four-file artifact totals
135,392,016 bytes and has canonical manifest SHA-256
`354ad9e76a40160b4fc5f86f15a9bba2114378c1f3b3c7ed3addc8e2c44db929`.

The main-process catalog now keeps the complete candidate record with its model
identity, MIT license, repository, immutable revision, and canonical manifest
digest. It exposes safe `available` metadata to the settings page. Only after
the two visible confirmations can the no-argument install request obtain the
main-process plan/source pair; the renderer still cannot alter its contents.

Two manual network smokes remain opt-in: the fetch-based downloader smoke is
guarded by `AURASCHOLAR_EMBEDDING_NETWORK_SMOKE=1`, while the source-and-
installer smoke is guarded by `AURASCHOLAR_EMBEDDING_CURL_NETWORK_SMOKE=1` for
restricted environments whose Node `fetch` cannot establish the CDN connection.
By default both write only beneath a disposable temporary root and delete it
after the test; neither is part of the normal test suite or application
runtime. The curl smoke has a separate explicit-root mode below for a
follow-on offline evaluation.

For a real retrieval evaluation, the curl smoke can instead publish the same
verified artifact to an explicitly supplied local root. This is test-only
setup, not a product installation shortcut: the artifact still passes the
catalog manifest, per-file SHA-256, and installer checks before it is used.

```sh
AURASCHOLAR_EMBEDDING_CURL_NETWORK_SMOKE=1 \
AURASCHOLAR_EMBEDDING_CURL_NETWORK_SMOKE_ROOT=/private/tmp/aurascholar-embedding-evaluation \
CI=true pnpm --filter @aurascholar/desktop exec vitest run \
  electron/main/local-embedding-artifact-curl-network-smoke.test.ts

AURASCHOLAR_EMBEDDING_EVALUATION_ROOT=/private/tmp/aurascholar-embedding-evaluation \
CI=true pnpm --filter @aurascholar/desktop exec vitest run \
  electron/main/local-semantic-retrieval-evaluation-integration.test.ts
```

An explicitly supplied root is intentionally retained for the second command;
the operator is responsible for removing it afterwards. The evaluation writes
an `AURASCHOLAR_RETRIEVAL_EVALUATION` JSON line with every language slice and
its automatic quality assessment.

### First real bilingual calibration run

On 2026-08-06, the pinned `Xenova/multilingual-e5-small` q8 artifact was
downloaded with curl, verified against the complete manifest, loaded by the
offline Transformers.js runtime, and evaluated through a persisted sqlite-vec
generation. The run used the visible 32-query development corpus, so these are
calibration signals rather than release evidence.

The table reports Recall@10 / nDCG@10; multi-document Recall@20 was `1.00` in
both scopes.

| Candidate scope                     |       zh → zh |       en → en |       zh → en |       en → zh | Automatic quality                       |
| ----------------------------------- | ------------: | ------------: | ------------: | ------------: | --------------------------------------- |
| `full-corpus`                       | 1.000 / 0.991 | 1.000 / 0.990 | 0.813 / 0.431 | 1.000 / 0.599 | failed: target-language ordering signal |
| `target-language-only`              | 1.000 / 0.994 | 1.000 / 0.990 | 1.000 / 0.946 | 1.000 / 0.990 | passed, provisional                     |
| `full-corpus` + explicit preference | 1.000 / 0.991 | 1.000 / 0.990 | 1.000 / 0.946 | 1.000 / 0.990 | passed, provisional                     |

This separates two facts that should not be collapsed: the model can match the
Chinese and English meanings when the candidate language is isolated, while
the full paired corpus exposes a separate language-selection problem (the
source-language twin often ranks before the requested target-language unit).

The product now has an explicit-language routing slice for this problem. A
conservative parser recognizes affirmative material requests such as “英文
文献”, “中文资料”, `English sources`, and `Which Chinese method…`; a bare
language word or “用英文回答” does not activate it. For an activated query,
the main process adds a documented `language-preference` RRF-equivalent
channel (weight `2`) after candidate hydration. It never removes non-matching
candidates. A ContentUnit's own language label wins; otherwise search-time
hydration inherits the current Work language label, so correcting bibliographic
metadata does not require a vector rebuild. Unknown or unlabelled languages
remain neutral.

The semantic-index planner also reports this effective-label coverage for the
ready corpus: recognized Chinese/English labels, unlabelled units, and labels
outside the currently supported pair. It makes the bounded routing behavior
visible before a user relies on an explicit material-language request.

All 16 explicit cross-language queries in the development corpus are covered by
parser tests. The routed row above is still a provisional development signal,
not release evidence; the raw full-corpus and target-language-only rows remain
mandatory so routing cannot conceal an embedding regression.

## Automated acceptance and follow-up

1. Exercise the complete manifest through a disposable test profile, then keep
   installation user-initiated and preserve the no-renderer-path/URL boundary.
2. Run the packaged Electron smoke test on native macOS x64, Windows arm64/x64,
   and Linux arm64/x64 runners. Measure cold start, peak memory, throughput,
   and app-size impact for every supported target.
3. Run the executable [bilingual retrieval evaluation protocol](./RETRIEVAL_EVALUATION_PROTOCOL.md)
   on an explicitly labelled offline corpus when making model-selection
   decisions. It validates copied-query self matches, label language, corpus
   isolation, and Recall/MRR/nDCG scoring. Any synthetic or development labels
   remain visibly provisional; a human-reviewed corpus may improve confidence
   but is not required to enable local indexing.
4. Continue automated rebuild, deletion, stale-generation, crash-recovery,
   packaging, and FTS-fallback tests. The accepted local runtime is already
   connected to the generation worker and hybrid search path, including the
   explicit-language routing diagnostic.
5. Expand language-label coverage and run the same three-way report on a
   held-out corpus before treating the routed result as a release baseline.

## Primary references

- [Multilingual E5 small model card](https://huggingface.co/intfloat/multilingual-e5-small)
- [BGE-M3 model card](https://huggingface.co/BAAI/bge-m3)
- [Transformers.js local model configuration](https://huggingface.co/docs/transformers.js/main/en/custom_usage)
- [Transformers.js feature-extraction pipeline](https://huggingface.co/docs/transformers.js/v3.8.1/en/api/pipelines)
- [ONNX Runtime Node.js binding support matrix](https://onnxruntime.ai/docs/get-started/with-javascript/node.html)
