// Schema DDL v1 — must stay in sync with schema.ts (the Drizzle definitions
// are the typed view; this is the executable source for migrations).
export const DDL_V1 = `
CREATE TABLE IF NOT EXISTS works (
  id TEXT PRIMARY KEY,
  doi TEXT,
  title TEXT NOT NULL,
  abstract TEXT,
  year INTEGER,
  publication_date TEXT,
  venue_name TEXT,
  venue_type TEXT,
  type TEXT NOT NULL DEFAULT 'article',
  arxiv_id TEXT,
  openalex_id TEXT,
  s2_id TEXT,
  pmid TEXT,
  fingerprint TEXT,
  csl_json TEXT,
  reading_status TEXT NOT NULL DEFAULT 'unread',
  starred INTEGER NOT NULL DEFAULT 0,
  notes_md TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS works_doi_uq ON works(doi) WHERE doi IS NOT NULL;
CREATE INDEX IF NOT EXISTS works_fingerprint_idx ON works(fingerprint);
CREATE INDEX IF NOT EXISTS works_year_idx ON works(year);

CREATE TABLE IF NOT EXISTS authors (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  orcid TEXT,
  openalex_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS authors_orcid_uq ON authors(orcid) WHERE orcid IS NOT NULL;

CREATE TABLE IF NOT EXISTS work_authors (
  work_id TEXT NOT NULL REFERENCES works(id),
  author_id TEXT NOT NULL REFERENCES authors(id),
  position INTEGER NOT NULL,
  is_corresponding INTEGER NOT NULL DEFAULT 0,
  raw_name TEXT,
  PRIMARY KEY (work_id, author_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id),
  kind TEXT NOT NULL DEFAULT 'pdf',
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  original_filename TEXT,
  source_url TEXT,
  fetched_via TEXT,
  page_count INTEGER,
  text_extracted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS attachments_work_idx ON attachments(work_id);
CREATE INDEX IF NOT EXISTS attachments_sha_idx ON attachments(sha256);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id),
  work_id TEXT NOT NULL REFERENCES works(id),
  PRIMARY KEY (collection_id, work_id)
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_uq ON tags(name);

CREATE TABLE IF NOT EXISTS work_tags (
  work_id TEXT NOT NULL REFERENCES works(id),
  tag_id TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (work_id, tag_id)
);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  attachment_id TEXT NOT NULL REFERENCES attachments(id),
  work_id TEXT NOT NULL REFERENCES works(id),
  type TEXT NOT NULL,
  color TEXT,
  page_index INTEGER NOT NULL,
  anchor_json TEXT,
  content_md TEXT,
  ink_paths_json TEXT,
  sort_key REAL NOT NULL DEFAULT 0,
  orphaned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS annotations_attachment_idx ON annotations(attachment_id, sort_key);

CREATE TABLE IF NOT EXISTS annotation_comments (
  id TEXT PRIMARY KEY,
  annotation_id TEXT NOT NULL REFERENCES annotations(id),
  content_md TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS annotation_comments_annotation_idx ON annotation_comments(annotation_id);

CREATE TABLE IF NOT EXISTS flashcards (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id),
  front_md TEXT NOT NULL,
  back_md TEXT NOT NULL,
  card_type TEXT NOT NULL DEFAULT 'qa',
  source TEXT NOT NULL DEFAULT 'manual',
  ai_model TEXT,
  generation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS flashcards_work_idx ON flashcards(work_id);

CREATE TABLE IF NOT EXISTS flashcard_srs (
  flashcard_id TEXT PRIMARY KEY REFERENCES flashcards(id),
  due_at INTEGER NOT NULL,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0,
  last_review_at INTEGER
);

CREATE TABLE IF NOT EXISTS flashcard_reviews (
  id TEXT PRIMARY KEY,
  flashcard_id TEXT NOT NULL REFERENCES flashcards(id),
  rating INTEGER NOT NULL,
  reviewed_at INTEGER NOT NULL,
  elapsed_days REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS flashcard_reviews_card_idx ON flashcard_reviews(flashcard_id);

CREATE TABLE IF NOT EXISTS citations (
  citing_work_id TEXT NOT NULL,
  cited_work_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'openalex',
  PRIMARY KEY (citing_work_id, cited_work_id)
);

CREATE TABLE IF NOT EXISTS graph_cache (
  work_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sentinel_tasks (
  id TEXT PRIMARY KEY,
  work_id TEXT REFERENCES works(id),
  doi TEXT,
  title TEXT NOT NULL,
  current_state TEXT NOT NULL DEFAULT 'accepted',
  target_flags TEXT,
  poll_interval_s INTEGER NOT NULL DEFAULT 86400,
  next_poll_at INTEGER NOT NULL,
  last_polled_at INTEGER,
  error_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS sentinel_next_poll_idx ON sentinel_tasks(status, next_poll_at);

CREATE TABLE IF NOT EXISTS sentinel_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES sentinel_tasks(id),
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  evidence_json TEXT,
  detected_at INTEGER NOT NULL,
  notified_at INTEGER
);
CREATE INDEX IF NOT EXISTS sentinel_events_task_idx ON sentinel_events(task_id);

CREATE TABLE IF NOT EXISTS sync_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_table TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL,
  column_hlcs_json TEXT,
  hlc TEXT NOT NULL,
  device_id TEXT NOT NULL,
  synced_at INTEGER
);
CREATE INDEX IF NOT EXISTS sync_log_entity_idx ON sync_log(entity_table, entity_id);

CREATE TABLE IF NOT EXISTS sync_state (
  provider_id TEXT PRIMARY KEY,
  last_pushed_seq INTEGER NOT NULL DEFAULT 0,
  last_pulled_cursor TEXT,
  remote_config_json TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  work_id TEXT REFERENCES works(id),
  status TEXT NOT NULL DEFAULT 'pending',
  model TEXT,
  prompt_version TEXT,
  result_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_jobs_status_idx ON ai_jobs(status);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT
);

CREATE TABLE IF NOT EXISTS cv_profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  bio_md TEXT,
  sections_json TEXT,
  theme TEXT NOT NULL DEFAULT 'dawn-minimal',
  last_published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
`;
