export const smokeDiscoveryBrowserReferenceImport = String.raw`
        location.hash = "#/discovery";
        await waitFor(
          () =>
            location.hash.includes("/discovery") &&
            Boolean(document.querySelector(".discovery-page--home")),
          3_000
        );
        const browserSite = Array.from(document.querySelectorAll(".discovery-card")).find((card) =>
          card.textContent?.includes(DISCOVERY_SITE_SMOKE.name)
        );
        browserSite?.click();
        await waitFor(
          () =>
            Boolean(document.querySelector(".discovery-page--browser")) &&
            Boolean(document.querySelector(".research-browser-host")),
          4_000
        );
        const activeBrowserTabBeforeImport = await waitFor(async () =>
          (await window.aura.research.list()).find((tab) => tab.active) ?? null,
        4_000);
        const browserReferenceDoi = "10.4242/aurascholar.browser-reference-preview";
        const browserReferenceRowsBefore = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM works WHERE doi = ? AND deleted_at IS NULL AND works.library_id = ?",
          [browserReferenceDoi, libraryId]
        );
        const browserReferenceInput = document.querySelector(
          '.research-tabbar input[type="file"]'
        );
        if (browserReferenceInput) {
          const browserReferenceFile = new File(
            [
              "@article{browser-reference-preview-smoke,",
              "  title = {Browser Reference Preview Smoke},",
              "  author = {Hopper, Grace},",
              "  year = {2026},",
              "  doi = {" + browserReferenceDoi + "}",
              "}"
            ].join("\\n"),
            "browser-reference-preview.bib",
            { type: "text/plain" }
          );
          const browserReferenceTransfer = new DataTransfer();
          browserReferenceTransfer.items.add(browserReferenceFile);
          Object.defineProperty(browserReferenceInput, "files", {
            configurable: true,
            value: browserReferenceTransfer.files
          });
          browserReferenceInput.dispatchEvent(new Event("change", { bubbles: true }));
          const browserReferenceDialog = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("确认导入引用文件") ? dialog : null;
          }, 3_000);
          const cancelBrowserReferenceImport = Array.from(
            browserReferenceDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\\s+/g, " ").trim() === "取消");
          cancelBrowserReferenceImport?.click();
          await waitFor(() => !document.querySelector('[role="dialog"]'), 2_000);
          const browserReferenceRowsAfter = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE doi = ? AND deleted_at IS NULL AND works.library_id = ?",
            [browserReferenceDoi, libraryId]
          );
          const browserTabsAfterCancel = await window.aura.research.list();
          discoveryReferenceImportCancelPreserved =
            discoveryReferenceImportCancelPreserved &&
            Boolean(
              browserReferenceDialog?.textContent?.includes("browser-reference-preview.bib") &&
                browserReferenceDialog.textContent.includes("导入 1 条") &&
                Boolean(activeBrowserTabBeforeImport?.tabId) &&
                activeBrowserTabBeforeImport?.tabId ===
                  browserTabsAfterCancel.find((tab) => tab.active)?.tabId
            ) &&
            Number(browserReferenceRowsBefore[0]?.n ?? 0) === 0 &&
            Number(browserReferenceRowsAfter[0]?.n ?? 0) === 0 &&
            bodyIncludes("已取消导入引用文件");
        } else {
          discoveryReferenceImportCancelPreserved = false;
        }
        const exitBrowserButton = Array.from(document.querySelectorAll("button")).find(
          (button) => button.textContent?.replace(/\\s+/g, " ").trim() === "← 站点"
        );
        exitBrowserButton?.click();
        await waitFor(() => Boolean(document.querySelector(".discovery-page--home")), 3_000);
`;
