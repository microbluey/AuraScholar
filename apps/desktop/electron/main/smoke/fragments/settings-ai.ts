export const smokeSettingsAi = String.raw`        location.hash = "#/settings";
        await waitFor(
          () =>
            location.hash.includes("/settings") &&
            bodyIncludes("设置") &&
            bodyIncludes("阅读翻译"),
          4_000
        );
        await waitFor(
          () =>
            !bodyIncludes("正在读取 AI 配置") &&
            !bodyIncludes("正在读取翻译配置") &&
            !bodyIncludes("正在读取同步配置"),
          4_000
        );
        const aiInputs = Array.from(document.querySelectorAll(".settings-card--ai input"));
        const aiBaseUrlInput = aiInputs[0];
        const aiModelInput = aiInputs[1];
        const apiKeyInput = aiInputs[2];
        let expectedAiNormalizedUrl = "";
        settingsInitialLoadCompleted =
          Boolean(apiKeyInput) &&
          !apiKeyInput.disabled &&
          !bodyIncludes("正在读取 AI 配置") &&
          !bodyIncludes("正在读取翻译配置") &&
          !bodyIncludes("正在读取同步配置");
        if (aiBaseUrlInput && aiModelInput && apiKeyInput) {
          const aiSettingsBeforeInvalidUrl = localStorage.getItem("ai-settings");
          const aiSecretBeforeInvalidUrl = await window.aura?.secrets?.get?.("secret:ai:apiKey");
          const invalidAiUrl = "api.smoke-ai.example/v1";
          const credentialAiUrl = "https://sk-smoke-secret@api.smoke-ai.example/v1";
          const validAiUrlInputValue = "https://api.smoke-ai.example/v1///";
          const validAiUrl = "https://api.smoke-ai.example/v1";
          expectedAiNormalizedUrl = validAiUrl;
          const aiModel = "smoke-ai-model";
          setInputValue(aiBaseUrlInput, invalidAiUrl);
          setInputValue(aiModelInput, aiModel);
          setInputValue(apiKeyInput, "smoke-ai-invalid-key");
          await waitFor(
            () =>
              aiBaseUrlInput.value === invalidAiUrl &&
              aiModelInput.value === aiModel &&
              apiKeyInput.value === "smoke-ai-invalid-key",
            1_000
          );
          const invalidAiUrlSaveButton = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存 AI 配置"
          );
          invalidAiUrlSaveButton?.click();
          settingsAiUrlInvalidVisible = Boolean(
            await waitFor(() => {
              const saveButton = Array.from(document.querySelectorAll("button")).find(
                (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存 AI 配置"
              );
              return bodyIncludes("AI API 地址格式不正确") && saveButton && !saveButton.disabled
                ? saveButton
                : null;
            }, 1_000)
          );
          setInputValue(aiBaseUrlInput, credentialAiUrl);
          await waitFor(() => aiBaseUrlInput.value === credentialAiUrl, 1_000);
          const credentialAiUrlSaveButton = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存 AI 配置"
          );
          credentialAiUrlSaveButton?.click();
          settingsAiUrlCredentialsRejected = Boolean(
            await waitFor(() => {
              const saveButton = Array.from(document.querySelectorAll("button")).find(
                (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存 AI 配置"
              );
              return bodyIncludes("AI API 地址不要包含密钥或账号") &&
                saveButton &&
                !saveButton.disabled
                ? saveButton
                : null;
            }, 1_000)
          );
          const aiSettingsAfterInvalidUrl = localStorage.getItem("ai-settings");
          const aiSecretAfterInvalidUrl = await window.aura?.secrets?.get?.("secret:ai:apiKey");
          settingsAiUrlInvalidDidNotPersist =
            aiSettingsAfterInvalidUrl === aiSettingsBeforeInvalidUrl &&
            aiSecretAfterInvalidUrl === aiSecretBeforeInvalidUrl;
          setInputValue(aiBaseUrlInput, validAiUrlInputValue);
          await waitFor(() => aiBaseUrlInput.value === validAiUrlInputValue, 1_000);

          const aiSettingsBeforeFailure = localStorage.getItem("ai-settings");
          const aiSecretBeforeFailure = await window.aura?.secrets?.get?.("secret:ai:apiKey");
          const aiFailureDraft = "smoke-ai-save-failure-key";
          setInputValue(apiKeyInput, aiFailureDraft);
          await waitFor(() => apiKeyInput.value === aiFailureDraft, 1_000);
          window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__ =
            "Smoke settings AI save failure";
          const failSaveAiButton = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存 AI 配置"
          );
          failSaveAiButton?.click();
          const preservedAiInput = await waitFor(() => {
            const currentApiKeyInput = Array.from(
              document.querySelectorAll(".settings-card--ai input")
            )[2];
            const saveButton = Array.from(document.querySelectorAll("button")).find(
              (button) =>
                button.textContent?.replace(/\s+/g, " ").trim() === "保存 AI 配置" &&
                !button.disabled
            );
            return bodyIncludes("保存失败，修改仍保留，可重新保存") &&
              bodyIncludes("Smoke settings AI save failure") &&
              currentApiKeyInput?.value === aiFailureDraft &&
              Boolean(saveButton)
              ? currentApiKeyInput
              : null;
          }, 3_000);
          delete window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__;
          const aiSettingsAfterFailure = localStorage.getItem("ai-settings");
          const aiSecretAfterFailure = await window.aura?.secrets?.get?.("secret:ai:apiKey");
          settingsAiSaveFailureVisible =
            bodyIncludes("保存失败，修改仍保留，可重新保存") &&
            bodyIncludes("Smoke settings AI save failure");
          settingsAiSaveFailurePreserved =
            Boolean(preservedAiInput) && preservedAiInput.value === aiFailureDraft;
          settingsAiSaveFailureDidNotPersist =
            aiSettingsAfterFailure === aiSettingsBeforeFailure &&
            aiSecretAfterFailure === aiSecretBeforeFailure;
          setInputValue(apiKeyInput, "smoke-ai-busy-key");
          await waitFor(() => apiKeyInput.value === "smoke-ai-busy-key", 1_000);
          const saveAiButton = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存 AI 配置"
          );
          saveAiButton?.click();
          await waitFor(
            () =>
              bodyIncludes("配置操作正在进行") &&
              bodyIncludes("AI 服务 正在处理") &&
              bodyIncludes("保存中..."),
            2_000
          );
          settingsBusySaveControlsDisabled =
            Boolean(saveAiButton?.disabled) &&
            Array.from(document.querySelectorAll(".settings-card--ai input")).every(
              (input) => input.disabled
            );
          settingsBusySaveAriaVisible =
            settingsBusySaveControlsDisabled &&
            saveAiButton?.getAttribute("aria-busy") === "true";
          document.querySelector('.app-nav a[aria-label="文献库"]')?.click();
          const busyNavigationDialog = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("当前有设置操作正在进行") ? dialog : null;
          }, 3_000);
          settingsBusyNavigationConfirmVisible = Boolean(
            busyNavigationDialog?.textContent?.includes("正在处理：AI 服务")
          );
          const keepEditingSettings = Array.from(
            busyNavigationDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "继续编辑");
          keepEditingSettings?.click();
          await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
          settingsBusyNavigationCancelPreserved =
            settingsBusyNavigationConfirmVisible && location.hash.includes("/settings");
        }
        await waitFor(() => bodyIncludes("已保存，新的 AI 配置会用于摘要、闪卡与翻译。"), 3_000);
        if (expectedAiNormalizedUrl) {
          const savedAiSettingsText = localStorage.getItem("ai-settings");
          const currentAiBaseUrlInput = document.querySelector(".settings-card--ai input");
          try {
            const savedAiSettings = JSON.parse(savedAiSettingsText ?? "null");
            settingsAiUrlNormalized =
              savedAiSettings?.baseUrl === expectedAiNormalizedUrl &&
              currentAiBaseUrlInput?.value === expectedAiNormalizedUrl;
          } catch {
            settingsAiUrlNormalized = false;
          }
        }
        if (aiBaseUrlInput && aiModelInput && apiKeyInput) {
          window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_TEST__ =
            "Smoke settings AI test failure";
          const testAiButton = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "测试连接"
          );
          testAiButton?.click();
          settingsAiTestFailureBusyVisible = Boolean(
            await waitFor(() => {
              const currentTestButton = Array.from(document.querySelectorAll("button")).find(
                (button) => /测试中|测试连接/.test(button.textContent?.replace(/\s+/g, " ").trim() ?? "")
              );
              return bodyIncludes("测试中...") &&
                currentTestButton?.getAttribute("aria-busy") === "true"
                ? currentTestButton
                : null;
            }, 4_000)
          );
          settingsAiTestFailureVisible = Boolean(
            await waitFor(
              () =>
                bodyIncludes("连接失败，配置已保存，可修改后重新测试") &&
                bodyIncludes("Smoke settings AI test failure"),
              4_000
            )
          );
          delete window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_TEST__;
          const aiSettingsAfterTestFailureText = localStorage.getItem("ai-settings");
          const aiSecretAfterTestFailure = await window.aura?.secrets?.get?.("secret:ai:apiKey");
          try {
            const savedAiSettingsAfterTest = JSON.parse(aiSettingsAfterTestFailureText ?? "null");
            settingsAiTestFailureConfigSaved =
              savedAiSettingsAfterTest?.baseUrl === expectedAiNormalizedUrl &&
              savedAiSettingsAfterTest?.model === "smoke-ai-model" &&
              savedAiSettingsAfterTest?.kind === "openai-compatible" &&
              aiSecretAfterTestFailure === "smoke-ai-busy-key" &&
              aiBaseUrlInput.value === expectedAiNormalizedUrl &&
              aiModelInput.value === "smoke-ai-model" &&
              apiKeyInput.value === "smoke-ai-busy-key";
          } catch {
            settingsAiTestFailureConfigSaved = false;
          }
          settingsAiTestFailureRetryVisible = Boolean(
            Array.from(document.querySelectorAll("button")).find(
              (button) =>
                button.textContent?.replace(/\s+/g, " ").trim() === "测试连接" &&
                !button.disabled
            )
          );
        }

`;
