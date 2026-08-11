export const smokeLibraryBulkTrash = String.raw`          clickRowByTitle(SAMPLE.title);
          await waitFor(
            () =>
              (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(SAMPLE.title),
            2_000
          );
          const sampleCheckbox = document.querySelector(
            '[data-library-row-id="' + SAMPLE.workId + '"] .library-checkbox-input'
          );
          if (sampleCheckbox && !sampleCheckbox.checked) {
            sampleCheckbox.click();
            await waitFor(() => bodyIncludes("已选 1 篇"), 1_000);
          }
          if (sampleCheckbox?.checked) {
            libraryBulkSelectMixedVisible = Boolean(
              await waitFor(() => {
                const pageSelectCheckbox = document.querySelector(
                  ".library-table__head .library-checkbox-input"
                );
                return pageSelectCheckbox instanceof HTMLInputElement &&
                  pageSelectCheckbox.indeterminate &&
                  pageSelectCheckbox.getAttribute("aria-checked") === "mixed";
              }, 1_000)
            );
          }
          const libraryCitationMenuButton = () => document.querySelector(".library-cite-menu > button");
          if (sampleCheckbox?.checked && libraryCitationMenuButton()) {
            const originalAnchorClick = HTMLAnchorElement.prototype.click;
            const originalCitationCreateObjectUrl = URL.createObjectURL;
            let libraryCitationDownloadCount = 0;
            let libraryCitationExportTextPromise = null;
            URL.createObjectURL = (blob) => {
              if (blob instanceof Blob) {
                libraryCitationExportTextPromise = blob.text().catch(() => "");
              }
              return "blob:aurascholar-citation-export-smoke";
            };
            HTMLAnchorElement.prototype.click = function () {
              if (this.download === "aurascholar-references.bib") {
                libraryCitationDownloadCount += 1;
                return;
              }
              return originalAnchorClick.call(this);
            };
            try {
              libraryCitationMenuButton()?.click();
              await waitFor(() => Boolean(findExactButton("BibTeX (.bib)")), 1_000);
              findExactButton("BibTeX (.bib)")?.click();
              await waitFor(
                () =>
                  libraryCitationMenuButton()?.disabled &&
                  libraryCitationMenuButton()?.textContent?.includes("导出中") &&
                  bodyIncludes("正在导出 1 篇文献的引用"),
                1_000
              );
              libraryCitationExportBusyVisible = Boolean(
                libraryCitationMenuButton()?.disabled &&
                  libraryCitationMenuButton()?.textContent?.includes("导出中") &&
                  bodyIncludes("正在导出 1 篇文献的引用")
              );
              await waitFor(
                () =>
                  !libraryCitationMenuButton()?.disabled &&
                  bodyIncludes("已导出 1 篇文献的引用(BIBTEX)"),
                2_000
              );
              const libraryCitationExportText = libraryCitationExportTextPromise
                ? await libraryCitationExportTextPromise
                : "";
              libraryCitationExportPmidVisible = libraryCitationExportText.includes(
                "pmid = {" + SAMPLE.pmid + "}"
              );
              libraryCitationExportSuccessVisible =
                libraryCitationDownloadCount === 1 &&
                libraryCitationExportPmidVisible &&
                !libraryCitationMenuButton()?.disabled &&
                bodyIncludes("已导出 1 篇文献的引用(BIBTEX)");
            } finally {
              URL.createObjectURL = originalCitationCreateObjectUrl;
              HTMLAnchorElement.prototype.click = originalAnchorClick;
            }

            const originalCreateObjectUrl = URL.createObjectURL;
            URL.createObjectURL = () => {
              throw new Error("smoke-citation-export-failed");
            };
            try {
              libraryCitationMenuButton()?.click();
              await waitFor(() => Boolean(findExactButton("RIS (.ris)")), 1_000);
              findExactButton("RIS (.ris)")?.click();
              await waitFor(
                () => bodyIncludes("导出失败:smoke-citation-export-failed"),
                2_000
              );
              libraryCitationExportFailureVisible = bodyIncludes(
                "导出失败:smoke-citation-export-failed"
              );
            } finally {
              URL.createObjectURL = originalCreateObjectUrl;
            }

            libraryCitationMenuButton()?.click();
            await waitFor(() => Boolean(findExactButton("APA 7th")), 1_000);
            findExactButton("APA 7th")?.click();
            await waitFor(
              () =>
                libraryCitationMenuButton()?.disabled &&
                libraryCitationMenuButton()?.textContent?.includes("复制中") &&
                bodyIncludes("正在复制 1 条参考文献"),
              1_000
            );
            libraryCitationCopyBusyVisible = Boolean(
              libraryCitationMenuButton()?.disabled &&
                libraryCitationMenuButton()?.textContent?.includes("复制中") &&
                bodyIncludes("正在复制 1 条参考文献")
            );
            await waitFor(
              () =>
                !libraryCitationMenuButton()?.disabled &&
                bodyIncludes("已复制 1 条参考文献到剪贴板"),
              2_000
            );
            let libraryCitationClipboardMatches = true;
            try {
              if (navigator.clipboard?.readText) {
                libraryCitationClipboardMatches = (await navigator.clipboard.readText()).includes(SAMPLE.title);
              }
            } catch {}
            libraryCitationCopySuccessVisible =
              !libraryCitationMenuButton()?.disabled &&
              bodyIncludes("已复制 1 条参考文献到剪贴板") &&
              libraryCitationClipboardMatches;

            window.__AURASCHOLAR_SMOKE_CLIPBOARD_WRITE_ERROR__ = "smoke-citation-copy-failed";
            try {
              libraryCitationMenuButton()?.click();
              await waitFor(() => Boolean(findExactButton("IEEE")), 1_000);
              findExactButton("IEEE")?.click();
              await waitFor(
                () => bodyIncludes("复制失败:smoke-citation-copy-failed"),
                2_000
              );
              libraryCitationCopyFailureVisible = bodyIncludes(
                "复制失败:smoke-citation-copy-failed"
              );
            } finally {
              delete window.__AURASCHOLAR_SMOKE_CLIPBOARD_WRITE_ERROR__;
            }

            if (sampleCheckbox.checked) {
              sampleCheckbox.click();
              await waitFor(() => !bodyIncludes("已选 1 篇"), 1_000);
            }
          }

          if (searchInput) {
            setInputValue(searchInput, BULK_TRASH_FAILURE_SMOKE.query);
            await waitFor(
              () =>
                BULK_TRASH_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)),
              3_000
            );
            for (const work of BULK_TRASH_FAILURE_SMOKE.works) {
              const checkbox = document.querySelector(
                '[data-library-row-id="' + work.workId + '"] .library-checkbox-input'
              );
              if (checkbox && !checkbox.checked) checkbox.click();
            }
            await waitFor(() => bodyIncludes("已选 2 篇"), 1_000);
            const bulkTrashFailureButton = () =>
              Array.from(document.querySelectorAll(".library-bulkbar button")).find((button) => {
                const label = button.textContent?.replace(/\s+/g, " ").trim();
                return label === "删除" || label === "移入中...";
              });
            const bulkTrashFailureRowsBefore = await window.aura.db.query(
              "SELECT id, deleted_at FROM works WHERE id IN (?, ?) AND works.library_id = ? ORDER BY id",
              [...BULK_TRASH_FAILURE_SMOKE.works.map((work) => work.workId), libraryId]
            );
            bulkTrashFailureButton()?.click();
            const bulkTrashFailureDialog = await waitFor(() => {
              const dialog = document.querySelector('[role="dialog"]');
              return dialog?.textContent?.includes("批量移入回收站？") ? dialog : null;
            }, 3_000);
            await window.aura.db.exec(
              "DROP TRIGGER IF EXISTS aurascholar_smoke_bulk_trash_failure"
            );
            await window.aura.db.exec(
              "CREATE TEMP TRIGGER aurascholar_smoke_bulk_trash_failure BEFORE UPDATE OF deleted_at ON works WHEN OLD.id = 'smoke-work-bulk-trash-failure-b' AND NEW.deleted_at IS NOT NULL BEGIN SELECT RAISE(FAIL, 'Smoke library bulk trash rollback failure'); END;"
            );
            const bulkTrashFailureConfirmButton = Array.from(
              bulkTrashFailureDialog?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "移入 2 篇");
            try {
              bulkTrashFailureConfirmButton?.click();
              libraryBulkTrashFailureBusyVisible = Boolean(
                await waitFor(() => {
                  const button = bulkTrashFailureButton();
                  return button?.disabled &&
                    button.getAttribute("aria-busy") === "true" &&
                    button.textContent?.includes("移入中") &&
                    bodyIncludes("正在将 2 篇文献移入回收站")
                    ? button
                    : null;
                }, 1_000)
              );
              await waitFor(
                () =>
                  bodyIncludes("批量移入回收站失败，所选文献仍保留，可重新移入回收站") &&
                  bodyIncludes(BULK_TRASH_FAILURE_SMOKE.error),
                3_000
              );
            } finally {
              await window.aura.db.exec(
                "DROP TRIGGER IF EXISTS aurascholar_smoke_bulk_trash_failure"
              );
            }
            const bulkTrashFailureRowsAfter = await window.aura.db.query(
              "SELECT id, deleted_at FROM works WHERE id IN (?, ?) AND works.library_id = ? ORDER BY id",
              [...BULK_TRASH_FAILURE_SMOKE.works.map((work) => work.workId), libraryId]
            );
            const bulkTrashFailureRetryButton = bulkTrashFailureButton();
            libraryBulkTrashFailureVisible =
              bodyIncludes("批量移入回收站失败，所选文献仍保留，可重新移入回收站") &&
              bodyIncludes(BULK_TRASH_FAILURE_SMOKE.error);
            libraryBulkTrashFailureDidNotPersist =
              bulkTrashFailureRowsBefore.length === BULK_TRASH_FAILURE_SMOKE.works.length &&
              bulkTrashFailureRowsAfter.length === BULK_TRASH_FAILURE_SMOKE.works.length &&
              bulkTrashFailureRowsBefore.every((row) => row.deleted_at == null) &&
              bulkTrashFailureRowsAfter.every((row) => row.deleted_at == null);
            libraryBulkTrashFailurePreserved =
              BULK_TRASH_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)) &&
              bodyIncludes("已选 2 篇") &&
              Boolean(bulkTrashFailureRetryButton) &&
              !bulkTrashFailureRetryButton?.disabled &&
              !document.querySelector('button[aria-label="撤销移入回收站"]');
            const bulkTrashFailureClearButton = Array.from(
              document.querySelectorAll(".library-bulkbar button")
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消选择");
            bulkTrashFailureClearButton?.click();
            await waitFor(() => !bodyIncludes("已选 2 篇"), 1_000);

            setInputValue(searchInput, TRASH_FAILURE_SMOKE.title);
            await waitFor(() => rowText().includes(TRASH_FAILURE_SMOKE.title), 3_000);
            clickRowByTitle(TRASH_FAILURE_SMOKE.title);
            const selectedDetailTitle = () =>
              document.querySelector(".library-detail--selected h2")?.textContent ?? "";
            await waitFor(
              () => selectedDetailTitle().includes(TRASH_FAILURE_SMOKE.title),
              3_000
            );
            const singleTrashButton = () =>
              Array.from(document.querySelectorAll(".library-detail--selected button")).find(
                (button) => {
                  const label = button.textContent?.replace(/\s+/g, " ").trim();
                  return label === "移入回收站" || label === "移入中...";
                }
              );
            const trashFailureRowsBefore = await window.aura.db.query(
              "SELECT deleted_at FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
              [TRASH_FAILURE_SMOKE.workId, libraryId]
            );
            singleTrashButton()?.click();
            const trashFailureDialog = await waitFor(() => {
              const dialog = document.querySelector('[role="dialog"]');
              return dialog?.textContent?.includes("移入回收站？") ? dialog : null;
            }, 3_000);
            window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH__ =
              TRASH_FAILURE_ERROR_SMOKE.error;
            const trashFailureConfirmButton = Array.from(
              trashFailureDialog?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "移入回收站");
            trashFailureConfirmButton?.click();
            libraryTrashFailureBusyVisible = Boolean(
              await waitFor(() => {
                const button = singleTrashButton();
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes("移入中") &&
                  bodyIncludes("正在将《" + TRASH_FAILURE_SMOKE.title + "》移入回收站")
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("移入回收站失败，文献仍保留，可重新移入回收站") &&
                bodyIncludes(TRASH_FAILURE_ERROR_SMOKE.error),
              3_000
            );
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH__;
            const trashFailureRowsAfter = await window.aura.db.query(
              "SELECT deleted_at FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
              [TRASH_FAILURE_SMOKE.workId, libraryId]
            );
            const retryTrashButton = singleTrashButton();
            libraryTrashFailureVisible =
              bodyIncludes("移入回收站失败，文献仍保留，可重新移入回收站") &&
              bodyIncludes(TRASH_FAILURE_ERROR_SMOKE.error);
            libraryTrashFailureDidNotPersist =
              trashFailureRowsBefore[0]?.deleted_at == null &&
              trashFailureRowsAfter[0]?.deleted_at == null;
            libraryTrashFailurePreserved =
              rowText().includes(TRASH_FAILURE_SMOKE.title) &&
              selectedDetailTitle().includes(TRASH_FAILURE_SMOKE.title) &&
              Boolean(retryTrashButton) &&
              !retryTrashButton?.disabled &&
              !document.querySelector('button[aria-label="撤销移入回收站"]');

            setInputValue(searchInput, TRASH_UNDO_SMOKE.title);
            await waitFor(() => rowText().includes(TRASH_UNDO_SMOKE.title), 3_000);
            const trashUndoCheckbox = document.querySelector(
              '[data-library-row-id="' + TRASH_UNDO_SMOKE.workId + '"] .library-checkbox-input'
            );
            if (trashUndoCheckbox && !trashUndoCheckbox.checked) {
              trashUndoCheckbox.click();
              await waitFor(() => bodyIncludes("已选 1 篇"), 1_000);
            }
            const trashUndoDeleteButton = Array.from(
              document.querySelectorAll(".library-bulkbar button")
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除");
            trashUndoDeleteButton?.click();
            const trashUndoDialog = await waitFor(() => {
              const dialog = document.querySelector('[role="dialog"]');
              return dialog?.textContent?.includes("批量移入回收站？") ? dialog : null;
            }, 3_000);
            const trashUndoConfirmButton = Array.from(
              trashUndoDialog?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "移入 1 篇");
            trashUndoConfirmButton?.click();
            await waitFor(
              () =>
                bodyIncludes("已将 1 篇文献移入回收站") &&
                Boolean(document.querySelector('button[aria-label="撤销移入回收站"]')),
              3_000
            );
            const trashUndoButton = document.querySelector('button[aria-label="撤销移入回收站"]');
            libraryTrashUndoVisible = Boolean(
              trashUndoButton &&
                bodyIncludes("已将 1 篇文献移入回收站") &&
                !rowText().includes(TRASH_UNDO_SMOKE.title)
            );
            window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READ__ =
              "Smoke unrelated refresh failure while trash undo remains available";
            document.querySelector('[data-library-action="refresh"]')?.click();
            const unrelatedRefreshFailureVisible = Boolean(
              await waitFor(
                () =>
                  bodyIncludes("读取文献库失败") &&
                  bodyIncludes(
                    "Smoke unrelated refresh failure while trash undo remains available"
                  ),
                3_000
              )
            );
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READ__;
            const trashUndoButtonAfterUnrelatedNotice = document.querySelector(
              'button[aria-label="撤销移入回收站"]'
            );
            libraryTrashUndoVisible =
              libraryTrashUndoVisible &&
              unrelatedRefreshFailureVisible &&
              Boolean(trashUndoButtonAfterUnrelatedNotice) &&
              !trashUndoButtonAfterUnrelatedNotice?.disabled;
            window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH_RESTORE__ =
              TRASH_UNDO_RESTORE_FAILURE_SMOKE.error;
            trashUndoButtonAfterUnrelatedNotice?.click();
            libraryTrashUndoFailureBusyVisible = Boolean(
              await waitFor(() => {
                const button = document.querySelector('button[aria-label="撤销移入回收站"]');
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes("撤销中") &&
                  bodyIncludes("正在撤销移入回收站:1 篇文献")
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("撤销移入回收站失败，撤销入口仍保留，可重新撤销") &&
                bodyIncludes(TRASH_UNDO_RESTORE_FAILURE_SMOKE.error),
              3_000
            );
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH_RESTORE__;
            const trashUndoRowsAfterFailure = await window.aura.db.query(
              "SELECT deleted_at FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
              [TRASH_UNDO_SMOKE.workId, libraryId]
            );
            const trashUndoButtonAfterFailure = document.querySelector(
              'button[aria-label="撤销移入回收站"]'
            );
            libraryTrashUndoFailureVisible =
              bodyIncludes("撤销移入回收站失败，撤销入口仍保留，可重新撤销") &&
              bodyIncludes(TRASH_UNDO_RESTORE_FAILURE_SMOKE.error);
            libraryTrashUndoFailureDidNotPersist =
              trashUndoRowsAfterFailure[0]?.deleted_at != null;
            libraryTrashUndoFailurePreserved =
              Boolean(trashUndoButtonAfterFailure) &&
              !trashUndoButtonAfterFailure?.disabled &&
              !rowText().includes(TRASH_UNDO_SMOKE.title);
            trashUndoButtonAfterFailure?.click();
            libraryTrashUndoBusyVisible = Boolean(
              await waitFor(() => {
                const button = document.querySelector('button[aria-label="撤销移入回收站"]');
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes("撤销中") &&
                  bodyIncludes("正在撤销移入回收站:1 篇文献")
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(
              () => bodyIncludes("已撤销移入回收站") && rowText().includes(TRASH_UNDO_SMOKE.title),
              3_000
            );
            const trashUndoRows = await window.aura.db.query(
              "SELECT deleted_at FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
              [TRASH_UNDO_SMOKE.workId, libraryId]
            );
            libraryTrashUndoRecovered =
              libraryTrashUndoVisible &&
              libraryTrashUndoBusyVisible &&
              bodyIncludes("已撤销移入回收站") &&
              rowText().includes(TRASH_UNDO_SMOKE.title) &&
              trashUndoRows[0]?.deleted_at == null;
            setInputValue(searchInput, "");
            await waitFor(() => rowText().includes(SAMPLE.title), 3_000);
          }

            const libraryFilterTabGroup = () =>
              document.querySelector('.library-tabs[role="group"][aria-label="阅读状态筛选"]');
            const libraryFilterTab = (label) =>
              Array.from(libraryFilterTabGroup()?.querySelectorAll(".library-tab") ?? []).find(
                (button) => button.textContent?.includes(label)
              );
            const allInitialTab = libraryFilterTab("全部");
            const readingTab = libraryFilterTab("阅读中");
            libraryFilterTabsExposeState =
              Boolean(libraryFilterTabGroup()) &&
              allInitialTab?.getAttribute("aria-pressed") === "true" &&
              readingTab?.getAttribute("aria-pressed") === "false";

            const trashTab = document.querySelector('[data-library-view="trash"]');
            trashTab?.click();
          await waitFor(
            () =>
              document.querySelector('input[placeholder="搜索回收站"]') &&
              bodyIncludes(TRASH_ACTION_SMOKE.title),
            3_000
            );
            libraryFilterTabsExposeState =
              libraryFilterTabsExposeState &&
              trashTab?.getAttribute("aria-current") === "page";
          const trashSearchInput = document.querySelector('input[placeholder="搜索回收站"]');
          if (trashSearchInput) {
            setInputValue(trashSearchInput, TRASH_PURGE_FAILURE_SMOKE.query);
            await waitFor(
              () =>
                TRASH_PURGE_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)),
              3_000
            );
            for (const work of TRASH_PURGE_FAILURE_SMOKE.works) {
              const checkbox = document.querySelector(
                '[data-library-row-id="' + work.workId + '"] .library-checkbox-input'
              );
              if (checkbox && !checkbox.checked) checkbox.click();
            }
            await waitFor(() => bodyIncludes("已选 2 篇"), 1_000);
            const trashPurgeFailureButton = () =>
              Array.from(document.querySelectorAll(".library-bulkbar button")).find((button) => {
                const label = button.textContent?.replace(/\s+/g, " ").trim();
                return label === "永久删除" || label === "删除中...";
              });
            const purgeFailureRowsBefore = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM works WHERE id IN (?, ?) AND deleted_at IS NOT NULL AND works.library_id = ?",
              [
                TRASH_PURGE_FAILURE_SMOKE.works[0].workId,
                TRASH_PURGE_FAILURE_SMOKE.works[1].workId
              , libraryId]
            );
            trashPurgeFailureButton()?.click();
            const trashPurgeFailureDialog = await waitFor(() => {
              const dialog = document.querySelector('[role="dialog"]');
              return dialog?.textContent?.includes("永久删除文献？") ? dialog : null;
            }, 3_000);
            const trashPurgeFailureConfirmButton = Array.from(
              trashPurgeFailureDialog?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "永久删除");
            const trashPurgeFailurePhraseInput = trashPurgeFailureDialog?.querySelector(
              ".library-confirm-modal__phrase input"
            );
            if (trashPurgeFailurePhraseInput) {
              setInputValue(trashPurgeFailurePhraseInput, "永久删除");
              await waitFor(() => !trashPurgeFailureConfirmButton?.disabled, 1_000);
            }
            await window.aura.db.exec("DROP TRIGGER IF EXISTS aurascholar_smoke_purge_failure");
            await window.aura.db.exec(
              "CREATE TEMP TRIGGER aurascholar_smoke_purge_failure BEFORE DELETE ON works WHEN OLD.id = 'smoke-work-trash-purge-failure-b' BEGIN SELECT RAISE(FAIL, 'Smoke library trash purge rollback failure'); END;"
            );
            trashPurgeFailureConfirmButton?.click();
            libraryTrashPurgeFailureBusyVisible = Boolean(
              await waitFor(() => {
                const button = trashPurgeFailureButton();
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes("删除中") &&
                  bodyIncludes("正在永久删除 2 篇文献")
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("永久删除失败，所选文献仍保留在回收站，可重新永久删除") &&
                bodyIncludes(TRASH_PURGE_FAILURE_SMOKE.error),
              3_000
            );
            await window.aura.db.exec("DROP TRIGGER IF EXISTS aurascholar_smoke_purge_failure");
            const purgeFailureRowsAfter = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM works WHERE id IN (?, ?) AND deleted_at IS NOT NULL AND works.library_id = ?",
              [
                TRASH_PURGE_FAILURE_SMOKE.works[0].workId,
                TRASH_PURGE_FAILURE_SMOKE.works[1].workId
              , libraryId]
            );
            const trashPurgeFailureRetryButton = trashPurgeFailureButton();
            libraryTrashPurgeFailureVisible =
              bodyIncludes("永久删除失败，所选文献仍保留在回收站，可重新永久删除") &&
              bodyIncludes(TRASH_PURGE_FAILURE_SMOKE.error);
            libraryTrashPurgeFailureDidNotPersist =
              Number(purgeFailureRowsBefore[0]?.n ?? 0) ===
                TRASH_PURGE_FAILURE_SMOKE.works.length &&
              Number(purgeFailureRowsAfter[0]?.n ?? 0) ===
                TRASH_PURGE_FAILURE_SMOKE.works.length;
            libraryTrashPurgeFailurePreserved =
              TRASH_PURGE_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)) &&
              bodyIncludes("已选 2 篇") &&
              Boolean(trashPurgeFailureRetryButton) &&
              !trashPurgeFailureRetryButton?.disabled;
            const trashPurgeFailureClearButton = Array.from(
              document.querySelectorAll(".library-bulkbar button")
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消选择");
            trashPurgeFailureClearButton?.click();
            await waitFor(() => !bodyIncludes("已选 2 篇"), 1_000);

            setInputValue(trashSearchInput, TRASH_RESTORE_FAILURE_SMOKE.query);
            await waitFor(
              () =>
                TRASH_RESTORE_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)),
              3_000
            );
            for (const work of TRASH_RESTORE_FAILURE_SMOKE.works) {
              const checkbox = document.querySelector(
                '[data-library-row-id="' + work.workId + '"] .library-checkbox-input'
              );
              if (checkbox && !checkbox.checked) checkbox.click();
            }
            await waitFor(() => bodyIncludes("已选 2 篇"), 1_000);
            const trashRestoreFailureButton = () =>
              Array.from(document.querySelectorAll(".library-bulkbar button")).find((button) => {
                const label = button.textContent?.replace(/\s+/g, " ").trim();
                return label === "恢复" || label === "恢复中...";
              });
            const restoreFailureRowsBefore = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM works WHERE id IN (?, ?) AND deleted_at IS NOT NULL AND works.library_id = ?",
              [
                TRASH_RESTORE_FAILURE_SMOKE.works[0].workId,
                TRASH_RESTORE_FAILURE_SMOKE.works[1].workId
              , libraryId]
            );
            await window.aura.db.exec(
              "DROP TRIGGER IF EXISTS aurascholar_smoke_trash_restore_failure"
            );
            await window.aura.db.exec(
              "CREATE TEMP TRIGGER aurascholar_smoke_trash_restore_failure BEFORE UPDATE OF deleted_at ON works WHEN OLD.id = 'smoke-work-trash-restore-failure-b' AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL BEGIN SELECT RAISE(FAIL, 'Smoke library trash restore rollback failure'); END;"
            );
            try {
              trashRestoreFailureButton()?.click();
              libraryTrashRestoreFailureBusyVisible = Boolean(
                await waitFor(() => {
                  const button = trashRestoreFailureButton();
                  return button?.disabled &&
                    button.getAttribute("aria-busy") === "true" &&
                    button.textContent?.includes("恢复中") &&
                    bodyIncludes("正在恢复 2 篇文献")
                    ? button
                    : null;
                }, 1_000)
              );
              await waitFor(
                () =>
                  bodyIncludes("恢复文献失败，所选文献仍保留在回收站，可重新恢复") &&
                  bodyIncludes(TRASH_RESTORE_FAILURE_SMOKE.error),
                3_000
              );
            } finally {
              await window.aura.db.exec(
                "DROP TRIGGER IF EXISTS aurascholar_smoke_trash_restore_failure"
              );
            }
            const restoreFailureRowsAfter = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM works WHERE id IN (?, ?) AND deleted_at IS NOT NULL AND works.library_id = ?",
              [
                TRASH_RESTORE_FAILURE_SMOKE.works[0].workId,
                TRASH_RESTORE_FAILURE_SMOKE.works[1].workId
              , libraryId]
            );
            const trashRestoreFailureRetryButton = trashRestoreFailureButton();
            libraryTrashRestoreFailureVisible =
              bodyIncludes("恢复文献失败，所选文献仍保留在回收站，可重新恢复") &&
              bodyIncludes(TRASH_RESTORE_FAILURE_SMOKE.error);
            libraryTrashRestoreFailureDidNotPersist =
              Number(restoreFailureRowsBefore[0]?.n ?? 0) ===
                TRASH_RESTORE_FAILURE_SMOKE.works.length &&
              Number(restoreFailureRowsAfter[0]?.n ?? 0) ===
                TRASH_RESTORE_FAILURE_SMOKE.works.length;
            libraryTrashRestoreFailurePreserved =
              TRASH_RESTORE_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)) &&
              bodyIncludes("已选 2 篇") &&
              Boolean(trashRestoreFailureRetryButton) &&
              !trashRestoreFailureRetryButton?.disabled;
            const trashRestoreFailureClearButton = Array.from(
              document.querySelectorAll(".library-bulkbar button")
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消选择");
            trashRestoreFailureClearButton?.click();
            await waitFor(() => !bodyIncludes("已选 2 篇"), 1_000);

            setInputValue(trashSearchInput, TRASH_PURGE_SMOKE.title);
            await waitFor(() => rowText().includes(TRASH_PURGE_SMOKE.title), 3_000);
            const trashPurgeCheckbox = document.querySelector(
              '[data-library-row-id="' + TRASH_PURGE_SMOKE.workId + '"] .library-checkbox-input'
            );
            if (trashPurgeCheckbox && !trashPurgeCheckbox.checked) {
              trashPurgeCheckbox.click();
              await waitFor(() => bodyIncludes("已选 1 篇"), 1_000);
            }
            const trashPurgeButton = () =>
              Array.from(document.querySelectorAll(".library-bulkbar button")).find((button) => {
                const label = button.textContent?.replace(/\s+/g, " ").trim();
                return label === "永久删除" || label === "删除中...";
              });
            trashPurgeButton()?.click();
            const trashPurgeDialog = await waitFor(() => {
              const dialog = document.querySelector('[role="dialog"]');
              return dialog?.textContent?.includes("永久删除文献？") ? dialog : null;
            }, 3_000);
            const trashPurgeConfirmButton = Array.from(
              trashPurgeDialog?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "永久删除");
            const trashPurgePhraseInput = trashPurgeDialog?.querySelector(
              ".library-confirm-modal__phrase input"
            );
            const blockedRows = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM works WHERE id = ? AND works.library_id = ?",
              [TRASH_PURGE_SMOKE.workId, libraryId]
            );
            libraryTrashPurgeTypedConfirmProtected =
              Boolean(trashPurgeConfirmButton?.disabled) &&
              Boolean(trashPurgePhraseInput) &&
              bodyIncludes("输入“永久删除”后才会启用确认按钮。") &&
              Number(blockedRows[0]?.n ?? 0) === 1;
            if (trashPurgePhraseInput) {
              setInputValue(trashPurgePhraseInput, "永久删除");
              await waitFor(() => !trashPurgeConfirmButton?.disabled, 1_000);
            }
            trashPurgeConfirmButton?.click();
            await waitFor(
              () =>
                trashPurgeButton()?.disabled &&
                trashPurgeButton()?.getAttribute("aria-busy") === "true" &&
                trashPurgeButton()?.textContent?.includes("删除中") &&
                bodyIncludes("正在永久删除 1 篇文献"),
              1_000
            );
            libraryTrashPurgeBusyVisible = Boolean(
              trashPurgeButton()?.disabled &&
                trashPurgeButton()?.getAttribute("aria-busy") === "true" &&
                trashPurgeButton()?.textContent?.includes("删除中") &&
                bodyIncludes("正在永久删除 1 篇文献")
            );
            await waitFor(
              () => bodyIncludes("已永久删除 1 篇文献") && !rowText().includes(TRASH_PURGE_SMOKE.title),
              3_000
            );
            const purgedRows = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM works WHERE id = ? AND works.library_id = ?",
              [TRASH_PURGE_SMOKE.workId, libraryId]
            );
            libraryTrashPurgePersisted =
              bodyIncludes("已永久删除 1 篇文献") && Number(purgedRows[0]?.n ?? 0) === 0;
            setInputValue(trashSearchInput, "");
            await waitFor(() => bodyIncludes(TRASH_ACTION_SMOKE.title), 3_000);
          }
          const trashActionCheckbox = document.querySelector(
            '[data-library-row-id="' + TRASH_ACTION_SMOKE.workId + '"] .library-checkbox-input'
          );
          if (trashActionCheckbox && !trashActionCheckbox.checked) {
            trashActionCheckbox.click();
            await waitFor(() => bodyIncludes("已选 1 篇"), 1_000);
          }
          const trashRestoreButton = () =>
            Array.from(document.querySelectorAll(".library-bulkbar button")).find((button) => {
              const label = button.textContent?.replace(/\s+/g, " ").trim();
              return label === "恢复" || label === "恢复中...";
            });
          if (trashActionCheckbox?.checked && trashRestoreButton()) {
            trashRestoreButton()?.click();
            await waitFor(
              () =>
                trashRestoreButton()?.disabled &&
                trashRestoreButton()?.textContent?.includes("恢复中") &&
                bodyIncludes("正在恢复 1 篇文献"),
              1_000
            );
            libraryTrashRestoreBusyVisible = Boolean(
              trashRestoreButton()?.disabled &&
                trashRestoreButton()?.textContent?.includes("恢复中") &&
                bodyIncludes("正在恢复 1 篇文献")
            );
            await waitFor(
              () => bodyIncludes("已恢复 1 篇文献") && !bodyIncludes(TRASH_ACTION_SMOKE.title),
              3_000
            );
            const restoredRows = await window.aura.db.query(
              "SELECT deleted_at FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
              [TRASH_ACTION_SMOKE.workId, libraryId]
            );
            libraryTrashRestoreSuccessVisible =
              bodyIncludes("已恢复 1 篇文献") && restoredRows[0]?.deleted_at == null;
            }
`;
