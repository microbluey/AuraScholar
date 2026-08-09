# Bilingual retrieval evaluation protocol

> Status: executable scoring, dataset-validation, local candidate-comparison
> contract, and a visible development calibration corpus. The protocol is an
> automated measurement tool; it does not gate local indexing, and human review
> is an optional confidence layer rather than a product prerequisite.
>
> Date: 2026-08-06

[`@aurascholar/knowledge`](../packages/knowledge/src/retrieval-evaluation.ts)
defines the dataset format and deterministic scoring harness for the Chinese /
English semantic-retrieval gate. It is deliberately independent of sqlite-vec,
an embedding runtime, and raw backend scores: a benchmark driver provides an
ordered list of `ContentUnit` IDs for each query.

## Dataset boundary

Every record pins a dataset id/version and has one of two splits:

- `development`: visible tuning and pull-request regression data;
- `held-out`: release-only data, never used to select prompts, chunking, or a
  model during development.

Each candidate has its ContentUnit ID, source ID, language, and evaluation
text. Each query has its own language, the target language of all positive
labels, a discipline, graded relevance judgments, and label provenance.
`zh → zh`, `en → en`, `zh → en`, and `en → zh` are reported independently;
the same-language and cross-language rollups are supplementary, never a reason
to hide a weak slice.

The validator normalizes Unicode (`NFKC`), casing, whitespace, and punctuation
before checking identity. It preserves meaningful symbols such as the `++` in
`C++`. It rejects:

- a query copied from any candidate text, including punctuation-only variants;
- duplicate normalized candidate or query text;
- relevance IDs outside the isolated candidate corpus;
- a positive label whose candidate language does not match its declared target
  language; and
- duplicate, out-of-corpus, or over-limit ranks returned by a retrieval driver.

This makes synthetic self-match measurements unusable as semantic-quality
evidence. Synthetic labels remain useful for testing the scorer, but their
provenance is visible in every report and they cannot make a release dataset
eligible.

## Running a driver

```ts
import {
  createSemanticRetrievalEvaluationRetriever,
  evaluateRetrievalDataset,
} from "@aurascholar/knowledge";

const report = await evaluateRetrievalDataset(
  dataset,
  createSemanticRetrievalEvaluationRetriever({
    embeddingProvider,
    indexId: benchmarkIndexId,
    libraryId: benchmarkLibraryId,
    vectorStore,
  }),
  {
    candidateScope: "full-corpus",
    cutoffs: [1, 3, 10, 20],
    runProvenance: {
      extractor: "pdf-text-v1",
      chunker: "embedding-window-mean-v1",
      embeddingProfile: "<immutable profile fingerprint>",
      vectorStore: "sqlite-vec@<version>:cosine",
      fusion: "none:semantic-only",
      reranker: "none",
      prompt: "not-applicable",
      generator: "not-applicable",
    },
  },
);
```

`createSemanticRetrievalEvaluationRetriever` calls only `EmbeddingProvider` and
`VectorStore`; it intentionally excludes full-text or RRF ranks from an
embedding-model comparison. The driver must build or select only the benchmark
corpus; it must not fall back to a user Library. The harness passes the maximum
requested cutoff as `limit` and rejects extra or out-of-corpus ranks, so a
driver cannot silently score a larger result window.

`candidateScope` is retained in every report:

- `full-corpus` (the default) passes every benchmark candidate to the retriever.
  It measures semantic relevance together with the product question of whether
  a requested target-language result outranks an equivalent source-language
  result;
- `target-language-only` passes only candidates whose language equals the
  query's declared target language. It isolates cross-language semantic
  matching from language-selection behavior.

For a paired bilingual corpus, a model-selection run should report both scopes.
They answer different questions and must not be substituted for one another.

### Product language routing is a separate view

The semantic-only evaluator intentionally reports the raw `full-corpus` result;
it must not silently inject a product language filter or reranker into an
embedding-model score. The desktop product may additionally report a
`full-corpus` run with the declared explicit-language routing policy:

