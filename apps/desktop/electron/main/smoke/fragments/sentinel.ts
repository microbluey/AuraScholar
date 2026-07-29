export const smokeSentinel = String.raw`        location.hash = "#/sentinel";
        await waitFor(
          () =>
            location.hash.includes("/sentinel") &&
            bodyIncludes("检索哨兵") &&
            bodyIncludes("检索哨兵暂时不可用") &&
            bodyIncludes("Smoke sentinel initial load failure") &&
            Boolean(document.querySelector('button[aria-label="重试读取检索哨兵"]')) &&
            Boolean(document.querySelector(".sentinel-mode-tabs")),
          4_000
        );
        sentinelLoadRetryAttempts = 1;
        document.querySelector('button[aria-label="重试读取检索哨兵"]')?.click();
        await waitFor(
          () =>
            bodyIncludes(SENTINEL_ERROR_SMOKE.title) &&
            !bodyIncludes("检索哨兵暂时不可用") &&
            !bodyIncludes("Smoke sentinel initial load failure"),
          5_000
        );
        sentinelLoadRetryAttempts += 1;
        sentinelLoadRetryRecoveryVisible =
          sentinelLoadRetryAttempts === 2 &&
          bodyIncludes(SENTINEL_ERROR_SMOKE.title) &&
          !bodyIncludes("检索哨兵暂时不可用") &&
          !bodyIncludes("Smoke sentinel initial load failure");
        sentinelLoadRetryRecoveryDetail =
          "attempts=" +
          sentinelLoadRetryAttempts +
          "; task=" +
          bodyIncludes(SENTINEL_ERROR_SMOKE.title) +
          "; error=" +
          bodyIncludes("检索哨兵暂时不可用");
        delete window.__AURASCHOLAR_SMOKE_SENTINEL_FAIL_NEXT_READ__;
        const sentinelRaceTitle = "Smoke Sentinel Race Newer Refresh Wins";
        const sentinelRaceNow = Date.now();
        window.__AURASCHOLAR_SMOKE_SENTINEL_AFTER_READ_DELAY_MS__ = 450;
        window.__AURASCHOLAR_SMOKE_SENTINEL_AFTER_READ_COUNT__ = 0;
        window.dispatchEvent(new Event("aurascholar:sentinel-updated"));
        await waitFor(
          () => Number(window.__AURASCHOLAR_SMOKE_SENTINEL_AFTER_READ_COUNT__ ?? 0) >= 1,
          1_000
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO sentinel_tasks (id, library_id, work_id, doi, title, current_state, target_flags, poll_interval_s, next_poll_at, last_polled_at, error_count, status, created_at, updated_at, deleted_at) VALUES (?, ?, NULL, ?, ?, 'accepted', NULL, 86400, ?, NULL, 0, 'active', ?, ?, NULL)",
          [
            "smoke-sentinel-refresh-race", libraryId,
            "10.4242/aurascholar.sentinel-refresh-race",
            sentinelRaceTitle,
            sentinelRaceNow + 86_400_000,
            sentinelRaceNow,
            sentinelRaceNow
          ]
        );
        window.__AURASCHOLAR_SMOKE_SENTINEL_AFTER_READ_DELAY_MS__ = 0;
        window.dispatchEvent(new Event("aurascholar:sentinel-updated"));
        await waitFor(() => bodyIncludes(sentinelRaceTitle), 2_000);
        await wait(650);
        sentinelRefreshRacePreserved =
          bodyIncludes(sentinelRaceTitle) &&
          bodyIncludes(SENTINEL_ERROR_SMOKE.title) &&
          !bodyIncludes("读取哨兵任务");
        delete window.__AURASCHOLAR_SMOKE_SENTINEL_AFTER_READ_DELAY_MS__;
        delete window.__AURASCHOLAR_SMOKE_SENTINEL_AFTER_READ_COUNT__;

        const sentinelTitleViewButton = Array.from(
          document.querySelectorAll(".sentinel-view-tabs button")
        ).find((button) => button.textContent?.includes("找 DOI"));
        sentinelTitleViewButton?.click();
        await waitFor(
          () =>
            bodyIncludes("当前视图没有任务") &&
            Boolean(document.querySelector('button[aria-label="查看全部哨兵任务"]')),
          1_000
        );
        document.querySelector('button[aria-label="查看全部哨兵任务"]')?.click();
        sentinelFilterEmptyActionRestoresResults = Boolean(
          await waitFor(
            () => {
              const allViewButton = Array.from(
                document.querySelectorAll(".sentinel-view-tabs button")
              ).find((button) => button.textContent?.includes("全部"));
              return (
                bodyIncludes(sentinelRaceTitle) &&
                !bodyIncludes("当前视图没有任务") &&
                allViewButton?.classList.contains("sentinel-view-tab--active") &&
                document.activeElement === allViewButton
              );
            },
            1_000
          )
        );

        sentinelLastErrorVisible =
          bodyIncludes(SENTINEL_ERROR_SMOKE.title) &&
          bodyIncludes("最近失败") &&
          bodyIncludes(SENTINEL_ERROR_SMOKE.error);
        const sentinelManualFailureCard = Array.from(
          document.querySelectorAll(".sentinel-task-card")
        ).find((card) => card.textContent?.includes(SENTINEL_MANUAL_FAILURE_SMOKE.title));
        const sentinelManualFailureButton = sentinelManualFailureCard
          ? Array.from(sentinelManualFailureCard.querySelectorAll("button")).find(
              (button) => button.textContent?.replace(/\s+/g, " ").trim() === "单独检查"
            )
          : null;
        sentinelManualFailureButton?.click();
        sentinelTaskCheckBusyVisible = Boolean(
          await waitFor(() => {
            const card = Array.from(document.querySelectorAll(".sentinel-task-card")).find((item) =>
              item.textContent?.includes(SENTINEL_MANUAL_FAILURE_SMOKE.title)
            );
            const busyButton = Array.from(card?.querySelectorAll("button") ?? []).find(
              (button) => button.getAttribute("aria-busy") === "true"
            );
            return card?.getAttribute("aria-busy") === "true" &&
              busyButton?.disabled &&
              busyButton.textContent?.includes("检查中") &&
              bodyIncludes("正在检查该监控")
              ? busyButton
              : null;
          }, 1_000)
        );
        sentinelManualFailureVisible = Boolean(
          await waitFor(
            () =>
              bodyIncludes("单篇检查失败") &&
              bodyIncludes(SENTINEL_MANUAL_FAILURE_SMOKE.title) &&
              bodyIncludes(SENTINEL_MANUAL_FAILURE_SMOKE.errorFragment),
            2_000
          )
        );
        const sentinelManualFailureRows = await window.aura.db.query(
          "SELECT error_count, last_error FROM sentinel_tasks WHERE id = ? AND sentinel_tasks.library_id = ?",
          [SENTINEL_MANUAL_FAILURE_SMOKE.id, libraryId]
        );
        sentinelManualFailureRecorded =
          Number(sentinelManualFailureRows[0]?.error_count ?? 0) > 0 &&
          String(sentinelManualFailureRows[0]?.last_error ?? "").includes(
            SENTINEL_MANUAL_FAILURE_SMOKE.errorFragment
          );
        const sentinelTitleTab = Array.from(
          document.querySelectorAll(".sentinel-mode-tabs button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "标题");
        sentinelTitleTab?.click();
        const sentinelTitleInput = await waitFor(
          () => document.querySelector('input[placeholder="论文标题"]'),
          1_000
        );
        if (sentinelTitleInput) {
          setInputValue(sentinelTitleInput, "Composition Sentinel Title");
          dispatchComposingEnter(sentinelTitleInput);
          await wait(250);
          sentinelAddCompositionIgnored =
            !bodyIncludes("已添加标题监控") &&
            !bodyIncludes("创建监控失败") &&
            !bodyIncludes("处理中");
        }
        const sentinelDoiTab = Array.from(
          document.querySelectorAll(".sentinel-mode-tabs button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "DOI");
        sentinelDoiTab?.click();
        const sentinelDoiInput = await waitFor(
          () => document.querySelector('input[placeholder^="DOI"]'),
          1_000
        );
        if (sentinelDoiInput) {
          setInputValue(sentinelDoiInput, SENTINEL_DUPLICATE_SMOKE.doi);
          const sentinelAddButton = findExactButton("开始监控");
          sentinelAddButton?.click();
          sentinelAddBusyVisible = Boolean(
            await waitFor(() => {
              const busyButton = Array.from(document.querySelectorAll("button")).find(
                (button) =>
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes("创建中")
              );
              return busyButton?.disabled &&
                sentinelDoiInput.disabled &&
                bodyIncludes("正在创建监控")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(() => bodyIncludes("监控已存在"), 2_000);
          const sentinelDuplicateRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM sentinel_tasks WHERE doi = ? AND deleted_at IS NULL AND sentinel_tasks.library_id = ?",
            [SENTINEL_DUPLICATE_SMOKE.doi, libraryId]
          );
          sentinelDuplicateDoiCount = Number(sentinelDuplicateRows[0]?.n ?? 0);
          sentinelDuplicateDoiMessageVisible = bodyIncludes("监控已存在");
          sentinelDuplicateDoiBlocked =
            sentinelDuplicateDoiMessageVisible && sentinelDuplicateDoiCount === 1;

          setInputValue(sentinelDoiInput, SENTINEL_RESTORE_SMOKE.doi);
          findExactButton("开始监控")?.click();
          await waitFor(() => bodyIncludes("已恢复监控"), 2_000);
          const sentinelRestoreRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n, COALESCE(MAX(CASE WHEN deleted_at IS NULL AND status = 'active' THEN 1 ELSE 0 END), 0) AS active FROM sentinel_tasks WHERE doi = ? AND sentinel_tasks.library_id = ?",
            [SENTINEL_RESTORE_SMOKE.doi, libraryId]
          );
          sentinelDeletedDoiRestoredCount = Number(sentinelRestoreRows[0]?.n ?? 0);
          sentinelDeletedDoiRestored =
            bodyIncludes("已恢复监控") &&
            sentinelDeletedDoiRestoredCount === 1 &&
            Number(sentinelRestoreRows[0]?.active ?? 0) === 1;
        }

        const findSentinelDeleteUndoCard = () =>
          Array.from(document.querySelectorAll(".sentinel-task-card")).find((card) =>
            card.textContent?.includes(SENTINEL_DELETE_UNDO_SMOKE.title)
          );
        const findSentinelDeleteUndoDeleteButton = () =>
          Array.from(findSentinelDeleteUndoCard()?.querySelectorAll("button") ?? []).find(
            (button) => {
              const label = button.textContent?.replace(/\s+/g, " ").trim();
              return label === "删除" || Boolean(label?.includes("删除中"));
            }
          );
        const clickConfirmSentinelDelete = async () => {
          const dialog = await waitFor(() => {
            const candidate = document.querySelector('[role="dialog"]');
            return candidate?.textContent?.includes("删除哨兵监控？") ? candidate : null;
          }, 3_000);
          const confirmButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除监控"
          );
          confirmButton?.click();
        };

        const sentinelDeleteRowsBeforeFailure = await window.aura.db.query(
          "SELECT COUNT(*) AS n, COALESCE(MAX(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS active FROM sentinel_tasks WHERE id = ? AND sentinel_tasks.library_id = ?",
          [SENTINEL_DELETE_UNDO_SMOKE.id, libraryId]
        );
        findSentinelDeleteUndoDeleteButton()?.click();
        await waitFor(() => document.querySelector('[role="dialog"]')?.textContent?.includes("删除哨兵监控？"), 3_000);
        window.__AURASCHOLAR_SMOKE_SENTINEL_FAIL_NEXT_DELETE__ =
          SENTINEL_DELETE_FAILURE_SMOKE.error;
        await clickConfirmSentinelDelete();
        sentinelDeleteFailureBusyVisible = Boolean(
          await waitFor(() => {
            const button = findSentinelDeleteUndoDeleteButton();
            return button?.disabled &&
              button.getAttribute("aria-busy") === "true" &&
              button.textContent?.includes("删除中") &&
              bodyIncludes("正在删除监控任务")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("删除监控失败，监控任务仍保留，可重新删除") &&
            bodyIncludes(SENTINEL_DELETE_FAILURE_SMOKE.error),
          3_000
        );
        delete window.__AURASCHOLAR_SMOKE_SENTINEL_FAIL_NEXT_DELETE__;
        const sentinelDeleteRowsAfterFailure = await window.aura.db.query(
          "SELECT COUNT(*) AS n, COALESCE(MAX(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS active FROM sentinel_tasks WHERE id = ? AND sentinel_tasks.library_id = ?",
          [SENTINEL_DELETE_UNDO_SMOKE.id, libraryId]
        );
        const sentinelDeleteUndoButtonAfterFailure = findSentinelDeleteUndoDeleteButton();
        sentinelDeleteFailureVisible =
          bodyIncludes("删除监控失败，监控任务仍保留，可重新删除") &&
          bodyIncludes(SENTINEL_DELETE_FAILURE_SMOKE.error);
        sentinelDeleteFailureDidNotPersist =
          Number(sentinelDeleteRowsBeforeFailure[0]?.n ?? 0) === 1 &&
          Number(sentinelDeleteRowsBeforeFailure[0]?.active ?? 0) === 1 &&
          Number(sentinelDeleteRowsAfterFailure[0]?.n ?? 0) === 1 &&
          Number(sentinelDeleteRowsAfterFailure[0]?.active ?? 0) === 1;
        sentinelDeleteFailurePreserved =
          Boolean(findSentinelDeleteUndoCard()) &&
          Boolean(sentinelDeleteUndoButtonAfterFailure) &&
          !sentinelDeleteUndoButtonAfterFailure?.disabled &&
          !document.querySelector('button[aria-label="撤销删除监控任务"]');

        sentinelDeleteUndoButtonAfterFailure?.click();
        window.__AURASCHOLAR_SMOKE_SENTINEL_FAIL_NEXT_READ__ =
          "Smoke sentinel post-delete refresh failure";
        await clickConfirmSentinelDelete();
        await waitFor(
          () => {
            const button = findSentinelDeleteUndoDeleteButton();
            return button?.disabled &&
              button.getAttribute("aria-busy") === "true" &&
              button.textContent?.includes("删除中") &&
              bodyIncludes("正在删除监控任务")
              ? button
              : null;
          },
          1_000
        );
        await waitFor(
          () =>
            bodyIncludes("已删除监控任务") &&
            !Array.from(document.querySelectorAll(".sentinel-task-card")).some((card) =>
              card.textContent?.includes(SENTINEL_DELETE_UNDO_SMOKE.title)
            ) &&
            Boolean(document.querySelector('button[aria-label="撤销删除监控任务"]')),
          3_000
        );
        const sentinelDeleteUndoAction = document.querySelector(
          'button[aria-label="撤销删除监控任务"]'
        );
        sentinelDeleteUndoVisible =
          Boolean(sentinelDeleteUndoAction) &&
          bodyIncludes("已删除监控任务，列表刷新失败") &&
          bodyIncludes("Smoke sentinel post-delete refresh failure");
        window.__AURASCHOLAR_SMOKE_SENTINEL_FAIL_NEXT_RESTORE__ =
          SENTINEL_RESTORE_FAILURE_SMOKE.error;
        sentinelDeleteUndoAction?.click();
        sentinelDeleteUndoFailureBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销删除监控任务"]');
            return button?.disabled &&
              button.getAttribute("aria-busy") === "true" &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销删除监控任务")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("撤销删除监控失败，撤销入口仍保留，可重新撤销") &&
            bodyIncludes(SENTINEL_RESTORE_FAILURE_SMOKE.error),
          3_000
        );
        delete window.__AURASCHOLAR_SMOKE_SENTINEL_FAIL_NEXT_RESTORE__;
        const sentinelDeleteUndoRowsAfterFailure = await window.aura.db.query(
          "SELECT deleted_at, status FROM sentinel_tasks WHERE id = ? AND sentinel_tasks.library_id = ? LIMIT 1",
          [SENTINEL_DELETE_UNDO_SMOKE.id, libraryId]
        );
        const sentinelDeleteUndoActionAfterFailure = document.querySelector(
          'button[aria-label="撤销删除监控任务"]'
        );
        sentinelDeleteUndoFailureVisible =
          bodyIncludes("撤销删除监控失败，撤销入口仍保留，可重新撤销") &&
          bodyIncludes(SENTINEL_RESTORE_FAILURE_SMOKE.error);
        sentinelDeleteUndoFailureDidNotPersist =
          sentinelDeleteUndoRowsAfterFailure[0]?.deleted_at != null;
        sentinelDeleteUndoFailurePreserved =
          Boolean(sentinelDeleteUndoActionAfterFailure) &&
          !sentinelDeleteUndoActionAfterFailure?.disabled &&
          !findSentinelDeleteUndoCard();
        sentinelDeleteUndoActionAfterFailure?.click();
        sentinelDeleteUndoBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销删除监控任务"]');
            return button?.disabled &&
              button.getAttribute("aria-busy") === "true" &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销删除监控任务")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("已撤销删除监控任务") &&
            Array.from(document.querySelectorAll(".sentinel-task-card")).some((card) =>
              card.textContent?.includes(SENTINEL_DELETE_UNDO_SMOKE.title)
            ),
          3_000
        );
        const sentinelDeleteUndoRows = await window.aura.db.query(
          "SELECT deleted_at, status FROM sentinel_tasks WHERE id = ? AND sentinel_tasks.library_id = ? LIMIT 1",
          [SENTINEL_DELETE_UNDO_SMOKE.id, libraryId]
        );
        sentinelDeleteUndoRestored =
          sentinelDeleteUndoVisible &&
          sentinelDeleteUndoBusyVisible &&
          bodyIncludes("已撤销删除监控任务") &&
          sentinelDeleteUndoRows[0]?.deleted_at == null &&
          sentinelDeleteUndoRows[0]?.status === "active";

        const graphEmptyLatestNow = Date.now();
        await window.aura.db.run("UPDATE works SET created_at = ?, updated_at = ? WHERE id = ? AND library_id = ?", [
          graphEmptyLatestNow,
          graphEmptyLatestNow,
          SAMPLE.workId
        , libraryId]);
`;
