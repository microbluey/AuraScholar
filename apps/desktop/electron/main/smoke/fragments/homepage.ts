export const smokeHomepage = String.raw`        location.hash = "#/homepage";
        await waitFor(
          () =>
            location.hash.includes("/homepage") &&
            bodyIncludes("学术主页") &&
            bodyIncludes("展示成果"),
          4_000
        );
        const homepageLibraryRetryPanel = () =>
          document.querySelector(".homepage-card--publications")?.textContent ?? "";
        const homepageLibraryRetryButton = await waitFor(
          () => document.querySelector('button[aria-label="重试读取主页文献库"]'),
          3_000
        );
        const homepageLibraryReadRetryErrorVisible =
          homepageLibraryRetryPanel().includes("文献库暂时不可用") &&
          homepageLibraryRetryPanel().includes("Smoke homepage library read failure");
        homepageLibraryRetryButton?.click();
        homepageLibraryReadRetryRecoveryVisible =
          homepageLibraryReadRetryErrorVisible &&
          Boolean(
            await waitFor(
              () =>
                Boolean(document.querySelector(".homepage-publication-row")) &&
                !homepageLibraryRetryPanel().includes("文献库暂时不可用") &&
                !homepageLibraryRetryPanel().includes("Smoke homepage library read failure"),
              5_000
            )
          );
        homepageLibraryReadRetryRecoveryDetail = [
          "error=" + homepageLibraryReadRetryErrorVisible,
          "button=" + Boolean(homepageLibraryRetryButton),
          "row=" + Boolean(document.querySelector(".homepage-publication-row")),
          "errorText=" + homepageLibraryRetryPanel().includes("文献库暂时不可用"),
        ].join("; ");
        delete window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_READ__;
        await waitFor(() => !bodyIncludes("正在读取文献库..."), 5_000);
        const homepageRaceTitle = "Smoke Homepage Race Newer Library Work";
        const homepageRaceNow = Date.now();
        window.__AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_DELAY_MS__ = 450;
        window.__AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_COUNT__ = 0;
        window.dispatchEvent(new Event("aurascholar:library-updated"));
        await waitFor(
          () => Number(window.__AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_COUNT__ ?? 0) >= 1,
          1_000
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            "smoke-homepage-refresh-race", libraryId,
            "10.4242/aurascholar.homepage-refresh-race",
            homepageRaceTitle,
            "A deterministic smoke-test paper for validating homepage library refresh race handling.",
            2027,
            "Journal of Homepage UX",
            "article",
            "unread",
            1,
            homepageRaceNow + 1,
            homepageRaceNow + 1
          ]
        );
        window.__AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_DELAY_MS__ = 0;
        window.dispatchEvent(new Event("aurascholar:library-updated"));
        await waitFor(() => bodyIncludes(homepageRaceTitle), 2_000);
        await wait(650);
        homepageLibraryRefreshRacePreserved =
          bodyIncludes(homepageRaceTitle) &&
          bodyIncludes("展示成果") &&
          !bodyIncludes("正在读取文献库...");
        delete window.__AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_DELAY_MS__;
        delete window.__AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_COUNT__;
        const homepageInputByLabel = (label) =>
          Array.from(document.querySelectorAll(".homepage-field")).find((field) =>
            field.textContent?.includes(label)
          )?.querySelector("input, textarea");
        const homepageStoredProfile = () => {
          try {
            const stored = JSON.parse(localStorage.getItem("homepage-profile") ?? "{}");
            return stored && typeof stored === "object" ? stored : {};
          } catch {
            return {};
          }
        };
        const homepagePreviewSource = () => {
          const frame = document.querySelector('iframe[title="主页实时预览"]');
          return (
            frame?.getAttribute("srcdoc") ||
            frame?.srcdoc ||
            frame?.contentDocument?.documentElement?.outerHTML ||
            ""
          );
        };
        const homepageNameInput = homepageInputByLabel("姓名");
        if (homepageNameInput) {
          const homepageProfileSaveFailureName = "Smoke Homepage Save Failure " + Date.now();
          setInputValue(homepageNameInput, "");
          await waitFor(
            () => homepageNameInput.value === "" && homepageStoredProfile().displayName === "",
            2_000
          );
          window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_PROFILE_SAVE__ =
            "Smoke homepage profile save failure";
          window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_PROFILE_SAVE_COUNT__ = 2;
          setInputValue(homepageNameInput, homepageProfileSaveFailureName);
          homepageProfileSaveFailureVisible = Boolean(
            await waitFor(
              () =>
                bodyIncludes("主页草稿保存失败，当前页面已更新但刷新后可能丢失") &&
                bodyIncludes("Smoke homepage profile save failure") &&
                document.querySelector(".homepage-status.inline-notice--danger") &&
                document.querySelector('button[aria-label="重试保存主页草稿"]'),
              2_000
            )
          );
          const homepageProfileRetryButton = document.querySelector(
            'button[aria-label="重试保存主页草稿"]'
          );
          homepageProfileSaveFailureRetryVisible = Boolean(homepageProfileRetryButton);
          homepageProfileSaveFailureDidNotPersist =
            homepageStoredProfile().displayName !== homepageProfileSaveFailureName;
          homepageProfileSaveFailurePreserved =
            homepageNameInput.value === homepageProfileSaveFailureName &&
            homepagePreviewSource().includes(homepageProfileSaveFailureName);
          delete window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_PROFILE_SAVE_COUNT__;
          delete window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_PROFILE_SAVE__;
          homepageProfileRetryButton?.click();
          homepageProfileSaveFailureBusyVisible = Boolean(
            await waitFor(() => {
              const button = document.querySelector('button[aria-label="重试保存主页草稿"]');
              return button?.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("保存中") &&
                bodyIncludes("正在保存主页草稿") &&
                document.querySelector(".homepage-status.inline-notice--busy")
                ? button
                : null;
            }, 1_000)
          );
          homepageProfileSaveFailureRetryPersisted = Boolean(
            await waitFor(
              () =>
                bodyIncludes("主页草稿已保存。") &&
                homepageStoredProfile().displayName === homepageProfileSaveFailureName,
              2_000
            )
          );
        }
        const homepageScholarInput = homepageInputByLabel("Google Scholar");
        const homepageGithubInput = homepageInputByLabel("GitHub");
        if (homepageScholarInput && homepageGithubInput) {
          setInputValue(homepageScholarInput, "javascript:alert('homepage-smoke')");
          setInputValue(homepageGithubInput, "github.com/aurascholar/aurascholar");
          await waitFor(
            () => homepagePreviewSource().includes("https://github.com/aurascholar/aurascholar"),
            2_000
          );
          const homepagePreviewHtml = homepagePreviewSource();
          homepageSafeLinkRelHardened = homepagePreviewHtml.includes(
            'href="https://github.com/aurascholar/aurascholar" target="_blank" rel="noopener noreferrer"'
          );
          homepageExternalLinkSafetyOk =
            homepageSafeLinkRelHardened &&
            !homepagePreviewHtml.includes("javascript:") &&
            !homepagePreviewHtml.includes("homepage-smoke") &&
            !homepagePreviewHtml.includes("Google Scholar");
        }
        const homepagePublicationPanel = () =>
          document.querySelector(".homepage-card--publications")?.textContent ?? "";
        const homepagePublicationSearchInput = document.querySelector(
          'input[aria-label="搜索可展示成果"]'
        );
        homepagePublicationFilterActionDetail = "input=" + Boolean(homepagePublicationSearchInput);
        if (homepagePublicationSearchInput) {
          setInputValue(homepagePublicationSearchInput, "NoMatchingHomepagePublication");
          await waitFor(() => homepagePublicationPanel().includes("没有匹配的成果"), 1_500);
          const homepagePublicationClearButton = document.querySelector(
            'button[aria-label="清空主页成果筛选"]'
          );
          homepagePublicationClearButton?.click();
          homepagePublicationFilterActionRestored = Boolean(
            await waitFor(
              () =>
                homepagePublicationSearchInput.value === "" &&
                document.activeElement === homepagePublicationSearchInput &&
                Boolean(document.querySelector(".homepage-publication-row")) &&
                !homepagePublicationPanel().includes("没有匹配的成果"),
              1_500
            )
          );
          homepagePublicationFilterActionDetail = [
            "button=" + Boolean(homepagePublicationClearButton),
            "value=" + homepagePublicationSearchInput.value,
            "focused=" + (document.activeElement === homepagePublicationSearchInput),
            "row=" + Boolean(document.querySelector(".homepage-publication-row")),
            "empty=" + homepagePublicationPanel().includes("没有匹配的成果"),
          ].join("; ");
        }
        const homepageFeaturedButton = Array.from(
          document.querySelectorAll(".homepage-card--publications button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "精选成果");
        const firstHomepageWorkCheckbox = await waitFor(
          () => document.querySelector('.homepage-publication-row input[type="checkbox"]'),
          3_000
        );
        firstHomepageWorkCheckbox?.click();
        await waitFor(() => homepagePublicationPanel().includes("1 已选"), 2_000);
        const homepageManualSelectionText = homepagePublicationPanel();
        homepageFeaturedButton?.click();
        const homepageFeaturedDialog = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("用精选成果覆盖当前选择？") ? dialog : null;
        }, 3_000);
        homepageFeaturedOverwriteConfirmVisible = Boolean(
          homepageFeaturedDialog?.textContent?.includes("主页草稿会自动保存")
        );
        const keepManualSelection = Array.from(
          homepageFeaturedDialog?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "继续手动选择");
        keepManualSelection?.click();
        await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
        homepageFeaturedOverwriteCancelPreserved =
          homepageFeaturedOverwriteConfirmVisible &&
          homepagePublicationPanel() === homepageManualSelectionText &&
          bodyIncludes("已保留手动选择的主页成果。");
        await waitFor(
          () =>
            homepagePublicationPanel().includes("已选") &&
            !homepagePublicationPanel().includes("0 已选"),
          2_000
        );
        const homepageSelectedBeforeClear = homepagePublicationPanel();
        const homepageClearButton = Array.from(
          document.querySelectorAll(".homepage-card--publications button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "清空");
        const homepageStoredSelectedWorkIds = () => {
          try {
            const stored = JSON.parse(localStorage.getItem("homepage-profile") ?? "{}");
            return Array.isArray(stored.selectedWorkIds) ? stored.selectedWorkIds : [];
          } catch {
            return [];
          }
        };
        homepageClearButton?.click();
        const homepageClearDialog = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("清空主页成果列表？") ? dialog : null;
        }, 3_000);
        homepageClearSelectedConfirmVisible = Boolean(
          homepageClearDialog?.textContent?.includes("主页草稿会自动保存")
        );
        const keepHomepageSelection = Array.from(
          homepageClearDialog?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "继续保留");
        keepHomepageSelection?.click();
        await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
        homepageClearSelectedCancelPreserved =
          homepageClearSelectedConfirmVisible &&
          homepagePublicationPanel() === homepageSelectedBeforeClear &&
          bodyIncludes("已保留主页成果列表。");
        const homepageSelectedIdsBeforeClear = homepageStoredSelectedWorkIds();
        homepageClearButton?.click();
        const homepageClearUndoDialog = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("清空主页成果列表？") ? dialog : null;
        }, 3_000);
        const clearHomepageSelection = Array.from(
          homepageClearUndoDialog?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "清空列表");
        clearHomepageSelection?.click();
        const homepageUndoButton = await waitFor(
          () => document.querySelector('button[aria-label="撤销主页成果修改"]'),
          2_000
        );
        const homepageClearedSelectionVisible = Boolean(
          homepageUndoButton &&
            bodyIncludes("已清空主页成果列表。") &&
            homepagePublicationPanel().includes("0 已选")
        );
        window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_PROFILE_SAVE__ =
          "Smoke homepage profile save failure";
        homepageUndoButton?.click();
        homepageClearSelectedUndoFailureBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销主页成果修改"]');
            return button?.getAttribute("aria-busy") === "true" &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销主页成果修改")
              ? button
              : null;
          }, 1_000)
        );
        homepageClearSelectedUndoFailureVisible = Boolean(
          await waitFor(
            () =>
              bodyIncludes("撤销主页成果修改失败，当前页面已恢复但草稿保存失败") &&
              bodyIncludes("Smoke homepage profile save failure") &&
              document.querySelector('button[aria-label="撤销主页成果修改"]'),
            2_000
          )
        );
        homepageClearSelectedUndoFailureDidNotPersist =
          homepageStoredSelectedWorkIds().length === 0;
        homepageClearSelectedUndoFailurePreserved = Boolean(
          homepageClearSelectedUndoFailureVisible &&
            homepagePublicationPanel() === homepageSelectedBeforeClear &&
            document.querySelector('button[aria-label="撤销主页成果修改"]')
        );
        delete window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_PROFILE_SAVE__;
        const homepageUndoRetryButton = document.querySelector(
          'button[aria-label="撤销主页成果修改"]'
        );
        homepageUndoRetryButton?.click();
        const homepageUndoBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销主页成果修改"]');
            return button?.getAttribute("aria-busy") === "true" &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销主页成果修改")
              ? button
              : null;
          }, 1_000)
        );
        homepageClearSelectedUndoRecovered = Boolean(
          homepageClearedSelectionVisible &&
            homepageUndoBusyVisible &&
            (await waitFor(
              () =>
                homepagePublicationPanel() === homepageSelectedBeforeClear &&
                bodyIncludes("已撤销主页成果修改。"),
              2_000
            ))
        );
        homepageClearSelectedUndoRetryPersisted =
          homepageStoredSelectedWorkIds().length === homepageSelectedIdsBeforeClear.length &&
          homepageSelectedIdsBeforeClear.every((id) => homepageStoredSelectedWorkIds().includes(id));
        homepageClearSelectedUndoDetail = [
          "cleared=" + homepageClearedSelectionVisible,
          "busy=" + homepageUndoBusyVisible,
          "failureVisible=" + homepageClearSelectedUndoFailureVisible,
          "failureBusy=" + homepageClearSelectedUndoFailureBusyVisible,
          "failurePreserved=" + homepageClearSelectedUndoFailurePreserved,
          "failureNotPersisted=" + homepageClearSelectedUndoFailureDidNotPersist,
          "restored=" + (homepagePublicationPanel() === homepageSelectedBeforeClear),
          "retryPersisted=" + homepageClearSelectedUndoRetryPersisted,
          "success=" + bodyIncludes("已撤销主页成果修改。"),
        ].join("; ");
        const homepageExportButton = Array.from(document.querySelectorAll(".homepage-publish-actions button")).find(
          (button) => button.textContent?.replace(/\s+/g, " ").trim() === "导出 HTML"
        );
        const homepageCopyButton = Array.from(document.querySelectorAll(".homepage-publish-actions button")).find(
          (button) => button.textContent?.replace(/\s+/g, " ").trim() === "复制源码"
        );
        if (homepageCopyButton && homepageExportButton) {
          homepageCopyButton.click();
          await waitFor(
            () =>
              homepageCopyButton.disabled &&
              homepageExportButton.disabled &&
              homepageCopyButton.textContent?.includes("复制中") &&
              bodyIncludes("正在复制主页源码"),
            1_000
          );
          homepageCopyBusyVisible = Boolean(
            homepageCopyButton.disabled &&
              homepageExportButton.disabled &&
              homepageCopyButton.textContent?.includes("复制中") &&
              bodyIncludes("正在复制主页源码")
          );
          homepageCopyAriaBusyVisible =
            homepageCopyBusyVisible && homepageCopyButton.getAttribute("aria-busy") === "true";
          await waitFor(
            () =>
              !homepageCopyButton.disabled &&
              bodyIncludes("主页 HTML 已复制到剪贴板"),
            2_000
          );
          let homepageClipboardMatches = true;
          try {
            if (navigator.clipboard?.readText) {
              homepageClipboardMatches = (await navigator.clipboard.readText()).includes("<!doctype html>");
            }
          } catch {}
          homepageCopySuccessVisible =
            !homepageCopyButton.disabled &&
            bodyIncludes("主页 HTML 已复制到剪贴板") &&
            homepageClipboardMatches;

          window.__AURASCHOLAR_SMOKE_CLIPBOARD_WRITE_ERROR__ = "smoke-copy-failed";
          try {
            homepageCopyButton.click();
            await waitFor(
              () =>
                !homepageCopyButton.disabled &&
                bodyIncludes("复制失败") &&
                bodyIncludes("smoke-copy-failed"),
              2_000
            );
            homepageCopyFailureVisible =
              !homepageCopyButton.disabled &&
              bodyIncludes("复制失败") &&
              bodyIncludes("smoke-copy-failed");
          } finally {
            delete window.__AURASCHOLAR_SMOKE_CLIPBOARD_WRITE_ERROR__;
          }
        }
        if (homepageExportButton) {
          const originalAnchorClick = HTMLAnchorElement.prototype.click;
          let homepageDownloadClickCount = 0;
          HTMLAnchorElement.prototype.click = function () {
            if (this.download?.endsWith("-index.html")) {
              homepageDownloadClickCount += 1;
              return;
            }
            return originalAnchorClick.call(this);
          };
          try {
            homepageExportButton.click();
            await waitFor(
              () =>
                homepageExportButton.disabled &&
                homepageCopyButton?.disabled &&
                homepageExportButton.textContent?.includes("导出中") &&
                bodyIncludes("正在导出主页 HTML"),
              1_000
            );
            homepageExportBusyVisible = Boolean(
              homepageExportButton.disabled &&
                homepageCopyButton?.disabled &&
                homepageExportButton.textContent?.includes("导出中") &&
                bodyIncludes("正在导出主页 HTML")
            );
            homepageExportAriaBusyVisible =
              homepageExportBusyVisible && homepageExportButton.getAttribute("aria-busy") === "true";
            await waitFor(
              () =>
                !homepageExportButton.disabled &&
                bodyIncludes("已导出") &&
                bodyIncludes("index.html"),
              2_000
            );
            homepageExportSuccessVisible =
              homepageDownloadClickCount === 1 &&
              !homepageExportButton.disabled &&
              bodyIncludes("已导出") &&
              bodyIncludes("index.html");

            const originalCreateObjectUrl = URL.createObjectURL;
            URL.createObjectURL = () => {
              throw new Error("smoke-export-failed");
            };
            try {
              homepageExportButton.click();
              await waitFor(
                () => bodyIncludes("导出失败") && bodyIncludes("smoke-export-failed"),
                2_000
              );
              homepageExportFailureVisible =
                bodyIncludes("导出失败") && bodyIncludes("smoke-export-failed");
            } finally {
              URL.createObjectURL = originalCreateObjectUrl;
            }
          } finally {
            HTMLAnchorElement.prototype.click = originalAnchorClick;
          }
        }

`;
