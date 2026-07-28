export const smokeLibrarySeedBackground = String.raw`            await window.aura.db.run(
              "INSERT OR IGNORE INTO sentinel_tasks (id, library_id, work_id, doi, title, current_state, target_flags, poll_interval_s, next_poll_at, last_polled_at, error_count, status, created_at, updated_at, deleted_at) VALUES (?, ?, NULL, ?, ?, 'accepted', NULL, 86400, ?, NULL, 0, 'active', ?, ?, NULL)",
              [
                LIBRARY_SENTINEL_LINK_SMOKE.id, libraryId,
                LIBRARY_SENTINEL_LINK_SMOKE.doi,
                LIBRARY_SENTINEL_LINK_SMOKE.title,
                now + 43_200_000,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO sentinel_tasks (id, library_id, work_id, doi, title, current_state, target_flags, poll_interval_s, next_poll_at, last_polled_at, error_count, status, created_at, updated_at, deleted_at) VALUES (?, ?, NULL, ?, ?, 'accepted', NULL, 86400, ?, NULL, 0, 'active', ?, ?, NULL)",
              [
                SENTINEL_DUPLICATE_SMOKE.id, libraryId,
                SENTINEL_DUPLICATE_SMOKE.doi,
                SENTINEL_DUPLICATE_SMOKE.title,
                now + 43_200_000,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO sentinel_tasks (id, library_id, work_id, doi, title, current_state, target_flags, poll_interval_s, next_poll_at, last_polled_at, error_count, last_error, status, created_at, updated_at, deleted_at) VALUES (?, ?, NULL, ?, ?, 'accepted', NULL, 86400, ?, ?, 2, ?, 'active', ?, ?, NULL)",
              [
                SENTINEL_ERROR_SMOKE.id, libraryId,
                SENTINEL_ERROR_SMOKE.doi,
                SENTINEL_ERROR_SMOKE.title,
                now + 43_200_000,
                now - 3_600_000,
                SENTINEL_ERROR_SMOKE.error,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO sentinel_tasks (id, library_id, work_id, doi, title, current_state, target_flags, poll_interval_s, next_poll_at, last_polled_at, error_count, last_error, status, created_at, updated_at, deleted_at) VALUES (?, ?, NULL, ?, ?, 'accepted', ?, 86400, ?, NULL, 0, NULL, 'active', ?, ?, NULL)",
              [
                SENTINEL_MANUAL_FAILURE_SMOKE.id, libraryId,
                SENTINEL_MANUAL_FAILURE_SMOKE.doi,
                SENTINEL_MANUAL_FAILURE_SMOKE.title,
                "{broken",
                now + 43_200_000,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO sentinel_tasks (id, library_id, work_id, doi, title, current_state, target_flags, poll_interval_s, next_poll_at, last_polled_at, error_count, status, created_at, updated_at, deleted_at) VALUES (?, ?, NULL, ?, ?, 'accepted', NULL, 86400, ?, NULL, 0, 'active', ?, ?, NULL)",
              [
                SENTINEL_DELETE_UNDO_SMOKE.id, libraryId,
                SENTINEL_DELETE_UNDO_SMOKE.doi,
                SENTINEL_DELETE_UNDO_SMOKE.title,
                now + 43_200_000,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO sentinel_tasks (id, library_id, work_id, doi, title, current_state, target_flags, poll_interval_s, next_poll_at, last_polled_at, error_count, status, created_at, updated_at, deleted_at) VALUES (?, ?, NULL, ?, ?, 'accepted', NULL, 86400, ?, NULL, 0, 'paused', ?, ?, ?)",
              [
                SENTINEL_RESTORE_SMOKE.id, libraryId,
                SENTINEL_RESTORE_SMOKE.doi,
                SENTINEL_RESTORE_SMOKE.title,
                now + 43_200_000,
                now,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO saved_searches (id, library_id, query, sources_json, seen_ids_json, new_count, last_run_at, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
              [
                SAVED_SEARCH_SMOKE.id, libraryId,
                SAVED_SEARCH_SMOKE.query,
                null,
                "[]",
                now,
                now + 43_200_000,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO saved_searches (id, library_id, query, sources_json, seen_ids_json, new_count, last_run_at, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
              [
                SAVED_SEARCH_MANUAL_SMOKE.id, libraryId,
                SAVED_SEARCH_MANUAL_SMOKE.query,
                "[]",
                "[]",
                now,
                now + 43_200_000,
                now + 1,
                now + 1
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO saved_searches (id, library_id, query, sources_json, seen_ids_json, new_count, last_run_at, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 2, ?, ?, ?, ?)",
              [
                SAVED_SEARCH_HOME_OPEN_SMOKE.id, libraryId,
                SAVED_SEARCH_HOME_OPEN_SMOKE.query,
                "[]",
                "[]",
                now - 1_000,
                now + 43_200_000,
                now + 2,
                now + 2
              ]
            );
            await window.aura.db.run(
              "UPDATE saved_searches SET query = ?, sources_json = ?, seen_ids_json = ?, new_count = 2, last_run_at = ?, next_run_at = ?, last_error = NULL, updated_at = ?, deleted_at = NULL WHERE id = ? AND library_id = ?",
              [
                SAVED_SEARCH_HOME_OPEN_SMOKE.query,
                "[]",
                "[]",
                now - 1_000,
                now + 43_200_000,
                now + 2,
                SAVED_SEARCH_HOME_OPEN_SMOKE.id
              , libraryId]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO saved_searches (id, library_id, query, sources_json, seen_ids_json, new_count, last_run_at, next_run_at, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)",
              [
                SAVED_SEARCH_ERROR_SMOKE.id, libraryId,
                SAVED_SEARCH_ERROR_SMOKE.query,
                null,
                "[]",
                now - 3_600_000,
                now + 43_200_000,
                SAVED_SEARCH_ERROR_SMOKE.error,
                now + 3,
                now + 3
              ]
            );
`;
