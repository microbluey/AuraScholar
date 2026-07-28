export const smokeLibraryBase = String.raw`          window.dispatchEvent(new Event("aurascholar:library-updated"));
          document.querySelector('[data-library-action="refresh"]')?.click();
          await waitFor(() => rowText().includes(SAMPLE.title) && rowText().includes(SAMPLE.author), 8_000);
          clickRowByTitle(SAMPLE.title);
          await waitFor(
            () =>
              (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(SAMPLE.title),
            3_000
          );
            await waitFor(
              () =>
                bodyIncludes("全文文件") &&
                bodyIncludes("当前阅读版本") &&
                bodyIncludes("aurascholar-smoke.pdf") &&
                bodyIncludes("1 页"),
              8_000
            );
            libraryPdfAttachmentVisible =
              bodyIncludes("全文文件") &&
              bodyIncludes("当前阅读版本") &&
              bodyIncludes("aurascholar-smoke.pdf") &&
              bodyIncludes("1 页") &&
              bodyIncludes("继续阅读");

            await selectLibraryDetailTab("脉络");
            const relatedPanelText = (
              document.querySelector("#library-detail-panel-related")?.textContent ?? ""
            ).replace(/\s+/g, " ");
            libraryCitationContextVisible =
              relatedPanelText.includes("引用脉络") &&
              relatedPanelText.includes("打开图谱") &&
              relatedPanelText.includes("参考") &&
              relatedPanelText.includes("被引");
            libraryContextualWorkflowsHidden =
              !relatedPanelText.includes("检索哨兵") &&
              !relatedPanelText.includes("Semantic Scholar") &&
              !relatedPanelText.includes("开始监控") &&
              !relatedPanelText.includes("按需读取 S2");

            await selectLibraryDetailTab("笔记");
            const canvasWorkspaceFixtureNow = Date.now();
            await window.aura.db.run(
              "INSERT OR IGNORE INTO canvas_workspaces (id, library_id, name, description, schema_version, viewport_json, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)",
              [
                "canvas:default", libraryId,
                "研究画布",
                1,
                JSON.stringify({ x: 0, y: 0, zoom: 1 }),
                canvasWorkspaceFixtureNow,
                canvasWorkspaceFixtureNow
              ]
            );
            await window.aura.db.run(
              "DELETE FROM canvas_edges WHERE workspace_id = ?",
              ["canvas:default"]
            );
            await window.aura.db.run(
              "DELETE FROM canvas_nodes WHERE workspace_id = ?",
              ["canvas:default"]
            );
            window.dispatchEvent(new Event("aurascholar:canvas-updated"));
          const libraryRaceTitle = "Smoke Library Race Newer Refresh Wins";
          await window.aura.db.run("DELETE FROM works WHERE id = ? AND library_id = ?", [
            "smoke-library-refresh-race"
          , libraryId]);
          window.__AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_DELAY_MS__ = 450;
          window.__AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_COUNT__ = 0;
          document.querySelector('[data-library-action="refresh"]')?.click();
          await waitFor(
            () => Number(window.__AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_COUNT__ ?? 0) >= 1,
            1_000
          );
          const libraryRaceNow = Date.now();
          await window.aura.db.run(
            "INSERT OR REPLACE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              "smoke-library-refresh-race", libraryId,
              "10.4242/aurascholar.library-refresh-race",
              libraryRaceTitle,
              "A deterministic smoke-test paper for validating library refresh race handling.",
              2027,
              "Journal of Library UX",
              "article",
              "unread",
              0,
              libraryRaceNow + 1,
              libraryRaceNow + 1
            ]
          );
          window.__AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_DELAY_MS__ = 0;
          document.querySelector('[data-library-action="refresh"]')?.click();
          await waitFor(() => rowText().includes(libraryRaceTitle), 2_000);
          await wait(650);
          libraryRefreshRacePreserved =
            rowText().includes(libraryRaceTitle) && !bodyIncludes("浏览器预览无法读取本地文献库");
          delete window.__AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_DELAY_MS__;
          delete window.__AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_COUNT__;

          const positiveSearchRows = await window.aura.db.query(
            "SELECT w.id FROM works w JOIN works_fts f ON f.rowid = w.rowid WHERE works_fts MATCH ? AND w.deleted_at IS NULL AND w.library_id = ?",
            ['"Extreme"* "Consumer"*', libraryId]
          );
          const negativeSearchRows = await window.aura.db.query(
            "SELECT w.id FROM works w JOIN works_fts f ON f.rowid = w.rowid WHERE works_fts MATCH ? AND w.deleted_at IS NULL AND w.library_id = ?",
            ['"NoMatchingSmokePaper"*', libraryId]
          );
          searchDataPathOk =
            positiveSearchRows.some((row) => row.id === SAMPLE.workId) &&
            negativeSearchRows.length === 0;

          const searchInput = document.querySelector('input[placeholder="在结果中搜索"]');
          if (searchInput) {
            setInputValue(searchInput, "Extreme Consumer");
            await waitFor(() => rowText().includes(SAMPLE.title), 3_000);
          }
          searchResultVisible = rowText().includes(SAMPLE.title);

          if (searchInput) {
            setInputValue(searchInput, "NoMatchingSmokePaper");
            await waitFor(() => bodyIncludes("当前筛选无结果") && !rowText().includes(SAMPLE.title), 3_000);
            searchEmptyStateVisible = bodyIncludes("当前筛选无结果") && !rowText().includes(SAMPLE.title);
            const clearEmptySearchButton = document.querySelector('button[aria-label="清除当前搜索"]');
            clearEmptySearchButton?.click();
            searchEmptyActionRestoresResults = Boolean(
              clearEmptySearchButton &&
                (await waitFor(
                  () =>
                    searchInput.value === "" &&
                    document.activeElement === searchInput &&
                    rowText().includes(SAMPLE.title),
                  3_000
                ))
            );
            setInputValue(searchInput, "NoMatchingSmokePaper");
            await waitFor(() => bodyIncludes("当前筛选无结果") && !rowText().includes(SAMPLE.title), 3_000);
            const clearSearchButton = document.querySelector('button[aria-label="清除文献搜索"]');
            clearSearchButton?.click();
            searchClearButtonRestoresResults = Boolean(
              clearSearchButton &&
                (await waitFor(
                  () =>
                    searchInput.value === "" &&
                    document.activeElement === searchInput &&
                    rowText().includes(SAMPLE.title),
                  3_000
                ))
            );
            if (searchClearButtonRestoresResults) {
              setInputValue(searchInput, "NoMatchingSmokePaper");
              await waitFor(() => bodyIncludes("当前筛选无结果") && !rowText().includes(SAMPLE.title), 3_000);

              const composingEscape = new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                key: "Escape",
              });
              Object.defineProperty(composingEscape, "isComposing", {
                configurable: true,
                value: true,
              });
              searchInput.dispatchEvent(composingEscape);
              await wait(100);
              const compositionPreservedSearch =
                searchInput.value === "NoMatchingSmokePaper" &&
                bodyIncludes("当前筛选无结果") &&
                !rowText().includes(SAMPLE.title);

              searchInput.dispatchEvent(
                new KeyboardEvent("keydown", {
                  bubbles: true,
                  cancelable: true,
                  key: "Escape",
                })
              );
              searchEscapeClearsQuery = Boolean(
                compositionPreservedSearch &&
                  (await waitFor(
                    () =>
                      searchInput.value === "" &&
                      document.activeElement === searchInput &&
                      rowText().includes(SAMPLE.title),
                    3_000
                  ))
              );
            }
          } else {
            searchEmptyStateVisible = true;
            searchEmptyActionRestoresResults = true;
            searchClearButtonRestoresResults = true;
            searchEscapeClearsQuery = true;
          }

          clickRowByTitle(LIBRARY_UPLOAD_PDF.title);
          await waitFor(
            () =>
              (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
                LIBRARY_UPLOAD_PDF.title
              ) && bodyIncludes("上传 PDF"),
            3_000
          );
            const libraryUploadButton = () => {
              const panel = selectedLibrarySection("全文文件");
            return (
              Array.from(panel?.querySelectorAll("button") ?? []).find((button) => {
                const label = button.textContent?.replace(/\s+/g, " ").trim();
                return label === "上传 PDF" || label === "上传中..." || label === "上传新版本";
              }) ?? null
            );
          };
          const selectedPdfInput = Array.from(
            document.querySelectorAll('input[type="file"][accept="application/pdf"]')
          )[1];
          if (selectedPdfInput) {
            const uploadFile = new File(
              [makeSmokePdf("Library Detail Upload PDF")],
              "library-detail-upload.pdf",
              {
                type: "application/pdf"
              }
            );
            const uploadTransfer = new DataTransfer();
            uploadTransfer.items.add(uploadFile);
            Object.defineProperty(selectedPdfInput, "files", {
              configurable: true,
              value: uploadTransfer.files
            });
            selectedPdfInput.dispatchEvent(new Event("change", { bubbles: true }));
            libraryPdfUploadBusyVisible = Boolean(
              await waitFor(() => {
                const button = libraryUploadButton();
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes("上传中") &&
                  bodyIncludes("正在为《" + LIBRARY_UPLOAD_PDF.title + "》上传 PDF")
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(async () => {
              const rows = await window.aura.db.query(
                "SELECT COUNT(*) AS n FROM attachments WHERE work_id = ? AND deleted_at IS NULL AND kind = 'pdf'",
                [LIBRARY_UPLOAD_PDF.workId]
              );
              return Number(rows[0]?.n ?? 0) >= 1;
            }, 10_000);
            await waitFor(
              () =>
                bodyIncludes("已为《" + LIBRARY_UPLOAD_PDF.title + "》上传 PDF") ||
                bodyIncludes("1 个可读") ||
                libraryUploadButton()?.textContent?.includes("上传新版本"),
              3_000
            );
            const uploadRows = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM attachments WHERE work_id = ? AND deleted_at IS NULL AND kind = 'pdf'",
              [LIBRARY_UPLOAD_PDF.workId]
            );
            libraryPdfUploadPersisted = Number(uploadRows[0]?.n ?? 0) === 1;
            libraryPdfUploadSuccessVisible =
              libraryPdfUploadPersisted &&
              (bodyIncludes("已为《" + LIBRARY_UPLOAD_PDF.title + "》上传 PDF") ||
                bodyIncludes("1 个可读") ||
                Boolean(libraryUploadButton()?.textContent?.includes("上传新版本")));
          }

`;
