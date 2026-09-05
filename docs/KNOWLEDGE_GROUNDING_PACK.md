# Knowledge Grounding Pack

> Status: implementation contract
>
> The GroundingPack is the bounded, auditable hand-off from retrieval to an
> optional generator. It is derived data: it never becomes canonical evidence.

## Purpose

Every generated answer, comparison, or manuscript suggestion must be grounded
in a pack built from one frozen `CorpusScopeSnapshot`. The pack makes the
permitted corpus, source revision, authority, freshness, and citation anchors
explicit so a generator cannot broaden the search or silently cite a different
revision.

The first product remains hybrid evidence search. A pack may be displayed as
source cards without invoking a model; generation is optional and can fail
without losing the retrieved cards.

## Contract

A pack contains the following implementation-shaped fields:

```ts
type GroundingPack = {
  version: 1;
  runId: string;
  retrievalRunId: string;
  libraryId: string;
  corpusScope: CorpusScopeSnapshot;
  scopeHash: string;
  items: readonly GroundingPackItem[];
  // Alias of items; citation IDs are issued by the service.
  citations: readonly GroundingPackItem[];
  truncated: boolean;
  excluded: readonly GroundingPackExclusion[];
  hash: string;
};

type GroundingPackItem = {
  citationId: string;
  contentUnitId: string;
  contentUnitIds: readonly string[];
  libraryId: string;
  sourceType: "pdf" | "annotation" | "evidence";
  sourceTypes: readonly ("pdf" | "annotation" | "evidence")[];
  sourceId: string;
  sourceIds: readonly string[];
  workId: string | null;
  assetId: string | null;
  revisionId: string;
  anchor: RevisionBoundSourceAnchor;
  text: string;
  quotedText: string;
  contentHash: string;
  sourceContentHash: string | null;
  extractorProfile: string;
  chunkProfile: string;
  authority: "published-source" | "captured-source" | "user-annotation" | "user-evidence";
  authorities: readonly (
    | "published-source"
    | "captured-source"
    | "user-annotation"
    | "user-evidence"
  )[];
  revisionState: "current" | "historical";
  rank: number;
  sourceTitle: string | null;
  citationEligible: true;
};

type GroundingPackExclusion = {
  contentUnitId: string;
  sourceType: "pdf" | "annotation" | "evidence";
  reason:
    | "context-only"
    | "historical-source"
    | "historical-evidence"
    | "item-limit"
    | "payload-limit";
};
```

`packId`/`sources`/`limitations` from earlier design notes are conceptual
aliases only: `runId`/`items` identify the concrete pack, while exclusions and
truncation are represented by `excluded` and `truncated`. Implementations may
add diagnostic ranks and retrieval provenance, but must not omit the library,
scope snapshot, revision, anchor, or authority fields.

## Inclusion rules

1. Freeze filters and selected Works/documents before retrieval. Resolve the
   resulting allowlist inside the main process and carry it into the pack.
2. Enforce Library and narrower Project/document/Canvas/manuscript scope before
   candidate selection. A vector adapter that only post-filters is not eligible.
3. Include current published/captured source revisions, user annotations, and
   confirmed Evidence by default. ResearchNotes and manuscript drafts require
   explicit opt-in and remain visibly labelled.
4. Historical Evidence may be shown with a historical-version badge, but is
   excluded from grounding by default until the user re-verifies it.
5. Synthesis drafts are never grounding sources by default. Generated text is
   not a source merely because it was indexed.
6. Deduplicate by revision, anchor, and content hash while retaining authority
   badges and human-signal provenance.
7. If no eligible source supports the request, return a refusal or an empty pack
   with an exclusion reason; do not manufacture an answer from model memory.

## Citation and answer requirements

The generator receives source quotes and stable anchors, not unrestricted
database access or tool capabilities. It must cite the `citationId` for each
material claim. A citation is valid only when its `citationId` resolves to the same
Library, `revisionId`, and content hash used to build the pack.

The UI must distinguish exact/full-text matches, semantic matches, user notes,
historical evidence, and unresolved or conflicting sources. Raw vector distance
must never be presented as a confidence percentage. Conflicts and missing
support are reported through the validated claim/answer coverage state, and the
answer should say when evidence is insufficient or sources disagree.

The provider payload also carries the immutable `packHash`, alongside its
run/scope identity. The async payload builder revalidates this hash before a
provider boundary; the source records remain untrusted data rather than
instructions.

