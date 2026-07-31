# AuraScholar Research Knowledge Layer RFC

> Status: Proposed
>
> Date: 2026-07-27
>
> Target: AuraScholar desktop first, shared domain contracts for future web/mobile clients
>
> Scope: trusted research corpus, hybrid retrieval, evidence-grounded RAG, Canvas and writing integration

## 1. Summary

AuraScholar should treat papers, documents, annotations, excerpts, Canvas notes, and
manuscripts as one traceable research corpus. The Research Knowledge Layer turns
that corpus into searchable evidence and, only after retrieval is trustworthy,
supports evidence-grounded synthesis and writing.

The layer is not a global chatbot. It has three deliberately separate parts:

1. **Canonical knowledge**: source files, metadata, revisions, annotations,
   user-confirmed evidence, relationships, and manuscripts.
2. **Derived retrieval indexes**: normalized content units, FTS indexes,
   embeddings, vector indexes, and optional reranking data. These must always be
   disposable and rebuildable.
3. **Generated artifacts**: answers, synthesis drafts, comparison matrices, and
   suggestions. These are not source evidence and must not silently become
   authoritative retrieval content.

The first product release is hybrid evidence search, not generated answers.

## 2. Why AuraScholar needs this layer

AuraScholar already owns the parts a trustworthy academic knowledge system needs:

- bibliographic records and content-addressed attachments;
- PDF text extraction and multi-level annotation anchors;
- user excerpts and notes;
- explicit citation and Canvas relationships;
- multiple independent Canvas workspaces;
- planned universal document reading and in-app manuscript writing.

Without a shared knowledge layer, every module will eventually build its own
search, AI context assembly, source tracking, and caching rules. That would
produce inconsistent answers, duplicated indexing work, and sources that cannot
be traced back to the exact document revision.

The intended research loop is:

```text
discover/import
  -> read and annotate
  -> retrieve and verify evidence
  -> organize and synthesize in Canvas
  -> bind evidence to manuscript claims
  -> return to the exact source at any time
```

## 3. Goals and non-goals

### 3.1 Goals

- Search PDF text, structured documents, annotations, Evidence, and selected
  user-authored material through one scoped retrieval API.
- Preserve an exact, versioned path from every result and citation back to its
  source.
- Make Library, Project, selected-document, Canvas, and manuscript scopes
  explicit and enforce them before retrieval.
- Work in a local-only configuration. AI generation must remain optional.
- Prefer local embeddings after a runtime, packaging, licensing, and bilingual
  quality spike. Until then, full-text search remains usable. Remote embeddings
  and remote generation require separate opt-in consent.
- Make indexes recoverable after corruption, model changes, restores, and
  device migration.
- Expose trustworthy building blocks to Library, Reader, Canvas, and Writing
  without embedding Electron-specific logic in shared packages.
- Evaluate retrieval and generation separately on bilingual academic material.

### 3.2 Non-goals

- A global floating “Ask Aura” chatbot.
- Automatically promoting AI answers to Evidence.
- Treating semantic similarity as a factual Canvas relationship.
- Searching the entire Library when the user selected a narrower scope.
- Making a vector store the only copy of source text.
- Synchronizing vector indexes in the first release.
- Full GraphRAG entity and claim extraction in the first release.
- Letting retrieved document content invoke tools or perform writes.

## 4. Product vocabulary and authority levels

### 4.1 Library

The Library is the ownership and privacy boundary for a corpus. A Library may
contain many Projects. Every user-owned canonical record must belong to exactly
one non-deleted Library.

### 4.2 ResearchProject

A Research Project is a bounded research work unit. It may represent a paper,
review, grant, experiment, or longer-running topic, and is the normal working and
retrieval boundary. It may contain:

- Works and DocumentAssets;
- multiple Canvas workspaces;
- EvidenceItems and reviewed ResearchNotes;
- saved searches and discovery results;
- one or more Manuscripts.

Deleting a Project removes membership and project-owned artifacts. It never
deletes Library Works or source files unless the user separately requests that
operation.

### 4.3 DocumentAsset and DocumentRevision

`DocumentAsset` is the stable logical identity of a document. A PDF, DOCX, HTML
snapshot, Markdown file, EPUB, or notebook may all be DocumentAssets.

`DocumentRevision` identifies immutable bytes or an immutable captured source
version. Updating or replacing a file creates a revision and never rewrites the
identity used by older anchors.

### 4.4 SourceAnchor

`SourceAnchor` is a versioned discriminated union. Initial variants are:

- `pdf`: revision, page, quads, TextQuote, and optional TextPosition;
- `html` / `docx` / `markdown`: revision, heading path, block path, TextQuote,
  and optional DOM/structural hint;
- `epub`: revision and CFI, with TextQuote fallback;
- `canvas`: workspace, node, and node revision;
- `manuscript`: manuscript, block, and block revision.

Anchors are evidence locators, not mutable UI coordinates. A changed source may
produce a new anchor through an explicit re-anchoring operation, but the original
anchor remains part of provenance.

### 4.5 EvidenceItem

Evidence is user-confirmed source material, not an AI summary. Text is the first
rendered Evidence type, but the model reserves a typed payload for future figure,
table, region, formula, and notebook-output Evidence. It contains:

- source and revision identity;
- a SourceAnchor;
- a typed payload or captured quote and source-content hash;
- optional user note, tags, question/claim association, and evidence kind;
- provenance and timestamps.

`EvidenceKind` describes the material itself: `method`, `data`, `limitation`,
`definition`, or `context`. Whether Evidence supports or contradicts a claim
belongs to a separate, claim-bound `ClaimEvidenceRelation` such as `supports`,
`contradicts`, `qualifies`, or `background`. One EvidenceItem may play different
roles for different claims. Neither classification is automatically written as
a Canvas edge label.

### 4.6 SynthesisDraft, ResearchNote, and Manuscript

- A `SynthesisDraft` is model-generated and explicitly unconfirmed.
- A `ResearchNote` has `origin = user | ai-assisted` and
  `reviewState = draft | reviewed`. “Reviewed” means the user reviewed it; it
  does not grant published-source authority.
- A `Manuscript` is authored output composed of versioned blocks and citations.

Generated artifacts are excluded from authoritative retrieval by default.
Users may include notes or manuscript text through an explicit source-type
filter, but the UI must preserve their authority labels.

### 4.7 Project ownership and membership

The first implementation uses explicit ownership rules:

- Works, DocumentAssets, and EvidenceItems are Library-owned and may be members
  of multiple Projects through typed join tables.
