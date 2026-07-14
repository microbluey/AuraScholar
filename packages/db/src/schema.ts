import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Convention: UUIDv7 string PKs (time-ordered, sync-friendly). Timestamps are
// epoch milliseconds. deleted_at is a soft-delete tombstone required by the
// sync engine — hard deletes only happen during snapshot compaction.

const id = () => text("id").primaryKey();
const createdAt = () => integer("created_at").notNull();
const updatedAt = () => integer("updated_at").notNull();
const deletedAt = () => integer("deleted_at");

// A logical local-first library/vault. The local app can run without an
// account; later cloud accounts attach to libraries through memberships.
export const libraries = sqliteTable("libraries", {
  id: id(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("personal"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

// ---------------------------------------------------------------------------
// Works (papers / preprints / book chapters)
// ---------------------------------------------------------------------------

export const works = sqliteTable(
  "works",
  {
    id: id(),
    doi: text("doi"),
    title: text("title").notNull(),
    abstract: text("abstract"),
    year: integer("year"),
    publicationDate: text("publication_date"), // ISO date when known
    venueName: text("venue_name"),
    venueType: text("venue_type"), // journal | conference | repository | book
    type: text("type").notNull().default("article"), // article | preprint | book-chapter | ...
    arxivId: text("arxiv_id"),
    openalexId: text("openalex_id"),
    s2Id: text("s2_id"),
    pmid: text("pmid"),
    // Normalized title+year+first-author hash for dedup when no DOI exists.
    fingerprint: text("fingerprint"),
    // Full CSL-JSON metadata — source of truth for citation formatting/export.
    cslJson: text("csl_json", { mode: "json" }),
    // Rich bibliographic fields (EndNote-style, CSL-aligned). See migration v6.
    volume: text("volume"),
    issue: text("issue"),
    pages: text("pages"),
    numberOfVolumes: text("number_of_volumes"),
    edition: text("edition"),
    section: text("section"),
    publisher: text("publisher"),
    placePublished: text("place_published"),
    seriesTitle: text("series_title"),
    shortTitle: text("short_title"),
    originalTitle: text("original_title"),
    issn: text("issn"),
    isbn: text("isbn"),
    url: text("url"),
    accessedDate: text("accessed_date"),
    language: text("language"),
    callNumber: text("call_number"),
    accessionNumber: text("accession_number"),
    label: text("label"),
    databaseName: text("database_name"),
    // Author/index keywords as a JSON string array.
    keywordsJson: text("keywords_json", { mode: "json" }),
    readingStatus: text("reading_status").notNull().default("unread"), // unread | reading | read
    starred: integer("starred", { mode: "boolean" }).notNull().default(false),
    notesMd: text("notes_md"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("works_doi_uq").on(t.doi),
    index("works_fingerprint_idx").on(t.fingerprint),
    index("works_arxiv_idx").on(t.arxivId),
    index("works_openalex_idx").on(t.openalexId),
    index("works_s2_idx").on(t.s2Id),
    index("works_pmid_idx").on(t.pmid),
    index("works_year_idx").on(t.year),
  ],
);

export const authors = sqliteTable(
  "authors",
  {
    id: id(),
    displayName: text("display_name").notNull(),
    orcid: text("orcid"),
    openalexId: text("openalex_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex("authors_orcid_uq").on(t.orcid)],
);

export const workAuthors = sqliteTable(
  "work_authors",
  {
    workId: text("work_id")
      .notNull()
      .references(() => works.id),
    authorId: text("author_id")
      .notNull()
      .references(() => authors.id),
    position: integer("position").notNull(),
    isCorresponding: integer("is_corresponding", { mode: "boolean" }).notNull().default(false),
    rawName: text("raw_name"), // name as it appeared on the paper
    role: text("role").notNull().default("author"), // author | editor | translator
  },
  (t) => [primaryKey({ columns: [t.workId, t.authorId] })],
);

// Attachments are content-addressed: the PDF bytes live at
// blobs/<sha256[0..2]>/<sha256>.pdf, never inside the database.
export const attachments = sqliteTable(
  "attachments",
  {
    id: id(),
    workId: text("work_id")
      .notNull()
      .references(() => works.id),
    kind: text("kind").notNull().default("pdf"), // pdf | supplement
    sha256: text("sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    originalFilename: text("original_filename"),
    sourceUrl: text("source_url"),
    fetchedVia: text("fetched_via"), // unpaywall | arxiv | openalex | manual
    pageCount: integer("page_count"),
    textExtractedAt: integer("text_extracted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("attachments_work_idx").on(t.workId), index("attachments_sha_idx").on(t.sha256)],
);

// ---------------------------------------------------------------------------
// Organization: collections (hierarchical) and tags
// ---------------------------------------------------------------------------

export const collections = sqliteTable("collections", {
  id: id(),
  name: text("name").notNull(),
  parentId: text("parent_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

export const collectionItems = sqliteTable(
  "collection_items",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id),
    workId: text("work_id")
      .notNull()
      .references(() => works.id),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.workId] })],
);

export const tags = sqliteTable(
  "tags",
  {
    id: id(),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex("tags_name_uq").on(t.name)],
);

export const workTags = sqliteTable(
  "work_tags",
  {
    workId: text("work_id")
      .notNull()
      .references(() => works.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.workId, t.tagId] })],
);

// ---------------------------------------------------------------------------
// Annotations (reader) — anchor_json holds the multi-level selector set:
// quadpoints (fast path), TextQuote (robust), TextPosition (search hint).
// ---------------------------------------------------------------------------

export const annotations = sqliteTable(
  "annotations",
  {
    id: id(),
    attachmentId: text("attachment_id")
      .notNull()
      .references(() => attachments.id),
    workId: text("work_id")
      .notNull()
      .references(() => works.id),
    type: text("type").notNull(), // highlight | underline | strikeout | ink | note | comment
    color: text("color"),
    pageIndex: integer("page_index").notNull(),
    anchorJson: text("anchor_json", { mode: "json" }),
    contentMd: text("content_md"),
    inkPathsJson: text("ink_paths_json", { mode: "json" }), // normalized 0..1 page coords
    // page_index*1e6 + first rect top — single sortable key for sidebar lists.
    sortKey: real("sort_key").notNull().default(0),
    orphaned: integer("orphaned", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("annotations_attachment_idx").on(t.attachmentId, t.sortKey)],
);

export const annotationComments = sqliteTable(
  "annotation_comments",
  {
    id: id(),
    annotationId: text("annotation_id")
      .notNull()
      .references(() => annotations.id),
    contentMd: text("content_md").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("annotation_comments_annotation_idx").on(t.annotationId)],
);

// Writing snippets: excerpts/quotes the user collects while reading, for later
// reuse in writing. Unlike annotations (anchored to PDF coordinates), a snippet
// is just captured text + an optional note, traceable back to its work/page.
export const snippets = sqliteTable(
  "snippets",
  {
    id: id(),
    workId: text("work_id")
      .notNull()
      .references(() => works.id),
    pageIndex: integer("page_index"),
    quote: text("quote").notNull(),
    noteMd: text("note_md"),
    tag: text("tag"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("snippets_work_idx").on(t.workId, t.createdAt)],
);

// Saved searches ("检索订阅"): a stored open-source aggregate query re-run on a
// schedule to surface newly-published matches. seenIdsJson is the baseline set
// of stable ids observed last run; anything new on the next run bumps newCount.
export const savedSearches = sqliteTable(
  "saved_searches",
  {
    id: id(),
    query: text("query").notNull(),
    sourcesJson: text("sources_json"),
    seenIdsJson: text("seen_ids_json").notNull().default("[]"),
    newCount: integer("new_count").notNull().default(0),
    lastRunAt: integer("last_run_at"),
    nextRunAt: integer("next_run_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("saved_searches_due_idx").on(t.nextRunAt)],
);

// ---------------------------------------------------------------------------
// Flashcards + FSRS spaced-repetition state
// ---------------------------------------------------------------------------

export const flashcards = sqliteTable(
  "flashcards",
  {
    id: id(),
    workId: text("work_id")
      .notNull()
      .references(() => works.id),
    frontMd: text("front_md").notNull(),
    backMd: text("back_md").notNull(),
    cardType: text("card_type").notNull().default("qa"), // tldr | contribution | method | qa | limitation
    source: text("source").notNull().default("manual"), // ai | manual
    aiModel: text("ai_model"),
    generationId: text("generation_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("flashcards_work_idx").on(t.workId)],
);

export const flashcardSrs = sqliteTable("flashcard_srs", {
  flashcardId: text("flashcard_id")
    .primaryKey()
    .references(() => flashcards.id),
  dueAt: integer("due_at").notNull(),
  stability: real("stability").notNull().default(0),
  difficulty: real("difficulty").notNull().default(0),
  reps: integer("reps").notNull().default(0),
  lapses: integer("lapses").notNull().default(0),
  state: integer("state").notNull().default(0), // ts-fsrs State enum
  lastReviewAt: integer("last_review_at"),
});

export const flashcardReviews = sqliteTable(
  "flashcard_reviews",
  {
    id: id(),
    flashcardId: text("flashcard_id")
      .notNull()
      .references(() => flashcards.id),
    rating: integer("rating").notNull(), // ts-fsrs Rating enum
    reviewedAt: integer("reviewed_at").notNull(),
    elapsedDays: real("elapsed_days").notNull().default(0),
  },
  (t) => [index("flashcard_reviews_card_idx").on(t.flashcardId)],
);

// ---------------------------------------------------------------------------
// Citation graph
// ---------------------------------------------------------------------------

export const citations = sqliteTable(
  "citations",
  {
    citingWorkId: text("citing_work_id").notNull(),
    citedWorkId: text("cited_work_id").notNull(),
    source: text("source").notNull().default("openalex"), // openalex | s2 | crossref
  },
  (t) => [primaryKey({ columns: [t.citingWorkId, t.citedWorkId] })],
);

export const graphCache = sqliteTable("graph_cache", {
  workId: text("work_id").primaryKey(),
  payloadJson: text("payload_json", { mode: "json" }).notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});

// ---------------------------------------------------------------------------
// Indexing sentinel — tracks accept → online → in_issue → indexed.
// evidence_json on events stores raw API snapshots usable as proof material.
// ---------------------------------------------------------------------------

export const sentinelTasks = sqliteTable(
  "sentinel_tasks",
  {
    id: id(),
    workId: text("work_id").references(() => works.id),
    doi: text("doi"),
    title: text("title").notNull(),
    currentState: text("current_state").notNull().default("accepted"),
    // JSON array of milestones the user cares about: ["online","in_issue","indexed_openalex",...]
    targetFlags: text("target_flags", { mode: "json" }),
    pollIntervalS: integer("poll_interval_s").notNull().default(86400),
    nextPollAt: integer("next_poll_at").notNull(),
    lastPolledAt: integer("last_polled_at"),
    errorCount: integer("error_count").notNull().default(0),
    lastError: text("last_error"),
    status: text("status").notNull().default("active"), // active | paused | done
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("sentinel_next_poll_idx").on(t.status, t.nextPollAt)],
);

export const sentinelEvents = sqliteTable(
  "sentinel_events",
  {
    id: id(),
    taskId: text("task_id")
      .notNull()
      .references(() => sentinelTasks.id),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    evidenceJson: text("evidence_json", { mode: "json" }),
    detectedAt: integer("detected_at").notNull(),
    notifiedAt: integer("notified_at"),
  },
  (t) => [index("sentinel_events_task_idx").on(t.taskId)],
);

// ---------------------------------------------------------------------------
// Sync engine — append-only change log with per-field HLC timestamps (LWW).
// ---------------------------------------------------------------------------

export const syncLog = sqliteTable(
  "sync_log",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    libraryId: text("library_id"),
    entityTable: text("entity_table").notNull(),
    entityId: text("entity_id").notNull(),
    op: text("op").notNull(), // upsert | delete
    // Full row values at write time; older databases may have null here until
    // all repo mutations are routed through the logging layer.
    valuesJson: text("values_json", { mode: "json" }),
    // { fieldName: hlcString } — per-field clocks for last-writer-wins merge.
    columnHlcsJson: text("column_hlcs_json", { mode: "json" }),
    hlc: text("hlc").notNull(),
    deviceId: text("device_id").notNull(),
    createdAt: integer("created_at"),
    syncedAt: integer("synced_at"),
  },
  (t) => [
    index("sync_log_entity_idx").on(t.entityTable, t.entityId),
    index("sync_log_library_seq_idx").on(t.libraryId, t.seq),
  ],
);

export const syncState = sqliteTable("sync_state", {
  providerId: text("provider_id").primaryKey(),
  libraryId: text("library_id"),
  lastPushedSeq: integer("last_pushed_seq").notNull().default(0),
  lastPulledCursor: text("last_pulled_cursor"),
  remoteConfigJson: text("remote_config_json", { mode: "json" }),
});

export const devices = sqliteTable("devices", {
  deviceId: text("device_id").primaryKey(),
  name: text("name").notNull(),
  platform: text("platform").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
});

export const syncRowClocks = sqliteTable(
  "sync_row_clocks",
  {
    tableName: text("table_name").notNull(),
    rowId: text("row_id").notNull(),
    libraryId: text("library_id"),
    columnHlcsJson: text("column_hlcs_json", { mode: "json" }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tableName, t.rowId] }),
    index("sync_row_clocks_library_idx").on(t.libraryId, t.tableName),
  ],
);

export const blobSyncState = sqliteTable(
  "blob_sync_state",
  {
    sha256: text("sha256").notNull(),
    providerId: text("provider_id").notNull(),
    libraryId: text("library_id"),
    status: text("status").notNull().default("pending"),
    remotePath: text("remote_path"),
    uploadedAt: integer("uploaded_at"),
    downloadedAt: integer("downloaded_at"),
    error: text("error"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.sha256, t.providerId] }),
    index("blob_sync_state_library_idx").on(t.libraryId, t.status),
  ],
);

// ---------------------------------------------------------------------------
// AI jobs, settings, CV profiles
// ---------------------------------------------------------------------------

export const aiJobs = sqliteTable(
  "ai_jobs",
  {
    id: id(),
    kind: text("kind").notNull(), // flashcards | summary | ...
    workId: text("work_id").references(() => works.id),
    status: text("status").notNull().default("pending"), // pending | running | done | error
    model: text("model"),
    promptVersion: text("prompt_version"),
    resultJson: text("result_json", { mode: "json" }),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ai_jobs_status_idx").on(t.status)],
);

export const derivedArtifacts = sqliteTable(
  "derived_artifacts",
  {
    id: id(),
    libraryId: text("library_id"),
    sourceTable: text("source_table").notNull(),
    sourceId: text("source_id").notNull(),
    kind: text("kind").notNull(),
    model: text("model"),
    promptHash: text("prompt_hash"),
    inputHash: text("input_hash"),
    payloadJson: text("payload_json", { mode: "json" }).notNull(),
    localOnly: integer("local_only", { mode: "boolean" }).notNull().default(false),
    syncable: integer("syncable", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    expiresAt: integer("expires_at"),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("derived_artifacts_source_idx").on(t.sourceTable, t.sourceId, t.kind),
    index("derived_artifacts_library_idx").on(t.libraryId, t.kind),
  ],
);

// API keys never live here — desktop uses the OS keychain, web uses
// WebCrypto-encrypted storage. This table is for non-secret preferences only.
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json", { mode: "json" }),
  scope: text("scope").notNull().default("local"), // local | sync
  updatedAt: integer("updated_at"),
});

export const cvProfiles = sqliteTable("cv_profiles", {
  id: id(),
  displayName: text("display_name").notNull(),
  bioMd: text("bio_md"),
  sectionsJson: text("sections_json", { mode: "json" }),
  theme: text("theme").notNull().default("dawn-minimal"),
  lastPublishedAt: integer("last_published_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});
