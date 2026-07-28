export const smokeLibraryCollections = String.raw`        const collectionManagerDialog = await waitFor(() => {
          const dialog = document.querySelector('[data-library-dialog="collection-manager"]');
          return dialog?.textContent?.includes(COLLECTION_MANAGER_SMOKE.name) ? dialog : null;
        }, 3_000);
        if (collectionManagerDialog) {
          window.dispatchEvent(
            new CustomEvent("aurascholar:move-collection", {
              detail: {
                id: COLLECTION_MANAGER_SMOKE.id,
                parentId: MOVE_COLLECTION_SMOKE.id,
                position: 0
              }
            })
          );
          libraryCollectionMoveSuccessVisible = Boolean(
            await waitFor(
              () =>
                bodyIncludes(
                  "已移动文件夹「" + COLLECTION_MANAGER_SMOKE.name + "」"
                ),
              3_000
            )
          );
          const collectionMoveRows = await window.aura.db.query(
            "SELECT parent_id, sort_order FROM collections WHERE id = ? AND library_id = ? AND deleted_at IS NULL LIMIT 1",
            [COLLECTION_MANAGER_SMOKE.id, libraryId]
          );
          libraryCollectionMovePersisted =
            collectionMoveRows[0]?.parent_id === MOVE_COLLECTION_SMOKE.id &&
            Number(collectionMoveRows[0]?.sort_order ?? -1) === 0;

          const collectionCreateRowsBefore = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM collections WHERE deleted_at IS NULL AND name = ? AND collections.library_id = ?",
            [COLLECTION_CREATE_FAILURE_SMOKE.name, libraryId]
          );
          const collectionCreateButton = collectionManagerDialog.querySelector(
            '[data-library-action="create-collection"]'
          );
          collectionCreateButton?.click();
          const collectionCreatePrompt = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("新建文件夹")
            );
            return dialog?.querySelector("input") ? dialog : null;
          }, 1_000);
          const collectionCreateInput = collectionCreatePrompt?.querySelector("input");
          if (collectionCreateInput) {
            setInputValue(collectionCreateInput, COLLECTION_CREATE_FAILURE_SMOKE.name);
          }
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_CREATE__ =
            COLLECTION_CREATE_FAILURE_SMOKE.error;
          try {
            const collectionCreateSubmit = Array.from(
              collectionCreatePrompt?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "创建");
            collectionCreateSubmit?.click();
            libraryCollectionCreateFailureBusyVisible = Boolean(
              await waitFor(() => {
                const prompt = Array.from(document.querySelectorAll('[role="dialog"]')).find(
                  (item) => item.textContent?.includes("新建文件夹")
                );
                const button = Array.from(prompt?.querySelectorAll("button") ?? []).find(
                  (item) => item.getAttribute("aria-busy") === "true"
                );
                return prompt?.getAttribute("aria-busy") === "true" &&
                  button?.disabled &&
                  button.textContent?.includes("处理中") &&
                  bodyIncludes("正在创建文件夹")
                  ? prompt
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("创建文件夹失败，名称仍保留，可重新创建") &&
                bodyIncludes(COLLECTION_CREATE_FAILURE_SMOKE.error),
              3_000
            );
          } finally {
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_CREATE__;
          }
          const collectionCreateRowsAfter = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM collections WHERE deleted_at IS NULL AND name = ? AND collections.library_id = ?",
            [COLLECTION_CREATE_FAILURE_SMOKE.name, libraryId]
          );
          const collectionCreatePromptAfter = Array.from(
            document.querySelectorAll('[role="dialog"]')
          ).find((item) => item.textContent?.includes("新建文件夹"));
          const collectionCreateInputAfter = collectionCreatePromptAfter?.querySelector("input");
          const collectionCreateSubmitAfter = Array.from(
            collectionCreatePromptAfter?.querySelectorAll("button") ?? []
          ).find((button) => /创建|处理中/.test(button.textContent?.replace(/\s+/g, " ").trim() ?? ""));
          libraryCollectionCreateFailureVisible =
            bodyIncludes("创建文件夹失败，名称仍保留，可重新创建") &&
            bodyIncludes(COLLECTION_CREATE_FAILURE_SMOKE.error);
          libraryCollectionCreateFailurePreserved = Boolean(
            collectionCreateInputAfter?.value === COLLECTION_CREATE_FAILURE_SMOKE.name &&
              collectionCreateSubmitAfter &&
              !collectionCreateSubmitAfter.disabled
          );
          libraryCollectionCreateFailureDidNotPersist =
            Number(collectionCreateRowsBefore[0]?.n ?? 0) ===
            Number(collectionCreateRowsAfter[0]?.n ?? -1);
          const collectionCreateCancel = Array.from(
            collectionCreatePromptAfter?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
          collectionCreateCancel?.click();
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("新建文件夹")
              ),
            1_000
          );
          const collectionManagerRow = collectionManagerDialog.querySelector(
            '[data-collection-id="' + CSS.escape(COLLECTION_MANAGER_SMOKE.id) + '"]'
          );
          const collectionRenameRowsBefore = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM collections WHERE library_id = (SELECT id FROM current_library)) AS collections WHERE id = ? AND deleted_at IS NULL AND name = ?) AS original_count, (SELECT COUNT(*) FROM (SELECT * FROM collections WHERE library_id = (SELECT id FROM current_library)) AS collections WHERE deleted_at IS NULL AND name = ?) AS draft_count",
            [libraryId,
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.name,
              COLLECTION_RENAME_FAILURE_SMOKE.name
            ]
          );
          const collectionRenameButton = collectionManagerRow?.querySelector(
            '[data-library-action="rename-collection"]'
          );
          collectionRenameButton?.click();
          const collectionRenamePrompt = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll(".library-prompt-modal")).find((item) =>
              item.textContent?.includes("重命名文件夹")
            );
            return dialog?.querySelector("input") ? dialog : null;
          }, 1_000);
          const collectionRenameInput = collectionRenamePrompt?.querySelector("input");
          if (collectionRenameInput) {
            setInputValue(collectionRenameInput, COLLECTION_RENAME_FAILURE_SMOKE.name);
          }
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RENAME__ =
            COLLECTION_RENAME_FAILURE_SMOKE.error;
          try {
            const collectionRenameSubmit = Array.from(
              collectionRenamePrompt?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存");
            collectionRenameSubmit?.click();
            libraryCollectionRenameFailureBusyVisible = Boolean(
              await waitFor(() => {
                const prompt = Array.from(document.querySelectorAll(".library-prompt-modal")).find(
                  (item) => item.textContent?.includes("重命名文件夹")
                );
                return prompt?.getAttribute("aria-busy") === "true" &&
                  prompt.textContent?.includes("处理中") &&
                  bodyIncludes("正在重命名文件夹")
                  ? prompt
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("重命名文件夹失败，名称仍保留，可重新保存") &&
                bodyIncludes(COLLECTION_RENAME_FAILURE_SMOKE.error),
              3_000
            );
          } finally {
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RENAME__;
          }
          const collectionRenameRowsAfter = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM collections WHERE library_id = (SELECT id FROM current_library)) AS collections WHERE id = ? AND deleted_at IS NULL AND name = ?) AS original_count, (SELECT COUNT(*) FROM (SELECT * FROM collections WHERE library_id = (SELECT id FROM current_library)) AS collections WHERE deleted_at IS NULL AND name = ?) AS draft_count",
            [libraryId,
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.name,
              COLLECTION_RENAME_FAILURE_SMOKE.name
            ]
          );
          const collectionRenamePromptAfter = Array.from(
            document.querySelectorAll(".library-prompt-modal")
          ).find((item) => item.textContent?.includes("重命名文件夹"));
          const collectionRenameInputAfter = collectionRenamePromptAfter?.querySelector("input");
          const collectionRenameSubmitAfter = Array.from(
            collectionRenamePromptAfter?.querySelectorAll("button") ?? []
          ).find((button) => /保存|处理中/.test(button.textContent?.replace(/\s+/g, " ").trim() ?? ""));
          libraryCollectionRenameFailureVisible =
            bodyIncludes("重命名文件夹失败，名称仍保留，可重新保存") &&
            bodyIncludes(COLLECTION_RENAME_FAILURE_SMOKE.error);
          libraryCollectionRenameFailurePreserved = Boolean(
            collectionRenameInputAfter?.value === COLLECTION_RENAME_FAILURE_SMOKE.name &&
              collectionRenameSubmitAfter &&
              !collectionRenameSubmitAfter.disabled
          );
          libraryCollectionRenameFailureDidNotPersist =
            Number(collectionRenameRowsBefore[0]?.original_count ?? 0) ===
              Number(collectionRenameRowsAfter[0]?.original_count ?? -1) &&
            Number(collectionRenameRowsBefore[0]?.draft_count ?? 0) ===
              Number(collectionRenameRowsAfter[0]?.draft_count ?? -1);
          const collectionRenameCancel = Array.from(
            collectionRenamePromptAfter?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
          collectionRenameCancel?.click();
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.classList.contains("library-prompt-modal") &&
                item.textContent?.includes("重命名文件夹")
              ),
            1_000
          );
          const collectionDeleteFailureRowsBefore = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM collections WHERE library_id = (SELECT id FROM current_library)) AS collections WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM (SELECT * FROM collections WHERE library_id = (SELECT id FROM current_library)) AS collections WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM collection_items WHERE collection_id = ? AND work_id = ?) AS item_count",
            [libraryId,
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.id,
              MISSING_PDF.workId
            ]
          );
          const collectionManagerRowForFailedDelete = collectionManagerDialog.querySelector(
            '[data-collection-id="' + CSS.escape(COLLECTION_MANAGER_SMOKE.id) + '"]'
          );
          const collectionFailedDeleteButton = collectionManagerRowForFailedDelete?.querySelector(
            '[data-library-action="delete-collection"]'
          );
          collectionFailedDeleteButton?.click();
          const collectionFailedDeleteConfirm = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("删除文件夹？")
            );
            return dialog?.textContent?.includes(COLLECTION_MANAGER_SMOKE.name) ? dialog : null;
          }, 1_000);
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_DELETE__ =
            COLLECTION_DELETE_FAILURE_SMOKE.error;
          try {
            const collectionFailedDeleteConfirmButton = Array.from(
              collectionFailedDeleteConfirm?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除文件夹");
            collectionFailedDeleteConfirmButton?.click();
            libraryCollectionDeleteFailureBusyVisible = Boolean(
              await waitFor(() => {
                const manager = document.querySelector(
                  '[data-library-dialog="collection-manager"]'
                );
                const row = manager?.querySelector(
                  '[data-collection-id="' + CSS.escape(COLLECTION_MANAGER_SMOKE.id) + '"]'
                );
                const busyButton = row?.querySelector(
                  '[data-library-action="delete-collection"]'
                );
                return manager?.getAttribute("aria-busy") === "true" &&
                  row?.getAttribute("aria-busy") === "true" &&
                  busyButton?.disabled &&
                  busyButton.textContent?.includes("删除中") &&
                  manager.textContent?.includes("正在删除文件夹")
                  ? row
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("删除文件夹失败，文件夹仍保留，可重新删除") &&
                bodyIncludes(COLLECTION_DELETE_FAILURE_SMOKE.error),
              3_000
            );
          } finally {
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_DELETE__;
          }
          const collectionDeleteFailureRowsAfter = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM collections WHERE library_id = (SELECT id FROM current_library)) AS collections WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM (SELECT * FROM collections WHERE library_id = (SELECT id FROM current_library)) AS collections WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM collection_items WHERE collection_id = ? AND work_id = ?) AS item_count",
            [libraryId,
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.id,
              MISSING_PDF.workId
            ]
          );
          const collectionManagerDialogAfterFailedDelete = document.querySelector(
            '[data-library-dialog="collection-manager"]'
          );
          const collectionFailedDeleteRowAfter =
            collectionManagerDialogAfterFailedDelete?.querySelector(
              '[data-collection-id="' + CSS.escape(COLLECTION_MANAGER_SMOKE.id) + '"]'
            );
          const collectionFailedDeleteButtonAfter = collectionFailedDeleteRowAfter?.querySelector(
            '[data-library-action="delete-collection"]'
          );
          libraryCollectionDeleteFailureVisible = Boolean(
            collectionManagerDialogAfterFailedDelete?.textContent?.includes(
              "删除文件夹失败，文件夹仍保留，可重新删除"
            ) &&
              collectionManagerDialogAfterFailedDelete.textContent.includes(
                COLLECTION_DELETE_FAILURE_SMOKE.error
              )
          );
          libraryCollectionDeleteFailurePreserved = Boolean(
            collectionFailedDeleteRowAfter &&
              collectionFailedDeleteButtonAfter &&
              !collectionFailedDeleteButtonAfter.disabled &&
              collectionFailedDeleteButtonAfter.getAttribute("aria-busy") !== "true" &&
              !collectionManagerDialogAfterFailedDelete?.querySelector(
                '[data-library-action="restore-collection"]'
              )
          );
          libraryCollectionDeleteFailureDidNotPersist =
            Number(collectionDeleteFailureRowsBefore[0]?.active_count ?? 0) ===
              Number(collectionDeleteFailureRowsAfter[0]?.active_count ?? -1) &&
            Number(collectionDeleteFailureRowsBefore[0]?.deleted_count ?? 0) ===
              Number(collectionDeleteFailureRowsAfter[0]?.deleted_count ?? -1) &&
            Number(collectionDeleteFailureRowsBefore[0]?.item_count ?? 0) ===
              Number(collectionDeleteFailureRowsAfter[0]?.item_count ?? -1);
          const collectionManagerRowForDelete =
            collectionManagerDialogAfterFailedDelete?.querySelector(
              '[data-collection-id="' + CSS.escape(COLLECTION_MANAGER_SMOKE.id) + '"]'
            );
          const collectionDeleteButton = collectionManagerRowForDelete?.querySelector(
            '[data-library-action="delete-collection"]'
          );
          collectionDeleteButton?.click();
          const collectionDeleteConfirm = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("删除文件夹？")
            );
            return dialog?.textContent?.includes(COLLECTION_MANAGER_SMOKE.name) ? dialog : null;
          }, 1_000);
          const collectionDeleteConfirmButton = Array.from(
            collectionDeleteConfirm?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除文件夹");
          collectionDeleteConfirmButton?.click();
          libraryCollectionDeleteBusyVisible = Boolean(
            await waitFor(() => {
              const manager = document.querySelector(
                '[data-library-dialog="collection-manager"]'
              );
              const row = manager?.querySelector(
                '[data-collection-id="' + CSS.escape(COLLECTION_MANAGER_SMOKE.id) + '"]'
              );
              const busyButton = row?.querySelector(
                '[data-library-action="delete-collection"]'
              );
              return manager?.getAttribute("aria-busy") === "true" &&
                row?.getAttribute("aria-busy") === "true" &&
                busyButton?.disabled &&
                busyButton.textContent?.includes("删除中") &&
                manager.textContent?.includes("正在删除文件夹")
                ? row
                : null;
            }, 1_000)
          );
          const collectionDeleteSuccessDialog = await waitFor(() => {
            const manager = document.querySelector(
              '[data-library-dialog="collection-manager"]'
            );
            return manager?.textContent?.includes(
              "已删除文件夹「" + COLLECTION_MANAGER_SMOKE.name + "」"
            )
              ? manager
              : null;
          }, 3_000);
          libraryCollectionDeleteSuccessVisible = Boolean(collectionDeleteSuccessDialog);
          const collectionDeleteRows = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM collections WHERE library_id = (SELECT id FROM current_library)) AS collections WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM collection_items WHERE collection_id = ?) AS item_count",
            [libraryId, COLLECTION_MANAGER_SMOKE.id, COLLECTION_MANAGER_SMOKE.id]
          );
          libraryCollectionDeletePersisted =
            Number(collectionDeleteRows[0]?.deleted_count ?? 0) === 1 &&
            Number(collectionDeleteRows[0]?.item_count ?? 0) === 0;
          const collectionDeleteUndoButton = await waitFor(
            () => document.querySelector('[data-library-action="restore-collection"]'),
            1_000
          );
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RESTORE__ =
            COLLECTION_RESTORE_FAILURE_SMOKE.error;
          try {
            collectionDeleteUndoButton?.click();
            libraryCollectionDeleteUndoFailureBusyVisible = Boolean(
              await waitFor(() => {
                const manager = document.querySelector(
                  '[data-library-dialog="collection-manager"]'
                );
                const undoButton = manager?.querySelector(
                  '[data-library-action="restore-collection"]'
                );
                return manager?.getAttribute("aria-busy") === "true" &&
                  undoButton?.getAttribute("aria-busy") === "true" &&
                  undoButton.disabled &&
                  undoButton.textContent?.includes("撤销中") &&
                  manager.textContent?.includes("正在恢复文件夹")
                  ? undoButton
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("恢复文件夹失败，撤销入口仍保留，可重新撤销") &&
                bodyIncludes(COLLECTION_RESTORE_FAILURE_SMOKE.error),
              3_000
            );
          } finally {
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RESTORE__;
          }
          const collectionRestoreFailureRows = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM collections WHERE library_id = (SELECT id FROM current_library)) AS collections WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM (SELECT * FROM collections WHERE library_id = (SELECT id FROM current_library)) AS collections WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM collection_items WHERE collection_id = ? AND work_id = ?) AS item_count",
            [libraryId,
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.id,
              MISSING_PDF.workId
            ]
          );
          const collectionManagerDialogAfterFailedRestore = document.querySelector(
            '[data-library-dialog="collection-manager"]'
          );
          const collectionDeleteUndoButtonAfterFailure = await waitFor(() => {
            const manager = document.querySelector(
              '[data-library-dialog="collection-manager"]'
            );
            const undoButton = manager?.querySelector(
              '[data-library-action="restore-collection"]'
            );
            return undoButton &&
              !undoButton.disabled &&
              undoButton.getAttribute("aria-busy") !== "true"
              ? undoButton
              : null;
          }, 1_000);
          libraryCollectionDeleteUndoFailureVisible = Boolean(
            collectionManagerDialogAfterFailedRestore?.textContent?.includes(
              "恢复文件夹失败，撤销入口仍保留，可重新撤销"
            ) &&
              collectionManagerDialogAfterFailedRestore.textContent.includes(
                COLLECTION_RESTORE_FAILURE_SMOKE.error
              )
          );
          libraryCollectionDeleteUndoFailurePreserved = Boolean(
            collectionDeleteUndoButtonAfterFailure &&
              !collectionManagerDialogAfterFailedRestore?.textContent?.includes("正在恢复文件夹")
          );
          libraryCollectionDeleteUndoFailureDidNotPersist =
            Number(collectionRestoreFailureRows[0]?.active_count ?? -1) === 0 &&
            Number(collectionRestoreFailureRows[0]?.deleted_count ?? -1) === 1 &&
            Number(collectionRestoreFailureRows[0]?.item_count ?? -1) === 0;
          collectionDeleteUndoButtonAfterFailure?.click();
          libraryCollectionDeleteUndoBusyVisible = Boolean(
            await waitFor(() => {
              const manager = document.querySelector(
                '[data-library-dialog="collection-manager"]'
              );
              const undoButton = manager?.querySelector(
                '[data-library-action="restore-collection"]'
              );
              return manager?.getAttribute("aria-busy") === "true" &&
                undoButton?.getAttribute("aria-busy") === "true" &&
                undoButton.disabled &&
                undoButton.textContent?.includes("撤销中") &&
                manager.textContent?.includes("正在恢复文件夹")
                ? undoButton
                : null;
            }, 1_000)
          );
          const collectionRestoreDialog = await waitFor(() => {
            const manager = document.querySelector(
              '[data-library-dialog="collection-manager"]'
            );
            return manager?.textContent?.includes(
              "已恢复文件夹「" + COLLECTION_MANAGER_SMOKE.name + "」"
            )
              ? manager
              : null;
          }, 3_000);
          const collectionRestoreRows = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM collections WHERE library_id = (SELECT id FROM current_library)) AS collections WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM collection_items WHERE collection_id = ? AND work_id = ?) AS item_count",
            [libraryId, COLLECTION_MANAGER_SMOKE.id, COLLECTION_MANAGER_SMOKE.id, MISSING_PDF.workId]
          );
          libraryCollectionDeleteUndoRecovered =
            Boolean(collectionRestoreDialog?.textContent?.includes(COLLECTION_MANAGER_SMOKE.name)) &&
            Number(collectionRestoreRows[0]?.active_count ?? 0) === 1 &&
            Number(collectionRestoreRows[0]?.item_count ?? 0) === 1;
          const closeButton = collectionDeleteSuccessDialog?.querySelector(
            '[data-library-action="close-collection-manager"]'
          );
          closeButton?.click();
          await waitFor(
            () => !document.querySelector('[data-library-dialog="collection-manager"]'),
            1_000
          );
        }

`;