- Canvas workspaces, ResearchNotes, and Manuscripts are Project-owned and belong
  to one Project. Legacy or unfiled records are placed in a generated default
  Project during migration.
- Project membership attaches to a Work or logical DocumentAsset, not a specific
  revision. Default retrieval uses the current revision, while historical
  Evidence remains bound to its captured revision.

A `project_works` membership implicitly includes every current DocumentAsset
owned by that Work. `project_assets` is used for standalone documents without a
Work and for explicitly attached supplemental assets. The ScopeResolver unions
both membership sets and deduplicates by logical asset ID. Adding an asset that
already arrives through its Work does not broaden or duplicate the corpus.

Deleting a Project shows separate counts for Project-owned artifacts that will
be removed and Library-owned sources whose membership will only be detached.

Each non-deleted Library preserves at least one active Project and one Canvas
workspace. The last Project in that Library cannot be deleted. Deleting another
Project removes its Project-owned Canvases; if that would leave no workspace in
the same Library, the same Library-scoped transaction creates a blank Canvas in
the remaining active Project before redirecting there. A Project or Canvas in
another Library never satisfies this invariant.

### 4.8 ManuscriptCitation and ClaimEvidenceLink

Normal bibliographic citation must remain lightweight:

- `ManuscriptCitation` references a Work and may include a page/section locator.
  It does not require a saved EvidenceItem.
- `ClaimEvidenceLink` binds a specific manuscript claim to an EvidenceItem and
  its SourceAnchor.

This distinction supports ordinary background citation without weakening the
stronger evidence trail needed for factual claims.

## 5. Current-state constraints

The current schema and services provide useful foundations but are not ready for
safe vector retrieval:

- `works_fts` indexes title, abstract, and notes only; it does not index source
  document text.
- PDF text is normalized per page and can be extracted on demand, but there is
  no durable, revision-bound content-unit store.
- Annotations contain strong PDF anchor data and should be preserved as
  high-value human evidence.
- `derived_artifacts` has useful model/input hashes but is not a suitable
  high-volume chunk/vector table.
- `AIProvider` supports text/object generation but has no embedding or reranking
  contract.
- Libraries exist, while major root entities such as Works and Canvas
  workspaces are not strongly Library-scoped.
- Renderer services can currently issue arbitrary SQL through the desktop bridge.
  Adding `libraryId` to Repository methods alone therefore cannot establish a
  safety boundary; raw SQL paths must be audited and critical mutations must
  move behind scoped main-process commands.
- Attachments are content-addressed but lack a stable logical asset,
  current-revision pointer, and revision lineage.
- Current JSON backup preserves attachment records but not source-file bytes.
  Cross-device index rebuild is possible only after referenced blobs are
  available through backup, sync, or user relinking.
- Existing FTS uses the `unicode61` tokenizer. Chinese exact/full-text quality
  requires its own tokenizer/segmentation benchmark rather than being inferred
  from English behavior.
- Provider calls expose an AbortSignal at the shared interface, but cancellation
  and stale-scope checks must be made end-to-end before this layer relies on
  them.

These are P0 prerequisites, not cleanup to postpone until after a vector-search
prototype.

## 6. Architectural invariants

The following rules are release-blocking invariants.

### 6.1 Canonical data owns meaning

Immutable source bytes/snapshots, natively authored Markdown, metadata,
revisions, anchors, Evidence, user relationships, and manuscripts are canonical.
Parsed/normalized text, ContentUnits, embeddings, vector indexes, retrieval
traces, and generated answers are derived.

Deleting all derived index data must never remove a source, EvidenceItem, Canvas
node, or manuscript citation.

### 6.2 Scope is explicit and fail-closed

Every knowledge operation receives `libraryId`, a typed `CorpusScopeSnapshot`,
and optional `QueryContext`.
Repository and retrieval layers must not infer a hidden “active Library”.

Scope filters are applied while selecting FTS and vector candidates. Retrieving
globally and filtering the final top-k is forbidden.

Gate 0 includes a complete raw-SQL scope audit, scoped main-process commands for
safety-critical writes, and an architecture test that rejects new unscoped
root-entity access. Shared catalog entities, if any, must be explicitly named;
they cannot emerge accidentally from missing ownership columns.

### 6.3 Revisions are immutable

Content units, anchors, embeddings, retrieval hits, and citations bind to one
DocumentRevision and content hash. Replacing a source creates a new revision.

### 6.4 One retrieval uses one index generation

Embedding-model or chunker changes build a new generation in the background.
Queries pin one active generation for their complete lifetime. Generations are
never mixed within a result set.

### 6.5 Cancellation is advisory; identity checks are authoritative

AbortController should stop unnecessary work quickly, but providers may ignore
it. Before every durable write, the service revalidates:

- request identity and status;
- Library and Project/Workspace scope;
- source revision and content hash;
- index generation;
- current target identity.

An old request can never write into a newly active Project, Canvas, or session.

### 6.6 Retrieved content is untrusted data

PDF, HTML, DOCX, Markdown, OCR, and metadata may contain prompt injection.
Retrieved content is quoted data and cannot change system rules, scope, tool
permissions, or write behavior.

### 6.7 Human confirmation changes authority

Retrieval results are temporary. Saving original source material as Evidence is
an explicit action. Saving a generated result creates a SynthesisDraft or note,
never Evidence.

## 7. Domain and persistence model

Names below describe the intended domain. Exact SQL is finalized in each
migration PR.

### 7.1 Ownership and project scope

```text
research_projects
  id, library_id, name, description, status,
  created_at, updated_at, deleted_at

project_works
  project_id, work_id, role, created_at, deleted_at

project_assets
  project_id, asset_id, role, created_at, deleted_at

project_evidence
  project_id, evidence_id, role, created_at, deleted_at
```

Root user data—Works, collections, tags, Canvas workspaces, saved searches, and
future assets/manuscripts—must have explicit Library ownership. Existing global
unique constraints such as Work DOI and tag name become Library-scoped where
duplicates across Libraries are valid.

Gate 0 also makes bibliographic Authors Library-owned. ORCID uniqueness becomes
`(library_id, orcid)`, and WorkAuthor links validate matching Library ownership.
The first release has no cross-Library shared catalog entities; connector results
are imported/deduplicated within the destination Library.

All Repository methods that read or write scoped data accept an explicit
`libraryId`. Cross-table writes must validate ownership consistency.

