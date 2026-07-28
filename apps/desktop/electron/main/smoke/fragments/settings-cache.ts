export const smokeSettingsCache = String.raw`        await window.aura?.db?.run?.("DELETE FROM translation_cache");
        await window.aura?.db?.run?.(
          "INSERT OR REPLACE INTO translation_cache (cache_key, engine, target_lang, result, created_at) VALUES (?, ?, ?, ?, ?)",
          ["smoke-translation-cache-clear", "smoke", "zh", "缓存译文", Date.now()]
        );
        const clearTranslationCacheButton = () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => {
              const label = button.textContent?.replace(/\s+/g, " ").trim();
              return label === "清除翻译缓存" || label === "清除中...";
            }
          );
        clearTranslationCacheButton()?.click();
        const settingsCacheConfirm = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("清除翻译缓存？") ? dialog : null;
        }, 3_000);
        settingsTranslationCacheClearConfirmVisible = Boolean(
          settingsCacheConfirm?.textContent?.includes("重新调用翻译服务")
        );
        const cancelSettingsCacheClear = Array.from(
          settingsCacheConfirm?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保留缓存");
        cancelSettingsCacheClear?.click();
        await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
        settingsTranslationCacheClearCancelled =
          settingsTranslationCacheClearConfirmVisible &&
          bodyIncludes("已取消清除翻译缓存。") &&
          !document.querySelector('[role="dialog"]') &&
          Number(
            await window.aura?.db?.queryScalar?.(
              "SELECT COUNT(*) FROM translation_cache WHERE cache_key = 'smoke-translation-cache-clear'"
            )
          ) === 1;

        clearTranslationCacheButton()?.click();
        const settingsCacheConfirmAgain = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("清除翻译缓存？") ? dialog : null;
        }, 3_000);
        const confirmSettingsCacheClear = Array.from(
          settingsCacheConfirmAgain?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "清除缓存");
        confirmSettingsCacheClear?.click();
        settingsTranslationCacheClearBusyVisible = Boolean(
          await waitFor(() => {
            const button = clearTranslationCacheButton();
            return button?.getAttribute("aria-busy") === "true" &&
              button.disabled &&
              button.textContent?.includes("清除中") &&
              bodyIncludes("正在清除翻译缓存")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(() => bodyIncludes("已清除 1 条翻译缓存。"), 3_000);
        settingsTranslationCacheClearSuccessVisible = bodyIncludes("已清除 1 条翻译缓存。");
        settingsTranslationCacheClearPersisted =
          Number(await window.aura?.db?.queryScalar?.("SELECT COUNT(*) FROM translation_cache")) === 0;

        window.__AURASCHOLAR_SMOKE_SENTINEL_FAIL_NEXT_READ__ =
          "Smoke sentinel initial load failure";
`;
