export const smokeLibraryKeyboard = String.raw`        location.hash = "#/library";
        await waitFor(
          () =>
            location.hash.includes("/library") &&
            Boolean(document.querySelector(".library-page")) &&
            bodyIncludes("文献库"),
          4_000
        );
        window.dispatchEvent(
          new CustomEvent("aurascholar:library-view", { detail: { filter: "all" } })
        );
        const keyboardSearchInput = document.querySelector('input[placeholder="在结果中搜索"]');
        if (keyboardSearchInput?.value) setInputValue(keyboardSearchInput, "");
        findExactButton("取消选择")?.click();
        await waitFor(
          () => {
            const rows = Array.from(document.querySelectorAll(".library-table__row"));
            const searchInput = document.querySelector('input[placeholder="在结果中搜索"]');
            return rows.length >= 2 && (!searchInput || searchInput.value === "") ? rows : null;
          },
          4_000
        );
        await wait(250);
        const keyboardRows = Array.from(document.querySelectorAll(".library-table__row")).filter(
          (row) => row.isConnected
        );
        const keyboardSampleIndex = keyboardRows.findIndex(
          (row) => row.getAttribute("data-library-row-id") === SAMPLE.workId
        );
        const keyboardStartIndex =
          keyboardSampleIndex >= 0 && keyboardSampleIndex < keyboardRows.length - 1
            ? keyboardSampleIndex
            : keyboardRows.findIndex((_row, index) => index < keyboardRows.length - 1);
        const keyboardStartRow =
          keyboardStartIndex >= 0 ? keyboardRows[keyboardStartIndex] : null;
        if (keyboardStartRow) {
          const nextRow = keyboardRows[keyboardStartIndex + 1] ?? null;
          const nextId = nextRow?.getAttribute("data-library-row-id") ?? "";
          const nextTitle =
            nextRow?.querySelector(".library-table__paper strong")?.textContent?.trim() ?? "";
          libraryKeyboardNavigationDetail =
            "rows=" +
            keyboardRows.length +
            "; start=" +
            (keyboardStartRow.getAttribute("data-library-row-id") ?? "") +
            "; next=" +
            nextId +
            "; title=" +
            nextTitle;
          keyboardStartRow.focus();
          const keyboardStartFocused = await waitFor(
            () => document.activeElement === keyboardStartRow,
            1_000
          );
          libraryKeyboardNavigationDetail +=
            "; focusStart=" + Boolean(keyboardStartFocused);
          (document.activeElement === keyboardStartRow
            ? document.activeElement
            : keyboardStartRow
          ).dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })
          );
          await waitFor(
            () =>
              Boolean(nextId) &&
              document.activeElement?.getAttribute("data-library-row-id") === nextId &&
              (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(nextTitle),
            3_000
          );
          libraryKeyboardNavigationVisible =
            Boolean(nextId) &&
            document.activeElement?.getAttribute("data-library-row-id") === nextId &&
            (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(nextTitle);
          libraryKeyboardNavigationDetail +=
            "; activeAfter=" +
            (document.activeElement?.getAttribute("data-library-row-id") ?? "") +
            "; selectedAfter=" +
            (document
              .querySelector(".library-table__row--selected")
              ?.getAttribute("data-library-row-id") ?? "") +
            "; detailAfter=" +
            (document.querySelector(".library-detail--selected h2")?.textContent?.trim() ?? "");
          if (libraryKeyboardNavigationVisible) {
            libraryKeyboardOpenedId = nextId;
            document.activeElement?.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
            );
            await waitFor(
              () => location.hash.includes("/reader?work=" + encodeURIComponent(nextId)),
              5_000
            );
            libraryKeyboardOpenHash = location.hash;
          }
        } else {
          libraryKeyboardNavigationDetail =
            "rows=" + keyboardRows.length + "; start=; next=; title=";
        }

        location.hash = "#/library";
        await waitFor(
          () =>
            location.hash.includes("/library") &&
            Boolean(document.querySelector(".library-page")) &&
            rowText().includes(SAMPLE.title),
          5_000
        );
        const libraryCanvasIngressSourceVisible = rowText().includes(SAMPLE.title);
`;