Typed join tables are intentional: a polymorphic
`project_sources(source_type, source_id)` cannot provide real foreign keys and
would allow accidental cross-Library references. Each join table has a unique
membership constraint and validates that both sides share a Library.

Canvas workspaces, ResearchNotes, and Manuscripts store one non-null
`project_id`; their Project supplies the Library boundary.

Library ownership shipped in schema version 17. Schema version 18 adds
ResearchProject, typed Work membership, and non-null Canvas Project ownership.
Because migrations run before `ensureLocalFirstState`, neither migration assumes
that `local.library_id` is already configured: v17 bootstraps Library identity,
then v18 creates one default Project per Library and backfills Work membership
and Canvas ownership before rebuilding constrained tables.

### 7.2 Assets and revisions

To avoid a destructive first migration, the existing `attachments` table remains
compatible while the domain is introduced.

```text
document_assets
  id, library_id, work_id?, kind, title,
  current_revision_id?, created_at, updated_at, deleted_at

document_revisions
  id, asset_id, revision_no, mime_type,
  blob_sha256, byte_size, source_url?,
  extractor_profile?, extraction_status,
  created_at, deleted_at
```

An implementation may initially extend `attachments` as the physical revision
record rather than rename it. Existing attachments backfill to one asset and
revision 1. The current revision switches only after validation succeeds.

`blob_sha256` resolves through the content-addressed BlobStore for every local
format, including captured HTML, DOCX, EPUB, and notebooks. Revision insertion
verifies the bytes first; switching `current_revision_id` then occurs in a
transaction. A foreign key/trigger guarantees that the current revision belongs
to the same asset.

Annotations continue to reference the exact revision they were created against.
Re-anchoring produces a report with matched, ambiguous, and orphaned items.

### 7.3 Evidence

```text
evidence_items
  id, library_id,
  work_id?, asset_id?, revision_id?,
  source_kind, evidence_kind, anchor_json,
  payload_kind, payload_json,
  title?, note_md?, tags_json?,
  source_content_hash, provenance_json,
  created_at, updated_at, deleted_at

research_claims
  id, library_id, project_id,
  statement_md, origin, review_state,
  created_at, updated_at, deleted_at

claim_evidence_links
  library_id, claim_id, evidence_id,
  relation, note?, created_at, deleted_at
```

Gate 0 renders `payload_kind = text`; the union reserves `region`, `figure`,
`table`, `formula`, and `code-output` without overloading Markdown text.
EvidenceItems are Library-owned and join one or more Projects through
`project_evidence`. A claim relation is stored only on `claim_evidence_links`.
Saving Evidence from Reader without an active Project places it in the Library
Evidence Inbox with no Project membership. Project membership can be added later
without duplicating the EvidenceItem.

ResearchClaim is a first-class, Project-owned object. `claim_evidence_links` has
real foreign keys to `research_claims` and `evidence_items`; composite ownership
checks/trigger rules require matching `library_id` and require the Evidence to be
available in the Claim's Project. Canvas and Manuscript integrations use typed
binding tables that reference `research_claims` rather than a polymorphic
`claim_type/claim_id`.

Existing Snippets remain readable for at least one compatibility cycle.
Migration may backfill or dual-write Evidence, but must not silently delete
Snippet data.

Project-local staging uses a separate non-authoritative workflow table:

```text
evidence_shelf_items
  id, library_id, project_id,
  work_id?, asset_id?, revision_id?,
  anchor_snapshot_json, preview_payload_json,
  source_content_hash, status,
  created_at, updated_at, deleted_at
```

Shelf items are local-only in the first release, excluded from retrieval
authority and WebDAV row sync, and included in whole-Library JSON backup. Project
delete and permanent source erasure cascade to matching Shelf rows. A restored
row must revalidate revision/hash before it can become Evidence.

### 7.4 Content units

```text
content_units
  id, library_id,
  source_type, source_id,
  work_id?, asset_id?, revision_id?,
  parent_unit_id?, ordinal,
  heading_path_json?, anchor_json,
  text, language?, token_count,
  content_hash, extractor_profile, chunk_profile,
  state, created_at, updated_at, deleted_at
```

Content is split structurally:

- PDF by page, heading, and paragraph where recoverable;
- HTML, DOCX, and Markdown by section and block;
- annotations and Evidence as first-class short units;
- Canvas nodes and manuscript blocks by their own revision boundaries.

Fixed character windows may be used only as a bounded fallback inside an
oversized structural unit. Parent identifiers support context expansion after
retrieval.

ContentUnits are immutable for
`(revision, extractor_profile, chunk_profile, ordinal, content_hash)`. A new
extractor or chunker creates parallel units; it never overwrites units still
referenced by an active generation. Old units are collected only after the
generation has retired and no in-flight query lease refers to it.

An FTS5 index is built over `content_units.text`. FTS candidates join the pinned
`knowledge_index_entries` generation and validate unit/hash state so a query
cannot fuse G1 vectors with G2 text. Exact metadata queries use a separate
MetadataRetriever rather than being replaced by either FTS or vectors.

### 7.5 Embedding profiles and generations

```text
embedding_profiles
  id, provider_kind, egress_mode, model_id, model_revision?,
  dimension, distance_metric, normalization,
  chunk_profile_version, created_at

knowledge_indexes
  id, library_id, mode, embedding_profile_id?,
  generation, status, source_change_seq,
  expected_count, indexed_count,
  created_at, activated_at?, retired_at?, error?

knowledge_index_entries
  index_id, content_unit_id,
  content_hash, vector_ref?,
  status, created_at, updated_at
```

An embedding fingerprint includes provider, model identifier and revision where
available, dimensions, normalization, distance metric, chunker version, and
source-content hash. Equal dimensions do not make embeddings from different
models compatible.

`knowledge_indexes` is a pinned retrieval/corpus generation, not necessarily a
vector index. Gate 1A uses `mode = fulltext` with a null
`embedding_profile_id`; its entries pin the eligible ContentUnits for FTS. Gate
1B creates `mode = hybrid` generations with an EmbeddingProfile and vector refs.
This lets full-text retrieval have snapshot consistency without making
embeddings a prerequisite.

Generation switch:

1. Generation G1 continues serving queries.
2. G2 is built in the background.
3. Canonical mutations append to a monotonic, Library-scoped knowledge outbox in
   the same transaction.
4. G2 consumes changes through a stable high-water sequence; counts and hashes
   are then verified.
5. One transaction activates G2 and retires G1.
6. G1 is garbage-collected after in-flight generation leases expire.

