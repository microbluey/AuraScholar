export const smokeLibraryTags = String.raw`        findButton("管理标签")?.click();
        const tagManagerDialog = await waitFor(() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
            item.textContent?.includes("管理标签")
          );
          return dialog?.textContent?.includes(TAG_MANAGER_SMOKE.name) ? dialog : null;
        }, 3_000);
        if (tagManagerDialog) {
          const tagManagerRow = Array.from(
            tagManagerDialog.querySelectorAll(".library-tag-manager__row")
          ).find((row) => row.textContent?.includes(TAG_MANAGER_SMOKE.name));
          const tagRenameRowsBefore = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS tags WHERE id = ? AND deleted_at IS NULL AND name = ?) AS original_count, (SELECT COUNT(*) FROM (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS tags WHERE deleted_at IS NULL AND name = ?) AS draft_count",
            [libraryId, TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.name, TAG_RENAME_FAILURE_SMOKE.name]
          );
          const tagRenameButton = Array.from(tagManagerRow?.querySelectorAll("button") ?? []).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "重命名"
          );
          tagRenameButton?.click();
          const tagRenamePrompt = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll(".library-prompt-modal")).find((item) =>
              item.textContent?.includes("重命名标签")
            );
            return dialog?.querySelector("input") ? dialog : null;
          }, 1_000);
          const tagRenameInput = tagRenamePrompt?.querySelector("input");
          if (tagRenameInput) {
            setInputValue(tagRenameInput, TAG_RENAME_FAILURE_SMOKE.name);
          }
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RENAME__ =
            TAG_RENAME_FAILURE_SMOKE.error;
          try {
            const tagRenameSubmit = Array.from(
              tagRenamePrompt?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存");
            tagRenameSubmit?.click();
            libraryTagRenameFailureBusyVisible = Boolean(
              await waitFor(() => {
                const prompt = Array.from(document.querySelectorAll(".library-prompt-modal")).find(
                  (item) => item.textContent?.includes("重命名标签")
                );
                return prompt?.getAttribute("aria-busy") === "true" &&
                  prompt.textContent?.includes("处理中") &&
                  bodyIncludes("正在重命名标签")
                  ? prompt
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("重命名标签失败，名称仍保留，可重新保存") &&
                bodyIncludes(TAG_RENAME_FAILURE_SMOKE.error),
              3_000
            );
          } finally {
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RENAME__;
          }
          const tagRenameRowsAfter = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS tags WHERE id = ? AND deleted_at IS NULL AND name = ?) AS original_count, (SELECT COUNT(*) FROM (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS tags WHERE deleted_at IS NULL AND name = ?) AS draft_count",
            [libraryId, TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.name, TAG_RENAME_FAILURE_SMOKE.name]
          );
          const tagRenamePromptAfter = Array.from(document.querySelectorAll(".library-prompt-modal")).find(
            (item) => item.textContent?.includes("重命名标签")
          );
          const tagRenameInputAfter = tagRenamePromptAfter?.querySelector("input");
          const tagRenameSubmitAfter = Array.from(
            tagRenamePromptAfter?.querySelectorAll("button") ?? []
          ).find((button) => /保存|处理中/.test(button.textContent?.replace(/\s+/g, " ").trim() ?? ""));
          libraryTagRenameFailureVisible =
            bodyIncludes("重命名标签失败，名称仍保留，可重新保存") &&
            bodyIncludes(TAG_RENAME_FAILURE_SMOKE.error);
          libraryTagRenameFailurePreserved = Boolean(
            tagRenameInputAfter?.value === TAG_RENAME_FAILURE_SMOKE.name &&
              tagRenameSubmitAfter &&
              !tagRenameSubmitAfter.disabled
          );
          libraryTagRenameFailureDidNotPersist =
            Number(tagRenameRowsBefore[0]?.original_count ?? 0) ===
              Number(tagRenameRowsAfter[0]?.original_count ?? -1) &&
            Number(tagRenameRowsBefore[0]?.draft_count ?? 0) ===
              Number(tagRenameRowsAfter[0]?.draft_count ?? -1);
          const tagRenameCancel = Array.from(
            tagRenamePromptAfter?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
          tagRenameCancel?.click();
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.classList.contains("library-prompt-modal") &&
                item.textContent?.includes("重命名标签")
              ),
            1_000
          );
          const tagDeleteFailureRowsBefore = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS tags WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS tags WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM work_tags WHERE tag_id = ? AND work_id = ?) AS item_count",
            [libraryId, TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id, MISSING_PDF.workId]
          );
          const tagManagerRowForFailedDelete = Array.from(
            tagManagerDialog.querySelectorAll(".library-tag-manager__row")
          ).find((row) => row.textContent?.includes(TAG_MANAGER_SMOKE.name));
          const tagFailedDeleteButton = Array.from(
            tagManagerRowForFailedDelete?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除");
          tagFailedDeleteButton?.click();
          const tagFailedDeleteConfirm = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("删除标签？")
            );
            return dialog?.textContent?.includes(TAG_MANAGER_SMOKE.name) ? dialog : null;
          }, 1_000);
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_DELETE__ =
            TAG_DELETE_FAILURE_SMOKE.error;
          try {
            const tagFailedDeleteConfirmButton = Array.from(
              tagFailedDeleteConfirm?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除标签");
            tagFailedDeleteConfirmButton?.click();
            libraryTagDeleteFailureBusyVisible = Boolean(
              await waitFor(() => {
                const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find(
                  (item) => item.textContent?.includes("管理标签")
                );
                const row = Array.from(
                  manager?.querySelectorAll(".library-tag-manager__row") ?? []
                ).find((item) => item.textContent?.includes(TAG_MANAGER_SMOKE.name));
                const busyButton = Array.from(row?.querySelectorAll("button") ?? []).find(
                  (button) => button.getAttribute("aria-busy") === "true"
                );
                return manager?.getAttribute("aria-busy") === "true" &&
                  row?.getAttribute("aria-busy") === "true" &&
                  busyButton?.disabled &&
                  busyButton.textContent?.includes("删除中") &&
                  manager.textContent?.includes("正在删除标签")
                  ? row
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("删除标签失败，标签仍保留，可重新删除") &&
                bodyIncludes(TAG_DELETE_FAILURE_SMOKE.error),
              3_000
            );
          } finally {
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_DELETE__;
          }
          const tagDeleteFailureRowsAfter = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS tags WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS tags WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM work_tags WHERE tag_id = ? AND work_id = ?) AS item_count",
            [libraryId, TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id, MISSING_PDF.workId]
          );
          const tagManagerDialogAfterFailedDelete = Array.from(
            document.querySelectorAll('[role="dialog"]')
          ).find((item) => item.textContent?.includes("管理标签"));
          const tagFailedDeleteRowAfter = Array.from(
            tagManagerDialogAfterFailedDelete?.querySelectorAll(".library-tag-manager__row") ?? []
          ).find((row) => row.textContent?.includes(TAG_MANAGER_SMOKE.name));
          const tagFailedDeleteButtonAfter = Array.from(
            tagFailedDeleteRowAfter?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除");
          libraryTagDeleteFailureVisible = Boolean(
            tagManagerDialogAfterFailedDelete?.textContent?.includes(
              "删除标签失败，标签仍保留，可重新删除"
            ) &&
              tagManagerDialogAfterFailedDelete.textContent.includes(TAG_DELETE_FAILURE_SMOKE.error)
          );
          libraryTagDeleteFailurePreserved = Boolean(
            tagFailedDeleteRowAfter &&
              tagFailedDeleteButtonAfter &&
              !tagFailedDeleteButtonAfter.disabled &&
              tagFailedDeleteButtonAfter.getAttribute("aria-busy") !== "true" &&
              !tagManagerDialogAfterFailedDelete?.querySelector(
                'button[aria-label="撤销删除标签"]'
              )
          );
          libraryTagDeleteFailureDidNotPersist =
            Number(tagDeleteFailureRowsBefore[0]?.active_count ?? 0) ===
              Number(tagDeleteFailureRowsAfter[0]?.active_count ?? -1) &&
            Number(tagDeleteFailureRowsBefore[0]?.deleted_count ?? 0) ===
              Number(tagDeleteFailureRowsAfter[0]?.deleted_count ?? -1) &&
            Number(tagDeleteFailureRowsBefore[0]?.item_count ?? 0) ===
              Number(tagDeleteFailureRowsAfter[0]?.item_count ?? -1);
          const tagManagerRowForDelete = Array.from(
            tagManagerDialogAfterFailedDelete?.querySelectorAll(".library-tag-manager__row") ?? []
          ).find((row) => row.textContent?.includes(TAG_MANAGER_SMOKE.name));
          const tagDeleteButton = Array.from(
            tagManagerRowForDelete?.querySelectorAll("button") ?? []
          ).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除"
          );
          tagDeleteButton?.click();
          const tagDeleteConfirm = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("删除标签？")
            );
            return dialog?.textContent?.includes(TAG_MANAGER_SMOKE.name) ? dialog : null;
          }, 1_000);
          const tagDeleteConfirmButton = Array.from(
            tagDeleteConfirm?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除标签");
          tagDeleteConfirmButton?.click();
          libraryTagDeleteBusyVisible = Boolean(
            await waitFor(() => {
              const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find(
                (item) => item.textContent?.includes("管理标签")
              );
              const row = Array.from(
                manager?.querySelectorAll(".library-tag-manager__row") ?? []
              ).find((item) => item.textContent?.includes(TAG_MANAGER_SMOKE.name));
              const busyButton = Array.from(row?.querySelectorAll("button") ?? []).find(
                (button) => button.getAttribute("aria-busy") === "true"
              );
              return manager?.getAttribute("aria-busy") === "true" &&
                row?.getAttribute("aria-busy") === "true" &&
                busyButton?.disabled &&
                busyButton.textContent?.includes("删除中") &&
                manager.textContent?.includes("正在删除标签")
                ? row
                : null;
            }, 1_000)
          );
          const tagDeleteSuccessDialog = await waitFor(() => {
            const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("管理标签")
            );
            return manager?.textContent?.includes("已删除标签「" + TAG_MANAGER_SMOKE.name + "」")
              ? manager
              : null;
          }, 3_000);
          libraryTagDeleteSuccessVisible = Boolean(tagDeleteSuccessDialog);
          const tagDeleteRows = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS tags WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM work_tags WHERE tag_id = ?) AS item_count",
            [libraryId, TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id]
          );
          libraryTagDeletePersisted =
            Number(tagDeleteRows[0]?.deleted_count ?? 0) === 1 &&
            Number(tagDeleteRows[0]?.item_count ?? 0) === 0;
          const tagDeleteUndoButton = await waitFor(
            () => document.querySelector('button[aria-label="撤销删除标签"]'),
            1_000
          );
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RESTORE__ =
            TAG_RESTORE_FAILURE_SMOKE.error;
          try {
            tagDeleteUndoButton?.click();
            libraryTagDeleteUndoFailureBusyVisible = Boolean(
              await waitFor(() => {
                const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find(
                  (item) => item.textContent?.includes("管理标签")
                );
                const undoButton = manager?.querySelector('button[aria-label="撤销删除标签"]');
                return manager?.getAttribute("aria-busy") === "true" &&
                  undoButton?.getAttribute("aria-busy") === "true" &&
                  undoButton.disabled &&
                  undoButton.textContent?.includes("撤销中") &&
                  manager.textContent?.includes("正在恢复标签")
                  ? undoButton
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("恢复标签失败，撤销入口仍保留，可重新撤销") &&
                bodyIncludes(TAG_RESTORE_FAILURE_SMOKE.error),
              3_000
            );
          } finally {
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RESTORE__;
          }
          const tagRestoreFailureRows = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS tags WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS tags WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM work_tags WHERE tag_id = ? AND work_id = ?) AS item_count",
            [libraryId, TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id, MISSING_PDF.workId]
          );
          const tagManagerDialogAfterFailedRestore = Array.from(
            document.querySelectorAll('[role="dialog"]')
          ).find((item) => item.textContent?.includes("管理标签"));
          const tagDeleteUndoButtonAfterFailure = await waitFor(() => {
            const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("管理标签")
            );
            const undoButton = manager?.querySelector('button[aria-label="撤销删除标签"]');
            return undoButton &&
              !undoButton.disabled &&
              undoButton.getAttribute("aria-busy") !== "true"
              ? undoButton
              : null;
          }, 1_000);
          libraryTagDeleteUndoFailureVisible = Boolean(
            tagManagerDialogAfterFailedRestore?.textContent?.includes(
              "恢复标签失败，撤销入口仍保留，可重新撤销"
            ) &&
              tagManagerDialogAfterFailedRestore.textContent.includes(
                TAG_RESTORE_FAILURE_SMOKE.error
              )
          );
          libraryTagDeleteUndoFailurePreserved = Boolean(
            tagDeleteUndoButtonAfterFailure &&
              !tagManagerDialogAfterFailedRestore?.textContent?.includes("正在恢复标签")
          );
          libraryTagDeleteUndoFailureDidNotPersist =
            Number(tagRestoreFailureRows[0]?.active_count ?? -1) === 0 &&
            Number(tagRestoreFailureRows[0]?.deleted_count ?? -1) === 1 &&
            Number(tagRestoreFailureRows[0]?.item_count ?? -1) === 0;
          tagDeleteUndoButtonAfterFailure?.click();
          libraryTagDeleteUndoBusyVisible = Boolean(
            await waitFor(() => {
              const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find(
                (item) => item.textContent?.includes("管理标签")
              );
              const undoButton = manager?.querySelector('button[aria-label="撤销删除标签"]');
              return manager?.getAttribute("aria-busy") === "true" &&
                undoButton?.getAttribute("aria-busy") === "true" &&
                undoButton.disabled &&
                undoButton.textContent?.includes("撤销中") &&
                manager.textContent?.includes("正在恢复标签")
                ? undoButton
                : null;
            }, 1_000)
          );
          const tagRestoreDialog = await waitFor(() => {
            const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("管理标签")
            );
            return manager?.textContent?.includes("已恢复标签「" + TAG_MANAGER_SMOKE.name + "」")
              ? manager
              : null;
          }, 3_000);
          const tagRestoreRows = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS tags WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM work_tags WHERE tag_id = ? AND work_id = ?) AS item_count",
            [libraryId, TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id, MISSING_PDF.workId]
          );
          libraryTagDeleteUndoRecovered =
            Boolean(tagRestoreDialog?.textContent?.includes(TAG_MANAGER_SMOKE.name)) &&
            Number(tagRestoreRows[0]?.active_count ?? 0) === 1 &&
            Number(tagRestoreRows[0]?.item_count ?? 0) === 1;
          const closeButton = tagDeleteSuccessDialog?.querySelector(
            'button[aria-label="关闭管理标签"]'
          );
          closeButton?.click();
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("管理标签")
              ),
            1_000
          );
        }

`;
