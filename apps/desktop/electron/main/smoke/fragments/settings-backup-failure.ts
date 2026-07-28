export const smokeSettingsBackupFailure = String.raw`          const beforeBackupImportRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE id = ? AND works.library_id = ?",
            [backupImportWorkId, libraryId]
          );
          const cancelledBackupTransfer = new DataTransfer();
          cancelledBackupTransfer.items.add(backupImportFile);
          Object.defineProperty(backupImportInput, "files", {
            configurable: true,
            value: cancelledBackupTransfer.files
          });
          backupImportInput.dispatchEvent(new Event("change", { bubbles: true }));
          const backupImportDialog = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("合并导入整库备份") ? dialog : null;
          }, 3_000);
          settingsBackupImportConfirmVisible = Boolean(
            backupImportDialog?.textContent?.includes("aurascholar-backup-import-smoke.json") &&
              backupImportDialog.textContent.includes("不会覆盖当前内容") &&
              backupImportDialog.textContent.includes(
                "将忽略 3 个不支持或运行态数据表（graph_cache、translation_cache、future_smoke_table）"
              ) &&
              backupImportDialog.textContent.includes("缓存、同步运行态和本机临时数据会在使用时重新生成")
          );
          const cancelBackupImport = Array.from(
            backupImportDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
          cancelBackupImport?.click();
          await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
          const cancelledBackupRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE id = ? AND works.library_id = ?",
            [backupImportWorkId, libraryId]
          );
          settingsBackupImportCancelPreserved =
            settingsBackupImportConfirmVisible &&
            Number(beforeBackupImportRows[0]?.n ?? 0) === 0 &&
            Number(cancelledBackupRows[0]?.n ?? 0) === 0 &&
            bodyIncludes("已取消导入备份");

          const ignoredOnlyGraphCacheKey = "smoke-backup-ignored-only-graph-cache";
          const ignoredOnlyTranslationCacheKey = "smoke-backup-ignored-only-translation-cache";
          const ignoredOnlyPayload = {
            version: 1,
            exportedAt: new Date(now).toISOString(),
            tables: {
              graph_cache: [
                {
                  work_id: ignoredOnlyGraphCacheKey,
                  payload_json: JSON.stringify({ stale: "ignored-only-graph-cache" }),
                  fetched_at: now
                }
              ],
              translation_cache: [
                {
                  cache_key: ignoredOnlyTranslationCacheKey,
                  engine: "smoke-ignored-only-cache",
                  target_lang: "zh",
                  result: "ignored-only-translation-cache",
                  created_at: now
                }
              ],
              future_smoke_ignored_only: [{ id: "ignored-only" }]
            }
          };
          const ignoredOnlyFile = new File(
            [JSON.stringify(ignoredOnlyPayload)],
            "aurascholar-backup-ignored-only-smoke.json",
            { type: "application/json" }
          );
          const ignoredOnlyTransfer = new DataTransfer();
          ignoredOnlyTransfer.items.add(ignoredOnlyFile);
          Object.defineProperty(backupImportInput, "files", {
            configurable: true,
            value: ignoredOnlyTransfer.files
          });
          backupImportInput.dispatchEvent(new Event("change", { bubbles: true }));
          await waitFor(
            () =>
              bodyIncludes("备份文件里没有可导入的用户数据") &&
              bodyIncludes(
                "已识别并忽略 3 个不支持或运行态数据表（graph_cache、translation_cache、future_smoke_ignored_only）"
              ),
            3_000
          );
          const ignoredOnlyGraphRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM graph_cache WHERE work_id = ?",
            [ignoredOnlyGraphCacheKey]
          );
          const ignoredOnlyTranslationRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM translation_cache WHERE cache_key = ?",
            [ignoredOnlyTranslationCacheKey]
          );
          settingsBackupImportIgnoredOnlyExplained =
            !document.querySelector('[role="dialog"]') &&
            Number(ignoredOnlyGraphRows[0]?.n ?? 0) === 0 &&
            Number(ignoredOnlyTranslationRows[0]?.n ?? 0) === 0 &&
            bodyIncludes("备份文件里没有可导入的用户数据") &&
            bodyIncludes(
              "已识别并忽略 3 个不支持或运行态数据表（graph_cache、translation_cache、future_smoke_ignored_only）"
            );

          const backupFailureWorkId = "smoke-backup-import-rollback-work";
          const backupFailureAuthorId = "smoke-backup-import-rollback-author";
          const backupFailureSettingKey = "safe.setting.import-rollback-smoke";
          const backupFailurePayload = {
            version: 1,
            exportedAt: new Date(now).toISOString(),
            tables: {
              settings: [
                {
                  key: backupFailureSettingKey,
                  value_json: JSON.stringify({ label: "rollback" }),
                  scope: "local",
                  updated_at: now
                }
              ],
              works: [
                {
                  id: backupFailureWorkId,
                  doi: "10.4242/aurascholar.backup-import-rollback",
                  title: "Backup Import Rollback Smoke Work",
                  abstract: "This row must roll back if a later backup table fails.",
                  year: 2026,
                  publication_date: "2026",
                  venue_name: "Journal of Backup Rollbacks",
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
                  id: backupFailureAuthorId,
                  display_name: "Backup Rollback Author",
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                }
              ]
            }
          };
          const backupFailureFile = new File(
            [JSON.stringify(backupFailurePayload)],
            "aurascholar-backup-import-rollback-smoke.json",
            { type: "application/json" }
          );
          const backupFailureTransfer = new DataTransfer();
          backupFailureTransfer.items.add(backupFailureFile);
          Object.defineProperty(backupImportInput, "files", {
            configurable: true,
            value: backupFailureTransfer.files
          });
          backupImportInput.dispatchEvent(new Event("change", { bubbles: true }));
          const backupFailureDialog = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("合并导入整库备份") ? dialog : null;
          }, 3_000);
          const confirmBackupFailureImport = Array.from(
            backupFailureDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "合并导入");
          await window.aura.db.run(
            "CREATE TEMP TRIGGER aurascholar_smoke_backup_import_failure BEFORE INSERT ON authors WHEN NEW.id = 'smoke-backup-import-rollback-author' BEGIN SELECT RAISE(FAIL, 'Smoke backup import rollback failure'); END;"
          );
          try {
            confirmBackupFailureImport?.click();
            settingsBackupImportFailureBusyVisible = Boolean(
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
            await waitFor(
              () =>
                bodyIncludes("导入失败，当前库未写入任何备份数据，可重新导入") &&
                bodyIncludes("Smoke backup import rollback failure"),
              4_000
            );
            settingsBackupImportFailureVisible =
              bodyIncludes("导入失败，当前库未写入任何备份数据，可重新导入") &&
              bodyIncludes("Smoke backup import rollback failure");
          } finally {
            await window.aura.db.run(
              "DROP TRIGGER IF EXISTS aurascholar_smoke_backup_import_failure"
            );
          }
          const failedImportWorkRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE id = ? AND works.library_id = ?",
            [backupFailureWorkId, libraryId]
          );
          const failedImportAuthorRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM authors WHERE id = ? AND authors.library_id = ?",
            [backupFailureAuthorId, libraryId]
          );
          const failedImportSettingRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM settings WHERE key = ?",
            [backupFailureSettingKey]
          );
          settingsBackupImportFailureDidNotPersist =
            Number(failedImportWorkRows[0]?.n ?? 0) === 0 &&
            Number(failedImportAuthorRows[0]?.n ?? 0) === 0 &&
            Number(failedImportSettingRows[0]?.n ?? 0) === 0;
          settingsBackupImportFailureRetryVisible = Boolean(
            await waitFor(() => {
              const button = backupImportButton();
              return button &&
                !button.disabled &&
                bodyIncludes("导入失败，当前库未写入任何备份数据，可重新导入")
                ? button
                : null;
            }, 1_000)
          );

`;