If G2 fails, G1 remains active.

With a sidecar VectorStore, the physical vectors cannot share the SQLite
transaction. The adapter first writes and fsyncs an immutable vector namespace
plus readiness manifest. SQLite then atomically switches the active namespace
pointer. Failed or abandoned namespaces are safe to reconcile later.

### 7.6 Durable indexing jobs

The existing `ai_jobs` table is not expanded into a general indexing queue.

```text
knowledge_changes
  seq, library_id,
  source_type, source_id,
  change_kind, expected_revision_id?, expected_content_hash?,
  created_at

knowledge_jobs
  id, library_id,
  kind, source_type, source_id,
  expected_revision_id?, expected_content_hash?,
  index_id?, dedupe_key,
  status, attempts, max_attempts, available_at,
  lease_owner?, lease_expires_at?,
  progress_json?, error?,
  created_at, updated_at
```

Supported initial kinds are `extract`, `chunk`, `embed`, `remove`, and `reindex`.
Canonical mutation and append-only `knowledge_changes` insertion happen in one
transaction. A dispatcher consumes the monotonic outbox and idempotently
upserts/coalesces `knowledge_jobs`; it never writes a second competing change
log. A desktop background worker claims short job leases; abandoned work is
recoverable after a crash.

Jobs are Library/source/index-generation work, not Project work, because the same
Work may appear in several Projects. Project identity is present only when the
canonical source itself is Project-owned. The state machine defines queued,
leased/running, retry-wait, completed, cancelled, and terminal-failed states.
An active-job uniqueness constraint enforces the dedupe key.

The current renderer IPC cannot safely implement a multi-call
`BEGIN -> mutation -> outbox -> COMMIT` sequence. Gate 0 therefore adds a
main-process UnitOfWork/command boundary that performs canonical mutation and
knowledge-outbox append within one `better-sqlite3` transaction.

The renderer may request and observe work but never owns persistent indexing.
Heavy extraction and embedding run outside the renderer and must not block the
Electron main event loop.

### 7.7 Retrieval and RAG records

Retrieval is usable without persisting user queries. Development diagnostics may
record local, short-lived runs only when local diagnostics are enabled:

```text
retrieval_runs
  id, library_id, scope_snapshot_json,
  index_id, query_hmac, config_json,
  status, timing_json, expires_at

retrieval_hits
  run_id, content_unit_id,
  fts_rank?, vector_rank?, fused_rank, rerank_score?
```

Query and source text are not written to logs by default. `query_hmac` uses a
device-local secret rather than an unsalted hash. Diagnostics default to a
seven-day TTL, are never synced, and are removed when their Library, Project, or
source is erased. Raw query/answer logging requires a separate local opt-in.

RAG is ephemeral by default. When local diagnostics are enabled, it may persist
only privacy-minimized operational metadata:

```text
synthesis_runs
  id, library_id, project_id?, retrieval_run_id,
  query_hmac, corpus_scope_hash,
  provider, model, status, timing_json,
  created_at, expires_at

synthesis_drafts
  id, library_id, project_id?,
  query_context_json, corpus_scope_snapshot_json,
  content_json, origin, review_state,
  created_at, updated_at, deleted_at

synthesis_draft_citations
  id, synthesis_draft_id, claim_key,
  asset_id?, revision_id?, work_id?,
  anchor_snapshot_json, quoted_text, source_content_hash,
  content_unit_id?
```

A SynthesisRun is an auditable scoped operation, not a conversational chat
session. It never persists raw query, answer, or source text and uses the same
seven-day local-only diagnostic TTL. Changing corpus scope creates a new run.

Only an explicit user `Save synthesis` action creates a canonical
SynthesisDraft with its validated citations. Citation identifiers are
orchestrator-generated from the current `GroundingPack` and validated by the
service; generated output that cites any other identifier is rejected.
Persistent draft citations retain canonical source/revision/anchor identity;
`content_unit_id` is only an optional diagnostic link because ContentUnits are
rebuildable. Deleting the Draft cascades its citations; permanent source erasure
follows section 11 and removes source-bound captured quotes.

## 8. Shared service contracts

Shared, platform-neutral contracts belong in packages.

```ts
interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimension: number;

  embedQuery(text: string, options?: { signal?: AbortSignal }): Promise<Float32Array>;
  embedDocuments(texts: string[], options?: { signal?: AbortSignal }): Promise<Float32Array[]>;
}

interface Reranker {
  rerank(
    query: string,
    candidates: readonly RetrievalCandidate[],
    options?: { signal?: AbortSignal },
  ): Promise<readonly RerankedCandidate[]>;
}

interface MetadataRetriever {
  search(input: {
    libraryId: string;
    corpusScope: CorpusScopeSnapshot;
    query: string;
    filters?: RetrievalFilters;
  }): Promise<readonly RetrievalCandidate[]>;
}

interface VectorStore {
  search(input: {
    libraryId: string;
    indexId: string;
    allowedSourceIds: readonly string[];
    filters?: RetrievalFilters;
    vector: Float32Array;
    limit: number;
  }): Promise<readonly RetrievalCandidate[]>;
}

interface HybridRetriever {
  search(input: {
    libraryId: string;
    queryContext?: QueryContext;
    corpusScope: CorpusScopeSnapshot;
    query: string;
    filters?: RetrievalFilters;
    limit: number;
    signal?: AbortSignal;
  }): Promise<RetrievalResult>;
}
```

Retrieval pipeline:

1. Freeze active filters/selection into a `CorpusScopeSnapshot`, then resolve its
   allowed source identities.
2. Run normalized identifier/metadata matching, FTS/BM25, and vector candidate
   retrieval in parallel. Exact DOI/arXiv/PMID/ISBN matches receive deterministic
   priority.
3. Deduplicate source paragraphs, annotations, and saved Evidence by
   revision/anchor/content hash while retaining badges and human-signal boosts.
4. Fuse non-exact ranks with Reciprocal Rank Fusion.
5. Optionally rerank a bounded candidate set.
6. Expand the parent section within a token budget.
7. Return original text, authority label, SourceAnchor, and diagnostic ranks.

The product does not present raw vector distance as a user-facing “confidence
percentage”.

Every VectorStore adapter passes the same fail-closed contract suite. Library
partition and selected Project/document allowlists must constrain candidate
selection before top-k. An adapter that can only post-filter candidates is not
eligible for release.

## 9. Vector-store decision

The first implementation must depend on a `VectorStore` adapter, not a concrete
database extension.

