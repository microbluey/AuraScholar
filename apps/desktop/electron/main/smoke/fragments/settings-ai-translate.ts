export const smokeSettingsAiTranslate = String.raw`        location.hash = "#/settings?section=ai";
        await waitFor(
          () =>
            location.hash.includes("/settings?section=ai") &&
            Boolean(document.querySelector('[data-settings-section="ai"].settings-card--targeted')) &&
            bodyIncludes("读取 AI 配置失败") &&
            bodyIncludes("Smoke settings AI config read failure") &&
            Boolean(document.querySelector('button[aria-label="重试读取 AI 配置"]')),
          4_000
        );
        settingsAiLoadRetryAttempts = 1;
        document.querySelector('button[aria-label="重试读取 AI 配置"]')?.click();
        await waitFor(
          () =>
            !bodyIncludes("读取 AI 配置失败") &&
            !bodyIncludes("Smoke settings AI config read failure") &&
            !bodyIncludes("正在读取 AI 配置") &&
            Boolean(document.querySelector(".settings-card--ai input:not(:disabled)")),
          4_000
        );
        settingsAiLoadRetryAttempts += 1;
        settingsAiLoadRetryRecoveryVisible =
          settingsAiLoadRetryAttempts === 2 &&
          !bodyIncludes("读取 AI 配置失败") &&
          !bodyIncludes("Smoke settings AI config read failure") &&
          Boolean(document.querySelector(".settings-card--ai input:not(:disabled)"));
        settingsAiLoadRetryRecoveryDetail =
          "attempts=" +
          settingsAiLoadRetryAttempts +
          "; inputEnabled=" +
          Boolean(document.querySelector(".settings-card--ai input:not(:disabled)")) +
          "; error=" +
          bodyIncludes("读取 AI 配置失败");
        delete window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_READ__;

        location.hash = "#/library";
        await waitFor(
          () => location.hash.includes("/library") && document.querySelector(".library-page"),
          4_000
        );
        const inlineMigrationKey = "smoke-inline-migration-ai-key";
        const inlineMigrationSettings = {
          apiKey: inlineMigrationKey,
          baseUrl: "https://api.inline-migration.example/v1",
          kind: "openai-compatible",
          model: "smoke-inline-migration-model"
        };
        localStorage.setItem("ai-settings", JSON.stringify(inlineMigrationSettings));
        await window.aura?.secrets?.delete?.("secret:ai:apiKey");
        window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__ =
          "Smoke inline AI migration failure";
        location.hash = "#/settings?section=ai";
        const inlineMigrationFailureInput = await waitFor(() => {
          const currentApiKeyInput = Array.from(
            document.querySelectorAll(".settings-card--ai input")
          )[2];
          return location.hash.includes("/settings?section=ai") &&
            !bodyIncludes("读取 AI 配置失败") &&
            currentApiKeyInput?.value === inlineMigrationKey &&
            !currentApiKeyInput.disabled
            ? currentApiKeyInput
            : null;
        }, 4_000);
        const inlineSettingsAfterFailure = localStorage.getItem("ai-settings") ?? "";
        const inlineSecretAfterFailure = await window.aura?.secrets?.get?.("secret:ai:apiKey");
        settingsInlineSecretMigrationVisible = Boolean(inlineMigrationFailureInput);
        settingsInlineSecretMigrationFailurePreserved =
          settingsInlineSecretMigrationVisible &&
          inlineSettingsAfterFailure.includes(inlineMigrationKey) &&
          !inlineSecretAfterFailure;
        delete window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__;
        location.hash = "#/library";
        await waitFor(
          () => location.hash.includes("/library") && document.querySelector(".library-page"),
          4_000
        );
        location.hash = "#/settings?section=ai";
        const migratedInlineInput = await waitFor(() => {
          const currentApiKeyInput = Array.from(
            document.querySelectorAll(".settings-card--ai input")
          )[2];
          return location.hash.includes("/settings?section=ai") &&
            !bodyIncludes("读取 AI 配置失败") &&
            currentApiKeyInput?.value === inlineMigrationKey
            ? currentApiKeyInput
            : null;
        }, 4_000);
        const inlineSettingsAfterRetry = localStorage.getItem("ai-settings") ?? "";
        const inlineSecretAfterRetry = await window.aura?.secrets?.get?.("secret:ai:apiKey");
        settingsInlineSecretMigrationRetrySanitized =
          Boolean(migratedInlineInput) &&
          inlineSecretAfterRetry === inlineMigrationKey &&
          !inlineSettingsAfterRetry.includes(inlineMigrationKey) &&
          !inlineSettingsAfterRetry.includes("apiKey");

        location.hash = "#/library";
        await waitFor(
          () => location.hash.includes("/library") && document.querySelector(".library-page"),
          4_000
        );
        window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_TRANSLATE_READ__ =
          "Smoke settings translate config read failure";
        location.hash = "#/settings?section=translate";
        await waitFor(
          () =>
            location.hash.includes("/settings?section=translate") &&
            Boolean(
              document.querySelector('[data-settings-section="translate"].settings-card--targeted')
            ) &&
            bodyIncludes("读取翻译配置失败") &&
            bodyIncludes("Smoke settings translate config read failure") &&
            Boolean(document.querySelector('button[aria-label="重试读取翻译配置"]')),
          4_000
        );
        settingsTranslateLoadRetryAttempts = 1;
        document.querySelector('button[aria-label="重试读取翻译配置"]')?.click();
        await waitFor(
          () =>
            !bodyIncludes("读取翻译配置失败") &&
            !bodyIncludes("Smoke settings translate config read failure") &&
            !bodyIncludes("正在读取翻译配置") &&
            Boolean(
              document.querySelector('[data-settings-section="translate"] select:not(:disabled)')
            ),
          4_000
        );
        settingsTranslateLoadRetryAttempts += 1;
        settingsTranslateLoadRetryRecoveryVisible =
          settingsTranslateLoadRetryAttempts === 2 &&
          !bodyIncludes("读取翻译配置失败") &&
          !bodyIncludes("Smoke settings translate config read failure") &&
          Boolean(
            document.querySelector('[data-settings-section="translate"] select:not(:disabled)')
          );
        settingsTranslateLoadRetryRecoveryDetail =
          "attempts=" +
          settingsTranslateLoadRetryAttempts +
          "; selectEnabled=" +
          Boolean(
            document.querySelector('[data-settings-section="translate"] select:not(:disabled)')
          ) +
          "; error=" +
          bodyIncludes("读取翻译配置失败");
        delete window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_TRANSLATE_READ__;

        location.hash = "#/settings?section=translate";
        await waitFor(
          () =>
            location.hash.includes("/settings?section=translate") &&
            Boolean(
              document.querySelector('[data-settings-section="translate"].settings-card--targeted')
            ) &&
            bodyIncludes("阅读翻译"),
          4_000
        );
        settingsTargetTranslateSectionVisible =
          location.hash.includes("/settings?section=translate") &&
          Boolean(
            document.querySelector('[data-settings-section="translate"].settings-card--targeted')
          );
        const translateCardForFailure = document.querySelector('[data-settings-section="translate"]');
        const deeplEngineButton = Array.from(
          translateCardForFailure?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "DeepL");
        deeplEngineButton?.click();
        const deeplKeyInput = await waitFor(
          () => {
            const currentTranslateCard = document.querySelector('[data-settings-section="translate"]');
            if (!currentTranslateCard?.textContent?.includes("DeepL API Key")) return null;
            return (
              Array.from(currentTranslateCard.querySelectorAll("input")).find(
                (input) => input.getAttribute("type") === "password"
              ) ?? null
            );
          },
          1_000
        );
        if (deeplKeyInput) {
          const translateSettingsBeforeValidation = localStorage.getItem("translate-settings");
          const deeplSecretBeforeValidation =
            await window.aura?.secrets?.get?.("secret:translate:deepl");
          const baiduSecretBeforeValidation =
            await window.aura?.secrets?.get?.("secret:translate:baidu");
          setInputValue(deeplKeyInput, "");
          await waitFor(() => deeplKeyInput.value === "", 1_000);
          const validateDeepLButton = Array.from(
            document.querySelector('[data-settings-section="translate"]')?.querySelectorAll("button") ??
              []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存翻译配置");
          validateDeepLButton?.click();
          const deepLValidationVisible = Boolean(
            await waitFor(() => {
              const currentTranslateCard = document.querySelector('[data-settings-section="translate"]');
              const saveButton = Array.from(currentTranslateCard?.querySelectorAll("button") ?? []).find(
                (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存翻译配置"
              );
              return bodyIncludes("请填写 DeepL API Key") && saveButton && !saveButton.disabled
                ? saveButton
                : null;
            }, 1_000)
          );
          const baiduEngineButton = Array.from(
            document.querySelector('[data-settings-section="translate"]')?.querySelectorAll("button") ??
              []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "百度翻译");
          baiduEngineButton?.click();
          const baiduInputs = await waitFor(() => {
            const currentTranslateCard = document.querySelector('[data-settings-section="translate"]');
            if (!currentTranslateCard?.textContent?.includes("百度翻译 APPID")) return null;
            const inputs = Array.from(currentTranslateCard.querySelectorAll("input"));
            return inputs.length >= 2 ? inputs : null;
          }, 1_000);
          if (baiduInputs) {
            setInputValue(baiduInputs[0], "smoke-baidu-appid-only");
            setInputValue(baiduInputs[1], "");
            await waitFor(
              () => baiduInputs[0].value === "smoke-baidu-appid-only" && baiduInputs[1].value === "",
              1_000
            );
            const validateBaiduButton = Array.from(
              document.querySelector('[data-settings-section="translate"]')?.querySelectorAll("button") ??
                []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存翻译配置");
            validateBaiduButton?.click();
          }
          const baiduValidationVisible = Boolean(
            await waitFor(() => {
              const currentTranslateCard = document.querySelector('[data-settings-section="translate"]');
              const saveButton = Array.from(currentTranslateCard?.querySelectorAll("button") ?? []).find(
                (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存翻译配置"
              );
              return bodyIncludes("请填写百度翻译 APPID 和密钥") &&
                saveButton &&
                !saveButton.disabled
                ? saveButton
                : null;
            }, 1_000)
          );
          const translateSettingsAfterValidation = localStorage.getItem("translate-settings");
          const deeplSecretAfterValidation =
            await window.aura?.secrets?.get?.("secret:translate:deepl");
          const baiduSecretAfterValidation =
            await window.aura?.secrets?.get?.("secret:translate:baidu");
          settingsTranslateProviderValidationVisible =
            deepLValidationVisible && baiduValidationVisible;
          settingsTranslateProviderValidationDidNotPersist =
            translateSettingsAfterValidation === translateSettingsBeforeValidation &&
            deeplSecretAfterValidation === deeplSecretBeforeValidation &&
            baiduSecretAfterValidation === baiduSecretBeforeValidation;
          const deeplEngineButtonAgain = Array.from(
            document.querySelector('[data-settings-section="translate"]')?.querySelectorAll("button") ??
              []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "DeepL");
          deeplEngineButtonAgain?.click();
          const currentDeeplKeyInput = await waitFor(
            () => {
              const currentTranslateCard = document.querySelector('[data-settings-section="translate"]');
              if (!currentTranslateCard?.textContent?.includes("DeepL API Key")) return null;
              return (
                Array.from(currentTranslateCard.querySelectorAll("input")).find(
                  (input) => input.getAttribute("type") === "password"
                ) ?? null
              );
            },
            1_000
          );
          const translateSettingsBeforeFailure = localStorage.getItem("translate-settings");
          const translateSecretBeforeFailure =
            await window.aura?.secrets?.get?.("secret:translate:deepl");
          const translateFailureDraft = "smoke-translate-save-failure-key";
          setInputValue(currentDeeplKeyInput, translateFailureDraft);
          await waitFor(() => currentDeeplKeyInput?.value === translateFailureDraft, 1_000);
          window.__AURASCHOLAR_SMOKE_FAIL_SECRET_WRITE_AFTER__ = 1;
          window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__ =
            "Smoke settings translate save failure";
          const failSaveTranslateButton = Array.from(
            document.querySelector('[data-settings-section="translate"]')?.querySelectorAll("button") ??
              []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存翻译配置");
          failSaveTranslateButton?.click();
          const preservedTranslateInput = await waitFor(() => {
            const currentTranslateCard = document.querySelector('[data-settings-section="translate"]');
            const currentKeyInput = Array.from(currentTranslateCard?.querySelectorAll("input") ?? []).find(
              (input) => input.getAttribute("type") === "password"
            );
            const saveButton = Array.from(currentTranslateCard?.querySelectorAll("button") ?? []).find(
              (button) =>
                button.textContent?.replace(/\s+/g, " ").trim() === "保存翻译配置" &&
                !button.disabled
            );
            return bodyIncludes("保存失败，修改仍保留，可重新保存") &&
              bodyIncludes("Smoke settings translate save failure") &&
              currentKeyInput?.value === translateFailureDraft &&
              Boolean(saveButton)
              ? currentKeyInput
              : null;
          }, 3_000);
          delete window.__AURASCHOLAR_SMOKE_FAIL_SECRET_WRITE_AFTER__;
          delete window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__;
          const translateSettingsAfterFailure = localStorage.getItem("translate-settings");
          const translateSecretAfterFailure =
            await window.aura?.secrets?.get?.("secret:translate:deepl");
          settingsTranslateSaveFailureVisible =
            bodyIncludes("保存失败，修改仍保留，可重新保存") &&
            bodyIncludes("Smoke settings translate save failure");
          settingsTranslateSaveFailurePreserved =
            Boolean(preservedTranslateInput) &&
            preservedTranslateInput.value === translateFailureDraft;
          settingsTranslateSaveFailureDidNotPersist =
            translateSettingsAfterFailure === translateSettingsBeforeFailure &&
            translateSecretAfterFailure === translateSecretBeforeFailure;
          const resetTranslateButton = Array.from(
            document.querySelector('[data-settings-section="translate"]')?.querySelectorAll("button") ??
              []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "撤销修改");
          resetTranslateButton?.click();
          await waitFor(
            () =>
              !bodyIncludes("Smoke settings translate save failure") &&
              !Array.from(
                document.querySelector('[data-settings-section="translate"]')?.querySelectorAll("input") ??
                  []
              ).some((input) => input.value === translateFailureDraft),
            1_000
          );
        }

`;
