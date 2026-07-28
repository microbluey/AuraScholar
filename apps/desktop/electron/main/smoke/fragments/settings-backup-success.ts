export const smokeSettingsBackupSuccess = String.raw`          const confirmBackupTransfer = new DataTransfer();
          confirmBackupTransfer.items.add(backupImportFile);
          Object.defineProperty(backupImportInput, "files", {
            configurable: true,
            value: confirmBackupTransfer.files
          });
          backupImportInput.dispatchEvent(new Event("change", { bubbles: true }));
          const backupImportDialogAgain = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("合并导入整库备份") ? dialog : null;
          }, 3_000);
          const confirmBackupImport = Array.from(
            backupImportDialogAgain?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "合并导入");
          confirmBackupImport?.click();
          settingsBackupImportBusyVisible = Boolean(
            await waitFor(() => {
              const button = backupImportButton();
              return button?.disabled &&
                button.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("导入中") &&
                bodyIncludes("正在合并导入备份")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(() => bodyIncludes("备份导入完成：新增"), 4_000);
          settingsBackupImportSuccessVisible =
            bodyIncludes("备份导入完成：新增") &&
            bodyIncludes(
              "已忽略 3 个不支持或运行态数据表（graph_cache、translation_cache、future_smoke_table）"
            );
          settingsBackupImportRuntimeSkipExplained = bodyIncludes(
            "1 条旧设备未完成的 AI 任务未恢复，可在新设备重新生成"
          );
          const importedBackupRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE id = ? AND works.library_id = ?",
            [backupImportWorkId, libraryId]
          );
          const importedSnippetRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM snippets WHERE id = ?",
            [backupImportSnippetId]
          );
          const importedSavedSearchRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM saved_searches WHERE id = ? AND saved_searches.library_id = ?",
            [backupImportSavedSearchId, libraryId]
          );
          const importedProxySettingRows = await window.aura.db.query(
            "SELECT value_json FROM settings WHERE key = ?",
            [backupImportProxySettingKey]
          );
          const importedSafeSettingRows = await window.aura.db.query(
            "SELECT value_json FROM settings WHERE key = ?",
            [backupImportSafeSettingKey]
          );
          const importedSecretSettingRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM settings WHERE key = ?",
            [backupImportSecretSettingKey]
          );
          const importedRuntimeSettingRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM settings WHERE key IN (?, ?)",
            [backupImportRuntimeSyncKey, backupImportRuntimeConflictKey]
          );
          const currentLibraryRows = await window.aura.db.query(
            "SELECT value_json FROM settings WHERE key = 'local.library_id'"
          );
          let currentLibraryId = "";
          try {
            currentLibraryId = currentLibraryRows[0]
              ? JSON.parse(currentLibraryRows[0].value_json)
              : "";
          } catch {
            currentLibraryId = "";
          }
          const importedDerivedArtifactRows = await window.aura.db.query(
            "SELECT library_id, source_id, payload_json FROM derived_artifacts WHERE id = ? AND library_id = ?",
            [backupImportDerivedArtifactId, libraryId]
          );
          const oldBackupLibraryRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM libraries WHERE id = ?",
            [backupImportOldLibraryId]
          );
          const importedSearchRows = await window.aura.db.query(
            "SELECT w.id FROM works w JOIN works_fts f ON f.rowid = w.rowid WHERE works_fts MATCH ? AND w.deleted_at IS NULL AND w.library_id = ?",
            ['"Backup"* "Import"*', libraryId]
          );
          const importedAttachmentRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM attachments WHERE id = ? AND deleted_at IS NOT NULL",
            [backupImportAttachmentId]
          );
          const activeAttachmentRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM attachments WHERE id = ? AND deleted_at IS NULL",
            [backupImportAttachmentId]
          );
          const importedAnnotationRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM annotations WHERE id = ?",
            [backupImportAnnotationId]
          );
          const duplicateWorkRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE id = ? AND works.library_id = ?",
            [backupMergeWorkId, libraryId]
          );
          const mergedSnippetRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM snippets WHERE id = ? AND work_id = ?",
            [backupMergeSnippetId, backupMergeExistingWorkId]
          );
          const mergedAttachmentRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM attachments WHERE id = ? AND work_id = ? AND deleted_at IS NOT NULL",
            [backupMergeAttachmentId, backupMergeExistingWorkId]
          );
          const mergedAnnotationRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM annotations WHERE id = ? AND work_id = ? AND attachment_id = ?",
            [backupMergeAnnotationId, backupMergeExistingWorkId, backupMergeAttachmentId]
          );
          const collisionLocalAttachmentRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM attachments WHERE id = ? AND work_id = ? AND deleted_at IS NULL",
            [backupCollisionAttachmentId, backupCollisionLocalWorkId]
          );
          const collisionImportedAttachmentRows = await window.aura.db.query(
            "SELECT id FROM attachments WHERE work_id = ? AND original_filename = ? AND deleted_at IS NOT NULL",
            [backupCollisionImportWorkId, "backup-collision-missing.pdf"]
          );
          const collisionImportedAttachmentId =
            typeof collisionImportedAttachmentRows[0]?.id === "string"
              ? collisionImportedAttachmentRows[0].id
              : "";
          const collisionAnnotationRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM annotations ann JOIN attachments att ON att.id = ann.attachment_id WHERE ann.id = ? AND ann.work_id = ? AND ann.attachment_id = ? AND ann.attachment_id != ? AND att.work_id = ? AND att.deleted_at IS NOT NULL",
            [
              backupCollisionAnnotationId,
              backupCollisionImportWorkId,
              collisionImportedAttachmentId,
              backupCollisionAttachmentId,
              backupCollisionImportWorkId
            ]
          );
          const importedPendingAiJobRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM ai_jobs WHERE id = ? AND ai_jobs.library_id = ?",
            [backupImportPendingAiJobId, libraryId]
          );
          const importedDoneAiJobRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM ai_jobs WHERE id = ? AND work_id = ? AND status = 'done' AND ai_jobs.library_id = ?",
            [backupImportDoneAiJobId, backupImportWorkId, libraryId]
          );
          settingsBackupImportAiJobsPortable =
            Number(importedPendingAiJobRows[0]?.n ?? 0) === 0 &&
            Number(importedDoneAiJobRows[0]?.n ?? 0) === 1;
          const importedGraphCacheRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM graph_cache WHERE work_id = ?",
            [backupImportGraphCacheKey]
          );
          const importedTranslationCacheRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM translation_cache WHERE cache_key = ?",
            [backupImportTranslationCacheKey]
          );
          settingsBackupImportEphemeralDataExcluded =
            Number(importedGraphCacheRows[0]?.n ?? 0) === 0 &&
            Number(importedTranslationCacheRows[0]?.n ?? 0) === 0;
          settingsBackupImportStableIdMerged =
            Number(duplicateWorkRows[0]?.n ?? 0) === 0 &&
            Number(mergedSnippetRows[0]?.n ?? 0) === 1 &&
            Number(mergedAttachmentRows[0]?.n ?? 0) === 1 &&
            Number(mergedAnnotationRows[0]?.n ?? 0) === 1 &&
            bodyIncludes("已合并");
          settingsBackupImportLibraryScoped =
            currentLibraryId !== "" &&
            importedDerivedArtifactRows[0]?.library_id === currentLibraryId &&
            importedDerivedArtifactRows[0]?.source_id === backupImportWorkId &&
            importedDerivedArtifactRows[0]?.library_id !== backupImportOldLibraryId &&
            Number(oldBackupLibraryRows[0]?.n ?? 0) === 0;
          try {
            const importedDerivedPayload = importedDerivedArtifactRows[0]?.payload_json
              ? JSON.parse(importedDerivedArtifactRows[0].payload_json)
              : null;
            settingsBackupImportLibraryScoped =
              settingsBackupImportLibraryScoped &&
              importedDerivedPayload?.apiKey === "" &&
              importedDerivedPayload?.nested?.accessToken === "" &&
              importedDerivedPayload?.nested?.client_secret === "" &&
              importedDerivedPayload?.nested?.cookie === "" &&
              importedDerivedPayload?.nested?.id_token === "" &&
              importedDerivedPayload?.nested?.session_id === "" &&
              importedDerivedPayload?.nested?.sourceUrl ===
                "https://artifact-import.example.test/path" &&
              !JSON.stringify(importedDerivedPayload).includes("backup-import-artifact-secret") &&
              !JSON.stringify(importedDerivedPayload).includes("backup-import-artifact-token") &&
              !JSON.stringify(importedDerivedPayload).includes(
                "backup-import-artifact-client-secret"
              ) &&
              !JSON.stringify(importedDerivedPayload).includes("backup-import-artifact-cookie") &&
              !JSON.stringify(importedDerivedPayload).includes("backup-import-artifact-id-token") &&
              !JSON.stringify(importedDerivedPayload).includes(
                "backup-import-artifact-session-id"
              ) &&
              !JSON.stringify(importedDerivedPayload).includes("artifact-import-pass");
          } catch {
            settingsBackupImportLibraryScoped = false;
          }
          settingsBackupImportAttachmentIdCollisionRemapped =
            Number(collisionLocalAttachmentRows[0]?.n ?? 0) === 1 &&
            collisionImportedAttachmentId !== "" &&
            collisionImportedAttachmentId !== backupCollisionAttachmentId &&
            Number(collisionAnnotationRows[0]?.n ?? 0) === 1;
          settingsBackupImportSearchIndexed = importedSearchRows.some(
            (row) => row.id === backupImportWorkId
          );
          try {
            const importedProxyValue = importedProxySettingRows[0]
              ? JSON.parse(importedProxySettingRows[0].value_json)
              : "";
            const importedSafeValue = importedSafeSettingRows[0]
              ? JSON.parse(importedSafeSettingRows[0].value_json)
              : null;
            const importedSafeText = JSON.stringify(importedSafeValue);
            settingsBackupImportSettingsSanitized =
              importedProxyValue === "http://127.0.0.1:7777/" &&
              importedSafeValue?.apiKey === "" &&
              importedSafeValue?.client_secret === "" &&
              importedSafeValue?.cookie === "" &&
              importedSafeValue?.id_token === "" &&
              importedSafeValue?.proxy === "http://proxy.example.test:8090/" &&
              Number(importedSecretSettingRows[0]?.n ?? 0) === 0 &&
              Number(importedRuntimeSettingRows[0]?.n ?? 0) === 0 &&
              !importedSafeText.includes("nested-import-secret") &&
              !importedSafeText.includes("nested-import-client-secret") &&
              !importedSafeText.includes("nested-import-cookie") &&
              !importedSafeText.includes("nested-import-id-token") &&
              !importedSafeText.includes("nested-pass");
          } catch {
            settingsBackupImportSettingsSanitized = false;
          }
          settingsBackupImportAttachmentDeactivated =
            Number(importedAttachmentRows[0]?.n ?? 0) === 1 &&
            Number(activeAttachmentRows[0]?.n ?? 0) === 0 &&
            Number(importedAnnotationRows[0]?.n ?? 0) === 1 &&
            bodyIncludes("附件记录已标记为待重新挂载");
          settingsBackupImportPersisted =
            Number(importedBackupRows[0]?.n ?? 0) === 1 &&
            Number(importedSnippetRows[0]?.n ?? 0) === 1 &&
            Number(importedSavedSearchRows[0]?.n ?? 0) === 1 &&
            settingsBackupImportAttachmentDeactivated;

`;