- the query parser activates only for an affirmative material request such as
  “英文文献”, “中文资料”, `English sources`, or `Which Chinese method…`;
  answer-language requests such as “用英文回答” remain neutral;
- the reranker adds a separate `language-preference` RRF-equivalent channel to
  hydrated candidates and keeps non-matching candidates in the result set;
- a ContentUnit language label takes precedence over the current Work language
  label; unknown or unlabelled candidates receive no preference signal; and
- the routing weight, parser version, and metadata precedence are recorded in
  `runProvenance.reranker`.

When translated pairs are present, the reproducible diagnostic should therefore
show raw `full-corpus`, routed `full-corpus`, and `target-language-only` side by
side. A routed pass can demonstrate that the product selection layer fixes a
known language-ordering issue; it cannot be used to claim that the underlying
embedding model improved. A routed result remains provisional on a development
split and must be rechecked on held-out data.

`runProvenance` is required and retained in the report after whitespace
normalization. It pins the extractor, chunker, embedding profile, VectorStore,
fusion, reranker, prompt, and generator. Retrieval-only fields use an explicit
`none` or `not-applicable` value rather than being omitted.

At each cutoff the report contains:

- `hitRate`: share of queries with at least one labelled ContentUnit retrieved;
- `recall`: macro fraction of all labelled ContentUnits retrieved;
- `meanReciprocalRank`: rank sensitivity for the first relevant result; and
- `ndcg`: graded rank quality using relevance grades 1–3.

`recall` is the conservative metric for the RFC's multi-document requirement;
when a query has labels from two or more `sourceId`s, it also appears in the
separate `multiDocument` aggregate.

## Automated quality assessment

`assessRetrievalEvaluationQuality(report)` turns an already-scored report into
a machine-readable Gate 1B model-quality signal. It checks every primary
language direction separately, so a strong aggregate cannot hide a weak
cross-language result:

- `zh → zh` and `en → en`: Recall@10 ≥ 0.90 and nDCG@10 ≥ 0.80;
- `zh → en` and `en → zh`: Recall@10 ≥ 0.82 and nDCG@10 ≥ 0.72; and
- multi-document Recall@20 ≥ 0.80.

The result contains `passed`, `provisional`, an individual `checks` entry for
each threshold, and human-readable `reasons` for every failure. Missing slices
or required cutoffs fail closed. `provisional` is `true` for a development
dataset: it may pass the mechanical thresholds but must not be represented as
held-out evidence.

The assessment also retains the report's `candidateScope`. A passing
`target-language-only` assessment demonstrates the embedding model's
cross-language semantic matching; a failing `full-corpus` assessment can still
identify a language-selection or routing problem. The two results should be
shown side by side when the corpus contains translated pairs.

This is deliberately independent of
`getRetrievalEvaluationReleaseReadiness`: it does not require human review and
is never invoked before local model installation, indexing, or search. For
example, a fully retrieved synthetic development corpus can produce
`{ passed: true, provisional: true }`; that proves a regression check passed,
not that the model is production-quality.

```ts
import { assessRetrievalEvaluationQuality } from "@aurascholar/knowledge";

const quality = assessRetrievalEvaluationQuality(report);
if (!quality.passed) console.error(quality.reasons);
```

## Optional strict release-data structure

`assertReleaseReadyRetrievalEvaluationDataset` is an intentionally strict,
optional research/release-data validator. When used, it requires the held-out
split, at least 360 queries across at least four disciplines, all four language
slices, and two independent human reviews plus adjudication for every label.
It checks corpus structure only. The local product does not call this validator
before installation, indexing, or search; automated integrity and fallback
tests remain the product gates.

## Optional blind human-review handoff

The review helpers provide the mechanical boundary for the human process; they
do not claim to verify a person's identity or replace the review itself. Start
from a private, valid `held-out` seed dataset. Its provisional labels can be
synthetic, but the seed must not be used for tuning and must remain private.

