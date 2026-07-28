export const smokeLibraryBulkOperations = String.raw`        if (librarySearchInput) {
          findExactButton("取消选择")?.click();
          setInputValue(librarySearchInput, MOVE_COLLECTION_FAILURE_SMOKE.query);
          await waitFor(
            () =>
              MOVE_COLLECTION_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)),
            3_000
          );
          for (const work of MOVE_COLLECTION_FAILURE_SMOKE.works) {
            const checkbox = document.querySelector(
              '[data-library-row-id="' + work.workId + '"] .library-checkbox-input'
            );
            if (checkbox && !checkbox.checked) checkbox.click();
          }
          await waitFor(() => bodyIncludes("已选 2 篇"), 1_000);
          const moveFailureRowsBefore = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM collection_items WHERE work_id IN (?, ?) AND collection_id = ?",
            [
              MOVE_COLLECTION_FAILURE_SMOKE.works[0].workId,
              MOVE_COLLECTION_FAILURE_SMOKE.works[1].workId,
              MOVE_COLLECTION_SMOKE.id
            ]
          );
          findExactButton("移动到文件夹")?.click();
          const moveFailureDialog = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("移动到文件夹")
            );
            return dialog?.textContent?.includes(MOVE_COLLECTION_SMOKE.name) ? dialog : null;
          }, 2_000);
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_MOVE_AFTER_FIRST__ =
            MOVE_COLLECTION_FAILURE_SMOKE.error;
          const moveFailureTargetButton = Array.from(
            moveFailureDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.includes(MOVE_COLLECTION_SMOKE.name));
          moveFailureTargetButton?.click();
          libraryMoveToCollectionFailureBusyVisible = Boolean(
            await waitFor(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("移动到文件夹")
              );
              const button = Array.from(dialog?.querySelectorAll("button") ?? []).find((item) =>
                item.textContent?.includes(MOVE_COLLECTION_SMOKE.name)
              );
              return dialog?.getAttribute("aria-busy") === "true" &&
                button?.getAttribute("aria-busy") === "true" &&
                button.disabled &&
                button.textContent?.includes("移动中") &&
                dialog.textContent?.includes("正在移动 2 篇文献")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("移动文件夹失败，所选文献仍保留在原文件夹，可重新移动") &&
              bodyIncludes("移动失败，所选文献仍保留，可重新移动。") &&
              bodyIncludes(MOVE_COLLECTION_FAILURE_SMOKE.error),
            3_000
          );
          delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_MOVE_AFTER_FIRST__;
          const moveFailureRowsAfter = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM collection_items WHERE work_id IN (?, ?) AND collection_id = ?",
            [
              MOVE_COLLECTION_FAILURE_SMOKE.works[0].workId,
              MOVE_COLLECTION_FAILURE_SMOKE.works[1].workId,
              MOVE_COLLECTION_SMOKE.id
            ]
          );
          const moveFailureDialogAfter = Array.from(
            document.querySelectorAll('[role="dialog"]')
          ).find((item) => item.textContent?.includes("移动到文件夹"));
          const moveFailureRetryButton = Array.from(
            moveFailureDialogAfter?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.includes(MOVE_COLLECTION_SMOKE.name));
          libraryMoveToCollectionFailureVisible =
            bodyIncludes("移动文件夹失败，所选文献仍保留在原文件夹，可重新移动") &&
            bodyIncludes("移动失败，所选文献仍保留，可重新移动。") &&
            bodyIncludes(MOVE_COLLECTION_FAILURE_SMOKE.error);
          libraryMoveToCollectionFailureDidNotPersist =
            Number(moveFailureRowsBefore[0]?.n ?? 0) === 0 &&
            Number(moveFailureRowsAfter[0]?.n ?? 0) === 0;
          libraryMoveToCollectionFailurePreserved =
            MOVE_COLLECTION_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)) &&
            bodyIncludes("已选 2 篇") &&
            Boolean(moveFailureRetryButton) &&
            !moveFailureRetryButton?.disabled;
          moveFailureDialogAfter
            ?.querySelector('button[aria-label="关闭"]')
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("移动到文件夹")
              ),
            1_000
          );
          findExactButton("取消选择")?.click();
          await waitFor(() => !bodyIncludes("已选 2 篇"), 1_000);
          setInputValue(librarySearchInput, "");
          await waitFor(() => rowText().includes(SAMPLE.title), 3_000);
        }

        const moveSmokeRow = Array.from(document.querySelectorAll(".library-table__row")).find(
          (item) => item.textContent?.includes(SAMPLE.title)
        );
        const moveSmokeCheckbox = moveSmokeRow?.querySelector('input[type="checkbox"]');
        if (moveSmokeCheckbox && !moveSmokeCheckbox.checked) {
          moveSmokeCheckbox.click();
        }
        await waitFor(() => bodyIncludes("已选 1 篇"), 1_000);
        findExactButton("移动到文件夹")?.click();
        const moveDialog = await waitFor(() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
            item.textContent?.includes("移动到文件夹")
          );
          return dialog?.textContent?.includes(MOVE_COLLECTION_SMOKE.name) ? dialog : null;
        }, 2_000);
        if (moveDialog) {
          const moveTargetButton = Array.from(moveDialog.querySelectorAll("button")).find(
            (button) => button.textContent?.includes(MOVE_COLLECTION_SMOKE.name)
          );
          moveTargetButton?.click();
          libraryMoveToCollectionBusyVisible = Boolean(
            await waitFor(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("移动到文件夹")
              );
              const button = Array.from(dialog?.querySelectorAll("button") ?? []).find((item) =>
                item.textContent?.includes(MOVE_COLLECTION_SMOKE.name)
              );
              return dialog?.getAttribute("aria-busy") === "true" &&
                button?.getAttribute("aria-busy") === "true" &&
                button.disabled &&
                button.textContent?.includes("移动中") &&
                dialog.textContent?.includes("正在移动 1 篇文献")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("移动到文件夹")
              ),
            3_000
          );
          libraryMoveToCollectionSuccessVisible = bodyIncludes(
            "已移动 1 篇文献到「" + MOVE_COLLECTION_SMOKE.name + "」"
          );
          const moveRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM collection_items WHERE work_id = ? AND collection_id = ?",
            [SAMPLE.workId, MOVE_COLLECTION_SMOKE.id]
          );
          libraryMoveToCollectionPersisted = Number(moveRows[0]?.n ?? 0) === 1;
        }

        if (librarySearchInput) {
          findExactButton("取消选择")?.click();
          setInputValue(librarySearchInput, BULK_TAG_FAILURE_SMOKE.query);
          await waitFor(
            () => BULK_TAG_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)),
            3_000
          );
          for (const work of BULK_TAG_FAILURE_SMOKE.works) {
            const checkbox = document.querySelector(
              '[data-library-row-id="' + work.workId + '"] .library-checkbox-input'
            );
            if (checkbox && !checkbox.checked) checkbox.click();
          }
          await waitFor(() => bodyIncludes("已选 2 篇"), 1_000);
          findExactButton("添加标签")?.click();
          const bulkTagFailureDialog = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("添加标签")
            );
            return dialog?.textContent?.includes("将标签添加到已选的 2 篇文献")
              ? dialog
              : null;
          }, 2_000);
          const bulkTagFailureInput = bulkTagFailureDialog?.querySelector("input");
          if (bulkTagFailureInput) setInputValue(bulkTagFailureInput, BULK_TAG_FAILURE_SMOKE.name);
          const bulkTagFailureRowsBefore = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS tags WHERE name = ?) AS tag_count, (SELECT COUNT(*) FROM work_tags wt JOIN (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS t ON t.id = wt.tag_id WHERE t.name = ? AND wt.work_id IN (?, ?)) AS item_count",
            [libraryId,
              BULK_TAG_FAILURE_SMOKE.name,
              BULK_TAG_FAILURE_SMOKE.name,
              BULK_TAG_FAILURE_SMOKE.works[0].workId,
              BULK_TAG_FAILURE_SMOKE.works[1].workId
            ]
          );
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_BULK_TAG_AFTER_FIRST__ =
            BULK_TAG_FAILURE_SMOKE.error;
          const bulkTagFailureButton = Array.from(
            bulkTagFailureDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "添加");
          bulkTagFailureButton?.click();
          libraryBulkTagFailureBusyVisible = Boolean(
            await waitFor(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("添加标签")
              );
              const busyButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
                (button) => button.getAttribute("aria-busy") === "true"
              );
              return dialog?.getAttribute("aria-busy") === "true" &&
                busyButton?.disabled &&
                busyButton.textContent?.includes("添加中") &&
                dialog.textContent?.includes("添加中")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("添加标签失败，所选文献和标签仍保持原状，可重新添加") &&
              bodyIncludes(BULK_TAG_FAILURE_SMOKE.error),
            3_000
          );
          delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_BULK_TAG_AFTER_FIRST__;
          const bulkTagFailureRowsAfter = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS tags WHERE name = ?) AS tag_count, (SELECT COUNT(*) FROM work_tags wt JOIN (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS t ON t.id = wt.tag_id WHERE t.name = ? AND wt.work_id IN (?, ?)) AS item_count",
            [libraryId,
              BULK_TAG_FAILURE_SMOKE.name,
              BULK_TAG_FAILURE_SMOKE.name,
              BULK_TAG_FAILURE_SMOKE.works[0].workId,
              BULK_TAG_FAILURE_SMOKE.works[1].workId
            ]
          );
          const bulkTagFailureDialogAfter = Array.from(
            document.querySelectorAll('[role="dialog"]')
          ).find((item) => item.textContent?.includes("添加标签"));
          const bulkTagFailureRetryButton = Array.from(
            bulkTagFailureDialogAfter?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "添加");
          const bulkTagFailureInputAfter = bulkTagFailureDialogAfter?.querySelector("input");
          libraryBulkTagFailureVisible =
            bodyIncludes("添加标签失败，所选文献和标签仍保持原状，可重新添加") &&
            bodyIncludes(BULK_TAG_FAILURE_SMOKE.error);
          libraryBulkTagFailureDidNotPersist =
            Number(bulkTagFailureRowsBefore[0]?.tag_count ?? 0) === 0 &&
            Number(bulkTagFailureRowsBefore[0]?.item_count ?? 0) === 0 &&
            Number(bulkTagFailureRowsAfter[0]?.tag_count ?? 0) === 0 &&
            Number(bulkTagFailureRowsAfter[0]?.item_count ?? 0) === 0;
          libraryBulkTagFailurePreserved =
            BULK_TAG_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)) &&
            bodyIncludes("已选 2 篇") &&
            bulkTagFailureInputAfter?.value === BULK_TAG_FAILURE_SMOKE.name &&
            Boolean(bulkTagFailureRetryButton) &&
            !bulkTagFailureRetryButton?.disabled;
          bulkTagFailureDialogAfter
            ?.querySelector('button[aria-label="关闭"]')
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("添加标签")
              ),
            1_000
          );
          findExactButton("取消选择")?.click();
          await waitFor(() => !bodyIncludes("已选 2 篇"), 1_000);
          setInputValue(librarySearchInput, "");
          await waitFor(() => rowText().includes(SAMPLE.title), 3_000);
        }

        const bulkTagSmokeRow = Array.from(document.querySelectorAll(".library-table__row")).find(
          (item) => item.textContent?.includes(SAMPLE.title)
        );
        const bulkTagCheckbox = bulkTagSmokeRow?.querySelector('input[type="checkbox"]');
        if (bulkTagCheckbox && !bulkTagCheckbox.checked) {
          bulkTagCheckbox.click();
        }
        await waitFor(() => bodyIncludes("已选 1 篇"), 1_000);
        findExactButton("添加标签")?.click();
        const bulkTagDialog = await waitFor(() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
            item.textContent?.includes("添加标签")
          );
          return dialog?.textContent?.includes("将标签添加到已选的 1 篇文献") ? dialog : null;
        }, 2_000);
        if (bulkTagDialog) {
          const tagInput = bulkTagDialog.querySelector("input");
          if (tagInput) setInputValue(tagInput, BULK_TAG_SMOKE.name);
          const addTagButton = Array.from(bulkTagDialog.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "添加"
          );
          addTagButton?.click();
          libraryBulkTagBusyVisible = Boolean(
            await waitFor(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("添加标签")
              );
              const busyButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
                (button) => button.getAttribute("aria-busy") === "true"
              );
              return dialog?.getAttribute("aria-busy") === "true" &&
                busyButton?.disabled &&
                busyButton.textContent?.includes("添加中") &&
                dialog.textContent?.includes("添加中")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("添加标签")
              ),
            3_000
          );
          libraryBulkTagSuccessVisible = bodyIncludes(
            "已为 1 篇文献添加标签「" + BULK_TAG_SMOKE.name + "」"
          );
          const bulkTagRows = await window.aura.db.query(
            "WITH current_library(id) AS (VALUES (?)) SELECT COUNT(*) AS n FROM work_tags wt JOIN (SELECT * FROM tags WHERE library_id = (SELECT id FROM current_library)) AS t ON t.id = wt.tag_id WHERE wt.work_id = ? AND t.name = ? AND t.deleted_at IS NULL",
            [libraryId, SAMPLE.workId, BULK_TAG_SMOKE.name]
          );
          libraryBulkTagPersisted = Number(bulkTagRows[0]?.n ?? 0) === 1;
        }

        if (librarySearchInput) {
          findExactButton("取消选择")?.click();
          setInputValue(librarySearchInput, MERGE_FAILURE_SMOKE.query);
          await waitFor(
            () =>
              rowText().includes(MERGE_FAILURE_SMOKE.primaryTitle) &&
              rowText().includes(MERGE_FAILURE_SMOKE.duplicateTitle),
            3_000
          );
          clickRowByTitle(MERGE_FAILURE_SMOKE.primaryTitle);
          await waitFor(
            () =>
              (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
                MERGE_FAILURE_SMOKE.primaryTitle
              ),
            2_000
          );
          const mergeFailurePrimaryCheckbox = document.querySelector(
            '[data-library-row-id="' + MERGE_FAILURE_SMOKE.primaryId + '"] .library-checkbox-input'
          );
          const mergeFailureDuplicateCheckbox = document.querySelector(
            '[data-library-row-id="' + MERGE_FAILURE_SMOKE.duplicateId + '"] .library-checkbox-input'
          );
          if (mergeFailurePrimaryCheckbox && !mergeFailurePrimaryCheckbox.checked) {
            mergeFailurePrimaryCheckbox.click();
          }
          if (mergeFailureDuplicateCheckbox && !mergeFailureDuplicateCheckbox.checked) {
            mergeFailureDuplicateCheckbox.click();
          }
          await waitFor(() => bodyIncludes("已选 2 篇"), 1_000);
          const mergeFailureRowsBefore = await window.aura.db.query(
            "SELECT SUM(CASE WHEN id = ? AND deleted_at IS NULL THEN 1 ELSE 0 END) AS primary_active, SUM(CASE WHEN id = ? AND deleted_at IS NULL THEN 1 ELSE 0 END) AS duplicate_active, (SELECT work_id FROM attachments WHERE id = ?) AS attachment_work_id FROM works WHERE id IN (?, ?) AND works.library_id = ?",
            [
              MERGE_FAILURE_SMOKE.primaryId,
              MERGE_FAILURE_SMOKE.duplicateId,
              MERGE_FAILURE_SMOKE.attachmentId,
              MERGE_FAILURE_SMOKE.primaryId,
              MERGE_FAILURE_SMOKE.duplicateId
            , libraryId]
          );
          await window.aura.db.exec("DROP TRIGGER IF EXISTS aurascholar_smoke_merge_failure");
          await window.aura.db.exec(
            "CREATE TEMP TRIGGER aurascholar_smoke_merge_failure BEFORE UPDATE OF deleted_at ON works WHEN OLD.id = 'smoke-work-merge-failure-duplicate' AND NEW.deleted_at IS NOT NULL BEGIN SELECT RAISE(FAIL, 'Smoke merge rollback failure'); END;"
          );
          findExactButton("合并文献")?.click();
          const mergeFailureConfirmDialog = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("合并重复文献？")
            );
            return dialog?.textContent?.includes(MERGE_FAILURE_SMOKE.primaryTitle) &&
              dialog.textContent?.includes(MERGE_FAILURE_SMOKE.duplicateTitle)
              ? dialog
              : null;
          }, 2_000);
          const mergeFailureConfirmButton = Array.from(
            mergeFailureConfirmDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "确认合并");
          mergeFailureConfirmButton?.click();
          libraryMergeFailureBusyVisible = Boolean(
            await waitFor(() => {
              const mergeButton = Array.from(
                document.querySelectorAll(".library-bulkbar button")
              ).find((button) => button.textContent?.includes("合并中"));
              return mergeButton?.getAttribute("aria-busy") === "true" &&
                mergeButton.disabled &&
                bodyIncludes("正在合并 1 篇重复文献")
                ? mergeButton
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("合并失败，主记录和重复文献仍保持原状，可重新合并") &&
              bodyIncludes(MERGE_FAILURE_SMOKE.error),
            3_000
          );
          await window.aura.db.exec("DROP TRIGGER IF EXISTS aurascholar_smoke_merge_failure");
          const mergeFailureRowsAfter = await window.aura.db.query(
            "SELECT SUM(CASE WHEN id = ? AND deleted_at IS NULL THEN 1 ELSE 0 END) AS primary_active, SUM(CASE WHEN id = ? AND deleted_at IS NULL THEN 1 ELSE 0 END) AS duplicate_active, (SELECT work_id FROM attachments WHERE id = ?) AS attachment_work_id FROM works WHERE id IN (?, ?) AND works.library_id = ?",
            [
              MERGE_FAILURE_SMOKE.primaryId,
              MERGE_FAILURE_SMOKE.duplicateId,
              MERGE_FAILURE_SMOKE.attachmentId,
              MERGE_FAILURE_SMOKE.primaryId,
              MERGE_FAILURE_SMOKE.duplicateId
            , libraryId]
          );
          const mergeFailureRetryButton = Array.from(
            document.querySelectorAll(".library-bulkbar button")
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "合并文献");
          libraryMergeFailureVisible =
            bodyIncludes("合并失败，主记录和重复文献仍保持原状，可重新合并") &&
            bodyIncludes(MERGE_FAILURE_SMOKE.error);
          libraryMergeFailureDidNotPersist =
            Number(mergeFailureRowsBefore[0]?.primary_active ?? 0) === 1 &&
            Number(mergeFailureRowsBefore[0]?.duplicate_active ?? 0) === 1 &&
            mergeFailureRowsBefore[0]?.attachment_work_id === MERGE_FAILURE_SMOKE.duplicateId &&
            Number(mergeFailureRowsAfter[0]?.primary_active ?? 0) === 1 &&
            Number(mergeFailureRowsAfter[0]?.duplicate_active ?? 0) === 1 &&
            mergeFailureRowsAfter[0]?.attachment_work_id === MERGE_FAILURE_SMOKE.duplicateId;
          libraryMergeFailurePreserved =
            rowText().includes(MERGE_FAILURE_SMOKE.primaryTitle) &&
            rowText().includes(MERGE_FAILURE_SMOKE.duplicateTitle) &&
            bodyIncludes("已选 2 篇") &&
            Boolean(mergeFailureRetryButton) &&
            !mergeFailureRetryButton?.disabled;
          findExactButton("取消选择")?.click();
          await waitFor(() => !bodyIncludes("已选 2 篇"), 1_000);
          setInputValue(librarySearchInput, "");
          await waitFor(() => rowText().includes(MERGE_SMOKE.primaryTitle), 3_000);
        }

        clickRowByTitle(MERGE_SMOKE.primaryTitle);
        await waitFor(
          () =>
            (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
              MERGE_SMOKE.primaryTitle
            ),
          2_000
        );
        const mergePrimaryCheckbox = document.querySelector(
          '[data-library-row-id="' + MERGE_SMOKE.primaryId + '"] .library-checkbox-input'
        );
        const mergeDuplicateCheckbox = document.querySelector(
          '[data-library-row-id="' + MERGE_SMOKE.duplicateId + '"] .library-checkbox-input'
        );
        if (mergePrimaryCheckbox && !mergePrimaryCheckbox.checked) mergePrimaryCheckbox.click();
        if (mergeDuplicateCheckbox && !mergeDuplicateCheckbox.checked) {
          mergeDuplicateCheckbox.click();
        }
        await waitFor(() => bodyIncludes("已选 2 篇"), 1_000);
        findExactButton("合并文献")?.click();
        const mergeConfirmDialog = await waitFor(() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
            item.textContent?.includes("合并重复文献？")
          );
          return dialog?.textContent?.includes(MERGE_SMOKE.primaryTitle) &&
            dialog.textContent?.includes(MERGE_SMOKE.duplicateTitle)
            ? dialog
            : null;
        }, 2_000);
        const mergeConfirmButton = Array.from(
          mergeConfirmDialog?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "确认合并");
        mergeConfirmButton?.click();
        libraryMergeBusyVisible = Boolean(
          await waitFor(() => {
            const mergeButton = Array.from(
              document.querySelectorAll(".library-bulkbar button")
            ).find((button) => button.textContent?.includes("合并中"));
            return mergeButton?.getAttribute("aria-busy") === "true" &&
              mergeButton.disabled &&
              bodyIncludes("正在合并 1 篇重复文献")
              ? mergeButton
              : null;
          }, 1_000)
        );
        await waitFor(
          () => bodyIncludes("已合并 1 篇重复文献到《" + MERGE_SMOKE.primaryTitle + "》"),
          4_000
        );
        libraryMergeSuccessVisible = bodyIncludes(
          "已合并 1 篇重复文献到《" + MERGE_SMOKE.primaryTitle + "》"
        );
        const mergeRows = await window.aura.db.query(
          "SELECT SUM(CASE WHEN id = ? AND deleted_at IS NULL THEN 1 ELSE 0 END) AS primary_active, SUM(CASE WHEN id = ? AND deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS duplicate_deleted FROM works WHERE id IN (?, ?) AND works.library_id = ?",
          [
            MERGE_SMOKE.primaryId,
            MERGE_SMOKE.duplicateId,
            MERGE_SMOKE.primaryId,
            MERGE_SMOKE.duplicateId
          , libraryId]
        );
        libraryMergePersisted =
          Number(mergeRows[0]?.primary_active ?? 0) === 1 &&
          Number(mergeRows[0]?.duplicate_deleted ?? 0) === 1;

        document.querySelector('[data-app-action="open-command-palette"]')?.click();
        const manageCollectionsCommand = await waitFor(
          () => document.querySelector("#command-library-manage-collections"),
          2_000
        );
        manageCollectionsCommand?.click();
`;
