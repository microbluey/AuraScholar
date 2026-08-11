export const smokeLibrarySeedAssets = String.raw`            await window.aura.db.run(
              "INSERT OR IGNORE INTO tags (id, library_id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
              [SAMPLE.tagId, libraryId, SAMPLE.tag, "#0f766e", now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO tags (id, library_id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
              [TAG_MANAGER_SMOKE.id, libraryId, TAG_MANAGER_SMOKE.name, TAG_MANAGER_SMOKE.color, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO collections (id, library_id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, NULL, 0, ?, ?)",
              [COLLECTION_MANAGER_SMOKE.id, libraryId, COLLECTION_MANAGER_SMOKE.name, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO collections (id, library_id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, NULL, 0, ?, ?)",
              [MOVE_COLLECTION_SMOKE.id, libraryId, MOVE_COLLECTION_SMOKE.name, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO collection_items (collection_id, work_id) VALUES (?, ?)",
              [COLLECTION_MANAGER_SMOKE.id, MISSING_PDF.workId]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)",
              [SAMPLE.workId, SAMPLE.tagId]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)",
              [MISSING_PDF.workId, TAG_MANAGER_SMOKE.id]
            );
            const pdfBytes = makeSmokePdf();
            const stagedPdf = await window.aura.data.command("library.stagePdf", { bytes: pdfBytes });
            const pdfSha = stagedPdf.sha;
            await window.aura.db.run(
              "INSERT OR IGNORE INTO attachments (id, work_id, kind, sha256, byte_size, original_filename, fetched_via, page_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                SAMPLE.attachmentId,
                SAMPLE.workId,
                "pdf",
                pdfSha,
                pdfBytes.byteLength,
                "aurascholar-smoke.pdf",
                "smoke",
                1,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO attachments (id, work_id, kind, sha256, byte_size, original_filename, fetched_via, page_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                READER_ARCHIVED_SMOKE.attachmentId,
                READER_ARCHIVED_SMOKE.workId,
                "pdf",
                pdfSha,
                pdfBytes.byteLength,
                "reader-archived-smoke.pdf",
                "smoke",
                1,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO attachments (id, work_id, kind, sha256, byte_size, original_filename, fetched_via, page_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                MERGE_FAILURE_SMOKE.attachmentId,
                MERGE_FAILURE_SMOKE.duplicateId,
                "pdf",
                MERGE_FAILURE_SMOKE.attachmentSha,
                2048,
                "merge-failure.pdf",
                "smoke",
                1,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "UPDATE attachments SET work_id = ?, deleted_at = NULL, updated_at = ? WHERE id = ?",
              [MERGE_FAILURE_SMOKE.duplicateId, now, MERGE_FAILURE_SMOKE.attachmentId]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO annotations (id, attachment_id, work_id, type, color, page_index, anchor_json, content_md, sort_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                READER_ARCHIVED_SMOKE.annotationId,
                READER_ARCHIVED_SMOKE.attachmentId,
                READER_ARCHIVED_SMOKE.workId,
                "highlight",
                "#ffd866",
                0,
                JSON.stringify({
                  version: 1,
                  pageIndex: 0,
                  quote: { exact: "Archived Reader Smoke PDF", prefix: "", suffix: "" },
                  position: { start: 0, end: 26 }
                }),
                "Archived annotation should stay hidden until restore.",
                0,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO annotations (id, attachment_id, work_id, type, color, page_index, anchor_json, content_md, sort_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                SAMPLE.annotationId,
                SAMPLE.attachmentId,
                SAMPLE.workId,
                "highlight",
                "#ffd866",
                0,
                JSON.stringify({
                  version: 1,
                  pageIndex: 0,
                  quote: { exact: "AuraScholar Smoke PDF", prefix: "", suffix: "" },
                  position: { start: 0, end: 23 }
                }),
                "Smoke reader note for delete confirmation.",
                0,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR REPLACE INTO snippets (id, work_id, page_index, quote, note_md, tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              [
                SNIPPET_SMOKE.id,
                SAMPLE.workId,
                0,
                SNIPPET_SMOKE.quote,
                null,
                "smoke",
                now,
                now
              ]
            );
`;
