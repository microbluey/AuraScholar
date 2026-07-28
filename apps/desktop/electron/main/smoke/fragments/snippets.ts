export const smokeSnippets = String.raw`        location.hash = "#/snippets";
        await waitFor(
          () =>
            location.hash.includes("/snippets") &&
            bodyIncludes("写作素材") &&
            bodyIncludes("写作素材暂时不可用") &&
            bodyIncludes("Smoke snippets initial load failure") &&
            Boolean(document.querySelector('button[aria-label="重试读取写作素材"]')),
          5_000
        );
        snippetLoadRetryAttempts = 1;
        document.querySelector('button[aria-label="重试读取写作素材"]')?.click();
        await waitFor(
          () =>
            bodyIncludes(SNIPPET_SMOKE.quote) &&
            !bodyIncludes("写作素材暂时不可用") &&
            !bodyIncludes("Smoke snippets initial load failure"),
          5_000
        );
        snippetLoadRetryAttempts += 1;
        snippetLoadRetryRecoveryVisible =
          snippetLoadRetryAttempts === 2 &&
          bodyIncludes(SNIPPET_SMOKE.quote) &&
          !bodyIncludes("写作素材暂时不可用") &&
          !bodyIncludes("Smoke snippets initial load failure");
        snippetLoadRetryRecoveryDetail =
          "attempts=" +
          snippetLoadRetryAttempts +
          "; quote=" +
          bodyIncludes(SNIPPET_SMOKE.quote) +
          "; error=" +
          bodyIncludes("写作素材暂时不可用");
        delete window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_READ__;
        const snippetRaceQuote = "Smoke snippet race quote newer refresh wins";
        window.__AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_DELAY_MS__ = 450;
        window.__AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_COUNT__ = 0;
        window.dispatchEvent(new Event("aurascholar:snippets-updated"));
        await waitFor(
          () => Number(window.__AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_COUNT__ ?? 0) >= 1,
          1_000
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO snippets (id, work_id, page_index, quote, note_md, tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            "smoke-snippet-refresh-race",
            SAMPLE.workId,
            0,
            snippetRaceQuote,
            null,
            "smoke",
            Date.now(),
            Date.now()
          ]
        );
        window.__AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_DELAY_MS__ = 0;
        window.dispatchEvent(new Event("aurascholar:snippets-updated"));
        await waitFor(() => bodyIncludes(snippetRaceQuote), 2_000);
        await wait(650);
        snippetRefreshRacePreserved =
          bodyIncludes(SNIPPET_SMOKE.quote) &&
          bodyIncludes(snippetRaceQuote) &&
          !bodyIncludes("正在读取写作素材");
        delete window.__AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_DELAY_MS__;
        delete window.__AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_COUNT__;

        const snippetsSearchInput = document.querySelector('input[aria-label="搜索写作素材"]');
        if (snippetsSearchInput) {
          setInputValue(snippetsSearchInput, "no matching smoke snippet");
          await waitFor(
            () =>
              bodyIncludes("当前筛选没有素材") &&
              Boolean(document.querySelector('button[aria-label="清空素材筛选"]')),
            1_000
          );
          document.querySelector('button[aria-label="清空素材筛选"]')?.click();
          snippetFilterEmptyActionRestoresResults = Boolean(
            await waitFor(
              () =>
                snippetsSearchInput.value === "" &&
                document.activeElement === snippetsSearchInput &&
                bodyIncludes(SNIPPET_SMOKE.quote) &&
                bodyIncludes(snippetRaceQuote) &&
                !bodyIncludes("当前筛选没有素材"),
              1_000
            )
          );
        }

        const snippetCard = Array.from(document.querySelectorAll(".snippet-card")).find((card) =>
          card.textContent?.includes(SNIPPET_SMOKE.quote)
        );
        const editSnippetNoteButton = Array.from(snippetCard?.querySelectorAll("button") ?? []).find(
          (button) => /加批注|编辑批注/.test(button.textContent ?? "")
        );
        editSnippetNoteButton?.click();
        const snippetEditor = await waitFor(
          () => snippetCard?.querySelector(".snippet-card__note-edit textarea"),
          2_000
        );
        if (snippetEditor) {
          const useMetaShortcut = isMacShortcut();
          setInputValue(snippetEditor, SNIPPET_SMOKE.noteDraft);
          await waitFor(() => snippetEditor.value === SNIPPET_SMOKE.noteDraft, 1_000);
          await waitFor(() => bodyIncludes("批注草稿尚未保存"), 1_000);
          const snippetClipboardSentinel = "aurascholar-snippet-dirty-copy-sentinel";
          if (window.aura?.clipboard?.writeText && window.aura?.clipboard?.readText) {
            await window.aura.clipboard.writeText(snippetClipboardSentinel);
          }
          const copyVisibleSnippetsButton = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "复制可见素材"
          );
          copyVisibleSnippetsButton?.click();
          await waitFor(() => bodyIncludes("请先保存批注草稿，再复制可见素材。"), 1_000);
          snippetDirtyCopyMessageVisible = bodyIncludes("请先保存批注草稿，再复制可见素材。");
          if (window.aura?.clipboard?.readText) {
            const clipboardText = await window.aura.clipboard.readText();
            snippetDirtyCopyClipboardPreserved = clipboardText === snippetClipboardSentinel;
          } else {
            snippetDirtyCopyClipboardPreserved = snippetDirtyCopyMessageVisible;
          }
          snippetDirtyCopyBlocked =
            snippetDirtyCopyMessageVisible && snippetDirtyCopyClipboardPreserved;
          snippetEditor.focus?.();

          const composingSaveEvent = defineKeyboardCode(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              code: "Enter",
              ctrlKey: !useMetaShortcut,
              key: "Enter",
              metaKey: useMetaShortcut
            }),
            13
          );
          Object.defineProperty(composingSaveEvent, "isComposing", {
            configurable: true,
            value: true
          });
          snippetEditor.dispatchEvent(composingSaveEvent);
          await wait(150);
          snippetSaveCompositionIgnored =
            Boolean(document.querySelector(".snippet-card__note-edit textarea")) &&
            !bodyIncludes("批注已保存");

          const composingEscapeEvent = defineKeyboardCode(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              code: "Escape",
              key: "Escape"
            }),
            27
          );
          Object.defineProperty(composingEscapeEvent, "isComposing", {
            configurable: true,
            value: true
          });
          snippetEditor.dispatchEvent(composingEscapeEvent);
          await wait(150);
          snippetEscapeCompositionIgnored =
            Boolean(document.querySelector(".snippet-card__note-edit textarea")) &&
            !Array.from(document.querySelectorAll('[role="dialog"]')).some((dialog) =>
              dialog.textContent?.includes("放弃这条批注草稿吗")
            );

          const snippetSaveFailureRowsBefore = await window.aura.db.query(
            "SELECT note_md FROM snippets WHERE id = ?",
            [SNIPPET_SMOKE.id]
          );
          window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_SAVE__ =
            "Smoke snippets note save failure";
          const failureSnippetEditor = document.querySelector(".snippet-card__note-edit textarea");
          failureSnippetEditor?.focus?.();
          if (failureSnippetEditor) {
            const failureSaveEvent = defineKeyboardCode(
              new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                code: "Enter",
                ctrlKey: !useMetaShortcut,
                key: "Enter",
                metaKey: useMetaShortcut
              }),
              13
            );
            failureSnippetEditor.dispatchEvent(failureSaveEvent);
          }
          const preservedSnippetEditor = await waitFor(() => {
            const editor = document.querySelector(".snippet-card__note-edit textarea");
            return bodyIncludes("保存批注失败，草稿仍保留，可重新保存") &&
              bodyIncludes("Smoke snippets note save failure") &&
              editor?.value === SNIPPET_SMOKE.noteDraft
              ? editor
              : null;
          }, 2_000);
          delete window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_SAVE__;
          const snippetSaveFailureRowsAfter = await window.aura.db.query(
            "SELECT note_md FROM snippets WHERE id = ?",
            [SNIPPET_SMOKE.id]
          );
          snippetSaveFailureVisible =
            bodyIncludes("保存批注失败，草稿仍保留，可重新保存") &&
            bodyIncludes("Smoke snippets note save failure");
          snippetSaveFailurePreserved =
            Boolean(preservedSnippetEditor) &&
            preservedSnippetEditor.value === SNIPPET_SMOKE.noteDraft;
          snippetSaveFailureDidNotPersist =
            (snippetSaveFailureRowsAfter[0]?.note_md ?? null) ===
            (snippetSaveFailureRowsBefore[0]?.note_md ?? null);

          const activeSnippetEditor = document.querySelector(".snippet-card__note-edit textarea");
          activeSnippetEditor?.focus?.();
          if (activeSnippetEditor) {
            const shortcutSaveEvent = defineKeyboardCode(
              new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                code: "Enter",
                ctrlKey: !useMetaShortcut,
                key: "Enter",
                metaKey: useMetaShortcut
              }),
              13
            );
            snippetShortcutEventPrevented = !activeSnippetEditor.dispatchEvent(shortcutSaveEvent);
          }
          await waitFor(
            () =>
              bodyIncludes("批注已保存") &&
              bodyIncludes(SNIPPET_SMOKE.noteDraft) &&
              !document.querySelector(".snippet-card__note-edit textarea"),
            3_000
          );
          const savedSnippetRows = await window.aura.db.query(
            "SELECT note_md FROM snippets WHERE id = ?",
            [SNIPPET_SMOKE.id]
          );
          snippetSavedNote = savedSnippetRows[0]?.note_md ?? null;
          snippetEditorClosedAfterShortcut = !document.querySelector(".snippet-card__note-edit textarea");
          snippetShortcutSaveVisible =
            snippetSavedNote === SNIPPET_SMOKE.noteDraft &&
            bodyIncludes("批注已保存") &&
            bodyIncludes(SNIPPET_SMOKE.noteDraft) &&
            snippetEditorClosedAfterShortcut;

          const copyVisibleSnippetsButtonAfterSave = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "复制可见素材"
          );
          copyVisibleSnippetsButtonAfterSave?.click();
          await waitFor(
            () =>
              copyVisibleSnippetsButtonAfterSave?.disabled &&
              copyVisibleSnippetsButtonAfterSave.getAttribute("aria-busy") === "true" &&
              copyVisibleSnippetsButtonAfterSave.textContent?.includes("复制中") &&
              bodyIncludes("正在复制可见素材"),
            1_000
          );
          snippetVisibleCopyBusyVisible =
            Boolean(copyVisibleSnippetsButtonAfterSave?.disabled) &&
            Boolean(copyVisibleSnippetsButtonAfterSave?.textContent?.includes("复制中")) &&
            bodyIncludes("正在复制可见素材");
          snippetVisibleCopyAriaBusyVisible =
            snippetVisibleCopyBusyVisible &&
            copyVisibleSnippetsButtonAfterSave?.getAttribute("aria-busy") === "true";
          await waitFor(
            () =>
              !copyVisibleSnippetsButtonAfterSave?.disabled &&
              bodyIncludes("已复制") &&
              bodyIncludes("可见素材"),
            2_000
          );
          snippetVisibleCopySuccessVisible =
            !copyVisibleSnippetsButtonAfterSave?.disabled &&
            bodyIncludes("已复制") &&
            bodyIncludes("可见素材");

          const savedSnippetCard = () =>
            Array.from(document.querySelectorAll(".snippet-card")).find((card) =>
              card.textContent?.includes(SNIPPET_SMOKE.quote)
            );
          const snippetActionButton = (label) =>
            Array.from(savedSnippetCard()?.querySelectorAll("button") ?? []).find(
              (button) => button.textContent?.replace(/\s+/g, " ").trim() === label
            );

          const snippetCopyButton = snippetActionButton("复制");
          snippetCopyButton?.click();
          await waitFor(
            () =>
              snippetCopyButton?.disabled &&
              snippetCopyButton.getAttribute("aria-busy") === "true" &&
              snippetCopyButton.textContent?.includes("复制中") &&
              savedSnippetCard()?.textContent?.includes("复制中"),
            1_000
          );
          snippetCardCopyBusyVisible =
            Boolean(snippetCopyButton?.disabled) &&
            Boolean(snippetCopyButton?.textContent?.includes("复制中")) &&
            Boolean(savedSnippetCard()?.textContent?.includes("复制中"));
          snippetCardCopyAriaBusyVisible =
            snippetCardCopyBusyVisible && snippetCopyButton?.getAttribute("aria-busy") === "true";
          await waitFor(() => savedSnippetCard()?.textContent?.includes("已复制"), 2_000);

          const snippetCopyCitationButton = snippetActionButton("复制+引文");
          snippetCopyCitationButton?.click();
          await waitFor(
            () =>
              snippetCopyCitationButton?.disabled &&
              snippetCopyCitationButton.getAttribute("aria-busy") === "true" &&
              snippetCopyCitationButton.textContent?.includes("生成中") &&
              savedSnippetCard()?.textContent?.includes("生成引文"),
            1_000
          );
          snippetCardCopyCitationBusyVisible =
            Boolean(snippetCopyCitationButton?.disabled) &&
            Boolean(snippetCopyCitationButton?.textContent?.includes("生成中")) &&
            Boolean(savedSnippetCard()?.textContent?.includes("生成引文"));
          snippetCardCopyCitationAriaBusyVisible =
            snippetCardCopyCitationBusyVisible &&
            snippetCopyCitationButton?.getAttribute("aria-busy") === "true";
          await waitFor(
            () => savedSnippetCard()?.textContent?.includes("已复制含引文"),
            2_000
          );

          const clickConfirmSnippetDelete = async () => {
            const dialog = await waitFor(() => {
              const candidate = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("删除写作素材？")
              );
              return candidate ?? null;
            }, 1_000);
            const confirmButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
              (button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除素材"
            );
            confirmButton?.click();
          };
          const snippetDeleteRowsBeforeFailure = await window.aura.db.query(
            "SELECT deleted_at FROM snippets WHERE id = ? LIMIT 1",
            [SNIPPET_SMOKE.id]
          );
          const snippetDeleteButtonBeforeFailure = snippetActionButton("删除");
          snippetDeleteButtonBeforeFailure?.click();
          await waitFor(
            () =>
              Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("删除写作素材？")
              ),
            1_000
          );
          window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_DELETE__ =
            SNIPPET_DELETE_FAILURE_SMOKE.error;
          await clickConfirmSnippetDelete();
          snippetDeleteFailureBusyVisible = Boolean(
            await waitFor(() => {
              return bodyIncludes("正在删除素材") &&
                snippetDeleteButtonBeforeFailure?.disabled &&
                snippetDeleteButtonBeforeFailure.getAttribute("aria-busy") === "true" &&
                snippetDeleteButtonBeforeFailure.textContent?.includes("删除中")
                ? snippetDeleteButtonBeforeFailure
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("删除素材失败，素材仍保留，可重新删除") &&
              bodyIncludes(SNIPPET_DELETE_FAILURE_SMOKE.error),
            3_000
          );
          delete window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_DELETE__;
          const snippetDeleteRowsAfterFailure = await window.aura.db.query(
            "SELECT deleted_at FROM snippets WHERE id = ? LIMIT 1",
            [SNIPPET_SMOKE.id]
          );
          snippetDeleteFailureVisible =
            bodyIncludes("删除素材失败，素材仍保留，可重新删除") &&
            bodyIncludes(SNIPPET_DELETE_FAILURE_SMOKE.error);
          snippetDeleteFailureDidNotPersist =
            snippetDeleteRowsBeforeFailure[0]?.deleted_at == null &&
            snippetDeleteRowsAfterFailure[0]?.deleted_at == null;
          snippetDeleteFailurePreserved =
            bodyIncludes(SNIPPET_SMOKE.quote) &&
            Boolean(snippetActionButton("删除")) &&
            !document.querySelector('button[aria-label="撤销删除素材"]');

          const snippetDeleteButton = snippetActionButton("删除");
          snippetDeleteButton?.click();
          await clickConfirmSnippetDelete();
          await waitFor(
            () =>
              bodyIncludes("正在删除素材") &&
              snippetDeleteButton?.disabled &&
              snippetDeleteButton.getAttribute("aria-busy") === "true" &&
              snippetDeleteButton.textContent?.includes("删除中"),
            1_000
          );
          snippetDeleteBusyVisible =
            bodyIncludes("正在删除素材") &&
            Boolean(snippetDeleteButton?.disabled) &&
            Boolean(snippetDeleteButton?.textContent?.includes("删除中"));
          snippetDeleteAriaBusyVisible =
            snippetDeleteBusyVisible && snippetDeleteButton?.getAttribute("aria-busy") === "true";
          await waitFor(
            () => bodyIncludes("素材已删除") && !bodyIncludes(SNIPPET_SMOKE.quote),
            3_000
          );
          snippetDeleteSuccessVisible =
            bodyIncludes("素材已删除") && !bodyIncludes(SNIPPET_SMOKE.quote);
          const snippetUndoButton = document.querySelector('button[aria-label="撤销删除素材"]');
          snippetDeleteUndoVisible = Boolean(snippetDeleteSuccessVisible && snippetUndoButton);
          window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_RESTORE__ =
            SNIPPET_RESTORE_FAILURE_SMOKE.error;
          snippetUndoButton?.click();
          snippetDeleteUndoFailureBusyVisible = Boolean(
            await waitFor(() => {
              const button = document.querySelector('button[aria-label="撤销删除素材"]');
              return button?.disabled &&
                button.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("撤销中") &&
                bodyIncludes("正在撤销删除素材")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("撤销删除素材失败，撤销入口仍保留，可重新撤销") &&
              bodyIncludes(SNIPPET_RESTORE_FAILURE_SMOKE.error),
            3_000
          );
          delete window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_RESTORE__;
          const snippetUndoRowsAfterFailure = await window.aura.db.query(
            "SELECT deleted_at FROM snippets WHERE id = ? LIMIT 1",
            [SNIPPET_SMOKE.id]
          );
          const snippetUndoButtonAfterFailure = document.querySelector(
            'button[aria-label="撤销删除素材"]'
          );
          snippetDeleteUndoFailureVisible =
            bodyIncludes("撤销删除素材失败，撤销入口仍保留，可重新撤销") &&
            bodyIncludes(SNIPPET_RESTORE_FAILURE_SMOKE.error);
          snippetDeleteUndoFailureDidNotPersist =
            snippetUndoRowsAfterFailure[0]?.deleted_at != null;
          snippetDeleteUndoFailurePreserved =
            Boolean(snippetUndoButtonAfterFailure) &&
            !snippetUndoButtonAfterFailure?.disabled &&
            !bodyIncludes(SNIPPET_SMOKE.quote);
          snippetUndoButtonAfterFailure?.click();
          snippetDeleteUndoBusyVisible = Boolean(
            await waitFor(() => {
              const button = document.querySelector('button[aria-label="撤销删除素材"]');
              return button?.disabled &&
                button.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("撤销中") &&
                bodyIncludes("正在撤销删除素材")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () => bodyIncludes("已撤销删除素材") && bodyIncludes(SNIPPET_SMOKE.quote),
            3_000
          );
          const restoredSnippetRows = await window.aura.db.query(
            "SELECT deleted_at FROM snippets WHERE id = ? LIMIT 1",
            [SNIPPET_SMOKE.id]
          );
          snippetDeleteUndoRecovered =
            snippetDeleteUndoVisible &&
            snippetDeleteUndoBusyVisible &&
            bodyIncludes("已撤销删除素材") &&
            bodyIncludes(SNIPPET_SMOKE.quote) &&
            restoredSnippetRows[0]?.deleted_at == null;
        }

        await window.aura.db.run("DELETE FROM snippets");
        const snippetEmptyNow = Date.now();
        await window.aura.db.run("UPDATE works SET created_at = ?, updated_at = ? WHERE id = ? AND library_id = ?", [
          snippetEmptyNow,
          snippetEmptyNow,
          SAMPLE.workId
        , libraryId]);
        window.dispatchEvent(new Event("aurascholar:snippets-updated"));
        location.hash = "#/snippets";
        await waitFor(
          () =>
            location.hash.includes("/snippets") &&
            bodyIncludes("写作素材") &&
            bodyIncludes("打开最近文献") &&
            bodyIncludes(SAMPLE.title),
          5_000
        );
        const snippetEmptyLatestReaderButton = Array.from(document.querySelectorAll("button")).find(
          (button) => button.textContent?.replace(/\s+/g, " ").trim() === "打开最近文献"
        );
        snippetEmptyLatestReaderVisible =
          Boolean(snippetEmptyLatestReaderButton) &&
          bodyIncludes("最近文献") &&
          bodyIncludes(SAMPLE.title);
        snippetEmptyLatestReaderButton?.click();
        await waitFor(
          () =>
            location.hash.includes("/reader?work=" + encodeURIComponent(SAMPLE.workId)) &&
            bodyIncludes("PDF Reader") &&
            bodyIncludes(SAMPLE.title),
          10_000
        );
        snippetEmptyLatestReaderHash = location.hash;
        snippetEmptyLatestReaderOpened =
          snippetEmptyLatestReaderHash.includes("/reader?work=" + encodeURIComponent(SAMPLE.workId)) &&
          bodyIncludes(SAMPLE.title);

        location.hash = "#/library";
        await waitFor(
          () => location.hash.includes("/library") && bodyIncludes("文献库"),
          5_000
        );
        await window.aura.db.run(
          "UPDATE works SET reading_status = 'unread', updated_at = ? WHERE id = ? AND library_id = ?",
          [Date.now(), SAMPLE.workId, libraryId]
        );
`;