```ts
import {
  createRetrievalEvaluationBlindReviewBundle,
  finalizeHumanReviewedRetrievalEvaluation,
} from "@aurascholar/knowledge/evaluation-tools";

const bundle = createRetrievalEvaluationBlindReviewBundle(heldOutSeedDataset);
// Send only bundle.packet to each reviewer. Keep bundle.key with the coordinator.

const finalized = finalizeHumanReviewedRetrievalEvaluation({
  sourceDataset: heldOutSeedDataset,
  reviewBundle: bundle,
  reviewerSubmissions: [firstReviewerSubmission, secondReviewerSubmission],
  adjudication,
});
```

The public `packet` contains opaque task/candidate aliases, query text, and
only candidates in the query's target language. It contains neither canonical
ContentUnit/source IDs nor relevance labels. Each reviewer must grade every
candidate from 0–3; `0` means not relevant. The coordinator retains the
private `key`, compares the two complete matrices with
`listRetrievalEvaluationReviewDisagreements`, and supplies one explicit
adjudication matrix.

Finalization rejects development data, incomplete forms, duplicate reviewer
IDs, mismatched bundles, and an adjudication with no relevant item for a query.
It then replaces provisional labels with the adjudicated judgments and records
the two reviewer IDs, adjudicator ID, packet ID, and disagreement count in a
separate audit object. The review coordinator remains responsible for ensuring
those IDs correspond to two independent human reviewers and for retaining the
underlying signed/dated submissions securely.

## Development calibration corpus and local comparison

[`BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1`](../packages/knowledge/src/retrieval-evaluation-development-corpus.ts)
is a visible, original-text development corpus. It contains 16 content units
and 32 queries: eight in each of `zh → zh`, `en → en`, `zh → en`, and `en →
zh`, spanning research methods, public health, climate science, and digital
humanities. Every query has an essential and a supporting result from distinct
sources, so Recall and the multi-document aggregate are exercised as well as
first-result metrics.

Its labels use `kind: "synthetic"` on purpose. It is suitable for checking
regressions while developing a model/runtime/index, but it is visible to model
selection and therefore cannot become a held-out release gate or be described
as human-reviewed.

Use `createLocalSemanticRetrievalEvaluationCandidate` to adapt each model's
own isolated local index, then compare exactly the same data and cutoffs:

```ts
import {
  BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1,
  compareLocalRetrievalEvaluationCandidates,
  createLocalSemanticRetrievalEvaluationCandidate,
} from "@aurascholar/knowledge/evaluation-tools";

const scorecard = await compareLocalRetrievalEvaluationCandidates(
  BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1,
  [
    createLocalSemanticRetrievalEvaluationCandidate({
      id: "baseline",
      embeddingProvider: baselineProvider,
      libraryId: baselineLibraryId,
      indexId: baselineIndexId,
      vectorStore: baselineVectorStore,
      runProvenance: baselineProvenance,
    }),
    createLocalSemanticRetrievalEvaluationCandidate({
      id: "candidate",
      embeddingProvider: candidateProvider,
      libraryId: candidateLibraryId,
      indexId: candidateIndexId,
      vectorStore: candidateVectorStore,
      runProvenance: candidateProvenance,
    }),
  ],
  { baselineCandidateId: "baseline", cutoffs: [1, 3, 10, 20] },
);
```

The adapter rejects a non-local `EmbeddingProvider` before it can receive a
query, and candidates run serially to avoid concurrent local-model memory
pressure. `scorecard` retains each complete report and adds signed
candidate-minus-baseline deltas for the overall metrics and every language
slice; a positive aggregate cannot hide a weak `zh → en` or `en → zh` result.

### Automated persistence integration check

[`local-semantic-retrieval-evaluation-integration.test.ts`](../apps/desktop/electron/main/local-semantic-retrieval-evaluation-integration.test.ts)
materializes all 16 development units into a real in-memory `sqlite-vec`
generation, then sends the same generation through
`createSemanticRetrievalEvaluationRetriever` and the scorer. Its deterministic
topic-projection provider is a plumbing fixture, not a model-quality claim;
the assertions only ensure that source scope, generation persistence, all four
language slices, and labelled targets survive the actual vector path. The
dataset remains visibly synthetic and `releaseReadiness.eligible` remains
false. Run it with:

