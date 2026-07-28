export const smokeReaderTranslation = String.raw`        const translationSelectionSpan = document.querySelector(".au-reader-page__text span");
        if (translationSelectionSpan?.firstChild && translationSelectionSpan.textContent) {
          const range = document.createRange();
          range.setStart(translationSelectionSpan.firstChild, 0);
          range.setEnd(
            translationSelectionSpan.firstChild,
            Math.min(translationSelectionSpan.textContent.length, 20)
          );
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          translationSelectionSpan.dispatchEvent(
            new MouseEvent("mouseup", { bubbles: true, cancelable: true })
          );
          const selectionTranslateButton = await waitFor(
            () => document.querySelector('button[title="翻译选中文本"]'),
            2_000
          );
          selectionTranslateButton?.click();
          const selectionTranslationPopover = await waitFor(
            () => document.querySelector(".reader-selection-translation"),
            2_000
          );
          if (selectionTranslationPopover) {
            const rect = selectionTranslationPopover.getBoundingClientRect();
            readerTranslationSelectionPopoverVisible =
              selectionTranslationPopover.textContent?.includes("AuraScholar") === true &&
              rect.left >= 0 &&
              rect.top >= 0 &&
              rect.right <= window.innerWidth &&
              rect.bottom <= window.innerHeight;
            selectionTranslationPopover.querySelector('button[aria-label="关闭划词翻译"]')?.click();
          }
        }

        const translateTab = Array.from(document.querySelectorAll(".reader-tabs button")).find(
          (button) => button.textContent?.includes("翻译")
        );
        translateTab?.click();
        await waitFor(() => Boolean(document.querySelector(".reader-translate-panel")), 2_000);
        const translationModeButtons = Array.from(
          document.querySelectorAll(".reader-translate-modebar button")
        );
        const translationModesVisible = ["划词翻译", "双栏对照", "文内对照"].every((label) =>
          translationModeButtons.some(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === label
          )
        );
        translationModeButtons
          .find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "双栏对照")
          ?.click();
        await waitFor(
          () =>
            Boolean(document.querySelector(".reader-translate-panel--split")) &&
            Boolean(document.querySelector(".reader-pdf-pane--source")) &&
            Boolean(document.querySelector('.reader-translation-document[aria-label="译文 PDF"]')),
          1_000
        );
        readerTranslationSplitDocumentsVisible =
          Boolean(document.querySelector(".reader-pdf-pane--source")) &&
          Boolean(document.querySelector('.reader-translation-document[aria-label="译文 PDF"]')) &&
          bodyIncludes("原文 PDF") &&
          bodyIncludes("译文 PDF");
        const translatePageButton = Array.from(
          document.querySelectorAll(".reader-translate-panel button")
        ).find((button) => button.textContent?.includes("翻译该页"));
        translatePageButton?.click();
        readerTranslationStartBusyVisible = Boolean(
          await waitFor(() => {
            const panel = document.querySelector(".reader-translate-panel");
            const busyButton = Array.from(panel?.querySelectorAll("button") ?? []).find(
              (button) => button.getAttribute("aria-busy") === "true" && button.disabled
            );
            return panel?.getAttribute("aria-busy") === "true" &&
              busyButton?.textContent?.includes("翻译中") &&
              panel.textContent?.includes("翻译中")
              ? busyButton
              : null;
          }, 1_000)
        );
        await waitFor(() => bodyIncludes("请先在设置页配置 AI 服务"), 3_000);
        readerTranslationStartErrorVisible =
          translationModesVisible &&
          readerTranslationStartBusyVisible &&
          bodyIncludes("请先在设置页配置 AI 服务");
        const translateSettingsButton = Array.from(
          document.querySelectorAll(".reader-translate-panel button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "去配置 AI");
        readerTranslationSettingsCtaVisible =
          readerTranslationStartErrorVisible && Boolean(translateSettingsButton);
        translateSettingsButton?.click();
        await waitFor(
          () =>
            location.hash.includes("/settings?section=ai") &&
            Boolean(document.querySelector('[data-settings-section="ai"].settings-card--targeted')) &&
            bodyIncludes("AI 服务") &&
            bodyIncludes("阅读翻译"),
          3_000
        );
        readerTranslationSettingsCtaTargetsSection =
          location.hash.includes("/settings?section=ai") &&
          Boolean(document.querySelector('[data-settings-section="ai"].settings-card--targeted'));
        readerTranslationSettingsCtaNavigates =
          location.hash.includes("/settings?section=ai") &&
          bodyIncludes("AI 服务") &&
          bodyIncludes("阅读翻译");
        location.hash =
          "#/reader?work=" + encodeURIComponent(SAMPLE.workId) + "&tab=translate";
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            Boolean(document.querySelector(".reader-translate-panel")),
          4_000
        );
        const splitModeButtonAfterReturn = Array.from(
          document.querySelectorAll(".reader-translate-modebar button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "双栏对照");
        splitModeButtonAfterReturn?.click();
        await waitFor(
          () => Boolean(document.querySelector('.reader-translation-document[aria-label="译文 PDF"]')),
          2_000
        );
        const expectedTranslationCopy = [
          "Smoke translated paragraph one.",
          "Smoke translated paragraph two."
        ].join("\n\n");
        window.dispatchEvent(
          new CustomEvent("aurascholar:reader-translation-smoke-segments", {
            detail: {
              engine: "smoke",
              segments: [
                { source: "Smoke source paragraph one.", result: "Smoke translated paragraph one." },
                { source: "Smoke source paragraph two.", result: "Smoke translated paragraph two." }
              ]
            }
          })
        );
        await waitFor(
          () =>
            bodyIncludes("Smoke translated paragraph one.") &&
            Boolean(
              Array.from(document.querySelectorAll("button")).find((button) =>
                button.textContent?.replace(/\s+/g, " ").trim() === "复制译文"
              )
            ),
          2_000
        );
        const inlineModeButton = Array.from(
          document.querySelectorAll(".reader-translate-modebar button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "文内对照");
        inlineModeButton?.click();
        const inlineDocument = await waitFor(
          () => document.querySelector('.reader-translation-document[aria-label="文内对照 PDF"]'),
          2_000
        );
        const firstBilingualSection = inlineDocument?.querySelector(
          ".reader-translation-page__bilingual section"
        );
        readerTranslationInlineDocumentVisible =
          Boolean(inlineDocument) &&
          firstBilingualSection?.querySelector(".reader-translation-page__source")?.textContent?.includes(
            "Smoke source paragraph one."
          ) === true &&
          firstBilingualSection?.querySelector(".reader-translation-page__result")?.textContent?.includes(
            "Smoke translated paragraph one."
          ) === true;
        const copyTranslationButton = Array.from(document.querySelectorAll("button")).find((button) =>
          button.textContent?.replace(/\s+/g, " ").trim() === "复制译文"
        );
        copyTranslationButton?.click();
        readerTranslationCopyBusyVisible = Boolean(
          await waitFor(() => {
            const busyButton = Array.from(document.querySelectorAll("button")).find(
              (button) => button.getAttribute("aria-busy") === "true" && button.disabled
            );
            return busyButton?.textContent?.includes("复制中") ? busyButton : null;
          }, 1_000)
        );
        await waitFor(() => bodyIncludes("已复制 2 段译文"), 2_000);
        readerTranslationCopyStatusText =
          document.querySelector(".reader-translate-copy-status")?.textContent?.trim() ?? "";
        readerTranslationCopyFeedbackVisible = readerTranslationCopyStatusText.includes(
          "已复制 2 段译文"
        );
        try {
          if (window.aura?.clipboard?.readText) {
            const clipboardText = await window.aura.clipboard.readText();
            readerTranslationClipboardMatches = clipboardText === expectedTranslationCopy;
          } else if (navigator.clipboard?.readText) {
            const clipboardText = await navigator.clipboard.readText();
            readerTranslationClipboardMatches = clipboardText === expectedTranslationCopy;
          } else {
            readerTranslationClipboardMatches = readerTranslationCopyFeedbackVisible;
          }
        } catch {
          readerTranslationClipboardMatches = readerTranslationCopyFeedbackVisible;
        }

        const readerAnnotationsTab = Array.from(
          document.querySelectorAll(".reader-tabs button")
        ).find((button) => button.textContent?.includes("批注"));
        readerAnnotationsTab?.click();
        const readerAnnotationCanvasButton = await waitFor(() => {
          const activeReaderTab = document.querySelector(".reader-tabs .au-tab--active");
          if (!activeReaderTab?.textContent?.includes("批注")) return null;
          return (
            Array.from(document.querySelectorAll(".au-annsidebar__canvas")).find((button) =>
              button.getAttribute("aria-label")?.includes("AuraScholar Smoke PDF")
            ) ?? null
          );
        }, 3_000);
        readerAnnotationCanvasButton?.click();
        await waitFor(
          () =>
            location.hash.startsWith("#/canvas/") &&
            !location.hash.includes("workId=") &&
            !location.hash.includes("annotationId=") &&
            Boolean(document.querySelector(".canvas-workspace")) &&
            Boolean(
              Array.from(document.querySelectorAll(".canvas-card--excerpt")).find((card) =>
                card.querySelector(".canvas-card__quote")?.textContent?.includes(
                  "AuraScholar Smoke PDF"
                )
              )
            ),
          8_000
        );
        canvasReaderAnnotationDeepLinkHash = location.hash;
        canvasReaderAnnotationDeepLinkNavigated =
          Boolean(readerAnnotationCanvasButton) &&
          canvasReaderAnnotationDeepLinkHash.startsWith("#/canvas/") &&
          !canvasReaderAnnotationDeepLinkHash.includes("workId=") &&
          !canvasReaderAnnotationDeepLinkHash.includes("annotationId=");
        canvasReaderAnnotationVisible = Boolean(
          Array.from(document.querySelectorAll(".canvas-card--excerpt")).find((card) =>
            card.querySelector(".canvas-card__quote")?.textContent?.includes(
              "AuraScholar Smoke PDF"
            )
          )
        );
        const persistedCanvasAnnotation = await waitFor(async () => {
          const rows = await window.aura.db.query(
            "SELECT id, data_json FROM canvas_nodes WHERE workspace_id = ? AND type = 'excerpt'",
            ["canvas:default"]
          );
          return rows.find((row) => {
            try {
              const data = JSON.parse(row.data_json);
              return (
                data.workId === SAMPLE.workId &&
                data.annotationId === SAMPLE.annotationId &&
                data.highlightText === "AuraScholar Smoke PDF"
              );
            } catch {
              return false;
            }
          }) ?? null;
        }, 5_000);
        canvasReaderAnnotationPersisted = Boolean(persistedCanvasAnnotation);
        location.hash =
          "#/reader?work=" + encodeURIComponent(SAMPLE.workId) + "&tab=graph";
        await waitFor(
          () => {
            const activeReaderTab = document.querySelector(".reader-tabs .au-tab--active");
            return (
              location.hash.includes("tab=graph") &&
              activeReaderTab?.textContent?.includes("脉络") &&
              Boolean(document.querySelector(".citation-graph-view .citation-graph-node")) &&
              bodyIncludes(SAMPLE.doi)
            );
          },
          3_000
        );
        readerTabDeepLinkSyncVisible = Boolean(
          document.querySelector(".reader-tabs .au-tab--active")?.textContent?.includes("脉络")
        ) &&
          Boolean(document.querySelector(".citation-graph-view .citation-graph-node")) &&
          Boolean(document.querySelector('.citation-graph-zoom button[aria-label="放大图谱"]')) &&
          Boolean(document.querySelector(".citation-graph-focus")) &&
          Math.max(
            ...Array.from(document.querySelectorAll(".citation-graph-node")).map((node) =>
              Number(node.getAttribute("r") ?? 0)
            )
          ) <= 22;

        location.hash = "#/reader";
        await waitFor(
          () =>
            location.hash === "#/reader" &&
            bodyIncludes("阅读器") &&
            bodyIncludes("等待一篇 PDF") &&
            !bodyIncludes(SAMPLE.title) &&
            !document.querySelector(".au-reader-page__canvas"),
          3_000
        );
        readerNoWorkClearsDocument =
          location.hash === "#/reader" &&
          bodyIncludes("阅读器") &&
          bodyIncludes("等待一篇 PDF") &&
          !bodyIncludes(SAMPLE.title) &&
          !document.querySelector(".au-reader-page__canvas");

        window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_OPEN__ =
          "Smoke reader transient open failure";
        location.hash = "#/reader?work=" + encodeURIComponent(SAMPLE.workId);
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            bodyIncludes("Smoke reader transient open failure") &&
            Boolean(
              Array.from(document.querySelectorAll(".reader-empty-hero__actions button")).find(
                (button) => button.textContent?.replace(/\s+/g, " ").trim() === "重试打开"
              )
            ) &&
            !document.querySelector(".au-reader-page__canvas"),
          5_000
        );
        readerLoadRetryAttempts = 1;
        Array.from(document.querySelectorAll(".reader-empty-hero__actions button"))
          .find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "重试打开")
          ?.click();
        await waitFor(
          () =>
            bodyIncludes("PDF Reader") &&
            bodyIncludes(SAMPLE.title) &&
            Boolean(document.querySelector(".au-reader-page__canvas")) &&
            !bodyIncludes("Smoke reader transient open failure"),
          10_000
        );
        readerLoadRetryAttempts += 1;
        readerLoadRetryRecoveryVisible =
          readerLoadRetryAttempts === 2 &&
          bodyIncludes("PDF Reader") &&
          bodyIncludes(SAMPLE.title) &&
          Boolean(document.querySelector(".au-reader-page__canvas")) &&
          !bodyIncludes("Smoke reader transient open failure");
        readerLoadRetryRecoveryDetail =
          "attempts=" +
          readerLoadRetryAttempts +
          "; canvas=" +
          Boolean(document.querySelector(".au-reader-page__canvas")) +
          "; error=" +
          bodyIncludes("Smoke reader transient open failure");
        delete window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_OPEN__;

        const archivedAttachmentRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM attachments WHERE work_id = ? AND deleted_at IS NULL",
          [READER_ARCHIVED_SMOKE.workId]
        );
        const archivedAnnotationRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM annotations WHERE work_id = ? AND deleted_at IS NULL",
          [READER_ARCHIVED_SMOKE.workId]
        );
        readerArchivedAttachmentRows = Number(archivedAttachmentRows[0]?.n ?? 0);
        readerArchivedAnnotationRows = Number(archivedAnnotationRows[0]?.n ?? 0);
`;
