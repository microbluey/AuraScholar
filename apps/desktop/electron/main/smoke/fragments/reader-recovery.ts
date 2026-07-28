export const smokeReaderRecovery = String.raw`        location.hash = "#/reader?work=" + encodeURIComponent(READER_ARCHIVED_SMOKE.workId);
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            bodyIncludes("文献在回收站") &&
            bodyIncludes("待恢复文献") &&
            bodyIncludes(READER_ARCHIVED_SMOKE.title),
          10_000
        );
        const archivedActionText = Array.from(
          document.querySelectorAll(".reader-empty-hero__actions button")
        )
          .map((button) => button.textContent?.replace(/\s+/g, " ").trim() ?? "")
          .join(" ");
        readerArchivedHash = location.hash;
        readerArchivedStateVisible =
          bodyIncludes("文献在回收站") &&
          bodyIncludes("待恢复文献") &&
          bodyIncludes(READER_ARCHIVED_SMOKE.title) &&
          bodyIncludes(READER_ARCHIVED_SMOKE.author) &&
          bodyIncludes("这篇文献已在回收站");
        readerArchivedRecoveryCtaVisible = archivedActionText.includes("去文献库恢复");
        readerArchivedForbiddenActionsHidden =
          !archivedActionText.includes("补上 PDF") &&
          !archivedActionText.includes("去找全文") &&
          !archivedActionText.includes("打开本地 PDF") &&
          !archivedActionText.includes("重试打开");
        readerArchivedCanvasBlocked =
          !document.querySelector(".au-reader-page__canvas") &&
          !bodyIncludes("PDF Reader") &&
          !bodyIncludes("Archived annotation should stay hidden until restore.");
        Array.from(document.querySelectorAll(".reader-empty-hero__actions button"))
          .find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "去文献库恢复")
          ?.click();
        await waitFor(
          () =>
            location.hash.includes("/library") &&
            (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
              READER_ARCHIVED_SMOKE.title
            ) &&
            Boolean(
              document.querySelector(
                '.library-table__row--selected[data-library-row-id="' +
                  READER_ARCHIVED_SMOKE.workId +
                  '"]'
              )
              ) &&
              Boolean(
                document.querySelector('[data-library-view="trash"][aria-current="page"]')
              ),
          10_000
        );
        const archivedBackToTrashRow = document.querySelector(
          '.library-table__row--selected[data-library-row-id="' +
            READER_ARCHIVED_SMOKE.workId +
            '"]'
        );
        const archivedBackToTrashSearchInput = document.querySelector(
          ".library-inline-search--header input"
        );
        readerArchivedBackToTrashHash = location.hash;
        readerArchivedBackToTrashRowVisible = Boolean(archivedBackToTrashRow);
          readerArchivedBackToTrashSearchCleared =
            archivedBackToTrashSearchInput?.value === "";
          readerArchivedBackToTrashFilterVisible = Boolean(
            document.querySelector('[data-library-view="trash"][aria-current="page"]')
          );
        readerArchivedBackToTrashLocated =
          readerArchivedBackToTrashRowVisible &&
          readerArchivedBackToTrashSearchCleared &&
          readerArchivedBackToTrashFilterVisible &&
          (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
            READER_ARCHIVED_SMOKE.title
          );

        location.hash = "#/reader?work=" + encodeURIComponent(MISSING_PDF.workId);
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            bodyIncludes("PDF 未就绪") &&
            bodyIncludes(MISSING_PDF.title),
          10_000
        );
        readerMissingHash = location.hash;
        readerMissingPdfVisible =
          bodyIncludes("PDF 未就绪") &&
          bodyIncludes(MISSING_PDF.title) &&
          bodyIncludes(MISSING_PDF.author) &&
          bodyIncludes("这篇文献还没有 PDF 附件");
        readerMissingPdfRecoveryVisible =
          bodyIncludes("补上 PDF 并打开") &&
          bodyIncludes("去找全文") &&
          bodyIncludes("回文献库定位");
        readerMissingPdfAttachCtaVisible = bodyIncludes("补上 PDF 并打开");

        const findFulltextButton = Array.from(
          document.querySelectorAll(".reader-empty-hero__actions button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "去找全文");
        findFulltextButton?.click();
        await waitFor(
          () =>
            location.hash.includes("/discovery") &&
            Boolean(document.querySelector(".discovery-page--browser")) &&
            bodyIncludes("补全文目标") &&
            bodyIncludes(MISSING_PDF.title),
          5_000
        );
        readerFindFulltextHandoffHash = location.hash;
        readerFindFulltextHandoffView =
          document.querySelector(".discovery-page")?.className?.toString() ?? "";
        readerFindFulltextHandoffNavigated =
          location.hash.includes("/discovery") &&
          Boolean(document.querySelector(".discovery-page--browser"));
        readerFindFulltextHandoffTargetVisible =
          bodyIncludes("补全文目标") &&
          bodyIncludes(MISSING_PDF.title) &&
          bodyIncludes("下载或抓取到的 PDF 会优先挂回这篇文献");
        readerFindFulltextHandoffStatusVisible = bodyIncludes(
          "正在为《" + MISSING_PDF.title + "》打开全文来源"
        );
        location.hash = "#/reader?work=" + encodeURIComponent(MISSING_PDF.workId);
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            bodyIncludes("PDF 未就绪") &&
            bodyIncludes(MISSING_PDF.title),
          10_000
        );

        const backToLibraryButton = Array.from(
          document.querySelectorAll(".reader-empty-hero__actions button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "回文献库定位");
        backToLibraryButton?.click();
        await waitFor(
          () =>
            location.hash.includes("/library") &&
            (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
              MISSING_PDF.title
            ) &&
            Boolean(
              document.querySelector(
                '.library-table__row--selected[data-library-row-id="' + MISSING_PDF.workId + '"]'
              )
            ),
          10_000
        );
        const backToLibrarySelectedRow = document.querySelector(
          '.library-table__row--selected[data-library-row-id="' + MISSING_PDF.workId + '"]'
        );
        const backToLibrarySearchInput = document.querySelector(
          ".library-inline-search--header input"
        );
        readerMissingBackToLibraryHash = location.hash;
        readerMissingBackToLibraryDetail =
          document.querySelector(".library-detail--selected h2")?.textContent?.trim() ?? "";
        readerMissingBackToLibraryPageText =
          document.querySelector(".library-pagination__page")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        readerMissingBackToLibraryRowVisible = Boolean(backToLibrarySelectedRow);
        readerMissingBackToLibrarySearchCleared = backToLibrarySearchInput?.value === "";
        readerMissingBackToLibraryVisibleRows = Array.from(
          document.querySelectorAll(".library-table__row")
        )
          .map((row) => row.getAttribute("data-library-row-id") ?? "")
          .filter(Boolean)
          .join(",");
        readerMissingBackToLibraryLocated =
          location.hash.includes("/library") &&
          !location.hash.includes("work=") &&
          readerMissingBackToLibraryRowVisible &&
          readerMissingBackToLibrarySearchCleared &&
          (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
            MISSING_PDF.title
          );

        location.hash = "#/library?work=" + encodeURIComponent("smoke-work-not-in-library");
        await waitFor(
          () =>
            location.hash.includes("/library") &&
            bodyIncludes("没有找到要定位的文献"),
          3_000
        );
        libraryMissingDeepLinkFeedbackVisible = bodyIncludes("没有找到要定位的文献");

        location.hash = "#/reader?work=" + encodeURIComponent(MISSING_PDF.workId);
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            bodyIncludes("PDF 未就绪") &&
            bodyIncludes(MISSING_PDF.title),
          10_000
        );

        const recoveryInput = document.querySelector('.reader-empty-hero__actions input[type="file"]');
        if (recoveryInput) {
          const recoveryFile = new File([makeSmokePdf()], "reader-recovery.pdf", {
            type: "application/pdf"
          });
          const transfer = new DataTransfer();
          transfer.items.add(recoveryFile);
          Object.defineProperty(recoveryInput, "files", {
            configurable: true,
            value: transfer.files
          });
          recoveryInput.dispatchEvent(new Event("change", { bubbles: true }));
          readerMissingPdfAttachBusyVisible = Boolean(
            await waitFor(() => {
              const busyButton = Array.from(
                document.querySelectorAll(".reader-empty-hero__actions button")
              ).find((button) => button.getAttribute("aria-busy") === "true");
              return busyButton?.disabled &&
                busyButton.textContent?.includes("正在补上")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("PDF Reader") &&
              bodyIncludes(MISSING_PDF.title) &&
              bodyIncludes("已入库") &&
              bodyIncludes("1 页") &&
              Boolean(document.querySelector(".au-reader-page__canvas")),
            10_000
          );
          readerRecoveredPdfVisible =
            bodyIncludes("PDF Reader") &&
            bodyIncludes(MISSING_PDF.title) &&
            bodyIncludes("已入库") &&
            Boolean(document.querySelector(".au-reader-page__canvas"));
          const recoveredRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM attachments WHERE work_id = ? AND deleted_at IS NULL",
            [MISSING_PDF.workId]
          );
          readerRecoveredAttachmentCount = Number(recoveredRows[0]?.n ?? 0);
        }

        location.hash = "#/reader?work=" + encodeURIComponent(BROKEN_BLOB.workId);
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            bodyIncludes("PDF 未就绪") &&
            bodyIncludes(BROKEN_BLOB.title),
          10_000
        );
        readerBrokenHash = location.hash;
        readerBrokenBlobVisible =
          bodyIncludes("PDF 未就绪") &&
          bodyIncludes(BROKEN_BLOB.title) &&
          bodyIncludes(BROKEN_BLOB.author) &&
          bodyIncludes("本地文件无法读取");
        readerBrokenBlobRecoveryVisible =
          bodyIncludes("补上 PDF 并打开") &&
          bodyIncludes("去找全文") &&
          bodyIncludes("回文献库定位");

        const repairInput = document.querySelector('.reader-empty-hero__actions input[type="file"]');
        if (repairInput) {
          const repairFile = new File([makeSmokePdf()], "reader-broken-repair.pdf", {
            type: "application/pdf"
          });
          const repairTransfer = new DataTransfer();
          repairTransfer.items.add(repairFile);
          Object.defineProperty(repairInput, "files", {
            configurable: true,
            value: repairTransfer.files
          });
          repairInput.dispatchEvent(new Event("change", { bubbles: true }));
          await waitFor(
            () =>
              bodyIncludes("PDF Reader") &&
              bodyIncludes(BROKEN_BLOB.title) &&
              bodyIncludes("已入库") &&
              bodyIncludes("1 页") &&
              Boolean(document.querySelector(".au-reader-page__canvas")),
            10_000
          );
          const repairedRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM attachments WHERE work_id = ? AND deleted_at IS NULL",
            [BROKEN_BLOB.workId]
          );
          readerBrokenAttachmentCount = Number(repairedRows[0]?.n ?? 0);
        }

        location.hash = "#/reader?work=" + encodeURIComponent(CORRUPT_PDF.workId);
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            bodyIncludes("PDF 未就绪") &&
            bodyIncludes(CORRUPT_PDF.title),
          10_000
        );
        readerCorruptHash = location.hash;
        readerCorruptPdfVisible =
          bodyIncludes("PDF 未就绪") &&
          bodyIncludes(CORRUPT_PDF.title) &&
          bodyIncludes(CORRUPT_PDF.author) &&
          bodyIncludes("PDF 附件文件无法解析");
        readerCorruptPdfRecoveryVisible =
          bodyIncludes("补上 PDF 并打开") &&
          bodyIncludes("去找全文") &&
          bodyIncludes("回文献库定位");

        const corruptRepairInput = document.querySelector('.reader-empty-hero__actions input[type="file"]');
        if (corruptRepairInput) {
          const corruptRepairFile = new File([makeSmokePdf()], "reader-corrupt-repair.pdf", {
            type: "application/pdf"
          });
          const corruptTransfer = new DataTransfer();
          corruptTransfer.items.add(corruptRepairFile);
          Object.defineProperty(corruptRepairInput, "files", {
            configurable: true,
            value: corruptTransfer.files
          });
          corruptRepairInput.dispatchEvent(new Event("change", { bubbles: true }));
          await waitFor(
            () =>
              bodyIncludes("PDF Reader") &&
              bodyIncludes(CORRUPT_PDF.title) &&
              bodyIncludes("已入库") &&
              bodyIncludes("1 页") &&
              Boolean(document.querySelector(".au-reader-page__canvas")),
            10_000
          );
          const corruptRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM attachments WHERE work_id = ? AND deleted_at IS NULL",
            [CORRUPT_PDF.workId]
          );
          readerCorruptAttachmentCount = Number(corruptRows[0]?.n ?? 0);
        }

        window.__AURASCHOLAR_SMOKE_ROUTE_CRASH__ = {
          message: "AURASCHOLAR_SMOKE_ROUTE_CRASH",
          pathPrefix: "/reader"
        };
        location.hash = "#/reader?work=smoke-route-crash";
        await waitFor(
          () => {
            const boundary = document.querySelector(".app-error-boundary--route");
            const frame = document.querySelector(".app-frame");
            const sidebar = document.querySelector(".app-sidebar");
            const sidebarRect = sidebar?.getBoundingClientRect();
            const sidebarStyle = sidebar ? window.getComputedStyle(sidebar) : null;
            return boundary?.textContent?.includes("PDF 阅读器 暂时不可用") &&
              frame &&
              !frame.classList.contains("app-frame--immersive") &&
              sidebarRect &&
              sidebarRect.width > 0 &&
              sidebarRect.height > 0 &&
              sidebarStyle?.display !== "none" &&
              sidebarStyle?.visibility !== "hidden"
              ? boundary
              : null;
          },
          4_000
        );
        const routeCrashBoundary = document.querySelector(".app-error-boundary--route");
        const routeCrashFrame = document.querySelector(".app-frame");
        const routeCrashSidebar = document.querySelector(".app-sidebar");
        const routeCrashSidebarRect = routeCrashSidebar?.getBoundingClientRect();
        const routeCrashSidebarStyle = routeCrashSidebar
          ? window.getComputedStyle(routeCrashSidebar)
          : null;
        routeCrashBoundaryVisible = Boolean(
          routeCrashBoundary?.textContent?.includes("PDF 阅读器 暂时不可用") &&
            routeCrashBoundary.textContent.includes("回到文献库")
        );
        routeCrashShellVisible =
          Boolean(
            routeCrashFrame &&
              !routeCrashFrame.classList.contains("app-frame--immersive") &&
              routeCrashSidebarRect &&
              routeCrashSidebarRect.width > 0 &&
              routeCrashSidebarRect.height > 0 &&
              routeCrashSidebarStyle?.display !== "none" &&
              routeCrashSidebarStyle?.visibility !== "hidden"
          ) &&
          bodyIncludes("AuraScholar") &&
          bodyIncludes("快速打开") &&
          bodyIncludes("文献库");
        const recoverButton = Array.from(
          routeCrashBoundary?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "回到文献库");
        delete window.__AURASCHOLAR_SMOKE_ROUTE_CRASH__;
        recoverButton?.click();
        await waitFor(
          () =>
            location.hash.includes("/library") &&
            Boolean(document.querySelector(".library-page")) &&
            !document.querySelector(".app-error-boundary--route"),
          4_000
        );
        routeCrashRecoveryHash = location.hash;
        routeCrashRecoveredLibraryVisible =
          location.hash.includes("/library") &&
          Boolean(document.querySelector(".library-page")) &&
          bodyIncludes("文献库") &&
          !document.querySelector(".app-error-boundary--route");

`;