Two spikes use the same real corpus and evaluation harness:

1. SQLite BLOB plus in-process exact scan, followed by stable `sqlite-vec`
   exact KNN if Electron packaging succeeds.
2. Embedded LanceDB as a comparison for richer filtering and larger indexes.

Decision criteria:

- macOS arm64/x64, Windows, and Linux Electron packaging;
- 5k, 50k, and 500k content-unit corpora;
- cold start, P50/P95 query latency, memory, and index size;
- local embedding runtime download, checksum, license, disk quota, hardware
  fallback, model removal, and offline query behavior;
- Chinese FTS tokenizer/segmentation and cross-language embedding quality;
- Library/Project/type/year/tag filtering;
- insert, revision replacement, delete, crash recovery, and full rebuild;
- model-generation switch;
- backup and restore behavior.

`sqlite-vec` aligns with the current single-file SQLite architecture but remains
pre-v1 and must not be accepted without an Electron packaging and migration
spike. LanceDB offers stronger built-in vector/hybrid features but introduces a
native sidecar directory and additional backup/compaction complexity.

The vector index is optional in backups. Canonical data and profile fingerprints
are sufficient to rebuild it only when source blobs/snapshots are present. Gate 0
therefore includes a blob manifest and visible availability/relink state; it does
not imply that the current metadata-only JSON backup already carries file bytes.

## 10. Local-first privacy

### 10.1 Local mode

- Extraction, FTS, and retrieval run offline. Embeddings also run offline after
  a supported local runtime/model has been explicitly installed.
- Without a local embedding model, search degrades visibly to
  metadata + anchored full text; it never becomes unusable.
- If no local generation model is configured, evidence search remains fully
  usable and generated synthesis is unavailable.
- No silent fallback to a remote provider.
- Idle indexing consumes no sustained CPU and performs no network access.

### 10.2 Remote BYOK mode

Remote embedding and remote generation require separate opt-in settings.

Remote embedding authorization is Library-scoped. Before the first remote index
build, the UI exposes:

- provider and model;
- number of documents and estimated text/token volume to be uploaded;
- data and source types being sent;
- whether future new/changed documents will also be embedded remotely.

Revoking authorization stops future upload. The application never silently
changes an embedding profile from local to remote. Provider errors, logs, and
telemetry may not contain raw ContentUnit text. `EmbeddingProfile` records its
`local | remote` egress mode.

Generation sends only the query and selected GroundingPack, not the whole
Library or complete documents by default. API keys remain in the OS keychain.
Embeddings are treated as sensitive derived data and follow source deletion.

ContentUnits, embeddings, retrieval diagnostics, and synthesis diagnostics are
local-only derived data by default and are not row-synced. Standard backup needs
canonical data plus source blobs; derived full text and vectors are rebuilt.
Backups that opt into derived content must apply the same encryption and access
policy as the Library. Crash dumps, error logs, and telemetry may not contain
source text, embeddings, queries, or answers.

### 10.3 Prompt-injection boundary

Source payloads are encoded as data records with generated citation IDs.
Retrieved text cannot:

- change system instructions or scope;
- request other Library/Project content;
- trigger network, file, database, Canvas, or manuscript writes;
- authorize a tool call;
- promote itself to Evidence.

All writes remain deterministic application actions that require explicit user
intent.

Gate 2 treats the following as zero-tolerance failures:

- any cross-scope disclosure;
- document-induced tool, network, file, database, Canvas, or manuscript action;
- system-prompt or API-key disclosure;
- a citation ID outside the current RetrievalRun;
- executable HTML/script, remote-image auto-loading, or unsafe link behavior in
  rendered generated output.

The attack corpus covers hidden PDF text, HTML comments, OCR images,
Unicode/Base64 obfuscation, bilingual instructions split across chunks, and
ranking manipulation. Structured packaging is only one defense; the model also
receives no write-capable tools and all output passes deterministic validation.

## 11. Deletion, revision, and merge semantics

| Operation                                     | Canonical result                                                                                                             | Retrieval/index result                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Remove/soft-delete Work/Asset                 | Source is recoverably tombstoned; dependent Evidence keeps its captured snapshot and shows source unavailable                | Excluded immediately through canonical-state validation; physical vector cleanup may be asynchronous |
| Restore source                                | Restore canonical record and validate revision                                                                               | Reuse only entries whose complete fingerprint matches; otherwise reindex                             |
| Replace document                              | Create revision and explicitly switch current revision                                                                       | Build units/index entries for the new revision; retain old provenance until policy-based cleanup     |
| Permanently erase source and captured content | Remove bytes/source records and cascade-delete bound EvidenceItems, Project memberships, ClaimEvidenceLinks, and diagnostics | Remove units, vectors, caches, jobs, and retrieval traces; reconcile orphans                         |
| Merge Works                                   | Transactionally remap memberships, assets, Evidence, Canvas references, and citations                                        | Deduplicate by revision/content hash and rebuild affected index entries                              |
| Delete Project                                | Delete Project-owned Canvas/notes/manuscripts/runs and detach Library-owned memberships                                      | Remove units only for Project-owned sources; retain shared Library Work/Asset/Evidence units         |
| Delete Canvas workspace                       | Delete Canvas snapshot only                                                                                                  | Remove that workspace's derived units; never delete Work or attachment data                          |
| Switch Library/Project                        | No mutation                                                                                                                  | Abort old work and reject any late result at the write boundary                                      |

The product exposes recoverable removal and permanent erasure as different
operations. Permanent erase never silently retains a quote, derived full-text
copy, embedding, cached answer, or diagnostic trace. Before erasure, the user may
explicitly convert selected Evidence notes into independent ResearchNotes; the
converted note is clearly detached from the erased source and does not retain its
source payload.
No empty Evidence row with source identity or hash survives permanent erasure.

Source erasure removes the erased Library/Revision's BlobStore reference
immediately. Because blobs are content-addressed and may be shared by another
Work or Library, physical byte GC occurs only after a global reference check
finds no live DocumentRevision for that SHA. Another Library's live reference is
never deleted, while the erased Library can no longer resolve or read the blob
through its scoped APIs.

## 12. Product surfaces

All modules share four components.

### 12.1 Query Context and Corpus Scope Bar

The UI distinguishes two visible concepts:

- `Query Context`: selected text, manuscript claim, or selected Canvas nodes that
  explain what the user is asking about.
- `Corpus Scope`: current document, selected documents, current Canvas, current
  Project, or whole Library—the sources that may be searched.

