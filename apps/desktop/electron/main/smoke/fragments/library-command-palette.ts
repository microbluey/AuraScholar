export const smokeLibraryCommandPalette = String.raw`        const librarySidebarMeta = document.querySelector(".app-sidebar-meta");
        const librarySidebarHealth = document.querySelector(".app-shell-health");
        librarySidebarMetaVisible = Boolean(librarySidebarMeta);
        if (librarySidebarMeta) {
          const metaRect = librarySidebarMeta.getBoundingClientRect();
          const healthRect = librarySidebarHealth?.getBoundingClientRect();
          const healthStyle = librarySidebarHealth
            ? window.getComputedStyle(librarySidebarHealth)
            : null;
          const healthVisible = Boolean(
            librarySidebarHealth &&
              healthStyle?.display !== "none" &&
              healthStyle?.visibility !== "hidden" &&
              healthStyle?.opacity !== "0" &&
              healthRect &&
              healthRect.width > 0 &&
              healthRect.height > 0
          );
          const overlapsHealth = Boolean(
            healthVisible &&
              healthRect &&
              metaRect.left < healthRect.right &&
              metaRect.right > healthRect.left &&
              metaRect.top < healthRect.bottom &&
              metaRect.bottom > healthRect.top
          );
          librarySidebarHealthHidden = !healthVisible && !overlapsHealth;
          const sidebarRect = document.querySelector(".app-sidebar")?.getBoundingClientRect();
          const organizerActions = [
            librarySidebarMeta.querySelector('[data-library-action="create-collection"]')
          ];
          librarySidebarOrganizerActionsVisible =
            organizerActions.every((action) => {
              if (!action || !sidebarRect) return false;
              const rect = action.getBoundingClientRect();
              const style = window.getComputedStyle(action);
              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                rect.width > 0 &&
                rect.height > 0 &&
                rect.top >= sidebarRect.top &&
                rect.bottom <= sidebarRect.bottom
              );
            }) && !document.querySelector(".app-sidebar--library .app-workspace-card");
        }
        commandShortcutLabel = text(".app-command-trigger kbd");
        librarySearchShortcutLabel = text(".library-inline-search .au-kbd");
        const appShortcutUsesMeta = isMacShortcut();
        const librarySearchInputForCommandShortcut = document.querySelector(
          'input[placeholder="在结果中搜索"]'
        );
        librarySearchInputForCommandShortcut?.focus?.();
        librarySearchInputForCommandShortcut?.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: appShortcutUsesMeta,
            key: "k",
            metaKey: !appShortcutUsesMeta
          })
        );
        await wait(100);
        commandNonPlatformShortcutIgnored =
          !document.querySelector('[role="dialog"]') &&
          (!librarySearchInputForCommandShortcut ||
            document.activeElement === librarySearchInputForCommandShortcut);

        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: !appShortcutUsesMeta,
            key: "k",
            metaKey: appShortcutUsesMeta
          })
        );
        await waitFor(() => document.querySelector('[role="dialog"]'), 2_000);
        commandShortcutToggleOpens = Boolean(
          document.querySelector('[role="dialog"]')?.textContent?.includes("全局命令")
        );
        const commandToggleSearch = document.querySelector('input[aria-label="搜索命令"]');
        commandToggleSearch?.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: !appShortcutUsesMeta,
            key: "k",
            metaKey: appShortcutUsesMeta
          })
        );
        await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
        commandShortcutToggleCloses =
          commandShortcutToggleOpens && !document.querySelector('[role="dialog"]');

        const commandTrigger = findButton("快速打开");
        commandTrigger?.focus();
        commandTrigger?.click();
        await waitFor(() => document.querySelector('[role="dialog"]'), 2_000);
        const commandDialogOpen = Boolean(
          document.querySelector('[role="dialog"]')?.textContent?.includes("全局命令")
        );
        const commandSearch = document.querySelector('input[aria-label="搜索命令"]');
        if (commandSearch) {
          setInputValue(commandSearch, "NoMatchingCommandSmoke");
          await waitFor(() => bodyIncludes("没有匹配命令"), 1_000);
          const clearCommandSearchButton = document.querySelector('button[aria-label="清空命令搜索"]');
          clearCommandSearchButton?.click();
          commandEmptyActionRestoresResults = Boolean(
            clearCommandSearchButton &&
              (await waitFor(
                () =>
                  commandSearch.value === "" &&
                  document.activeElement === commandSearch &&
                  document.querySelectorAll(".app-command-item").length > 0,
                1_000
              ))
          );
          const commandList = document.querySelector(".app-command-list");
          if (commandList instanceof HTMLElement) {
            commandList.style.maxHeight = "180px";
            commandList.scrollTop = 0;
            for (let i = 0; i < 12; i += 1) {
              commandSearch.dispatchEvent(
                new KeyboardEvent("keydown", {
                  bubbles: true,
                  cancelable: true,
                  key: "ArrowDown"
                })
              );
            }
            commandKeyboardNavigationKeepsActiveVisible = Boolean(
              await waitFor(() => {
                const activeCommandItem = document.querySelector(
                  ".app-command-item[aria-selected='true']"
                );
                if (!(activeCommandItem instanceof HTMLElement) || commandList.scrollTop <= 0) {
                  return false;
                }
                const listRect = commandList.getBoundingClientRect();
                const itemRect = activeCommandItem.getBoundingClientRect();
                return itemRect.top >= listRect.top - 1 && itemRect.bottom <= listRect.bottom + 1;
              }, 1_500)
            );
          }
          const beforeCommandHash = location.hash;
          const composingCommandEnter = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter"
          });
          Object.defineProperty(composingCommandEnter, "isComposing", {
            configurable: true,
            value: true
          });
          Object.defineProperty(composingCommandEnter, "keyCode", {
            configurable: true,
            value: 229
          });
          commandSearch.dispatchEvent(composingCommandEnter);
          await wait(100);
          commandCompositionIgnored =
            location.hash === beforeCommandHash &&
            Boolean(document.querySelector('[role="dialog"]')?.textContent?.includes("全局命令"));
          const composingCommandEscape = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Escape"
          });
          Object.defineProperty(composingCommandEscape, "isComposing", {
            configurable: true,
            value: true
          });
          Object.defineProperty(composingCommandEscape, "keyCode", {
            configurable: true,
            value: 229
          });
          commandSearch.dispatchEvent(composingCommandEscape);
          await wait(100);
          commandCompositionEscapeIgnored = Boolean(
            document.querySelector('[role="dialog"]')?.textContent?.includes("全局命令")
          );
        }
        commandSearch?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
        commandCloseRestoresFocus = Boolean(
          commandTrigger &&
            (await waitFor(() => document.activeElement === commandTrigger, 1_000))
        );

        findButton("快速打开")?.click();
        await waitFor(() => document.querySelector('[role="dialog"]'), 2_000);
        const targetedCommandSearch = document.querySelector('input[aria-label="搜索命令"]');
        if (targetedCommandSearch) {
          setInputValue(targetedCommandSearch, "翻译");
          await waitFor(() => bodyIncludes("配置阅读翻译"), 1_000);
          commandTargetedSettingsActionVisible = Boolean(
            Array.from(document.querySelectorAll(".app-command-item")).find((item) =>
              item.textContent?.includes("配置阅读翻译")
            )
          );
          targetedCommandSearch.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              key: "Enter"
            })
          );
          await waitFor(
            () =>
              location.hash.includes("/settings?section=translate") &&
              Boolean(
                document.querySelector('[data-settings-section="translate"].settings-card--targeted')
              ),
            3_000
          );
          commandTargetedSettingsActionTargetsSection =
            location.hash.includes("/settings?section=translate") &&
            Boolean(
              document.querySelector('[data-settings-section="translate"].settings-card--targeted')
            );
          location.hash = "#/library";
          await waitFor(
            () =>
              location.hash.includes("/library") &&
              Boolean(document.querySelector(".library-page")) &&
              bodyIncludes("文献库"),
            4_000
          );
        }

        const librarySearchInput = document.querySelector('input[placeholder="在结果中搜索"]');
        findButton("快速打开")?.focus();
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: appShortcutUsesMeta,
            key: "f",
            metaKey: !appShortcutUsesMeta
          })
        );
        await wait(100);
        librarySearchNonPlatformShortcutIgnored =
          Boolean(librarySearchInput) && document.activeElement !== librarySearchInput;
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: !appShortcutUsesMeta,
            key: "f",
            metaKey: appShortcutUsesMeta
          })
        );
        await waitFor(() => document.activeElement === librarySearchInput, 1_000);
        librarySearchShortcutFocused =
          Boolean(librarySearchInput) && document.activeElement === librarySearchInput;
        librarySearchInput?.blur();

`;
