export const smokeSettingsBackupPayload = String.raw`        const backupImportButton = () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => {
              const label = button.textContent?.replace(/\s+/g, " ").trim();
              return label === "导入备份" || label === "导入中...";
            }
          );
        const backupImportInput = document.querySelector('input[type="file"][accept=".json,application/json"]');
        if (backupImportInput) {
          const backupImportWorkId = "smoke-backup-import-work";
          const backupImportAttachmentId = "smoke-backup-import-attachment";
          const backupImportAnnotationId = "smoke-backup-import-annotation";
          const backupImportSnippetId = "smoke-backup-import-snippet";
          const backupImportSavedSearchId = "smoke-backup-import-saved-search";
          const backupImportAuthorId = "smoke-backup-import-author";
          const backupMergeExistingWorkId = "smoke-backup-existing-work";
          const backupMergeDoi = "10.4242/aurascholar.backup-merge";
          const backupMergeWorkId = "smoke-backup-conflicting-work";
          const backupMergeAttachmentId = "smoke-backup-conflicting-attachment";
          const backupMergeAnnotationId = "smoke-backup-conflicting-annotation";
          const backupMergeSnippetId = "smoke-backup-conflicting-snippet";
          const backupCollisionLocalWorkId = "smoke-backup-attachment-collision-local-work";
          const backupCollisionImportWorkId = "smoke-backup-attachment-collision-work";
          const backupCollisionAttachmentId = "smoke-backup-attachment-collision-attachment";
          const backupCollisionAnnotationId = "smoke-backup-attachment-collision-annotation";
          const backupImportOldLibraryId = "smoke-backup-old-library";
          const backupImportDerivedArtifactId = "smoke-backup-import-derived-artifact";
          const backupImportPendingAiJobId = "smoke-backup-import-pending-ai-job";
          const backupImportDoneAiJobId = "smoke-backup-import-done-ai-job";
          const backupImportGraphCacheKey = "smoke-backup-import-graph-cache";
          const backupImportTranslationCacheKey = "smoke-backup-import-translation-cache";
          const backupImportProxySettingKey = "research.proxy.import-smoke";
          const backupImportSafeSettingKey = "safe.setting.import-smoke";
          const backupImportSecretSettingKey = "secret:import:apiKey";
          const backupImportRuntimeSyncKey = "sync.import-smoke.last_pushed_at";
          const backupImportRuntimeConflictKey = "sync.conflict.import-smoke.works.w1.title";
          const now = Date.now();
          await window.aura.db.run(
            "INSERT OR IGNORE INTO works (id, library_id, doi, title, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, 'article', 'unread', 0, ?, ?)",
            [
              backupMergeExistingWorkId, libraryId,
              backupMergeDoi,
              "Existing Backup Merge Target",
              now,
              now
            ]
          );
          await window.aura.db.run(
            "INSERT OR IGNORE INTO works (id, library_id, doi, title, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, 'article', 'unread', 0, ?, ?)",
            [
              backupCollisionLocalWorkId, libraryId,
              "10.4242/aurascholar.backup-attachment-collision-local",
              "Existing Attachment Collision Local Work",
              now,
              now
            ]
          );
          await window.aura.db.run(
            "INSERT OR IGNORE INTO attachments (id, work_id, kind, sha256, byte_size, original_filename, fetched_via, page_count, created_at, updated_at) VALUES (?, ?, 'pdf', ?, ?, ?, 'backup-smoke-local', 1, ?, ?)",
            [
              backupCollisionAttachmentId,
              backupCollisionLocalWorkId,
              "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
              4096,
              "local-collision-existing.pdf",
              now,
              now
            ]
          );
          const backupPayload = {
            version: 1,
            exportedAt: new Date(now).toISOString(),
            tables: {
              libraries: [
                {
                  id: backupImportOldLibraryId,
                  name: "Old Backup Library",
                  kind: "personal",
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                }
              ],
              works: [
                {
                  id: backupImportWorkId,
                  doi: "10.4242/aurascholar.backup-import",
                  title: "Backup Import Smoke Work",
                  abstract: "Imported from a user JSON backup.",
                  year: 2026,
                  publication_date: "2026",
                  venue_name: "Journal of Backup UX",
                  venue_type: "journal",
                  type: "article",
                  reading_status: "unread",
                  starred: 0,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                },
                {
                  id: backupMergeWorkId,
                  doi: backupMergeDoi,
                  title: "Backup Duplicate Should Merge",
                  abstract: "This backup row has the same DOI as an existing local work.",
                  year: 2026,
                  publication_date: "2026",
                  venue_name: "Journal of Backup Merge",
                  venue_type: "journal",
                  type: "article",
                  reading_status: "unread",
                  starred: 0,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                },
                {
                  id: backupCollisionImportWorkId,
                  doi: "10.4242/aurascholar.backup-attachment-collision-import",
                  title: "Backup Attachment Collision Import Work",
                  abstract: "This backup row reuses a local attachment id and must be remapped.",
                  year: 2026,
                  publication_date: "2026",
                  venue_name: "Journal of Backup Collisions",
                  venue_type: "journal",
                  type: "article",
                  reading_status: "unread",
                  starred: 0,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                }
              ],
              authors: [
                {
                  id: backupImportAuthorId,
                  display_name: "Backup Import Author",
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                }
              ],
              work_authors: [
                {
                  work_id: backupImportWorkId,
                  author_id: backupImportAuthorId,
                  position: 1,
                  is_corresponding: 0,
                  raw_name: "Backup Import Author",
                  role: "author"
                }
              ],
              attachments: [
                {
                  id: backupImportAttachmentId,
                  work_id: backupImportWorkId,
                  kind: "pdf",
                  sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  byte_size: 1024,
                  original_filename: "backup-import-missing.pdf",
                  source_url: null,
                  fetched_via: "backup-smoke",
                  page_count: 1,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                },
                {
                  id: backupMergeAttachmentId,
                  work_id: backupMergeWorkId,
                  kind: "pdf",
                  sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                  byte_size: 2048,
                  original_filename: "backup-merge-missing.pdf",
                  source_url: null,
                  fetched_via: "backup-smoke",
                  page_count: 1,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                },
                {
                  id: backupCollisionAttachmentId,
                  work_id: backupCollisionImportWorkId,
                  kind: "pdf",
                  sha256: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                  byte_size: 3072,
                  original_filename: "backup-collision-missing.pdf",
                  source_url: null,
                  fetched_via: "backup-smoke",
                  page_count: 1,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                }
              ],
              annotations: [
                {
                  id: backupImportAnnotationId,
                  attachment_id: backupImportAttachmentId,
                  work_id: backupImportWorkId,
                  type: "highlight",
                  color: "yellow",
                  page_index: 0,
                  anchor_json: "{}",
                  content_md: "Backup import annotation",
                  ink_paths_json: null,
                  sort_key: 1,
                  orphaned: 0,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                },
                {
                  id: backupMergeAnnotationId,
                  attachment_id: backupMergeAttachmentId,
                  work_id: backupMergeWorkId,
                  type: "highlight",
                  color: "yellow",
                  page_index: 0,
                  anchor_json: "{}",
                  content_md: "Backup merge annotation",
                  ink_paths_json: null,
                  sort_key: 2,
                  orphaned: 0,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                },
                {
                  id: backupCollisionAnnotationId,
                  attachment_id: backupCollisionAttachmentId,
                  work_id: backupCollisionImportWorkId,
                  type: "highlight",
                  color: "yellow",
                  page_index: 0,
                  anchor_json: "{}",
                  content_md: "Backup attachment collision annotation",
                  ink_paths_json: null,
                  sort_key: 3,
                  orphaned: 0,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                }
              ],
              snippets: [
                {
                  id: backupImportSnippetId,
                  work_id: backupImportWorkId,
                  page_index: 0,
                  quote: "Backup import snippet quote",
                  note_md: "Backup import snippet note",
                  tag: "backup",
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                },
                {
                  id: backupMergeSnippetId,
                  work_id: backupMergeWorkId,
                  page_index: 0,
                  quote: "Backup merge snippet quote",
                  note_md: "Backup merge snippet note",
                  tag: "backup",
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                }
              ],
              saved_searches: [
                {
                  id: backupImportSavedSearchId,
                  query: "Backup Import Saved Search",
                  sources_json: "[\"openalex\"]",
                  seen_ids_json: "[]",
                  new_count: 0,
                  last_run_at: null,
                  next_run_at: null,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null,
                  last_error: null
                }
              ],
              ai_jobs: [
                {
                  id: backupImportPendingAiJobId,
                  kind: "flashcards",
                  work_id: backupImportWorkId,
                  status: "pending",
                  model: "smoke-model",
                  prompt_version: "smoke-prompt",
                  result_json: null,
                  error: null,
                  created_at: now,
                  updated_at: now
                },
                {
                  id: backupImportDoneAiJobId,
                  kind: "reader-digest",
                  work_id: backupImportWorkId,
                  status: "done",
                  model: "smoke-model",
                  prompt_version: "smoke-prompt",
                  result_json: JSON.stringify({ summary: "Imported completed AI job" }),
                  error: null,
                  created_at: now,
                  updated_at: now
                }
              ],
              settings: [
                {
                  key: backupImportProxySettingKey,
                  value_json: JSON.stringify("http://import-user:import-pass@127.0.0.1:7777"),
                  scope: "local",
                  updated_at: now
                },
                {
                  key: backupImportSafeSettingKey,
                  value_json: JSON.stringify({
                    label: "safe",
                    apiKey: "nested-import-secret",
                    client_secret: "nested-import-client-secret",
                    cookie: "nested-import-cookie",
                    id_token: "nested-import-id-token",
                    proxy: "http://nested:nested-pass@proxy.example.test:8090"
                  }),
                  scope: "local",
                  updated_at: now
                },
                {
                  key: backupImportSecretSettingKey,
                  value_json: JSON.stringify("import-secret-key"),
                  scope: "local",
                  updated_at: now
                },
                {
                  key: backupImportRuntimeSyncKey,
                  value_json: JSON.stringify(987654),
                  scope: "local",
                  updated_at: now
                },
                {
                  key: backupImportRuntimeConflictKey,
                  value_json: JSON.stringify({ losingValue: "runtime-conflict" }),
                  scope: "local",
                  updated_at: now
                }
              ],
              derived_artifacts: [
                {
                  id: backupImportDerivedArtifactId,
                  library_id: backupImportOldLibraryId,
                  source_table: "works",
                  source_id: backupImportWorkId,
                  kind: "reader-digest",
                  model: "smoke-model",
                  prompt_hash: "smoke-prompt",
                  input_hash: "smoke-input",
                  payload_json: JSON.stringify({
                    summary: "Backup import derived artifact",
                    apiKey: "backup-import-artifact-secret",
                    nested: {
                      accessToken: "backup-import-artifact-token",
                      client_secret: "backup-import-artifact-client-secret",
                      cookie: "backup-import-artifact-cookie",
                      id_token: "backup-import-artifact-id-token",
                      session_id: "backup-import-artifact-session-id",
                      sourceUrl:
                        "https://artifact-import-user:artifact-import-pass@artifact-import.example.test/path"
                    }
                  }),
                  local_only: 1,
                  syncable: 0,
                  created_at: now,
                  updated_at: now,
                  expires_at: null,
                  deleted_at: null
                }
              ],
              graph_cache: [
                {
                  work_id: backupImportGraphCacheKey,
                  payload_json: JSON.stringify({ stale: "backup-import-graph-cache" }),
                  fetched_at: now
                }
              ],
              translation_cache: [
                {
                  cache_key: backupImportTranslationCacheKey,
                  engine: "smoke-import-cache",
                  target_lang: "zh",
                  result: "backup-import-translation-cache",
                  created_at: now
                }
              ],
              future_smoke_table: [{ id: "ignored" }]
            }
          };
          const backupImportFile = new File(
            [JSON.stringify(backupPayload)],
            "aurascholar-backup-import-smoke.json",
            { type: "application/json" }
          );
`;