For example: “针对「选中的主张」· 在「项目：可解释 AI」中找反例”.

Selected Works take priority over active Library filters. At query start,
filters and allowed source IDs become an immutable CorpusScopeSnapshot. Changing
selection, filters, Project, Canvas, or document cancels the old query. A
Whole-Library choice is session-local and never silently follows the user into
Reader or Canvas.

The bar reports human-scale document status such as
`12/15 documents searchable · 2 processing · 1 failed`; ContentUnit counts stay
inside diagnostics. A status popover distinguishes waiting, extracting, needs
OCR, unsupported format, missing source, and failed index.

### 12.2 Evidence Result Card

Displays original text first, plus:

- Work title, author, and year;
- page/section/block;
- source and authority type;
- whether the match came from exact/full-text or semantic retrieval;
- context-appropriate actions.

Search results use `Open context` and `Add to shelf` as primary actions. Text the
user selected directly in Reader can use `Save Evidence` immediately because it
is already being inspected in context. `Add to Canvas` or `Use in writing`
cannot bypass confirmation: when the source is not yet Evidence, the preview and
commit flow explicitly creates it.

Opening context prefers a split Reader/drawer and preserves query position,
Shelf selection, result focus, and the Reader's previous location.

### 12.3 Evidence Shelf

Temporary recommended results enter a shelf before becoming durable Evidence:

```text
retrieve -> stage -> verify in context -> save Evidence
```

Saving may add a question/claim, EvidenceKind, tags, and target Project. If it
links to a specific claim, ClaimEvidenceRelation is selected separately.

The Shelf is Project-local persisted staging, not canonical Evidence. It survives
navigation and app restart, is excluded from RAG authority, and is removed when
the user clears it or deletes the Project. Each candidate stores source revision
and content hash; a changed source requires re-verification. Retrieval collapses
the same source paragraph, Annotation, and saved Evidence into one card with
badges instead of showing duplicate hits.

Library-wide or no-Project searches may save confirmed items directly to the
Library Evidence Inbox. Their first `Add to shelf` action opens a lightweight
target-Project selector; a Shelf candidate is never created without an explicit
Project.

### 12.4 Cited Answer

RAG output is rendered as inspectable claim blocks, not opaque chat bubbles.
Each block exposes its supporting quotes and one source-coverage state:

- multiple supporting sources found;
- only partially relevant sources found;
- sources disagree;
- insufficient material found in the current scope.

These states describe coverage inside the selected corpus; they do not certify a
claim as academically true. Saving first creates a SynthesisDraft. A visible
review/edit action may convert it to an AI-assisted ResearchNote while retaining
origin metadata. It never creates Evidence.

### 12.5 Module entry points

| Module           | Query Context               | Default Corpus Scope                 | Initial capability                                                             |
| ---------------- | --------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| Library          | query or selected Works     | selected Works, else active filters  | unified metadata/full-text/semantic search; stage Evidence                     |
| Universal Reader | selected text, when present | current document                     | related evidence, contrary evidence, save selection as Evidence                |
| Canvas           | selected nodes              | current workspace or current Project | compare/synthesize; preview suggested Evidence and nodes before confirmation   |
| Writing          | selected manuscript claim   | current Project                      | find support, counter-evidence, and missing citations; bind confirmed Evidence |

### 12.6 Source authority defaults

Being indexed does not mean participating in retrieval by default:

| Source                             |         Indexed         | Default retrieval  | Eligible for grounding |
| ---------------------------------- | :---------------------: | :----------------: | :--------------------: |
| Published/captured source document |           yes           |        yes         |          yes           |
| User Annotation                    |           yes           |        yes         | yes, labeled user note |
| EvidenceItem                       |           yes           | merged with source |          yes           |
| ResearchNote                       |           yes           |         no         |  explicit opt-in only  |
| Manuscript draft                   |           yes           |         no         |  explicit opt-in only  |
| SynthesisDraft                     | optional for finding it |         no         |    never by default    |

### 12.7 Revision and failure states

Evidence and results expose one of:

- source is the current revision;
- Evidence refers to a historical revision;
- a re-anchoring candidate awaits confirmation;
- the original source is unavailable or permanently erased.

Users can view the captured snapshot, compare revisions side by side, confirm a
new anchor, retain the historical anchor, or remove the Evidence. Failure never
silently redirects an old anchor to a new document location.

Default source-document retrieval includes only current-revision ContentUnits.
Historical Evidence remains discoverable in Evidence Inbox and in searches that
explicitly include Evidence, with a historical-version badge. Until the user
re-verifies it, historical Evidence is excluded from GroundingPack by default
and is not counted as a stale source-document hit.

Gate 1A/1B UI also covers: empty Project, partial indexing, encrypted PDF, OCR
required, unsupported format, missing blob, local model not installed, embedding
failure with FTS fallback, paused/failed jobs, semantic no-result with keyword
results, offline remote provider, and quota failure. A generation failure keeps
the already retrieved source cards.

## 13. Package ownership

- `packages/core`: ResearchProject, DocumentAsset/Revision, SourceAnchor,
  EvidenceItem, authority and scope domain types.
- `packages/reader`: format adapters and stable structural extraction contracts.
- `packages/knowledge` (new): content-unit construction, job orchestration
  contracts, retrieval, rank fusion, GroundingPack construction, and trusted RAG
  orchestration.
- `packages/ai`: EmbeddingProvider, optional Reranker, and generation providers.
- `packages/db`: schema, migrations, scoped repositories, FTS, and durable jobs.
- `packages/platform`: worker/storage capabilities required by knowledge adapters.
- `apps/desktop`: Electron worker/utility-process implementation, IPC, progress
  reporting, and product UI.

Shared packages must not depend on Electron. The renderer never opens the
database or vector files directly.

## 14. Delivery plan and release gates

### Gate 0 — ownership and provenance

Deliver:

- explicit Library ownership, raw-SQL audit, scoped Repository/main-process
  commands, and atomic mutation/outbox UnitOfWork;
- ResearchProject plus create, switch, rename/archive, and source-membership UI;
- DocumentAsset/Revision plus BlobStore manifest and availability/relink state;
- SourceAnchor, text EvidenceItem, minimal Reader “Save Evidence”, and
  Evidence Inbox;
- attachment/Snippet compatibility migration;
- separate recoverable removal and permanent-erasure workflows;
- deletion, replacement, merge, migration, backup, and sync tests.

Release criteria:

