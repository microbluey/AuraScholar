export const smokeDiscoveryImport = String.raw`        location.hash = "#/discovery";
        await waitFor(
          () =>
            location.hash.includes("/discovery") &&
            Boolean(document.querySelector(".discovery-page--home")) &&
            bodyIncludes("学术检索"),
          4_000
        );
        const discoveryHomeInput = document.querySelector('input[aria-label="学术检索关键词"]');
        if (discoveryHomeInput) {
          setInputValue(discoveryHomeInput, "Composition Discovery Search");
          dispatchComposingEnter(discoveryHomeInput);
          await wait(200);
          discoverySearchCompositionIgnored =
            Boolean(document.querySelector(".discovery-page--home")) &&
            !document.querySelector(".discovery-command-card") &&
            !bodyIncludes("检索中");
        }
        if (window.aura?.research) {
          try {
            window.__AURASCHOLAR_SMOKE_RESEARCH_HIDE_ERROR__ = "smoke-hide-failed";
            location.hash = "#/settings";
            await waitFor(
              () =>
                location.hash.includes("/settings") &&
                bodyIncludes("内置浏览器视图隐藏失败") &&
                bodyIncludes("smoke-hide-failed"),
              3_000
            );
            discoveryBrowserHideFailureVisible =
              bodyIncludes("内置浏览器视图隐藏失败") && bodyIncludes("smoke-hide-failed");
            const closeRuntimeIssue = Array.from(
              document.querySelectorAll(".app-runtime-issue button")
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "关闭");
            closeRuntimeIssue?.click();
          } finally {
            delete window.__AURASCHOLAR_SMOKE_RESEARCH_HIDE_ERROR__;
            try {
              await window.aura.research.hide();
            } catch {}
          }
          location.hash = "#/discovery";
          await waitFor(
            () =>
              location.hash.includes("/discovery") &&
              Boolean(document.querySelector(".discovery-page--home")) &&
              bodyIncludes("学术检索"),
            4_000
          );
          const restoredDiscoveryInput = document.querySelector('input[aria-label="学术检索关键词"]');
          if (restoredDiscoveryInput) {
            setInputValue(restoredDiscoveryInput, SAVED_SEARCH_SMOKE.query);
          }
        }
        await waitFor(
          () => bodyIncludes(SAVED_SEARCH_HOME_OPEN_SMOKE.query) && bodyIncludes("2 新"),
          3_000
        );
        await waitFor(
          () => typeof window.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_SEARCH__ === "function",
          2_000
        );
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__ = {
          acceptAnyQuery: true,
          delayMs: 1_000,
          query: "Smoke Active Search To Replace",
          title: "Smoke Active Search Should Be Replaced",
          doi: "10.4242/aurascholar.replace-active-search"
        };
        window.__AURASCHOLAR_SMOKE_DISCOVERY_REPLACED_ACTIVE_SEARCH__ = false;
        const activeSearchPromise =
          window.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_SEARCH__?.("Smoke Active Search To Replace", [
            "openalex"
          ]) ?? Promise.resolve(false);
        await waitFor(() => Boolean(document.querySelector(".discovery-page--opensource")), 500);
        await wait(50);
        delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__ = {
          acceptAnyQuery: true,
          empty: true,
          query: SAVED_SEARCH_HOME_OPEN_SMOKE.query,
          title: "Smoke Home Saved Search Empty Result"
        };
        const homeSavedSearchButton = Array.from(
          document.querySelectorAll(".discovery-sub__main")
        ).find((button) => button.textContent?.includes(SAVED_SEARCH_HOME_OPEN_SMOKE.query));
        homeSavedSearchButton?.click();
        await waitFor(
          () => {
            const openingSub = Array.from(document.querySelectorAll(".discovery-sub")).find((item) =>
              item.textContent?.includes(SAVED_SEARCH_HOME_OPEN_SMOKE.query)
            );
            const openingMain = openingSub?.querySelector(".discovery-sub__main");
            return (
              Boolean(document.querySelector(".discovery-page--opensource")) &&
              openingMain?.getAttribute("aria-busy") === "true" &&
              openingMain?.textContent?.includes("正在打开订阅") &&
              bodyIncludes("正在打开订阅")
            );
          },
          1_000
        );
        const openingHomeSub = Array.from(document.querySelectorAll(".discovery-sub")).find((item) =>
          item.textContent?.includes(SAVED_SEARCH_HOME_OPEN_SMOKE.query)
        );
        const openingHomeMain = openingHomeSub?.querySelector(".discovery-sub__main");
        discoverySavedSearchHomeOpenBusyVisible = Boolean(
          document.querySelector(".discovery-page--opensource") &&
            openingHomeMain?.getAttribute("aria-busy") === "true" &&
            openingHomeMain?.textContent?.includes("正在打开订阅") &&
            bodyIncludes("正在打开订阅")
        );
        await waitFor(
          () =>
            Boolean(document.querySelector(".discovery-page--opensource")) &&
            bodyIncludes("开放源聚合检索") &&
            bodyIncludes("没有找到结果"),
          3_000
        );
        delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
        await waitFor(async () => {
          const rows = await window.aura.db.query(
            "SELECT new_count FROM saved_searches WHERE id = ? AND saved_searches.library_id = ? LIMIT 1",
            [SAVED_SEARCH_HOME_OPEN_SMOKE.id, libraryId]
          );
          return Number(rows[0]?.new_count ?? -1) === 0;
        }, 2_000);
        const homeOpenRows = await window.aura.db.query(
          "SELECT new_count FROM saved_searches WHERE id = ? AND saved_searches.library_id = ? LIMIT 1",
          [SAVED_SEARCH_HOME_OPEN_SMOKE.id, libraryId]
        );
        discoverySavedSearchHomeOpenNavigated =
          Boolean(document.querySelector(".discovery-page--opensource")) &&
          bodyIncludes("开放源聚合检索") &&
          bodyIncludes(SAVED_SEARCH_HOME_OPEN_SMOKE.query);
        discoverySavedSearchHomeOpenClearedNewCount =
          discoverySavedSearchHomeOpenNavigated && Number(homeOpenRows[0]?.new_count ?? -1) === 0;
        await activeSearchPromise.catch(() => false);
        discoverySavedSearchHomeOpenReplacedActiveSearch =
          window.__AURASCHOLAR_SMOKE_DISCOVERY_REPLACED_ACTIVE_SEARCH__ === true &&
          discoverySavedSearchHomeOpenNavigated &&
          discoverySavedSearchHomeOpenClearedNewCount;
        const openSourceSearchInput = document.querySelector('input[aria-label="开放源检索关键词"]');
        const clearOpenSearchButton = document.querySelector('button[aria-label="清空开放源检索"]');
        clearOpenSearchButton?.click();
        discoveryOpenSearchEmptyClearRestored = Boolean(
          clearOpenSearchButton &&
            openSourceSearchInput &&
            (await waitFor(
              () =>
                openSourceSearchInput.value === "" &&
                document.activeElement === openSourceSearchInput &&
                bodyIncludes("从开放数据源发现文献") &&
                !bodyIncludes("没有找到匹配文献"),
              1_000
            ))
        );
        const discoveryBackLink = Array.from(document.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("返回学术检索")
        );
        discoveryBackLink?.click();
        await waitFor(() => Boolean(document.querySelector(".discovery-page--home")), 2_000);
        const discoveryImportDoi = "10.4242/aurascholar.discovery-preview";
        const discoveryImportBeforeRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM works WHERE doi = ? AND deleted_at IS NULL AND works.library_id = ?",
          [discoveryImportDoi, libraryId]
        );
        const discoveryReferenceInput = document.querySelector('.web-import-card input[type="file"]');
        if (discoveryReferenceInput) {
          const discoveryBibText = [
            "@article{discovery-preview-smoke,",
            "  title = {Discovery Reference Preview Smoke},",
            "  author = {Hopper, Grace},",
            "  year = {2026},",
            "  doi = {" + discoveryImportDoi + "}",
            "}"
          ].join("\n");
          const discoveryBibFile = new File([discoveryBibText], "discovery-preview.bib", {
            type: "text/plain"
          });
          const discoveryTransfer = new DataTransfer();
          discoveryTransfer.items.add(discoveryBibFile);
          Object.defineProperty(discoveryReferenceInput, "files", {
            configurable: true,
            value: discoveryTransfer.files
          });
          discoveryReferenceInput.dispatchEvent(new Event("change", { bubbles: true }));
          const discoveryImportDialog = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("确认导入引用文件") ? dialog : null;
          }, 3_000);
          discoveryReferenceImportConfirmVisible = Boolean(
            discoveryImportDialog?.textContent?.includes("discovery-preview.bib") &&
              discoveryImportDialog.textContent.includes("导入 1 条")
          );
          const cancelDiscoveryImport = Array.from(
            discoveryImportDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
          cancelDiscoveryImport?.click();
          await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
          const discoveryImportAfterRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE doi = ? AND deleted_at IS NULL AND works.library_id = ?",
            [discoveryImportDoi, libraryId]
          );
          discoveryReferenceImportCancelPreserved =
            discoveryReferenceImportConfirmVisible &&
            Number(discoveryImportBeforeRows[0]?.n ?? 0) === 0 &&
            Number(discoveryImportAfterRows[0]?.n ?? 0) === 0 &&
            bodyIncludes("已取消导入引用文件");

          const discoveryConfirmTransfer = new DataTransfer();
          discoveryConfirmTransfer.items.add(discoveryBibFile);
          Object.defineProperty(discoveryReferenceInput, "files", {
            configurable: true,
            value: discoveryConfirmTransfer.files
          });
          discoveryReferenceInput.dispatchEvent(new Event("change", { bubbles: true }));
          const discoveryConfirmImportDialog = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("确认导入引用文件") ? dialog : null;
          }, 3_000);
          const confirmDiscoveryImport = Array.from(
            discoveryConfirmImportDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "导入 1 条");
          confirmDiscoveryImport?.click();
          await waitFor(
            () =>
              discoveryConfirmImportDialog?.getAttribute("aria-busy") === "true" &&
              confirmDiscoveryImport?.disabled &&
              confirmDiscoveryImport.getAttribute("aria-busy") === "true" &&
              confirmDiscoveryImport.textContent?.includes("导入中") &&
              discoveryConfirmImportDialog.textContent?.includes("正在导入引用文件"),
            1_000
          );
          discoveryReferenceImportCommitBusyVisible = Boolean(
            discoveryConfirmImportDialog?.getAttribute("aria-busy") === "true" &&
              confirmDiscoveryImport?.disabled &&
              confirmDiscoveryImport.getAttribute("aria-busy") === "true" &&
              confirmDiscoveryImport.textContent?.includes("导入中") &&
              discoveryConfirmImportDialog.textContent?.includes("正在导入引用文件")
          );
          await waitFor(
            () =>
              !document.querySelector('[role="dialog"]') &&
              bodyIncludes("引用文件导入完成"),
            3_000
          );
          const discoveryImportedRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE doi = ? AND deleted_at IS NULL AND works.library_id = ?",
            [discoveryImportDoi, libraryId]
          );
          discoveryReferenceImportCommitPersisted = Number(discoveryImportedRows[0]?.n ?? 0) === 1;
          discoveryReferenceImportCommitSuccessVisible =
            discoveryReferenceImportCommitBusyVisible &&
            discoveryReferenceImportCommitPersisted &&
            bodyIncludes("引用文件导入完成");

          const emptyReferenceBeforeRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE title = ? AND deleted_at IS NULL AND works.library_id = ?",
            ["(无标题)", libraryId]
          );
          const emptyReferenceFile = new File(
            ["@article{empty-discovery-smoke,\n}"],
            "empty-reference.bib",
            {
              type: "text/plain"
            }
          );
          const emptyReferenceTransfer = new DataTransfer();
          emptyReferenceTransfer.items.add(emptyReferenceFile);
          Object.defineProperty(discoveryReferenceInput, "files", {
            configurable: true,
            value: emptyReferenceTransfer.files
          });
          discoveryReferenceInput.dispatchEvent(new Event("change", { bubbles: true }));
          await waitFor(() => bodyIncludes("没有解析出文献。请选择"), 2_000);
          const emptyReferenceDialogOpen = Boolean(
            document.querySelector('[role="dialog"]')?.textContent?.includes("确认导入引用文件")
          );
          const emptyReferenceAfterRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE title = ? AND deleted_at IS NULL AND works.library_id = ?",
            ["(无标题)", libraryId]
          );
          discoveryReferenceImportRejectsEmptyVisible =
            bodyIncludes("没有解析出文献。请选择") && !emptyReferenceDialogOpen;
          discoveryReferenceImportRejectsEmptyPersisted =
            Number(emptyReferenceBeforeRows[0]?.n ?? 0) ===
            Number(emptyReferenceAfterRows[0]?.n ?? 0);

          const richReferenceImports = [
            {
              doi: "10.4242/aurascholar.discovery-nbib",
              pmid: "42000001",
              fileName: "discovery-rich-format.nbib",
              text: [
                "PMID- 42000001",
                "TI  - Discovery NBIB Import Smoke.",
                "FAU - Hopper, Grace",
                "JT  - Journal of Discovery Migration",
                "DP  - 2026",
                "VI  - 8",
                "IP  - 1",
                "PG  - 12-18",
                "LID - 10.4242/aurascholar.discovery-nbib [doi]",
                "AB  - PubMed NBIB import smoke fixture."
              ].join("\n")
            },
            {
              doi: "10.4242/aurascholar.discovery-enw",
              pmid: null,
              fileName: "discovery-rich-format.enw",
              text: [
                "%0 Journal Article",
                "%T Discovery ENW Import Smoke",
                "%A Hopper, Grace",
                "%J Journal of Discovery Migration",
                "%D 2026",
                "%V 8",
                "%N 1",
                "%P 19-24",
                "%R 10.4242/aurascholar.discovery-enw",
                "%U https://doi.org/10.4242/aurascholar.discovery-enw",
                "%X EndNote tagged import smoke fixture."
              ].join("\n")
            }
          ];
          const richReferenceResults = [];
          for (const richReferenceImport of richReferenceImports) {
            const richReferenceFile = new File(
              [richReferenceImport.text],
              richReferenceImport.fileName,
              {
                type: "text/plain"
              }
            );
            const richReferenceTransfer = new DataTransfer();
            richReferenceTransfer.items.add(richReferenceFile);
            Object.defineProperty(discoveryReferenceInput, "files", {
              configurable: true,
              value: richReferenceTransfer.files
            });
            discoveryReferenceInput.dispatchEvent(new Event("change", { bubbles: true }));
            const richReferenceDialog = await waitFor(() => {
              const dialog = document.querySelector('[role="dialog"]');
              return dialog?.textContent?.includes("确认导入引用文件") &&
                dialog.textContent.includes(richReferenceImport.fileName) &&
                dialog.textContent.includes("导入 1 条")
                ? dialog
                : null;
            }, 3_000);
            const richReferenceConfirm = Array.from(
              richReferenceDialog?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "导入 1 条");
            richReferenceConfirm?.click();
            const richReferencePersisted = Boolean(
              await waitFor(async () => {
                const rows = await window.aura.db.query(
                  "SELECT COUNT(*) AS n, COALESCE(MAX(CASE WHEN pmid IS ? THEN 1 ELSE 0 END), 0) AS pmid_ok FROM works WHERE doi = ? AND deleted_at IS NULL AND works.library_id = ?",
                  [richReferenceImport.pmid, richReferenceImport.doi, libraryId]
                );
                return (
                  Number(rows[0]?.n ?? 0) === 1 &&
                  Number(rows[0]?.pmid_ok ?? 0) === 1
                );
              }, 4_000)
            );
            const richReferenceMetadataPersisted = Boolean(
              await waitFor(async () => {
                const rows = await window.aura.db.query(
                  "SELECT pmid FROM works WHERE doi = ? AND deleted_at IS NULL AND works.library_id = ? LIMIT 1",
                  [richReferenceImport.doi, libraryId]
                );
                return richReferenceImport.pmid === null
                  ? rows[0]?.pmid == null
                  : rows[0]?.pmid === richReferenceImport.pmid;
              }, 4_000)
            );
            await waitFor(() => !document.querySelector('[role="dialog"]'), 3_000);
            richReferenceResults.push(
              Boolean(richReferenceDialog) &&
                Boolean(richReferenceConfirm) &&
                richReferencePersisted &&
                richReferenceMetadataPersisted
            );
          }
          discoveryReferenceImportRichFormatsPersisted =
            richReferenceResults.length === richReferenceImports.length &&
            richReferenceResults.every(Boolean);
        }
`;