## Grounded synthesis execution

The first execution boundary is deliberately narrow and does not persist an
answer. It performs the following sequence:

1. validate and freeze the complete GroundingPack before the provider boundary;
2. construct one fixed system instruction plus a bounded, canonical JSON data
   payload that labels every source record `untrusted`;
3. syntax-check and bound provider JSON before any relation resolver sees it;
4. obtain claim-to-citation relations from a trusted main-process resolver, not
   from provider output; and
5. revalidate every issued citation, relation, citation marker, and final
   coverage state before returning an answer.

An empty eligible pack does not contact a provider. It produces the explicit
`insufficient` state instead. The relation resolver may use only the frozen
pack and validated claim/citation references; it must never accept provider
fields that label a citation as supporting, qualifying, contradicting, or
background evidence.

This layer creates no durable SynthesisDraft or diagnostic row. A later
main-process integration must recheck its active Library/scope token and source
lifecycle state at any durable write boundary.

## Desktop document synthesis boundary

`ai.synthesizeDocument` is the first desktop integration of this contract. Its
renderer DTO contains only `query`, `workId`, and an opaque cancellation
`requestId`; it cannot submit a Library ID, source IDs, revisions, citations,
provider endpoint, API key, or model name. Electron main then:

1. resolves the current local Library and the selected Work into a canonical
   source allowlist, searches only that frozen scope, and captures each Asset's
   current revision before it builds the pack;
2. calls the configured main-process provider only when the pack has eligible
   citations, with the static instruction channel separated from untrusted
   source data;
3. asks a second, fixed-prompt main-process provider call to classify every
   exact claim/citation pair from the pack quote, rejecting missing, duplicate,
   unknown, or malformed relation rows; and
4. re-resolves the Work scope, canonical ContentUnits, and current Asset
   revisions immediately before it returns the ephemeral result.

The second classification is a defense-in-depth relevance check, not an
independent source of truth: it has no database access, receives only
pack-issued quotes and IDs, and its labels are still subject to deterministic
pack, marker, citation, and coverage validation. If the source lifecycle
changes during either provider call, the command rejects rather than returning
an answer tied to stale evidence. Empty packs return `insufficient` without
constructing or contacting a provider.

The desktop PDF Reader exposes this as a desktop-only **Grounded synthesis**
panel for the currently open, in-Library Work. The question is the only new
user-provided input. Its Markdown answer is an editable, session-only draft;
closing or changing the Reader session discards it. The rendered claim and
citation cards remain main-issued, revision-bound projections and cannot be
replaced by the renderer. This UI creates no Evidence, annotation, draft, or
other durable record.

## Safety and lifecycle

- Retrieved text is untrusted quoted data. It cannot change system rules,
  scope, permissions, or invoke tools.
- Pack construction and every durable semantic-index write carry the Library
  scope token and the generation `sourceChangeSeq`. A stale sequence or stale
  scope rejects the operation; it must not complete an old worker job.
- Indexes and packs are disposable. Source revisions, deletion, model changes,
  restore, or corruption invalidate derived data and trigger rebuild/cleanup.
- On provider failure, cancellation, lease loss, or scope change, preserve
  canonical records and already retrieved source cards; discard partial derived
  rows where possible and report the failure state.
- A pack is session-local diagnostic output unless explicitly saved as a
  generated artifact. Saving it does not promote any quote or answer to
  Evidence; Evidence requires explicit user confirmation.

## Evaluation gates

Grounding is evaluated separately from generation. Each benchmark record pins
scope, anchors, extractor/chunker, embedding profile, vector store, fusion,
prompt, and dataset versions. Release gates require:

- zero cross-Library, deleted, non-current-default, or out-of-scope citations;
- exact citation identity and anchor-resolution checks at 100%;
- no durable late writes after cancellation or scope changes;
- Recall@10 and other retrieval metrics reported independently for every
  language, discipline, format, and scope slice;
- visible FTS fallback when semantic indexing is unavailable.

See [KNOWLEDGE_LAYER_RFC.md](./KNOWLEDGE_LAYER_RFC.md) and the
[retrieval evaluation protocol](./RETRIEVAL_EVALUATION_PROTOCOL.md) for the
authoritative scope, authority, benchmark, and release-gate definitions.