- zero cross-Library results or writes;
- replacing a PDF cannot silently move old annotations;
- every EvidenceItem opens the intended source revision or explicitly reports
  that its original revision is unavailable;
- legacy database upgrade preserves identifiers, blob SHA, Work—Attachment—
  Annotation—Canvas—Snippet relationships, and anchor behavior;
- Library backfill has no null owner and failure rolls back completely;
- permanent erasure leaves no source payload, ContentUnit, embedding, quote
  snapshot, cached answer, or diagnostic record.

### Gate 1A — Anchored Full-text Search

Deliver:

- structural ContentUnits and full-text FTS;
- durable extraction/indexing jobs;
- MetadataRetriever for normalized identifiers and bibliographic fields;
- Query Context/Corpus Scope Bar, Evidence Result Card, and Evidence Shelf;
- scoped metadata + anchored full-text retrieval without embeddings or
  generation;
- initial format slice: born-digital PDF text, PDF annotations, and text
  Evidence.

Release criteria:

- DOI/arXiv/PMID/ISBN exact identifier Hit@1 = 100%;
- unique full-title Hit@1 >= 99%;
- author/topic retrieval is evaluated with Recall@K and nDCG rather than a
  misleading unique Top-1 requirement;
- SourceAnchor open success >= 99.5% for the supported PDF slice;
- zero deleted, non-current default-retrieval, or out-of-scope hits;
- historical provenance may open an explicitly labeled old revision but is
  never silently redirected;
- search, Evidence staging, and exact-source opening work with all network
  access disabled.

### Gate 1B — Semantic Hybrid Search

Entry condition:

- local embedding runtime/model and VectorStore packaging spikes pass on
  supported desktop platforms;
- Chinese full-text tokenizer/segmentation and bilingual embedding benchmark are
  selected and versioned.

Deliver:

- EmbeddingProvider and VectorStore adapters;
- generation-based index rebuild;
- scoped hybrid retrieval without generation.

Release criteria:

- same-language semantic Recall@10 >= 90% on the maintained benchmark;
- cross-language Recall@10 >= 82%;
- same-language nDCG@10 >= 0.80 and cross-language nDCG@10 >= 0.72;
- multi-document evidence Recall@20 >= 0.80;
- zero deleted, non-current default-retrieval, or out-of-scope hits in every
  VectorStore adapter contract test;
- provisional 50k-unit warm hybrid-search P95 target < 500 ms on the documented
  reference machine; the benchmark records dimensions, average unit length,
  filter selectivity, cold/warm cache, concurrent indexing, and whether query
  embedding/reranking is included;
- if semantic indexing is unavailable, the product visibly falls back to Gate
  1A rather than failing search.

### Gate 2 — Ask Current Document

Deliver:

- GroundingPack and service-validated citations;
- insufficient-evidence and conflicting-evidence states;
- prompt-injection regression suite;
- optional generation while search remains independent.

Release criteria:

- Citation ID and SourceAnchor resolution = 100%;
- claim-level citation precision target >= 97%;
- factual-claim citation coverage >= 90%;
- unsupported factual-claim rate <= 2%;
- fabricated Works, DOI, or sources: zero;
- no-answer correct refusal target >= 95%;
- answerable-query false-refusal rate <= 10%;
- conflicting-source cases show the principal opposing evidence >= 90%;
- zero prompt-injection boundary failures defined in section 10.3;
- an ignored cancellation cannot produce a durable stale result.

### Gate 3A — Compare and Ask Project

Deliver:

- multi-document compare and synthesis;
- Ask Project;
- saved SynthesisDrafts and reviewed ResearchNotes.

Release criteria:

- cross-scope leakage remains zero across the full security and concurrency
  suite;
- multi-document Recall@20, claim citation coverage, conflict presentation, and
  no-answer criteria continue to meet Gate 1B/2;
- near-duplicate chunks from one document cannot crowd out necessary source
  diversity;
- scope changes cancel the old run and prevent durable late writes.

### Gate 3B — Explicit Ask Library

Whole-Library synthesis ships only after measured user demand and after security,
quality, latency, and source-diversity tests pass at full-Library scale. This
scope is always explicitly selected and session-local.

### Gate 4A — Canvas suggestions

Deliver:

- selected-node retrieval and comparison;
- suggested Evidence/ghost nodes requiring preview and confirmation.

Release criteria:

- suggestions never mutate Canvas or create formal relationships without an
  explicit preview-and-commit action;
- committed actions are undoable and retain provenance;
- stale selection/workspace requests cannot create nodes.

### Writing foundation — independent prerequisite

Structured Manuscript blocks, ordinary ManuscriptCitation, DOCX round-trip, and
ClaimEvidenceLink are a separate writing product foundation. They do not wait for
RAG and are not hidden inside a Knowledge Layer integration PR.

### Gate 4B — Writing evidence suggestions

Deliver:

- support, counter-evidence, and missing-citation workflows.

Release criteria:

- suggestions never mutate manuscript content without an explicit
  preview-and-commit action;
- committed writes are undoable and retain model/source provenance;
- a ClaimEvidenceLink round-trips
  Manuscript -> Evidence -> SourceRevision/SourceAnchor;
- an ordinary ManuscriptCitation round-trips Manuscript -> Work and optional
  locator without requiring Evidence;
- DOCX export renders citations from structured bindings rather than generated
  citation text.

### Gate 5 — graph expansion

First use verified citation edges and user-confirmed Canvas relationships as an
optional candidate expansion step. Full entity/claim GraphRAG is considered only
when the evaluation suite demonstrates a material improvement over hybrid
retrieval that justifies indexing cost and review complexity.

The initial decision threshold is a >=5 percentage-point gain on a
graph-dependent held-out retrieval slice without breaking the agreed latency,
cost, or human-review budget. Citation graph data must gain explicit provider,
freshness, and provenance semantics before it can become trusted graph input.

## 15. Evaluation and CI

Maintain two bilingual datasets:

- visible development set for tuning and pull-request regression;
- held-out release set to prevent tuning directly to test answers.

The first complete benchmark contains at least 360 human-reviewed quality
queries and 120 isolation, deletion, concurrency, and prompt-injection cases.
Core labels receive two independent human reviews plus adjudication. Synthetic
queries may extend stress coverage but cannot alone decide release.

The corpus covers at least four disciplines and separate slices for Chinese
query/Chinese source, English/English, Chinese/English, English/Chinese, and
mixed terminology. It also covers exact identifiers, semantic paraphrases,
comparison, no-answer cases, deletion, revisions, scope attacks, and prompt
injection.

