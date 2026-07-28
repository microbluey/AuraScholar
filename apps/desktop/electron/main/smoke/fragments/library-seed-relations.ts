export const smokeLibrarySeedRelations = String.raw`            await window.aura.db.run(
              "UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ? AND library_id = ?",
              [now - 4_200, now - 4, READER_ARCHIVED_SMOKE.workId, libraryId]
            );
            await window.aura.db.run(
              "UPDATE works SET deleted_at = NULL, updated_at = ? WHERE id IN (?, ?) AND library_id = ?",
              [now - 4, MERGE_FAILURE_SMOKE.primaryId, MERGE_FAILURE_SMOKE.duplicateId, libraryId]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, library_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
              [SAMPLE.authorId, libraryId, SAMPLE.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, library_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
              [MISSING_PDF.authorId, libraryId, MISSING_PDF.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, library_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
              [BROKEN_BLOB.authorId, libraryId, BROKEN_BLOB.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, library_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
              [CORRUPT_PDF.authorId, libraryId, CORRUPT_PDF.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, library_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
              [LIBRARY_UPLOAD_PDF.authorId, libraryId, LIBRARY_UPLOAD_PDF.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, library_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
              [READER_ARCHIVED_SMOKE.authorId, libraryId, READER_ARCHIVED_SMOKE.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, library_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
              [TRASH_ACTION_SMOKE.authorId, libraryId, TRASH_ACTION_SMOKE.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, library_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
              [TRASH_FAILURE_SMOKE.authorId, libraryId, TRASH_FAILURE_SMOKE.author, now, now]
            );
            for (const work of BULK_TRASH_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO authors (id, library_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                [work.authorId, libraryId, work.author, now, now]
              );
            }
            for (const work of MOVE_COLLECTION_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO authors (id, library_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                [work.authorId, libraryId, work.author, now, now]
              );
            }
            for (const work of BULK_TAG_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO authors (id, library_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                [work.authorId, libraryId, work.author, now, now]
              );
            }
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, library_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
              [TRASH_UNDO_SMOKE.authorId, libraryId, TRASH_UNDO_SMOKE.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, library_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
              [TRASH_PURGE_SMOKE.authorId, libraryId, TRASH_PURGE_SMOKE.author, now, now]
            );
            for (const work of TRASH_PURGE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO authors (id, library_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                [work.authorId, libraryId, work.author, now, now]
              );
            }
            for (const work of TRASH_RESTORE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO authors (id, library_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                [work.authorId, libraryId, work.author, now, now]
              );
            }
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [SAMPLE.workId, SAMPLE.authorId, 0, SAMPLE.author, "author"]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [MISSING_PDF.workId, MISSING_PDF.authorId, 0, MISSING_PDF.author, "author"]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [BROKEN_BLOB.workId, BROKEN_BLOB.authorId, 0, BROKEN_BLOB.author, "author"]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [CORRUPT_PDF.workId, CORRUPT_PDF.authorId, 0, CORRUPT_PDF.author, "author"]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [LIBRARY_UPLOAD_PDF.workId, LIBRARY_UPLOAD_PDF.authorId, 0, LIBRARY_UPLOAD_PDF.author, "author"]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [
                READER_ARCHIVED_SMOKE.workId,
                READER_ARCHIVED_SMOKE.authorId,
                0,
                READER_ARCHIVED_SMOKE.author,
                "author"
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [TRASH_ACTION_SMOKE.workId, TRASH_ACTION_SMOKE.authorId, 0, TRASH_ACTION_SMOKE.author, "author"]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [TRASH_FAILURE_SMOKE.workId, TRASH_FAILURE_SMOKE.authorId, 0, TRASH_FAILURE_SMOKE.author, "author"]
            );
            for (const work of BULK_TRASH_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
                [work.workId, work.authorId, 0, work.author, "author"]
              );
            }
            for (const work of MOVE_COLLECTION_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
                [work.workId, work.authorId, 0, work.author, "author"]
              );
            }
            for (const work of BULK_TAG_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
                [work.workId, work.authorId, 0, work.author, "author"]
              );
            }
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [TRASH_UNDO_SMOKE.workId, TRASH_UNDO_SMOKE.authorId, 0, TRASH_UNDO_SMOKE.author, "author"]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [TRASH_PURGE_SMOKE.workId, TRASH_PURGE_SMOKE.authorId, 0, TRASH_PURGE_SMOKE.author, "author"]
            );
            for (const work of TRASH_PURGE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
                [work.workId, work.authorId, 0, work.author, "author"]
              );
            }
            for (const work of TRASH_RESTORE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
                [work.workId, work.authorId, 0, work.author, "author"]
              );
            }
            await window.aura.db.run(
              "DELETE FROM work_tags WHERE tag_id IN (SELECT id FROM tags WHERE name = ? AND library_id = ?)",
              [BULK_TAG_FAILURE_SMOKE.name, libraryId]
            );
            await window.aura.db.run(
              "DELETE FROM tags WHERE name = ? AND library_id = ?",
              [BULK_TAG_FAILURE_SMOKE.name, libraryId]
            );
`;
