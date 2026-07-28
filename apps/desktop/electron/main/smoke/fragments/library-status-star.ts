export const smokeLibraryStatusStar = String.raw`          clickRowByTitle(SAMPLE.title);
          await waitFor(
            () =>
              (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(SAMPLE.title),
            2_000
          );
          const selectedReadingStatusButton = () => {
            const detail = document.querySelector(".library-detail--selected");
            return (
              Array.from(detail?.querySelectorAll(".library-reading-toggle button") ?? []).find((button) => {
                const label = button.textContent?.replace(/\s+/g, " ").trim();
                return label === "阅读中" || label === "更新中...";
              }) ?? null
            );
          };
          const readingStatusRowsBeforeFailure = await window.aura.db.query(
            "SELECT reading_status FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
            [SAMPLE.workId, libraryId]
          );
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READING_STATUS__ =
            "Smoke library reading status failure";
          selectedReadingStatusButton()?.click();
          libraryReadingStatusFailureBusyVisible = Boolean(
            await waitFor(() => {
              const detail = document.querySelector(".library-detail--selected");
              const busyButton = Array.from(
                detail?.querySelectorAll(".library-reading-toggle button") ?? []
              ).find((button) => button.getAttribute("aria-busy") === "true");
              return busyButton?.disabled &&
                busyButton.textContent?.includes("更新中") &&
                bodyIncludes("正在更新阅读状态:阅读中")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("更新阅读状态失败，阅读状态仍保留，可重新更新") &&
              bodyIncludes("Smoke library reading status failure"),
            3_000
          );
          delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READING_STATUS__;
          const readingStatusRowsAfterFailure = await window.aura.db.query(
            "SELECT reading_status FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
            [SAMPLE.workId, libraryId]
          );
          const activeReadingStatusLabelAfterFailure =
            document
              .querySelector(".library-detail--selected .library-reading-toggle__active")
              ?.textContent?.replace(/\s+/g, " ")
              .trim() ?? "";
          libraryReadingStatusFailureVisible =
            bodyIncludes("更新阅读状态失败，阅读状态仍保留，可重新更新") &&
            bodyIncludes("Smoke library reading status failure");
          libraryReadingStatusFailureDidNotPersist =
            readingStatusRowsAfterFailure[0]?.reading_status ===
            readingStatusRowsBeforeFailure[0]?.reading_status;
          libraryReadingStatusFailurePreserved =
            libraryReadingStatusFailureVisible &&
            libraryReadingStatusFailureDidNotPersist &&
            activeReadingStatusLabelAfterFailure === "未读" &&
            selectedReadingStatusButton()?.textContent?.replace(/\s+/g, " ").trim() === "阅读中";

          selectedReadingStatusButton()?.click();
          libraryReadingStatusBusyVisible = Boolean(
            await waitFor(() => {
              const detail = document.querySelector(".library-detail--selected");
              const busyButton = Array.from(
                detail?.querySelectorAll(".library-reading-toggle button") ?? []
              ).find((button) => button.getAttribute("aria-busy") === "true");
              return busyButton?.disabled &&
                busyButton.textContent?.includes("更新中") &&
                bodyIncludes("正在更新阅读状态:阅读中")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(() => bodyIncludes("已更新阅读状态:阅读中"), 3_000);
          libraryReadingStatusSuccessVisible = bodyIncludes("已更新阅读状态:阅读中");
          const seededWorkCountRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE library_id = ?",
            [libraryId]
          );
          seededWorkCount = Number(seededWorkCountRows[0]?.n ?? 0);
          const statusRows = await window.aura.db.query(
            "SELECT reading_status FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
            [SAMPLE.workId, libraryId]
          );
          readingStatus = statusRows[0]?.reading_status ?? null;
          libraryReadingStatusPersisted = readingStatus === "reading";

          const selectedDetailStarButton = () => {
            const detail = document.querySelector(".library-detail--selected");
            return (
              Array.from(detail?.querySelectorAll(".library-panel-actions button") ?? []).find((button) => {
                const label = button.textContent?.replace(/\s+/g, " ").trim();
                return (
                  label === "标为重点" ||
                  label === "取消重点" ||
                  label === "标记中..." ||
                  label === "取消中..."
                );
              }) ?? null
            );
          };
          const libraryStarButton = selectedDetailStarButton();
          if (libraryStarButton) {
            const starTarget = !libraryStarButton.textContent?.includes("取消重点");
            const busyLabel = starTarget ? "标记中" : "取消中";
            const busyMessage = starTarget
              ? "正在标记重点:《" + SAMPLE.title + "》"
              : "正在取消重点:《" + SAMPLE.title + "》";
            const successMessage = starTarget
              ? "已标记重点:《" + SAMPLE.title + "》"
              : "已取消重点:《" + SAMPLE.title + "》";
            const starRowsBeforeFailure = await window.aura.db.query(
              "SELECT starred FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
              [SAMPLE.workId, libraryId]
            );
            window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_STAR__ =
              "Smoke library star failure";
            libraryStarButton.click();
            libraryStarFailureBusyVisible = Boolean(
              await waitFor(() => {
                const button = selectedDetailStarButton();
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes(busyLabel) &&
                  bodyIncludes(busyMessage)
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("更新重点状态失败，重点状态仍保留，可重新切换") &&
                bodyIncludes("Smoke library star failure"),
              3_000
            );
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_STAR__;
            const starRowsAfterFailure = await window.aura.db.query(
              "SELECT starred FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
              [SAMPLE.workId, libraryId]
            );
            libraryStarFailureVisible =
              bodyIncludes("更新重点状态失败，重点状态仍保留，可重新切换") &&
              bodyIncludes("Smoke library star failure");
            libraryStarFailureDidNotPersist =
              Number(starRowsAfterFailure[0]?.starred ?? -1) ===
              Number(starRowsBeforeFailure[0]?.starred ?? -2);
            libraryStarFailurePreserved =
              libraryStarFailureVisible &&
              libraryStarFailureDidNotPersist &&
              selectedDetailStarButton()?.textContent?.replace(/\s+/g, " ").trim() ===
                (starTarget ? "标为重点" : "取消重点");

            selectedDetailStarButton()?.click();
            libraryStarBusyVisible = Boolean(
              await waitFor(() => {
                const button = selectedDetailStarButton();
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes(busyLabel) &&
                  bodyIncludes(busyMessage)
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(() => bodyIncludes(successMessage), 3_000);
            libraryStarSuccessVisible = bodyIncludes(successMessage);
            const starRows = await window.aura.db.query(
              "SELECT starred FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
              [SAMPLE.workId, libraryId]
            );
            libraryStarPersisted = Number(starRows[0]?.starred ?? -1) === (starTarget ? 1 : 0);
          }

        }

        await window.aura.db.run("DELETE FROM canvas_nodes WHERE id = ?", [
          "smoke-app-shell-canvas-stats-race"
        ]);
        window.dispatchEvent(new Event("aurascholar:canvas-updated"));
        const appShellCanvasCountBefore = Number(
          await window.aura.db.queryScalar("SELECT COUNT(*) FROM canvas_nodes")
        );
        await waitFor(
          () => statusbarMetric("白板节点") === appShellCanvasCountBefore,
          3_000
        );
        window.__AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_DELAY_MS__ = 450;
        window.__AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_COUNT__ = 0;
        window.dispatchEvent(new Event("aurascholar:canvas-updated"));
        await waitFor(
          () => Number(window.__AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_COUNT__ ?? 0) >= 1,
          1_000
        );
        const appShellRaceNow = Date.now();
        await window.aura.db.run(
          "INSERT OR REPLACE INTO canvas_nodes (id, workspace_id, work_id, type, pos_x, pos_y, width, height, group_id, sort_order, tags_json, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            "smoke-app-shell-canvas-stats-race",
            "canvas:default",
            null,
            "idea-note",
            536,
            140,
            300,
            220,
            null,
            999,
            "[]",
            JSON.stringify({
              title: "Smoke canvas status race",
              contentMarkdown: "Persisted canvas node for app-shell count refresh.",
              hasEquations: false
            }),
            appShellRaceNow,
            appShellRaceNow
          ]
        );
        const appShellCanvasCountAfter = appShellCanvasCountBefore + 1;
        window.__AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_DELAY_MS__ = 0;
        window.dispatchEvent(new Event("aurascholar:canvas-updated"));
        await waitFor(
          () => statusbarMetric("白板节点") === appShellCanvasCountAfter,
          2_000
        );
        await wait(650);
        appShellCanvasStatsRacePreserved =
          statusbarMetric("白板节点") === appShellCanvasCountAfter &&
          Number(await window.aura.db.queryScalar("SELECT COUNT(*) FROM canvas_nodes")) ===
            appShellCanvasCountAfter;
        delete window.__AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_DELAY_MS__;
        delete window.__AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_COUNT__;
        detailVisible =
          (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(SAMPLE.title) &&
          bodyIncludes(SAMPLE.venue);
        populatedStateVisible =
          rowText().includes(SAMPLE.title) &&
          rowText().includes(SAMPLE.author) &&
          bodyIncludes(SAMPLE.tag);
        libraryBodyText = document.body.innerText;
        libraryHash = location.hash;
        libraryHeading = text("h1");
`;
