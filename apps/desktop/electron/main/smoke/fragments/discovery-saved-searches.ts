export const smokeDiscoverySavedSearches = String.raw`        const openSourceCard = Array.from(document.querySelectorAll(".discovery-card")).find((card) =>
          card.textContent?.includes("开放源聚合检索")
        );
        openSourceCard?.click();
        await waitFor(
          () =>
            Boolean(document.querySelector(".discovery-command-card")) &&
            bodyIncludes("保存为订阅"),
          2_000
        );
        discoverySavedSearchLastErrorVisible =
          bodyIncludes(SAVED_SEARCH_ERROR_SMOKE.query) &&
          bodyIncludes("检查失败") &&
          bodyIncludes(SAVED_SEARCH_ERROR_SMOKE.error);
        const duplicateSavedSearchInput = document.querySelector(
          'input[aria-label="开放源检索关键词"]'
        );
        if (duplicateSavedSearchInput) {
          setInputValue(duplicateSavedSearchInput, SAVED_SEARCH_SMOKE.query);
        }
        const saveDuplicateSearchButton = () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) =>
              /保存为订阅|保存中/.test(button.textContent?.replace(/\s+/g, " ").trim() ?? "")
          );
        await waitFor(() => {
          const button = saveDuplicateSearchButton();
          return Boolean(button && !button.disabled);
        }, 1_000);
        const savedSearchSaveFailureRowsBefore = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM saved_searches WHERE deleted_at IS NULL AND query = ? AND saved_searches.library_id = ?",
          [SAVED_SEARCH_SAVE_FAILURE_SMOKE.query, libraryId]
        );
        if (duplicateSavedSearchInput) {
          setInputValue(duplicateSavedSearchInput, SAVED_SEARCH_SAVE_FAILURE_SMOKE.query);
          await waitFor(
            () => duplicateSavedSearchInput.value === SAVED_SEARCH_SAVE_FAILURE_SMOKE.query,
            500
          );
          await wait(50);
        }
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_SAVE_SEARCH__ =
          SAVED_SEARCH_SAVE_FAILURE_SMOKE.error;
        try {
          saveDuplicateSearchButton()?.click();
          discoverySavedSearchSaveFailureBusyVisible = Boolean(
            await waitFor(() => {
              const button = saveDuplicateSearchButton();
              return button?.disabled &&
                button.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("保存中")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("保存订阅失败，检索条件仍保留，可重新保存") &&
              bodyIncludes(SAVED_SEARCH_SAVE_FAILURE_SMOKE.error),
            3_000
          );
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_SAVE_SEARCH__;
        }
        const savedSearchSaveFailureRowsAfter = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM saved_searches WHERE deleted_at IS NULL AND query = ? AND saved_searches.library_id = ?",
          [SAVED_SEARCH_SAVE_FAILURE_SMOKE.query, libraryId]
        );
        const saveFailureButtonAfter = saveDuplicateSearchButton();
        discoverySavedSearchSaveFailureVisible =
          bodyIncludes("保存订阅失败，检索条件仍保留，可重新保存") &&
          bodyIncludes(SAVED_SEARCH_SAVE_FAILURE_SMOKE.error);
        discoverySavedSearchSaveFailurePreserved = Boolean(
          duplicateSavedSearchInput?.value === SAVED_SEARCH_SAVE_FAILURE_SMOKE.query &&
            saveFailureButtonAfter &&
            !saveFailureButtonAfter.disabled
        );
        discoverySavedSearchSaveFailureDidNotPersist =
          Number(savedSearchSaveFailureRowsBefore[0]?.n ?? 0) ===
          Number(savedSearchSaveFailureRowsAfter[0]?.n ?? -1);
        if (duplicateSavedSearchInput) {
          setInputValue(duplicateSavedSearchInput, SAVED_SEARCH_SMOKE.query);
          await waitFor(() => duplicateSavedSearchInput.value === SAVED_SEARCH_SMOKE.query, 500);
          await wait(50);
        }
        await waitFor(() => {
          const button = saveDuplicateSearchButton();
          return Boolean(button && !button.disabled);
        }, 1_000);
        saveDuplicateSearchButton()?.click();
        await waitFor(() => bodyIncludes("检索订阅已存在"), 2_000);
        const duplicateSearchRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM saved_searches WHERE deleted_at IS NULL AND query = ? AND saved_searches.library_id = ?",
          [SAVED_SEARCH_SMOKE.query, libraryId]
        );
        discoveryDuplicateSavedSearchCount = Number(duplicateSearchRows[0]?.n ?? 0);
        discoveryDuplicateSavedSearchMessageVisible = bodyIncludes("检索订阅已存在");
        discoveryDuplicateSavedSearchBlocked =
          discoveryDuplicateSavedSearchMessageVisible && discoveryDuplicateSavedSearchCount === 1;

        const savedSearchSub = Array.from(document.querySelectorAll(".discovery-sub")).find((item) =>
          item.textContent?.includes(SAVED_SEARCH_MANUAL_SMOKE.query)
        );
        const savedSearchCheckButton = Array.from(savedSearchSub?.querySelectorAll("button") ?? []).find(
          (button) => button.getAttribute("title")?.includes("立即检查新结果")
        );
        if (savedSearchCheckButton) {
          window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__ = {
            acceptAnyQuery: true,
            delayMs: 450,
            empty: true,
            query: SAVED_SEARCH_MANUAL_SMOKE.query,
            title: "Smoke Manual Saved Search Empty Result"
          };
          try {
            savedSearchCheckButton.click();
            await waitFor(
              () =>
                savedSearchCheckButton.disabled &&
                savedSearchCheckButton.getAttribute("aria-busy") === "true" &&
                savedSearchCheckButton.textContent?.includes("…") &&
                bodyIncludes("正在检查订阅的新结果"),
              1_000
            );
            discoverySavedSearchManualCheckBusyVisible =
              savedSearchCheckButton.disabled &&
              savedSearchCheckButton.getAttribute("aria-busy") === "true" &&
              savedSearchCheckButton.textContent?.includes("…") &&
              bodyIncludes("正在检查订阅的新结果");
            savedSearchCheckButton.click();
            await waitFor(
              () =>
                !savedSearchCheckButton.disabled &&
                savedSearchCheckButton.textContent?.includes("↻") &&
                bodyIncludes("暂无新结果"),
              4_000
            );
            discoverySavedSearchManualCheckCompleted =
              !savedSearchCheckButton.disabled &&
              savedSearchCheckButton.textContent?.includes("↻") &&
              bodyIncludes("暂无新结果");
          } finally {
            delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
          }
        }

        const savedSearchDeleteSub = Array.from(document.querySelectorAll(".discovery-sub")).find((item) =>
          item.textContent?.includes(SAVED_SEARCH_ERROR_SMOKE.query)
        );
        const savedSearchDeleteButton = Array.from(savedSearchDeleteSub?.querySelectorAll("button") ?? []).find(
          (button) => button.getAttribute("title")?.includes("删除订阅")
        );
        const savedSearchDeleteFailureRowsBefore = await window.aura.db.query(
          "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM saved_searches WHERE library_id = (SELECT id FROM current_library)) AS saved_searches WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM (SELECT * FROM saved_searches WHERE library_id = (SELECT id FROM current_library)) AS saved_searches WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count",
          [libraryId, SAVED_SEARCH_ERROR_SMOKE.id, SAVED_SEARCH_ERROR_SMOKE.id]
        );
        savedSearchDeleteButton?.click();
        const savedSearchDeleteFailureDialog = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("删除检索订阅？") ? dialog : null;
        }, 3_000);
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_DELETE_SEARCH__ =
          SAVED_SEARCH_DELETE_FAILURE_SMOKE.error;
        try {
          const confirmFailedSavedSearchDeleteButton = Array.from(
            savedSearchDeleteFailureDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除订阅");
          confirmFailedSavedSearchDeleteButton?.click();
          discoverySavedSearchDeleteFailureBusyVisible = Boolean(
            await waitFor(() => {
              const row = Array.from(document.querySelectorAll(".discovery-sub")).find((item) =>
                item.textContent?.includes(SAVED_SEARCH_ERROR_SMOKE.query)
              );
              const button = Array.from(row?.querySelectorAll("button") ?? []).find((item) =>
                item.getAttribute("aria-busy") === "true" && item.textContent?.includes("…")
              );
              return button?.disabled &&
                button.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("…") &&
                row?.textContent?.includes("正在删除订阅")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("删除订阅失败，订阅仍保留，可重新删除") &&
              bodyIncludes(SAVED_SEARCH_DELETE_FAILURE_SMOKE.error),
            3_000
          );
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_DELETE_SEARCH__;
        }
        const savedSearchDeleteFailureRowsAfter = await window.aura.db.query(
          "WITH current_library(id) AS (VALUES (?)) SELECT (SELECT COUNT(*) FROM (SELECT * FROM saved_searches WHERE library_id = (SELECT id FROM current_library)) AS saved_searches WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM (SELECT * FROM saved_searches WHERE library_id = (SELECT id FROM current_library)) AS saved_searches WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count",
          [libraryId, SAVED_SEARCH_ERROR_SMOKE.id, SAVED_SEARCH_ERROR_SMOKE.id]
        );
        const savedSearchDeleteSubAfterFailure = Array.from(
          document.querySelectorAll(".discovery-sub")
        ).find((item) => item.textContent?.includes(SAVED_SEARCH_ERROR_SMOKE.query));
        const savedSearchDeleteButtonAfterFailure = Array.from(
          savedSearchDeleteSubAfterFailure?.querySelectorAll("button") ?? []
        ).find((button) => button.getAttribute("title")?.includes("删除订阅"));
        discoverySavedSearchDeleteFailureVisible =
          bodyIncludes("删除订阅失败，订阅仍保留，可重新删除") &&
          bodyIncludes(SAVED_SEARCH_DELETE_FAILURE_SMOKE.error);
        discoverySavedSearchDeleteFailurePreserved = Boolean(
          savedSearchDeleteSubAfterFailure &&
            savedSearchDeleteButtonAfterFailure &&
            !savedSearchDeleteButtonAfterFailure.disabled &&
            savedSearchDeleteButtonAfterFailure.getAttribute("aria-busy") !== "true" &&
            !document.querySelector('button[aria-label="撤销删除检索订阅"]')
        );
        discoverySavedSearchDeleteFailureDidNotPersist =
          Number(savedSearchDeleteFailureRowsBefore[0]?.active_count ?? 0) ===
            Number(savedSearchDeleteFailureRowsAfter[0]?.active_count ?? -1) &&
          Number(savedSearchDeleteFailureRowsBefore[0]?.deleted_count ?? 0) ===
            Number(savedSearchDeleteFailureRowsAfter[0]?.deleted_count ?? -1);
        savedSearchDeleteButtonAfterFailure?.click();
        const savedSearchDeleteDialog = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("删除检索订阅？") ? dialog : null;
        }, 3_000);
        discoverySavedSearchDeleteConfirmVisible = Boolean(
          savedSearchDeleteDialog?.textContent?.includes(SAVED_SEARCH_ERROR_SMOKE.query)
        );
        const confirmSavedSearchDeleteButton = Array.from(
          savedSearchDeleteDialog?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除订阅");
        confirmSavedSearchDeleteButton?.click();
        await waitFor(
          () =>
            savedSearchDeleteButton?.disabled &&
            savedSearchDeleteButton.getAttribute("aria-busy") === "true" &&
            savedSearchDeleteButton.textContent?.includes("…") &&
            savedSearchDeleteSub?.textContent?.includes("正在删除订阅"),
          1_000
        );
        discoverySavedSearchDeleteBusyVisible = Boolean(
          savedSearchDeleteButton?.disabled &&
            savedSearchDeleteButton.getAttribute("aria-busy") === "true" &&
            savedSearchDeleteButton.textContent?.includes("…") &&
            savedSearchDeleteSub?.textContent?.includes("正在删除订阅")
        );
        await waitFor(
          () =>
            bodyIncludes("已删除检索订阅") &&
            !Array.from(document.querySelectorAll(".discovery-sub")).some((item) =>
              item.textContent?.includes(SAVED_SEARCH_ERROR_SMOKE.query)
            ),
          3_000
        );
        const savedSearchDeleteRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM saved_searches WHERE deleted_at IS NULL AND query = ? AND saved_searches.library_id = ?",
          [SAVED_SEARCH_ERROR_SMOKE.query, libraryId]
        );
        discoverySavedSearchDeletePersisted = Number(savedSearchDeleteRows[0]?.n ?? 0) === 0;
        discoverySavedSearchDeleted =
          discoverySavedSearchDeleteConfirmVisible &&
          discoverySavedSearchDeleteBusyVisible &&
          discoverySavedSearchDeletePersisted &&
          bodyIncludes("已删除检索订阅");
        const savedSearchUndoButton = document.querySelector('button[aria-label="撤销删除检索订阅"]');
        discoverySavedSearchDeleteUndoVisible = Boolean(
          discoverySavedSearchDeleted && savedSearchUndoButton
        );
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_RESTORE_SEARCH__ =
          SAVED_SEARCH_RESTORE_FAILURE_SMOKE.error;
        try {
          savedSearchUndoButton?.click();
          discoverySavedSearchDeleteUndoFailureBusyVisible = Boolean(
            await waitFor(() => {
              const button = document.querySelector('button[aria-label="撤销删除检索订阅"]');
              return button?.disabled &&
                button.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("撤销中") &&
                bodyIncludes("正在撤销删除检索订阅")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("撤销删除订阅失败，撤销入口仍保留，可重新撤销") &&
              bodyIncludes(SAVED_SEARCH_RESTORE_FAILURE_SMOKE.error),
            3_000
          );
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_RESTORE_SEARCH__;
        }
        const savedSearchUndoFailureRows = await window.aura.db.query(
          "SELECT deleted_at, last_error FROM saved_searches WHERE id = ? AND saved_searches.library_id = ? LIMIT 1",
          [SAVED_SEARCH_ERROR_SMOKE.id, libraryId]
        );
        const savedSearchUndoButtonAfterFailure = await waitFor(() => {
          const button = document.querySelector('button[aria-label="撤销删除检索订阅"]');
          return button && !button.disabled && button.getAttribute("aria-busy") !== "true"
            ? button
            : null;
        }, 1_000);
        discoverySavedSearchDeleteUndoFailureVisible =
          bodyIncludes("撤销删除订阅失败，撤销入口仍保留，可重新撤销") &&
          bodyIncludes(SAVED_SEARCH_RESTORE_FAILURE_SMOKE.error);
        discoverySavedSearchDeleteUndoFailurePreserved = Boolean(savedSearchUndoButtonAfterFailure);
        discoverySavedSearchDeleteUndoFailureDidNotPersist =
          savedSearchUndoFailureRows[0]?.deleted_at != null &&
          savedSearchUndoFailureRows[0]?.last_error === SAVED_SEARCH_ERROR_SMOKE.error;
        savedSearchUndoButtonAfterFailure?.click();
        discoverySavedSearchDeleteUndoBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销删除检索订阅"]');
            return button?.disabled &&
              button.getAttribute("aria-busy") === "true" &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销删除检索订阅")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("已撤销删除检索订阅") &&
            Array.from(document.querySelectorAll(".discovery-sub")).some((item) =>
              item.textContent?.includes(SAVED_SEARCH_ERROR_SMOKE.query)
            ),
          3_000
        );
        const restoredSavedSearchRows = await window.aura.db.query(
          "SELECT deleted_at, last_error FROM saved_searches WHERE id = ? AND saved_searches.library_id = ? LIMIT 1",
          [SAVED_SEARCH_ERROR_SMOKE.id, libraryId]
        );
        discoverySavedSearchDeleteUndoRestored =
          discoverySavedSearchDeleteUndoVisible &&
          discoverySavedSearchDeleteUndoBusyVisible &&
          bodyIncludes("已撤销删除检索订阅") &&
          restoredSavedSearchRows[0]?.deleted_at == null &&
          restoredSavedSearchRows[0]?.last_error === SAVED_SEARCH_ERROR_SMOKE.error;

`;