Format gates are incremental:

- Gate 1A/1B requires the declared PDF/annotation/Evidence slice only;
- OCR PDF, HTML, Markdown, DOCX, Canvas, and Manuscript slices become blocking
  when their format adapters enter a release Gate;
- unsupported formats are visible rather than silently omitted.

Every sample records:

- permitted scope;
- relevant ContentUnits and exact SourceAnchors;
- minimum facts needed for an answer;
- acceptable citations;
- whether the system must refuse;
- whether sources conflict.

Each benchmark record also pins extractor, chunker, embedding profile,
VectorStore, fusion weights, reranker, prompt, generator, and dataset versions.

CI levels:

- every PR: unit/scoping tests and a small fixed golden set;
- nightly: complete retrieval, safety, deletion, and concurrency set;
- provider/chunker/model/reranker/prompt changes: full benchmark;
- release: held-out evaluation, offline test, performance baseline, migration,
  backup/restore, and human citation review.

Retrieval and generation are scored separately. Overall averages may not hide a
regression in a language, discipline, format, or scope slice. A drop greater than
three percentage points from the released baseline in any primary slice blocks
release. Security, isolation, deletion, and citation-identity checks require
100%; they have no regression budget. LLM judges may track trends but cannot
replace human citation-support review.

Performance reports use fixed 5k, 50k, and 500k ContentUnit corpora and document
the reference CPU, memory, OS, model, dimensions, text-length distribution,
filter selectivity, and index state. They report cold/warm P50/P95/P99 over at
least 1,000 fixed queries, peak memory, disk growth, and degradation during
background indexing. UI input feedback targets <=100 ms, cancellation feedback
<=200 ms with zero durable late writes, and no renderer main-thread task longer
than 50 ms attributable to indexing.

## 16. Initial vertical slice

The first user-visible milestone ships in two compatible increments:

1. Create or open a Research Project.
2. Add Library Works to the Project.
3. Index born-digital PDF text, annotations, and text Evidence locally.
4. Gate 1A: search metadata and anchored full text within the Project.
5. See indexing coverage and source authority.
6. Open a result at the exact source position.
7. Stage and confirm it as Evidence.
8. Remove or replace a source and observe immediate, correct retrieval behavior.
9. Rebuild the complete index from canonical data.
10. Gate 1B: install a supported local embedding profile and add semantic intent
    to the same search UI; FTS fallback remains available.

It intentionally contains no answer-generation UI. This milestone proves that
AuraScholar can retrieve trustworthy research evidence before a model is
allowed to synthesize it.

## 17. Pull-request sequence

Each PR has one primary purpose and follows the repository build, typecheck,
lint, and test requirements.

1. `docs: define research knowledge layer architecture`
2. `feat(db): scope research data by library`
3. `feat(desktop): enforce scoped data commands`
4. `feat(core): add research projects and source membership`
5. `feat(desktop): add project management`
6. `feat(core): add document revisions and evidence`
7. `feat(desktop): add evidence inbox and source recovery`
8. `feat(knowledge): extract anchored content units`
9. `feat(knowledge): add durable indexing jobs`
10. `feat(knowledge): implement anchored full-text retrieval`
11. `feat(desktop): add evidence search workspace`
12. `feat(knowledge): add scoped semantic retrieval`
13. `feat(ai): add evidence-grounded document synthesis`
14. `feat(desktop): integrate knowledge tools with canvas`
15. `feat(desktop): bind manuscript claims to evidence`

Database work is split into migrations beginning after the current schema
version 16. Each migration is tested for:

- clean installation;
- representative upgrades from older versions;
- repeat execution/idempotence where applicable;
- transaction rollback on failure;
- foreign-key integrity;
- blob availability and unchanged SHA;
- Work—Attachment—Annotation—Canvas—Snippet relationship integrity;
- Library backfill completeness and Library-scoped uniqueness behavior;
- PDF anchor location on the regression corpus;
- backup import and identifier remapping;
- sync table/field coverage;
- unchanged canonical record counts unless the migration explicitly documents a
  transformation.

## 18. Decision log

| Decision                     | Default                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Primary working scope        | Research Project                                                             |
| Project membership           | Work/logical Asset; current revision searched, historical Evidence preserved |
| Whole-Library search         | Explicit opt-in per query/session                                            |
| First product                | Anchored full-text evidence search, followed by semantic hybrid search       |
| First indexed sources        | Born-digital PDF text, annotations, text Evidence                            |
| Notes/manuscript retrieval   | Indexed later; excluded by default and clearly labeled                       |
| Generated content authority  | Non-authoritative by default                                                 |
| Recoverable source removal   | Evidence snapshot retained and marked unavailable                            |
| Permanent erasure            | Source payload and every captured/derived copy removed                       |
| Index sync                   | Rebuild locally; do not sync initially                                       |
| Embedding mode               | Local preferred after spike; remote embedding separately authorized          |
| Vector engine                | Adapter plus benchmark; no engine committed in this RFC                      |
| GraphRAG                     | Deferred until measured need                                                 |
| Bibliographic citation       | Work + optional locator; Evidence not required                               |
| Claim-to-evidence provenance | ClaimEvidenceLink to EvidenceItem + canonical SourceAnchor                   |

## 19. Open implementation decisions

The following are decided by focused implementation spikes without changing the
invariants above:

- extend `attachments` as physical revisions or introduce a new physical
  `document_revisions` table immediately;
- SQLite exact scan / `sqlite-vec` versus LanceDB for the first vector adapter;
- local embedding runtime and bilingual model profile;
- Chinese full-text tokenizer/segmentation profile;
- exact schema for typed Project join tables versus a future strongly keyed
  canonical-source registry;
- whether non-text Evidence payloads first store a blob region snapshot or only
  a reproducible source-region descriptor.

## 20. References

- Lewis et al., [Retrieval-Augmented Generation for Knowledge-Intensive NLP
  Tasks](https://arxiv.org/abs/2005.11401)
- Es et al., [RAGAS: Automated Evaluation of Retrieval Augmented
  Generation](https://arxiv.org/abs/2309.15217)
- [Microsoft GraphRAG methods](https://microsoft.github.io/graphrag/index/methods/)
- [sqlite-vec](https://github.com/asg017/sqlite-vec)
- [LanceDB quickstart](https://docs.lancedb.com/quickstart)
- [OWASP Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [OWASP Vector and Embedding
  Weaknesses](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/)
