export const smokeSettingsBackupValidation = String.raw`          const invalidBackupFile = new File(["{"], "bad-backup.json", {
            type: "application/json"
          });
          const invalidBackupTransfer = new DataTransfer();
          invalidBackupTransfer.items.add(invalidBackupFile);
          Object.defineProperty(backupImportInput, "files", {
            configurable: true,
            value: invalidBackupTransfer.files
          });
          backupImportInput.dispatchEvent(new Event("change", { bubbles: true }));
          await waitFor(
            () =>
              bodyIncludes("导入失败，当前库未写入任何备份数据，可重新导入：备份文件不是有效的 JSON。"),
            3_000
          );
          settingsBackupImportRejectsInvalidVisible = bodyIncludes(
            "导入失败，当前库未写入任何备份数据，可重新导入：备份文件不是有效的 JSON。"
          );

          const futureVersionBackupFile = new File(
            [
              JSON.stringify({
                version: 4,
                exportedAt: new Date(now).toISOString(),
                tables: {
                  works: [
                    {
                      id: "smoke-backup-future-version-work",
                      title: "Future Version Backup Work",
                      created_at: now,
                      updated_at: now,
                      deleted_at: null
                    }
                  ]
                }
              })
            ],
            "future-backup.json",
            { type: "application/json" }
          );
          const futureVersionBackupTransfer = new DataTransfer();
          futureVersionBackupTransfer.items.add(futureVersionBackupFile);
          Object.defineProperty(backupImportInput, "files", {
            configurable: true,
            value: futureVersionBackupTransfer.files
          });
          backupImportInput.dispatchEvent(new Event("change", { bubbles: true }));
          await waitFor(
            () =>
              bodyIncludes("导入失败，当前库未写入任何备份数据，可重新导入") &&
              bodyIncludes("备份文件版本 4 高于当前支持的版本 3") &&
              bodyIncludes("请先升级 AuraScholar 后再导入"),
            3_000
          );
          const futureVersionRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE id = ? AND works.library_id = ?",
            ["smoke-backup-future-version-work", libraryId]
          );
          settingsBackupImportRejectsFutureVersionVisible =
            Number(futureVersionRows[0]?.n ?? 0) === 0 &&
            bodyIncludes("备份文件版本 4 高于当前支持的版本 3") &&
            bodyIncludes("请先升级 AuraScholar 后再导入");

          location.hash = "#/library";
          await waitFor(
            () => location.hash.includes("/library") && bodyIncludes("文献库"),
            3_000
          );
          const backupSearchInput = await waitFor(
            () => document.querySelector('input[placeholder="在结果中搜索"]'),
            3_000
          );
          if (backupSearchInput) {
            setInputValue(backupSearchInput, "Backup Import Smoke Work");
            await waitFor(() => rowText().includes("Backup Import Smoke Work"), 3_000);
          }
          clickRowByTitle("Backup Import Smoke Work");
          await waitFor(
            () =>
              (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
                "Backup Import Smoke Work"
              ) && bodyIncludes("上传 PDF"),
            3_000
          );
          const backupPdfInput = Array.from(
            document.querySelectorAll('input[type="file"][accept="application/pdf"]')
          )[1];
          if (backupPdfInput) {
            const backupPdfFile = new File(
              [makeSmokePdf("Backup Import Restored PDF")],
              "backup-import-restored.pdf",
              { type: "application/pdf" }
            );
            const backupPdfTransfer = new DataTransfer();
            backupPdfTransfer.items.add(backupPdfFile);
            Object.defineProperty(backupPdfInput, "files", {
              configurable: true,
              value: backupPdfTransfer.files
            });
            backupPdfInput.dispatchEvent(new Event("change", { bubbles: true }));
            await waitFor(
              () =>
                bodyIncludes("已为《Backup Import Smoke Work》上传 PDF") &&
                bodyIncludes("已恢复 1 条备份批注"),
              4_000
          );
          const restoredRows = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM annotations ann JOIN attachments att ON att.id = ann.attachment_id WHERE ann.id = ? AND ann.attachment_id != ? AND ann.deleted_at IS NULL AND att.work_id = ? AND att.deleted_at IS NULL",
              [backupImportAnnotationId, backupImportAttachmentId, backupImportWorkId]
            );
            settingsBackupImportReattachAnnotationRestored =
              Number(restoredRows[0]?.n ?? 0) === 1;
          }

          location.hash = "#/settings";
          await waitFor(
            () =>
              location.hash.includes("/settings") &&
              bodyIncludes("设置") &&
              bodyIncludes("阅读翻译"),
            4_000
          );
          await waitFor(
            () =>
              !bodyIncludes("正在读取 AI 配置") &&
              !bodyIncludes("正在读取翻译配置") &&
              !bodyIncludes("正在读取同步配置"),
            4_000
          );
        }

`;
