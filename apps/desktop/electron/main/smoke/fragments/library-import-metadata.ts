export const smokeLibraryImportMetadata = String.raw`        document.querySelector('[data-library-action="open-import"]')?.click();
        const quickImportDialog = await waitFor(
          () => document.querySelector('[data-library-dialog="import"]'),
          1_000
        );
        const quickAddInput = quickImportDialog?.querySelector("#library-import-identifier");
        if (quickAddInput) {
          setInputValue(quickAddInput, "Composition Smoke Title");
          const composingEnter = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter"
          });
          Object.defineProperty(composingEnter, "isComposing", {
            configurable: true,
            value: true
          });
          Object.defineProperty(composingEnter, "keyCode", {
            configurable: true,
            value: 229
          });
          quickAddInput.dispatchEvent(composingEnter);
          await wait(350);
          quickAddCompositionIgnored =
            composingEnter.defaultPrevented &&
            quickAddInput.value === "Composition Smoke Title" &&
            !quickAddInput.disabled &&
            !bodyIncludes("正在识别") &&
            Boolean(document.querySelector('[data-library-dialog="import"]'));
          setInputValue(quickAddInput, "");
        }
        quickImportDialog
          ?.querySelector('[data-library-action="close-import"]')
          ?.click();
        await waitFor(
          () => !document.querySelector('[data-library-dialog="import"]'),
          1_000
        );

        const quickDropTarget = await waitFor(
          () => document.querySelector('[data-library-dropzone="imports"]'),
          1_000
        );
        if (quickDropTarget) {
          const bibText = [
            "@article{dragdrop-smoke,",
            "  title = {Drag Import Smoke Test},",
            "  author = {Lovelace, Ada},",
            "  year = {2026},",
            "  doi = {10.4242/aurascholar.dragdrop}",
            "}"
          ].join("\n");
          const bibFile = new File([bibText], "drag-import.bib", { type: "text/plain" });
          const dropTransfer = new DataTransfer();
          dropTransfer.items.add(bibFile);
          dispatchDropEvent(quickDropTarget, "dragenter", dropTransfer);
          dispatchDropEvent(quickDropTarget, "dragover", dropTransfer);
          dispatchDropEvent(quickDropTarget, "drop", dropTransfer);
          await waitFor(
            () =>
              document
                .querySelector('[data-library-dialog="reference-import-preview"]')
                ?.textContent?.includes("已解析出")
                ? document.querySelector('[data-library-dialog="reference-import-preview"]')
                : null,
            3_000
          );
          const importDialog = document.querySelector(
            '[data-library-dialog="reference-import-preview"]'
          );
          const importText = importDialog?.textContent ?? "";
          quickDropImportPreviewVisible = importText.includes("已解析出") && importText.includes("1");
          quickDropImportCount = quickDropImportPreviewVisible ? 1 : null;
          const cancelButton = importDialog?.querySelector(
            '[data-library-action="cancel-reference-import"]'
          );
          cancelButton?.click();
          await waitFor(
            () => !document.querySelector('[data-library-dialog="reference-import-preview"]'),
            1_000
          );
        }

        const quickDropConfirmTarget = await waitFor(
          () => document.querySelector('[data-library-dropzone="imports"]'),
          1_000
        );
        if (quickDropConfirmTarget) {
          const failureImportDoiA = "10.4242/aurascholar.dragdrop-failure-a";
          const failureImportDoiB = "10.4242/aurascholar.dragdrop-failure-b";
          const failureImportBib = [
            "@article{dragdrop-failure-a,",
            "  title = {Drag Import Failure Alpha},",
            "  author = {Lovelace, Ada},",
            "  year = {2026},",
            "  doi = {" + failureImportDoiA + "}",
            "}",
            "",
            "@article{dragdrop-failure-b,",
            "  title = {Drag Import Failure Beta},",
            "  author = {Hopper, Grace},",
            "  year = {2026},",
            "  doi = {" + failureImportDoiB + "}",
            "}"
          ].join("\n");
          const failureImportFile = new File([failureImportBib], "drag-import-failure.bib", {
            type: "text/plain"
          });
          const failureDropTransfer = new DataTransfer();
          failureDropTransfer.items.add(failureImportFile);
          dispatchDropEvent(quickDropConfirmTarget, "dragenter", failureDropTransfer);
          dispatchDropEvent(quickDropConfirmTarget, "dragover", failureDropTransfer);
          dispatchDropEvent(quickDropConfirmTarget, "drop", failureDropTransfer);
          const failureImportDialog = await waitFor(() => {
            const dialog = document.querySelector(
              '[data-library-dialog="reference-import-preview"]'
            );
            return dialog?.textContent?.includes("已解析出") &&
              dialog.textContent?.includes("2")
              ? dialog
              : null;
          }, 3_000);
          const failureImportRowsBefore = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE doi IN (?, ?) AND deleted_at IS NULL AND works.library_id = ?",
            [failureImportDoiA, failureImportDoiB, libraryId]
          );
          await window.aura.db.exec("DROP TRIGGER IF EXISTS aurascholar_smoke_reference_import_failure");
          await window.aura.db.exec(
            "CREATE TEMP TRIGGER aurascholar_smoke_reference_import_failure BEFORE INSERT ON works WHEN NEW.doi = '10.4242/aurascholar.dragdrop-failure-b' BEGIN SELECT RAISE(FAIL, 'Smoke reference import rollback failure'); END;"
          );
          const failureImportButton = failureImportDialog?.querySelector(
            '[data-library-action="confirm-reference-import"]'
          );
          failureImportButton?.click();
          quickDropImportFailureBusyVisible = Boolean(
            await waitFor(() => {
              const dialog = document.querySelector(
                '[data-library-dialog="reference-import-preview"]'
              );
              const busyButton = dialog?.querySelector(
                '[data-library-action="confirm-reference-import"]'
              );
              return dialog?.getAttribute("aria-busy") === "true" &&
                busyButton?.disabled &&
                busyButton.textContent?.includes("导入中") &&
                dialog.textContent?.includes("正在导入题录")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("导入失败，当前文献库未写入部分导入，可重新导入") &&
              bodyIncludes("Smoke reference import rollback failure"),
            3_000
          );
          await window.aura.db.exec("DROP TRIGGER IF EXISTS aurascholar_smoke_reference_import_failure");
          const failureImportRowsAfter = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE doi IN (?, ?) AND deleted_at IS NULL AND works.library_id = ?",
            [failureImportDoiA, failureImportDoiB, libraryId]
          );
          const failureImportDialogAfter = document.querySelector(
            '[data-library-dialog="reference-import-preview"]'
          );
          const failureImportRetryButton = failureImportDialogAfter?.querySelector(
            '[data-library-action="confirm-reference-import"]'
          );
          quickDropImportFailureVisible =
            bodyIncludes("导入失败，当前文献库未写入部分导入，可重新导入") &&
            bodyIncludes("Smoke reference import rollback failure");
          quickDropImportFailureDidNotPersist =
            Number(failureImportRowsBefore[0]?.n ?? 0) === 0 &&
            Number(failureImportRowsAfter[0]?.n ?? 0) === 0;
          quickDropImportFailurePreserved =
            Boolean(failureImportDialogAfter) &&
            Boolean(failureImportRetryButton) &&
            !failureImportRetryButton?.disabled &&
            failureImportDialogAfter?.textContent?.includes("已解析出") &&
            failureImportDialogAfter.textContent?.includes("2");
          const failureImportCancelButton = failureImportDialogAfter?.querySelector(
            '[data-library-action="cancel-reference-import"]'
          );
          failureImportCancelButton?.click();
          await waitFor(
            () => !document.querySelector('[data-library-dialog="reference-import-preview"]'),
            1_000
          );

          const confirmImportDoi = "10.4242/aurascholar.dragdrop-confirm";
          const confirmImportPmid = "88004242";
          const confirmImportTitle = "Confirmed Drag Import Smoke Test";
          const confirmImportNbib = [
            "PMID- " + confirmImportPmid,
            "TI  - " + confirmImportTitle + ".",
            "FAU - Hopper, Grace",
            "DP  - 2026",
            "JT  - Aura Scholar Smoke Journal",
            "LID - " + confirmImportDoi + " [doi]",
            "AID - " + confirmImportDoi + " [doi]"
          ].join("\n");
          const confirmImportFile = new File([confirmImportNbib], "drag-import-confirm.nbib", {
            type: "text/plain"
          });
          const confirmDropTransfer = new DataTransfer();
          confirmDropTransfer.items.add(confirmImportFile);
          dispatchDropEvent(quickDropConfirmTarget, "dragenter", confirmDropTransfer);
          dispatchDropEvent(quickDropConfirmTarget, "dragover", confirmDropTransfer);
          dispatchDropEvent(quickDropConfirmTarget, "drop", confirmDropTransfer);
          const confirmImportDialog = await waitFor(() => {
            const dialog = document.querySelector(
              '[data-library-dialog="reference-import-preview"]'
            );
            return dialog?.textContent?.includes("已解析出") ? dialog : null;
          }, 3_000);
          const confirmImportButton = confirmImportDialog?.querySelector(
            '[data-library-action="confirm-reference-import"]'
          );
          confirmImportButton?.click();
          quickDropImportConfirmBusyVisible = Boolean(
            await waitFor(() => {
              const dialog = document.querySelector(
                '[data-library-dialog="reference-import-preview"]'
              );
              const busyButton = dialog?.querySelector(
                '[data-library-action="confirm-reference-import"]'
              );
              return dialog?.getAttribute("aria-busy") === "true" &&
                busyButton?.disabled &&
                busyButton.textContent?.includes("导入中") &&
                dialog.textContent?.includes("正在导入题录")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(() => bodyIncludes("导入完成:新增"), 4_000);
          quickDropImportConfirmSuccessVisible = bodyIncludes("导入完成:新增");
          const confirmImportRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n, MAX(pmid) AS pmid FROM works WHERE deleted_at IS NULL AND (doi = ? OR pmid = ? OR title = ? OR title LIKE ?) AND works.library_id = ?",
            [confirmImportDoi, confirmImportPmid, confirmImportTitle, "%" + confirmImportTitle + "%", libraryId]
          );
          quickDropImportConfirmPersisted = Number(confirmImportRows[0]?.n ?? 0) >= 1;
          quickDropImportConfirmPmidPersisted =
            String(confirmImportRows[0]?.pmid ?? "") === confirmImportPmid;
        }

        await waitFor(
          () => !document.querySelector('[data-library-dialog="reference-import-preview"]'),
          2_000
        );
        const smokeImportPdf = await waitFor(
          () => window.__AURASCHOLAR_SMOKE_IMPORT_PDF__,
          1_000
        );
        if (smokeImportPdf) {
          const importConfirmTitle = "AuraScholar Smoke PDF Import Confirm";
          const importConfirmFileName = importConfirmTitle + ".pdf";
          const importConfirmPdf = new File(
            [makeSmokePdf(importConfirmTitle)],
            importConfirmFileName,
            { type: "application/pdf" }
          );
          const importConfirmPromise = smokeImportPdf(importConfirmPdf).catch(() => {});
          const importConfirmDialog = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("确认入库")
            );
            return dialog?.textContent?.includes("PDF 附件") ? dialog : null;
          }, 8_000);
          quickImportConfirmDialogVisible = Boolean(importConfirmDialog);
          const confirmImportButton = Array.from(
            importConfirmDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "确认入库");
          await importConfirmPromise;
          confirmImportButton?.click();
          quickImportConfirmCommitBusyVisible = Boolean(
            await waitFor(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("确认入库")
              );
              const busyButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
                (button) => button.getAttribute("aria-busy") === "true"
              );
              const selectedOption = dialog?.querySelector('input[name="import-selection"]:checked');
              return dialog?.getAttribute("aria-busy") === "true" &&
                busyButton?.disabled &&
                busyButton.textContent?.includes("入库中") &&
                selectedOption?.disabled &&
                dialog.textContent?.includes("正在确认入库")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(() => bodyIncludes("已入库:"), 4_000);
          const importConfirmRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works w JOIN attachments a ON a.work_id = w.id WHERE w.deleted_at IS NULL AND a.deleted_at IS NULL AND a.original_filename = ? AND w.title = ? AND w.library_id = ?",
            [importConfirmFileName, importConfirmTitle, libraryId]
          );
          quickImportConfirmCommitPersisted = Number(importConfirmRows[0]?.n ?? 0) >= 1;
        }

        clickRowByTitle(SAMPLE.title);
        await waitFor(
          () => (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(SAMPLE.title),
          2_000
        );
        const metadataBeforeRows = await window.aura.db.query(
          "SELECT year FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
          [SAMPLE.workId, libraryId]
        );
        const metadataEditButton = Array.from(
          document.querySelectorAll(".library-inspector__summary .library-panel-actions button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "编辑");
        metadataEditButton?.click();
        const yearInput = await waitFor(() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
            item.textContent?.includes("编辑文献元信息")
          );
          const yearLabel = Array.from(dialog?.querySelectorAll("label") ?? []).find((label) =>
            label.textContent?.includes("年份 Year")
          );
          return yearLabel?.querySelector("input") ?? null;
        }, 5_000);
        const metadataDialog = yearInput?.closest('[role="dialog"]');
        if (yearInput && metadataDialog) {
          setInputValue(yearInput, "20O6");
          await waitFor(() => yearInput.value === "20O6", 1_000);
          const saveMetadataButton = Array.from(metadataDialog.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存"
          );
          saveMetadataButton?.click();
          const yearError = await waitFor(
            () =>
              Array.from(metadataDialog.querySelectorAll('[role="alert"]')).find((item) =>
                item.textContent?.includes("年份必须是四位数字")
              ) ?? null,
            2_000
          );
          const metadataAfterRows = await window.aura.db.query(
            "SELECT year FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
            [SAMPLE.workId, libraryId]
          );
          metadataInvalidYearErrorVisible = Boolean(yearError);
          metadataInvalidYearBlocked = Boolean(
            Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("编辑文献元信息")
            )
          );
          metadataInvalidYearPreserved =
            metadataBeforeRows.length > 0 &&
            metadataAfterRows.length > 0 &&
            Number(metadataAfterRows[0]?.year ?? 0) === Number(metadataBeforeRows[0]?.year ?? 0);
          setInputValue(yearInput, String(metadataBeforeRows[0]?.year ?? ""));
          await waitFor(
            () =>
              !Array.from(metadataDialog.querySelectorAll('[role="alert"]')).some((item) =>
                item.textContent?.includes("年份必须是四位数字")
              ),
            1_000
          );
          const labelInput = Array.from(metadataDialog.querySelectorAll("label")).find((label) =>
            label.textContent?.includes("标记 Label")
          )?.querySelector("input");
          const metadataCloseButton = () =>
            Array.from(metadataDialog.querySelectorAll("button")).find(
              (button) =>
                button.classList.contains("library-modal__close") ||
                (button.getAttribute("aria-label") ?? "").startsWith("关闭")
            );
          const metadataProtectedLabel = "smoke-metadata-discard-protected-" + Date.now();
          if (labelInput) {
            setInputValue(labelInput, metadataProtectedLabel);
            await waitFor(() => labelInput.value === metadataProtectedLabel, 1_000);
          }
          metadataCloseButton()?.click();
          const metadataDiscardDialog = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("放弃元数据修改吗？")
            );
            return dialog ?? null;
          }, 2_000);
          const metadataContinueEditingButton = Array.from(
            metadataDiscardDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "继续编辑");
          metadataContinueEditingButton?.click();
          await waitFor(
            () =>
              bodyIncludes("已继续编辑，未保存修改仍在。") &&
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("放弃元数据修改吗？")
              ) &&
              Boolean(
                Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                  item.textContent?.includes("编辑文献元信息")
                )
              ) &&
              labelInput?.value === metadataProtectedLabel,
            2_000
          );
          const metadataProtectedRows = await window.aura.db.query(
            "SELECT label FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
            [SAMPLE.workId, libraryId]
          );
          metadataDiscardCancelPreserved =
            bodyIncludes("已继续编辑，未保存修改仍在。") &&
            labelInput?.value === metadataProtectedLabel &&
            metadataProtectedRows[0]?.label !== metadataProtectedLabel;
          const validSaveMetadataButton = Array.from(metadataDialog.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存"
          );
          const metadataFailureLabel = "smoke-metadata-save-failure-" + Date.now();
          if (labelInput) {
            setInputValue(labelInput, metadataFailureLabel);
            await waitFor(() => labelInput.value === metadataFailureLabel, 1_000);
          }
          window.__AURASCHOLAR_SMOKE_METADATA_FAIL_NEXT_SAVE__ = "Smoke metadata save failure";
          validSaveMetadataButton?.click();
          const metadataFailureAlert = await waitFor(
            () =>
              Array.from(metadataDialog.querySelectorAll('[role="alert"]')).find((item) => {
                const text = item.textContent ?? "";
                return (
                  text.includes("保存失败，修改仍保留") &&
                  text.includes("Smoke metadata save failure")
                );
              }) ?? null,
            2_000
          );
          delete window.__AURASCHOLAR_SMOKE_METADATA_FAIL_NEXT_SAVE__;
          const metadataFailureRows = await window.aura.db.query(
            "SELECT label FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
            [SAMPLE.workId, libraryId]
          );
          metadataSaveFailureVisible = Boolean(metadataFailureAlert);
          metadataSaveFailurePreserved =
            Boolean(
              Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("编辑文献元信息")
              )
            ) &&
            labelInput?.value === metadataFailureLabel &&
            Boolean(validSaveMetadataButton && !validSaveMetadataButton.disabled);
          metadataSaveFailureDidNotPersist = metadataFailureRows[0]?.label !== metadataFailureLabel;
          const metadataSavedLabel = "smoke-metadata-saved";
          if (labelInput) {
            setInputValue(labelInput, metadataSavedLabel);
            await waitFor(() => labelInput.value === metadataSavedLabel, 1_000);
          }
          validSaveMetadataButton?.click();
          await waitFor(
            () =>
              metadataDialog.getAttribute("aria-busy") === "true" &&
              validSaveMetadataButton?.disabled &&
              validSaveMetadataButton.getAttribute("aria-busy") === "true" &&
              validSaveMetadataButton.textContent?.includes("保存中") &&
              metadataCloseButton()?.disabled &&
              Boolean(labelInput?.disabled),
            1_000
          );
          metadataSaveBusyVisible =
            metadataDialog.getAttribute("aria-busy") === "true" &&
            Boolean(validSaveMetadataButton?.disabled) &&
            validSaveMetadataButton?.getAttribute("aria-busy") === "true" &&
            Boolean(validSaveMetadataButton?.textContent?.includes("保存中")) &&
            Boolean(metadataCloseButton()?.disabled) &&
            Boolean(labelInput?.disabled);
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("编辑文献元信息")
              ),
            2_000
          );
          const metadataSavedRows = await window.aura.db.query(
            "SELECT label FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
            [SAMPLE.workId, libraryId]
          );
          metadataSavePersisted = metadataSavedRows[0]?.label === metadataSavedLabel;
        }

`;
