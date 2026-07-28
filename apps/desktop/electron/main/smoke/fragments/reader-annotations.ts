export const smokeReaderAnnotations = String.raw`        location.hash = "#/reader?work=" + encodeURIComponent(SAMPLE.workId);
        await waitFor(() => location.hash.includes("/reader") && bodyIncludes("PDF Reader"), 10_000);
        await waitFor(
          () =>
            bodyIncludes(SAMPLE.title) &&
            bodyIncludes("已入库") &&
            bodyIncludes("1 页") &&
            Boolean(document.querySelector(".au-reader-page__canvas")),
          10_000
        );
        readerAutoReadingStatusPersisted = Boolean(
          await waitFor(async () => {
            const rows = await window.aura.db.query(
              "SELECT reading_status FROM works WHERE id = ? AND works.library_id = ? LIMIT 1",
              [SAMPLE.workId, libraryId]
            );
            return rows[0]?.reading_status === "reading";
          }, 3_000)
        );
        readerHash = location.hash;
        readerTitleVisible = bodyIncludes(SAMPLE.title);
        readerPageBadgeVisible = bodyIncludes("PDF Reader") && bodyIncludes("1 页") && bodyIncludes("已入库");
        readerCanvasVisible = Boolean(document.querySelector(".au-reader-page__canvas"));
        readerErrorVisible =
          bodyIncludes("这篇文献还没有 PDF 附件") ||
          bodyIncludes("读取 PDF 失败") ||
          bodyIncludes("无法打开阅读器");

        const smokeTextSpan = await waitFor(() => {
          const span = document.querySelector(".au-reader-page__text span");
          return span?.textContent?.includes("AuraScholar Smoke PDF") ? span : null;
        }, 3_000);
        if (smokeTextSpan?.firstChild && smokeTextSpan.textContent) {
          const range = document.createRange();
          const selectedLength = Math.min(smokeTextSpan.textContent.length, "AuraScholar Smoke PDF".length);
          if (selectedLength > 0) {
            range.setStart(smokeTextSpan.firstChild, 0);
            range.setEnd(smokeTextSpan.firstChild, selectedLength);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            smokeTextSpan.dispatchEvent(
              new MouseEvent("mouseup", { bubbles: true, cancelable: true })
            );
            const selectionToolbarButton = (predicate) =>
              Array.from(document.querySelectorAll(".au-reader__selection-toolbar button")).find(
                predicate
              );
            const selectionToolbarPreserved = () =>
              Boolean(document.querySelector(".au-reader__selection-toolbar")) &&
              Boolean(
                selectionToolbarButton((button) =>
                  button.getAttribute("title")?.includes("写作素材")
                )
              ) &&
              Boolean(
                selectionToolbarButton(
                  (button) =>
                    button.classList.contains("au-reader__swatch") ||
                    button.getAttribute("title")?.includes("高亮")
                )
              );
            await waitFor(
              () =>
                selectionToolbarButton((button) => button.getAttribute("title")?.includes("写作素材")),
              2_000
            );
            const annotationRowsBeforeCreateFailure = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM annotations WHERE work_id = ? AND deleted_at IS NULL",
              [SAMPLE.workId]
            );
            window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_CREATE__ =
              "Smoke reader annotation create failure";
            const annotationCreateFailureButton = await waitFor(
              () =>
                selectionToolbarButton(
                  (button) =>
                    button.classList.contains("au-reader__swatch") ||
                    button.getAttribute("title")?.includes("高亮")
                ),
              1_000
            );
            annotationCreateFailureButton?.click();
            readerAnnotationCreateFailureBusyVisible = Boolean(
              await waitFor(() => {
                const busyButton = selectionToolbarButton(
                  (button) =>
                    button.getAttribute("aria-busy") === "true" &&
                    button.getAttribute("title")?.includes("保存批注")
                );
                return busyButton?.disabled && bodyIncludes("正在保存批注") ? busyButton : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("保存批注失败，选区仍保留，可重新保存") &&
                bodyIncludes("Smoke reader annotation create failure"),
              3_000
            );
            delete window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_CREATE__;
            const annotationRowsAfterCreateFailure = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM annotations WHERE work_id = ? AND deleted_at IS NULL",
              [SAMPLE.workId]
            );
            readerAnnotationCreateFailureVisible =
              bodyIncludes("保存批注失败，选区仍保留，可重新保存") &&
              bodyIncludes("Smoke reader annotation create failure");
            readerAnnotationCreateFailureDidNotPersist =
              Number(annotationRowsAfterCreateFailure[0]?.n ?? -1) ===
              Number(annotationRowsBeforeCreateFailure[0]?.n ?? -2);
            readerAnnotationCreateFailurePreserved =
              readerAnnotationCreateFailureVisible && selectionToolbarPreserved();

            const snippetRowsBeforeFailure = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM snippets WHERE work_id = ? AND quote LIKE ? AND deleted_at IS NULL",
              [SAMPLE.workId, "%AuraScholar Smoke PDF%"]
            );
            window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_SNIPPET_SAVE__ =
              "Smoke reader snippet save failure";
            const snippetSaveFailureButton = await waitFor(
              () =>
                selectionToolbarButton((button) =>
                  button.getAttribute("title")?.includes("写作素材")
                ),
              1_000
            );
            snippetSaveFailureButton?.click();
            readerSnippetSaveFailureBusyVisible = Boolean(
              await waitFor(() => {
                const busyButton = selectionToolbarButton(
                  (button) =>
                    button.getAttribute("aria-busy") === "true" &&
                    button.getAttribute("title")?.includes("写作素材")
                );
                return busyButton?.disabled && bodyIncludes("正在保存为写作素材") ? busyButton : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("保存写作素材失败，选中文本仍保留，可重新保存") &&
                bodyIncludes("Smoke reader snippet save failure"),
              3_000
            );
            delete window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_SNIPPET_SAVE__;
            const snippetRowsAfterFailure = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM snippets WHERE work_id = ? AND quote LIKE ? AND deleted_at IS NULL",
              [SAMPLE.workId, "%AuraScholar Smoke PDF%"]
            );
            readerSnippetSaveFailureVisible =
              bodyIncludes("保存写作素材失败，选中文本仍保留，可重新保存") &&
              bodyIncludes("Smoke reader snippet save failure");
            readerSnippetSaveFailureDidNotPersist =
              Number(snippetRowsAfterFailure[0]?.n ?? -1) ===
              Number(snippetRowsBeforeFailure[0]?.n ?? -2);
            readerSnippetSaveFailurePreserved =
              readerSnippetSaveFailureVisible && selectionToolbarPreserved();

            const snippetSaveButton = await waitFor(
              () =>
                selectionToolbarButton((button) =>
                  button.getAttribute("title")?.includes("写作素材")
                ),
              2_000
            );
            snippetSaveButton?.click();
            readerSnippetSaveBusyVisible = Boolean(
              await waitFor(() => {
                const busyButton = selectionToolbarButton(
                  (button) =>
                    button.getAttribute("aria-busy") === "true" &&
                    button.getAttribute("title")?.includes("写作素材")
                );
                return busyButton?.disabled && bodyIncludes("正在保存为写作素材") ? busyButton : null;
              }, 1_000)
            );
            await waitFor(() => bodyIncludes("已存为写作素材"), 3_000);
            const savedSnippetCount = await window.aura?.db?.queryScalar?.(
              "SELECT COUNT(*) FROM snippets WHERE work_id = 'smoke-work-extreme-c-ux' AND quote LIKE '%AuraScholar Smoke PDF%' AND deleted_at IS NULL"
            );
            readerSnippetSavePersisted = Number(savedSnippetCount) >= 1;
          }
        }

        await waitFor(
          () =>
            bodyIncludes("Smoke reader note for delete confirmation.") &&
            Boolean(document.querySelector(".au-annsidebar__action")),
          3_000
        );
        const annotationComment = document.querySelector(".au-annsidebar__comment");
        annotationComment?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        const commentEditor = await waitFor(
          () => document.querySelector(".au-annsidebar__editor"),
          2_000
        );
        if (commentEditor) {
          const draftText = "Smoke reader note draft protected by discard confirmation.";
          setInputValue(commentEditor, draftText);
          await waitFor(
            () =>
              document.querySelector(".au-annsidebar__editor")?.value === draftText &&
              bodyIncludes("未保存"),
            1_000
          );
          let exportCreateObjectUrlCalled = false;
          const originalCreateObjectUrl = URL.createObjectURL;
          try {
            URL.createObjectURL = (...args) => {
              exportCreateObjectUrlCalled = true;
              return originalCreateObjectUrl.apply(URL, args);
            };
            const exportNotesButton = Array.from(document.querySelectorAll("button")).find(
              (button) => button.textContent?.replace(/\s+/g, " ").trim() === "导出笔记"
            );
            exportNotesButton?.click();
            await waitFor(() => bodyIncludes("请先保存批注评论草稿，再导出笔记。"), 1_000);
            readerCommentDirtyExportMessageVisible = bodyIncludes(
              "请先保存批注评论草稿，再导出笔记。"
            );
            readerCommentDirtyExportDownloadPrevented = !exportCreateObjectUrlCalled;
            readerCommentDirtyExportBlocked =
              readerCommentDirtyExportMessageVisible && readerCommentDirtyExportDownloadPrevented;
          } finally {
            URL.createObjectURL = originalCreateObjectUrl;
          }
          const composingCommentSave = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
            metaKey: true
          });
          Object.defineProperty(composingCommentSave, "isComposing", {
            configurable: true,
            value: true
          });
          commentEditor.dispatchEvent(composingCommentSave);
          await wait(150);
          const composingCommentEscape = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Escape"
          });
          Object.defineProperty(composingCommentEscape, "isComposing", {
            configurable: true,
            value: true
          });
          commentEditor.dispatchEvent(composingCommentEscape);
          await wait(150);
          readerCommentShortcutCompositionIgnored =
            document.querySelector(".au-annsidebar__editor")?.value === draftText &&
            bodyIncludes("未保存") &&
            !document.querySelector('[role="dialog"]');
          const cancelDraftButton = Array.from(
            document.querySelectorAll(".au-annsidebar__editor-actions button")
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
          cancelDraftButton?.click();
          const draftDialog = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("放弃批注评论草稿？") ? dialog : null;
          }, 3_000);
          readerCommentDraftConfirmVisible = Boolean(
            draftDialog?.textContent?.includes("当前草稿不会写入文献库")
          );
          const keepEditingButton = Array.from(
            draftDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "继续编辑");
          keepEditingButton?.click();
          await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
          readerCommentDraftCancelPreserved =
            readerCommentDraftConfirmVisible &&
            document.querySelector(".au-annsidebar__editor")?.value === draftText &&
            bodyIncludes("未保存");
          const cancelDraftAgainButton = Array.from(
            document.querySelectorAll(".au-annsidebar__editor-actions button")
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
          cancelDraftAgainButton?.click();
          const discardDialog = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("放弃批注评论草稿？") ? dialog : null;
          }, 3_000);
          const discardDraftButton = Array.from(
            discardDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "放弃草稿");
          discardDraftButton?.click();
          await waitFor(
            () =>
              !document.querySelector(".au-annsidebar__editor") &&
              bodyIncludes("Smoke reader note for delete confirmation."),
            2_000
          );
          readerCommentDraftDiscarded =
            !document.querySelector(".au-annsidebar__editor") &&
            bodyIncludes("Smoke reader note for delete confirmation.");
        }
        const annotationDeleteButton = document.querySelector(".au-annsidebar__action");
        annotationDeleteButton?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
        const annotationDeleteDialog = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("删除这条批注？") ? dialog : null;
        }, 3_000);
        readerAnnotationDeleteConfirmVisible = Boolean(
          annotationDeleteDialog?.textContent?.includes("已入库批注会从文献库中移除")
        );
        const cancelAnnotationDeleteButton = Array.from(
          annotationDeleteDialog?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
        cancelAnnotationDeleteButton?.click();
        await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
        readerAnnotationDeleteCancelPreserved =
          readerAnnotationDeleteConfirmVisible &&
          bodyIncludes("Smoke reader note for delete confirmation.") &&
          bodyIncludes("批注 1");

        const savedCommentText = "Smoke reader note saved with busy feedback.";
        const annotationCommentAfterCancel = document.querySelector(".au-annsidebar__comment");
        annotationCommentAfterCancel?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
        const saveCommentEditor = await waitFor(
          () => document.querySelector(".au-annsidebar__editor"),
          2_000
        );
        if (saveCommentEditor) {
          const failedCommentText = "Smoke reader comment save failure keeps draft.";
          const commentBeforeFailure = await window.aura?.db?.queryScalar?.(
            "SELECT content_md FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm'"
          );
          setInputValue(saveCommentEditor, failedCommentText);
          await waitFor(
            () =>
              document.querySelector(".au-annsidebar__editor")?.value === failedCommentText &&
              bodyIncludes("未保存"),
            1_000
          );
          window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_COMMENT_SAVE__ =
            "Smoke reader comment save failure";
          const failSaveCommentButton = Array.from(
            document.querySelectorAll(".au-annsidebar__editor-actions button")
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存");
          failSaveCommentButton?.click();
          const preservedCommentEditor = await waitFor(() => {
            const editor = document.querySelector(".au-annsidebar__editor");
            const saveButton = Array.from(
              document.querySelectorAll(".au-annsidebar__editor-actions button")
            ).find(
              (button) =>
                button.textContent?.replace(/\s+/g, " ").trim() === "保存" && !button.disabled
            );
            return bodyIncludes("保存评论失败，草稿仍保留，可重新保存") &&
              bodyIncludes("Smoke reader comment save failure") &&
              editor?.value === failedCommentText &&
              Boolean(saveButton)
              ? editor
              : null;
          }, 3_000);
          delete window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_COMMENT_SAVE__;
          const commentAfterFailure = await window.aura?.db?.queryScalar?.(
            "SELECT content_md FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm'"
          );
          readerCommentSaveFailureVisible =
            bodyIncludes("保存评论失败，草稿仍保留，可重新保存") &&
            bodyIncludes("Smoke reader comment save failure");
          readerCommentSaveFailurePreserved =
            Boolean(preservedCommentEditor) &&
            preservedCommentEditor.value === failedCommentText;
          readerCommentSaveFailureDidNotPersist = commentAfterFailure === commentBeforeFailure;
          setInputValue(saveCommentEditor, savedCommentText);
          await waitFor(
            () =>
              document.querySelector(".au-annsidebar__editor")?.value === savedCommentText &&
              bodyIncludes("未保存"),
            1_000
          );
          const saveCommentButton = Array.from(
            document.querySelectorAll(".au-annsidebar__editor-actions button")
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存");
          saveCommentButton?.click();
          readerCommentSaveBusyVisible = Boolean(
            await waitFor(() => {
              const busySaveButton = Array.from(
                document.querySelectorAll(".au-annsidebar__editor-actions button")
              ).find((button) => button.getAttribute("aria-busy") === "true");
              return busySaveButton?.disabled &&
                busySaveButton.textContent?.includes("保存中") &&
                bodyIncludes("保存中")
                ? busySaveButton
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("批注评论已保存") &&
              bodyIncludes(savedCommentText) &&
              !document.querySelector(".au-annsidebar__editor"),
            3_000
          );
          const savedComment = await window.aura?.db?.queryScalar?.(
            "SELECT content_md FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm'"
          );
          readerCommentSavePersisted = savedComment === savedCommentText && bodyIncludes(savedCommentText);
        }

        const readerAnnotationDeleteButton = () =>
          document.querySelector(".au-annsidebar__action");
        const clickConfirmReaderAnnotationDelete = async () => {
          const dialog = await waitFor(() => {
            const candidate = document.querySelector('[role="dialog"]');
            return candidate?.textContent?.includes("删除这条批注？") ? candidate : null;
          }, 3_000);
          const confirmButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除批注"
          );
          confirmButton?.click();
        };
        const annotationCountBeforeDeleteFailure = await window.aura?.db?.queryScalar?.(
          "SELECT COUNT(*) FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm' AND deleted_at IS NULL"
        );
        const annotationDeleteButtonForFailure = readerAnnotationDeleteButton();
        annotationDeleteButtonForFailure?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
        window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_DELETE__ =
          READER_ANNOTATION_DELETE_FAILURE_SMOKE.error;
        await clickConfirmReaderAnnotationDelete();
        readerAnnotationDeleteFailureBusyVisible = Boolean(
          await waitFor(() => {
            const item = document.querySelector(".au-annsidebar__item");
            const deleteButton = readerAnnotationDeleteButton();
            return item?.getAttribute("aria-busy") === "true" &&
              deleteButton?.getAttribute("aria-busy") === "true" &&
              deleteButton.disabled &&
              deleteButton.textContent?.includes("…")
              ? deleteButton
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("删除批注失败，批注仍保留，可重新删除") &&
            bodyIncludes(READER_ANNOTATION_DELETE_FAILURE_SMOKE.error),
          3_000
        );
        delete window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_DELETE__;
        const annotationCountAfterDeleteFailure = await window.aura?.db?.queryScalar?.(
          "SELECT COUNT(*) FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm' AND deleted_at IS NULL"
        );
        readerAnnotationDeleteFailureVisible =
          bodyIncludes("删除批注失败，批注仍保留，可重新删除") &&
          bodyIncludes(READER_ANNOTATION_DELETE_FAILURE_SMOKE.error);
        readerAnnotationDeleteFailureDidNotPersist =
          Number(annotationCountBeforeDeleteFailure) === 1 &&
          Number(annotationCountAfterDeleteFailure) === 1;
        readerAnnotationDeleteFailurePreserved =
          bodyIncludes("批注 1") &&
          bodyIncludes(savedCommentText) &&
          Boolean(readerAnnotationDeleteButton()) &&
          !document.querySelector('button[aria-label="撤销删除批注"]');

        const annotationDeleteButtonForBusy = readerAnnotationDeleteButton();
        annotationDeleteButtonForBusy?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
        await clickConfirmReaderAnnotationDelete();
        readerAnnotationDeleteBusyVisible = Boolean(
          await waitFor(() => {
            const item = document.querySelector(".au-annsidebar__item");
            const deleteButton = readerAnnotationDeleteButton();
            return item?.getAttribute("aria-busy") === "true" &&
              deleteButton?.getAttribute("aria-busy") === "true" &&
              deleteButton.disabled &&
              deleteButton.textContent?.includes("…")
              ? deleteButton
              : null;
          }, 1_000)
        );
        await waitFor(
          () => bodyIncludes("已删除批注") && bodyIncludes("批注 0") && !bodyIncludes(savedCommentText),
          3_000
        );
        const remainingAnnotationCount = await window.aura?.db?.queryScalar?.(
          "SELECT COUNT(*) FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm' AND deleted_at IS NULL"
        );
        readerAnnotationDeleteSuccessVisible =
          Number(remainingAnnotationCount) === 0 &&
          bodyIncludes("已删除批注") &&
          bodyIncludes("批注 0");
        const undoAnnotationDeleteButton = await waitFor(
          () => document.querySelector('button[aria-label="撤销删除批注"]'),
          1_000
        );
        window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_RESTORE__ =
          READER_ANNOTATION_RESTORE_FAILURE_SMOKE.error;
        undoAnnotationDeleteButton?.click();
        readerAnnotationDeleteUndoFailureBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销删除批注"]');
            return button?.getAttribute("aria-busy") === "true" &&
              button.disabled &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销删除批注")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("撤销删除批注失败，撤销入口仍保留，可重新撤销") &&
            bodyIncludes(READER_ANNOTATION_RESTORE_FAILURE_SMOKE.error),
          3_000
        );
        delete window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_RESTORE__;
        const annotationCountAfterUndoFailure = await window.aura?.db?.queryScalar?.(
          "SELECT COUNT(*) FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm' AND deleted_at IS NULL"
        );
        const undoAnnotationDeleteButtonAfterFailure = document.querySelector(
          'button[aria-label="撤销删除批注"]'
        );
        readerAnnotationDeleteUndoFailureVisible =
          bodyIncludes("撤销删除批注失败，撤销入口仍保留，可重新撤销") &&
          bodyIncludes(READER_ANNOTATION_RESTORE_FAILURE_SMOKE.error);
        readerAnnotationDeleteUndoFailureDidNotPersist =
          Number(annotationCountAfterUndoFailure) === 0;
        readerAnnotationDeleteUndoFailurePreserved =
          Boolean(undoAnnotationDeleteButtonAfterFailure) &&
          !undoAnnotationDeleteButtonAfterFailure?.disabled &&
          bodyIncludes("批注 0") &&
          !bodyIncludes(savedCommentText);
        undoAnnotationDeleteButtonAfterFailure?.click();
        readerAnnotationDeleteUndoBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销删除批注"]');
            return button?.getAttribute("aria-busy") === "true" &&
              button.disabled &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销删除批注")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("已撤销删除批注") &&
            bodyIncludes("批注 1") &&
            bodyIncludes(savedCommentText),
          3_000
        );
        const restoredAnnotationCount = await window.aura?.db?.queryScalar?.(
          "SELECT COUNT(*) FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm' AND deleted_at IS NULL"
        );
        readerAnnotationDeleteUndoRecovered =
          Number(restoredAnnotationCount) === 1 &&
          bodyIncludes("已撤销删除批注") &&
          bodyIncludes("批注 1") &&
          bodyIncludes(savedCommentText);
        const readerAnnotationToastAutoDismissed = Boolean(
          await waitFor(() => !document.querySelector(".reader-toast"), 4_000)
        );
        readerAnnotationDeleteUndoRecovered =
          readerAnnotationDeleteUndoRecovered && readerAnnotationToastAutoDismissed;

`;
