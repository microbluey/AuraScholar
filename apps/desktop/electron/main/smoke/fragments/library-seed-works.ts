export const smokeLibrarySeedWorks = String.raw`          try {
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, library_id, doi, pmid, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                SAMPLE.workId, libraryId,
                SAMPLE.doi,
                SAMPLE.pmid,
                SAMPLE.title,
                "A deterministic smoke-test paper for validating the populated desktop library state.",
                2026,
                SAMPLE.venue,
                "article",
                "unread",
                0,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                MISSING_PDF.workId, libraryId,
                MISSING_PDF.doi,
                MISSING_PDF.title,
                "A deterministic smoke-test paper for validating the missing-PDF reader recovery state.",
                2026,
                MISSING_PDF.venue,
                "article",
                "unread",
                0,
                now - 10000,
                now - 10000
              ]
            );
            for (let index = 0; index < 35; index += 1) {
              const createdAt = now - 100 - index;
              await window.aura.db.run(
                "INSERT OR REPLACE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  "smoke-work-library-deeplink-filler-" + index, libraryId,
                  "10.4242/aurascholar.library-deeplink-filler-" + index,
                  "Smoke Library Deep Link Filler " + String(index + 1).padStart(2, "0"),
                  "A deterministic smoke-test paper used to force library deep-link pagination.",
                  2026,
                  "Journal of Library Navigation",
                  "article",
                  "unread",
                  0,
                  createdAt,
                  createdAt
                ]
              );
            }
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                BROKEN_BLOB.workId, libraryId,
                BROKEN_BLOB.doi,
                BROKEN_BLOB.title,
                "A deterministic smoke-test paper for validating broken local blob recovery.",
                2026,
                BROKEN_BLOB.venue,
                "article",
                "unread",
                0,
                now - 2,
                now - 2
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                CORRUPT_PDF.workId, libraryId,
                CORRUPT_PDF.doi,
                CORRUPT_PDF.title,
                "A deterministic smoke-test paper for validating corrupt PDF repair.",
                2026,
                CORRUPT_PDF.venue,
                "article",
                "unread",
                0,
                now - 3,
                now - 3
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                LIBRARY_UPLOAD_PDF.workId, libraryId,
                LIBRARY_UPLOAD_PDF.doi,
                LIBRARY_UPLOAD_PDF.title,
                "A deterministic smoke-test paper for validating Library detail PDF upload feedback.",
                2026,
                LIBRARY_UPLOAD_PDF.venue,
                "article",
                "unread",
                0,
                now - 4,
                now - 4
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                MERGE_SMOKE.primaryId, libraryId,
                MERGE_SMOKE.primaryDoi,
                MERGE_SMOKE.primaryTitle,
                null,
                2026,
                "Journal of Merge Smoke",
                "article",
                "unread",
                0,
                now - 5,
                now - 5
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                MERGE_SMOKE.duplicateId, libraryId,
                MERGE_SMOKE.duplicateDoi,
                MERGE_SMOKE.duplicateTitle,
                "Metadata moved by merge smoke",
                2026,
                "Journal of Merge Smoke",
                "article",
                "unread",
                0,
                now - 6,
                now - 6
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                MERGE_FAILURE_SMOKE.primaryId, libraryId,
                MERGE_FAILURE_SMOKE.primaryDoi,
                MERGE_FAILURE_SMOKE.primaryTitle,
                "Primary record for validating failed merge rollback.",
                2026,
                "Journal of Atomic Merge UX",
                "article",
                "unread",
                0,
                now - 6,
                now - 6
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                MERGE_FAILURE_SMOKE.duplicateId, libraryId,
                MERGE_FAILURE_SMOKE.duplicateDoi,
                MERGE_FAILURE_SMOKE.duplicateTitle,
                "Duplicate record for validating failed merge rollback.",
                2026,
                "Journal of Atomic Merge UX",
                "article",
                "unread",
                0,
                now - 6,
                now - 6
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                READER_ARCHIVED_SMOKE.workId, libraryId,
                READER_ARCHIVED_SMOKE.doi,
                READER_ARCHIVED_SMOKE.title,
                "A deterministic smoke-test paper for validating archived Reader links.",
                2026,
                READER_ARCHIVED_SMOKE.venue,
                "article",
                "unread",
                0,
                now - 4,
                now - 4,
                now - 4_200
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                TRASH_ACTION_SMOKE.workId, libraryId,
                TRASH_ACTION_SMOKE.doi,
                TRASH_ACTION_SMOKE.title,
                "A deterministic smoke-test paper for validating recoverable trash actions.",
                2026,
                TRASH_ACTION_SMOKE.venue,
                "article",
                "unread",
                0,
                now - 4,
                now - 4,
                now - 2_000
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                TRASH_FAILURE_SMOKE.workId, libraryId,
                TRASH_FAILURE_SMOKE.doi,
                TRASH_FAILURE_SMOKE.title,
                "A deterministic smoke-test paper for validating retryable trash failures.",
                2026,
                TRASH_FAILURE_SMOKE.venue,
                "article",
                "unread",
                0,
                now - 4,
                now - 4
              ]
            );
            for (const work of BULK_TRASH_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  work.workId, libraryId,
                  work.doi,
                  work.title,
                  "A deterministic smoke-test paper for validating atomic bulk trash rollback.",
                  2026,
                  work.venue,
                  "article",
                  "unread",
                  0,
                  now - 4,
                  now - 4
                ]
              );
            }
            for (const work of MOVE_COLLECTION_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  work.workId, libraryId,
                  work.doi,
                  work.title,
                  "A deterministic smoke-test paper for validating atomic collection move rollback.",
                  2026,
                  work.venue,
                  "article",
                  "unread",
                  0,
                  now - 4,
                  now - 4
                ]
              );
            }
            for (const work of BULK_TAG_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  work.workId, libraryId,
                  work.doi,
                  work.title,
                  "A deterministic smoke-test paper for validating atomic bulk tag rollback.",
                  2026,
                  work.venue,
                  "article",
                  "unread",
                  0,
                  now - 4,
                  now - 4
                ]
              );
            }
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                TRASH_UNDO_SMOKE.workId, libraryId,
                TRASH_UNDO_SMOKE.doi,
                TRASH_UNDO_SMOKE.title,
                "A deterministic smoke-test paper for validating instant undo after accidental trash.",
                2026,
                TRASH_UNDO_SMOKE.venue,
                "article",
                "unread",
                0,
                now - 4,
                now - 4
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                TRASH_PURGE_SMOKE.workId, libraryId,
                TRASH_PURGE_SMOKE.doi,
                TRASH_PURGE_SMOKE.title,
                "A deterministic smoke-test paper for validating typed confirmation before permanent deletion.",
                2026,
                TRASH_PURGE_SMOKE.venue,
                "article",
                "unread",
                0,
                now - 4,
                now - 4,
                now - 3_000
              ]
            );
            for (const work of TRASH_PURGE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  work.workId, libraryId,
                  work.doi,
                  work.title,
                  "A deterministic smoke-test paper for validating atomic permanent delete rollback.",
                  2026,
                  work.venue,
                  "article",
                  "unread",
                  0,
                  now - 4,
                  now - 4,
                  now - 3_500
                ]
              );
            }
            for (const work of TRASH_RESTORE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  work.workId, libraryId,
                  work.doi,
                  work.title,
                  "A deterministic smoke-test paper for validating atomic trash restore rollback.",
                  2026,
                  work.venue,
                  "article",
                  "unread",
                  0,
                  now - 4,
                  now - 4,
                  now - 3_800
                ]
              );
            }
            await window.aura.db.run(
              "UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ? AND library_id = ?",
              [now - 2_000, now - 4, TRASH_ACTION_SMOKE.workId, libraryId]
            );
            await window.aura.db.run(
              "UPDATE works SET deleted_at = NULL, updated_at = ? WHERE id = ? AND library_id = ?",
              [now - 4, TRASH_FAILURE_SMOKE.workId, libraryId]
            );
            for (const work of BULK_TRASH_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "UPDATE works SET deleted_at = NULL, updated_at = ? WHERE id = ? AND library_id = ?",
                [now - 4, work.workId, libraryId]
              );
            }
            for (const work of MOVE_COLLECTION_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "UPDATE works SET deleted_at = NULL, updated_at = ? WHERE id = ? AND library_id = ?",
                [now - 4, work.workId, libraryId]
              );
              await window.aura.db.run(
                "DELETE FROM collection_items WHERE work_id = ?",
                [work.workId]
              );
            }
            for (const work of BULK_TAG_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "UPDATE works SET deleted_at = NULL, updated_at = ? WHERE id = ? AND library_id = ?",
                [now - 4, work.workId, libraryId]
              );
            }
            await window.aura.db.run(
              "UPDATE works SET deleted_at = NULL, updated_at = ? WHERE id = ? AND library_id = ?",
              [now - 4, TRASH_UNDO_SMOKE.workId, libraryId]
            );
            await window.aura.db.run(
              "UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ? AND library_id = ?",
              [now - 3_000, now - 4, TRASH_PURGE_SMOKE.workId, libraryId]
            );
            for (const work of TRASH_PURGE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ? AND library_id = ?",
                [now - 3_500, now - 4, work.workId, libraryId]
              );
            }
            for (const work of TRASH_RESTORE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ? AND library_id = ?",
                [now - 3_800, now - 4, work.workId, libraryId]
              );
            }
`;