```sh
CI=true pnpm --filter @aurascholar/desktop exec vitest run \
  electron/main/local-semantic-retrieval-evaluation-integration.test.ts
```

When the catalog-pinned local model artifact is available, the same driver
boundary can be supplied with the production local provider for a genuine
Recall/nDCG run; that result must be reported separately from this structural
integration check.

### Corpus-shaped product regression

[`local-semantic-corpus-regression.test.ts`](../apps/desktop/electron/main/local-semantic-corpus-regression.test.ts)
adds a second, deliberately non-model-quality check around the desktop product
path. It creates 504 citation-safe units plus 48 context-only units across more
than 250 source IDs, mixes PDF/annotation/Evidence origins and recognized,
unsupported, and missing language labels, then materializes a real in-memory
`sqlite-vec` generation. It verifies that context-only units stay out of search,
source-specific scope and the >250-source vector-store allowlist chunking path
both survive, and an explicit Chinese-material request can re-rank a translated
twin without making the raw selection invisible.

The fixture uses deterministic local topic vectors and broad local timing
budgets. It catches plumbing, scope, and accidental performance regressions;
it is neither a production-model benchmark nor a substitute for a labelled
held-out corpus. Run it with:

```sh
CI=true pnpm --filter @aurascholar/desktop exec vitest run \
  electron/main/local-semantic-corpus-regression.test.ts
```

Set `AURASCHOLAR_CORPUS_REGRESSION_VERBOSE=1` to emit build time, query P95,
ready-unit count, context-only count, and source count as a JSON line for a
local baseline comparison. These numbers are diagnostic only; the separate
vector-engine benchmark remains the 50k-scale engine-performance baseline.

The desktop integration test exposes that opt-in run through
`AURASCHOLAR_EMBEDDING_EVALUATION_ROOT`. The value is the private installer
root containing `installed/multilingual-e5-small`; the installer re-verifies
the manifest before inference and the Transformers.js runtime remains
remote-disabled.

```sh
AURASCHOLAR_EMBEDDING_EVALUATION_ROOT=/absolute/path/to/models/embedding \
CI=true pnpm --filter @aurascholar/desktop exec vitest run \
  electron/main/local-semantic-retrieval-evaluation-integration.test.ts
```

The opt-in run writes an `AURASCHOLAR_RETRIEVAL_EVALUATION` JSON line that
contains the per-slice report plus the automatic quality assessment. It reports
the result but deliberately does not assert that a newly installed model passes
the thresholds; model choice remains an evidence-based comparison, not a
startup dependency.

Set `AURASCHOLAR_RETRIEVAL_EVALUATION_VERBOSE=1` for the same run when
diagnosing a failed slice; the JSON line then also includes each query's ranked
ContentUnit IDs and a `targetLanguageOnly` diagnostic comparison. The default
quality result remains the full-corpus result: the diagnostic comparison does
not change the benchmark gate or product retrieval behavior. This separates
cross-language semantic matching from the additional question of whether a
query should outrank an equivalent result written in its source language.

If the evaluator host has no installed artifact but can use `curl` to reach the
fixed Hugging Face revision, run the two-command verified setup documented in
the [local embedding runtime spike](./LOCAL_EMBEDDING_RUNTIME_SPIKE.md#offline-artifact-installer-boundary).
The first command publishes only a manifest-verified local artifact; the second
command runs entirely offline against that root.

If a future model-selection exercise wants stronger human-labelled evidence,
the separate held-out Chinese/English corpus can use two independent reviews
and adjudication. That process is optional and is not required before enabling
a locally installed semantic profile. For any automated run, retain the
dataset, chunker, model, and VectorStore fingerprints and report provisional
labels honestly.
