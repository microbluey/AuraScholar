export const smokeLibraryFilterRecovery = String.raw`          const returnAllButton = document.querySelector(
            ".library-refinebar--trash button"
          );
          if (!location.hash.includes("/reader")) {
            returnAllButton?.click();
          }
          const returnedToAllView = Boolean(
            await waitFor(
              () =>
                Boolean(document.querySelector('input[placeholder="在结果中搜索"]')) &&
                !document.querySelector('input[placeholder="搜索回收站"]') &&
                libraryFilterTab("全部")?.getAttribute("aria-pressed") === "true" &&
                document.querySelectorAll(".library-table__row").length > 0,
              10_000
            )
          );
          libraryFilterTabsExposeState =
            libraryFilterTabsExposeState &&
            returnedToAllView &&
            libraryFilterTab("全部")?.getAttribute("aria-pressed") === "true";

          window.dispatchEvent(
            new CustomEvent("aurascholar:library-view", {
              detail: { filter: "all", tag: SAMPLE.tag },
            })
          );
          const tagViewLoaded = Boolean(
            await waitFor(
              () => rowText().includes(SAMPLE.title) && bodyIncludes("标签 " + SAMPLE.tag),
              10_000
            )
          );
          libraryFilterTab("重点")?.click();
          const starredEmptyLoaded = Boolean(
            await waitFor(
              () => bodyIncludes("当前筛选无结果") && !rowText().includes(SAMPLE.title),
              10_000
            )
          );
          const clearFilterEmptyButton = document.querySelector('button[aria-label="清除当前筛选"]');
          clearFilterEmptyButton?.click();
          const clearFilterRestoredAllView = Boolean(
            clearFilterEmptyButton &&
              (await waitFor(
                () =>
                  libraryFilterTab("全部")?.getAttribute("aria-pressed") === "true" &&
                  !bodyIncludes("当前筛选无结果"),
                3_000
              ))
          );
          // Clearing a filtered view resets it to page one. Later smoke writes
          // can change its position. Use the public Library search control to
          // locate SAMPLE before continuing the selected-row actions.
          const libraryRecoverySearchInput = document.querySelector(
            'input[placeholder="在结果中搜索"]'
          );
          let sampleLocatedAfterFilterClear = false;
          let sampleSearchResultVisible = false;
          if (clearFilterRestoredAllView && libraryRecoverySearchInput) {
            setInputValue(libraryRecoverySearchInput, SAMPLE.title);
            sampleSearchResultVisible = Boolean(
              await waitFor(
                () =>
                  libraryRecoverySearchInput.value === SAMPLE.title &&
                  Array.from(document.querySelectorAll(".library-table__row")).filter(
                    (row) => row.getAttribute("data-library-row-id") === SAMPLE.workId
                  ).length === 1 &&
                  rowText().includes(SAMPLE.title),
                10_000
              )
            );
            if (sampleSearchResultVisible) {
              clickRowByTitle(SAMPLE.title);
              sampleLocatedAfterFilterClear = Boolean(
                await waitFor(
                  () =>
                    Boolean(
                      document.querySelector(
                        '.library-table__row--selected[data-library-row-id="' + SAMPLE.workId + '"]'
                      )
                    ) &&
                    rowText().includes(SAMPLE.title) &&
                    (
                      document.querySelector(".library-detail--selected h2")?.textContent ?? ""
                    ).includes(SAMPLE.title),
                  3_000
                )
              );
            }
          }
          libraryFilterEmptyActionRestoresResults = Boolean(
            clearFilterEmptyButton &&
              returnedToAllView &&
              tagViewLoaded &&
              starredEmptyLoaded &&
              clearFilterRestoredAllView &&
              sampleLocatedAfterFilterClear
          );
`;
