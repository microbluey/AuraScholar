export const smokeSettingsSync = String.raw`        location.hash = "#/library";
        await waitFor(
          () => location.hash.includes("/library") && bodyIncludes("文献库"),
          4_000
        );
        window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_READ__ =
          "Smoke settings sync config read failure";
        location.hash = "#/settings?section=sync";
        await waitFor(
          () =>
            location.hash.includes("/settings?section=sync") &&
            Boolean(document.querySelector('[data-settings-section="sync"].settings-card--targeted')) &&
            bodyIncludes("读取同步配置失败") &&
            bodyIncludes("Smoke settings sync config read failure") &&
            Boolean(document.querySelector('button[aria-label="重试读取同步配置"]')),
          4_000
        );
        settingsSyncLoadRetryAttempts = 1;
        document.querySelector('button[aria-label="重试读取同步配置"]')?.click();
        await waitFor(
          () =>
            !bodyIncludes("读取同步配置失败") &&
            !bodyIncludes("Smoke settings sync config read failure") &&
            !bodyIncludes("正在读取同步配置") &&
            Boolean(document.querySelector('[data-settings-section="sync"] input:not(:disabled)')),
          4_000
        );
        settingsSyncLoadRetryAttempts += 1;
        settingsSyncLoadRetryRecoveryVisible =
          settingsSyncLoadRetryAttempts === 2 &&
          !bodyIncludes("读取同步配置失败") &&
          !bodyIncludes("Smoke settings sync config read failure") &&
          Boolean(document.querySelector('[data-settings-section="sync"] input:not(:disabled)'));
        settingsSyncLoadRetryRecoveryDetail =
          "attempts=" +
          settingsSyncLoadRetryAttempts +
          "; inputEnabled=" +
          Boolean(document.querySelector('[data-settings-section="sync"] input:not(:disabled)')) +
          "; error=" +
          bodyIncludes("读取同步配置失败");
        delete window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_READ__;
        const syncCardForFailure = document.querySelector('[data-settings-section="sync"]');
        const syncFailureInputs = Array.from(syncCardForFailure?.querySelectorAll("input") ?? []);
        const syncUrlInput = syncFailureInputs[0];
        const syncUserInput = syncFailureInputs[1];
        const syncPassInput = syncFailureInputs[2];
        if (syncUrlInput && syncUserInput && syncPassInput) {
          const syncSettingsBeforeInvalidUrl = localStorage.getItem("sync-settings");
          const syncSecretBeforeInvalidUrl = await window.aura?.secrets?.get?.(
            "secret:sync:password"
          );
          const syncInvalidUrl = "dav.example.invalid/aurascholar";
          const syncCredentialUrl = "https://user:pass@dav.example.invalid/aurascholar";
          setInputValue(syncUrlInput, syncInvalidUrl);
          setInputValue(syncUserInput, "smoke-sync-invalid-user");
          setInputValue(syncPassInput, "smoke-sync-invalid-pass");
          await waitFor(
            () =>
              syncUrlInput.value === syncInvalidUrl &&
              syncUserInput.value === "smoke-sync-invalid-user" &&
              syncPassInput.value === "smoke-sync-invalid-pass",
            1_000
          );
          const invalidSyncUrlSaveButton = Array.from(
            syncCardForFailure?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存同步配置");
          invalidSyncUrlSaveButton?.click();
          const invalidUrlMessageVisible = Boolean(
            await waitFor(() => {
              const currentSyncCard = document.querySelector('[data-settings-section="sync"]');
              const saveButton = Array.from(currentSyncCard?.querySelectorAll("button") ?? []).find(
                (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存同步配置"
              );
              return bodyIncludes("WebDAV 地址格式不正确") && saveButton && !saveButton.disabled
                ? saveButton
                : null;
            }, 1_000)
          );
          setInputValue(syncUrlInput, syncCredentialUrl);
          await waitFor(() => syncUrlInput.value === syncCredentialUrl, 1_000);
          const credentialSyncUrlSaveButton = Array.from(
            document.querySelector('[data-settings-section="sync"]')?.querySelectorAll("button") ??
              []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存同步配置");
          credentialSyncUrlSaveButton?.click();
          const credentialUrlMessageVisible = Boolean(
            await waitFor(() => {
              const currentSyncCard = document.querySelector('[data-settings-section="sync"]');
              const saveButton = Array.from(currentSyncCard?.querySelectorAll("button") ?? []).find(
                (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存同步配置"
              );
              return bodyIncludes("WebDAV 地址不要包含用户名或密码") &&
                saveButton &&
                !saveButton.disabled
                ? saveButton
                : null;
            }, 1_000)
          );
          const syncSettingsAfterInvalidUrl = localStorage.getItem("sync-settings");
          const syncSecretAfterInvalidUrl = await window.aura?.secrets?.get?.(
            "secret:sync:password"
          );
          settingsSyncUrlInvalidVisible = invalidUrlMessageVisible;
          settingsSyncUrlCredentialsRejected = credentialUrlMessageVisible;
          settingsSyncUrlInvalidDidNotPersist =
            syncSettingsAfterInvalidUrl === syncSettingsBeforeInvalidUrl &&
            syncSecretAfterInvalidUrl === syncSecretBeforeInvalidUrl;

          const syncSettingsBeforeFailure = localStorage.getItem("sync-settings");
          const syncSecretBeforeFailure = await window.aura?.secrets?.get?.("secret:sync:password");
          const syncFailureUrl = "https://dav.example.invalid/aurascholar";
          const syncFailureUser = "smoke-sync-save-failure-user";
          const syncFailurePass = "smoke-sync-save-failure-pass";
          setInputValue(syncUrlInput, syncFailureUrl);
          setInputValue(syncUserInput, syncFailureUser);
          setInputValue(syncPassInput, syncFailurePass);
          await waitFor(
            () =>
              syncUrlInput.value === syncFailureUrl &&
              syncUserInput.value === syncFailureUser &&
              syncPassInput.value === syncFailurePass,
            1_000
          );
          window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__ =
            "Smoke settings sync save failure";
          const failSaveSyncButton = Array.from(
            syncCardForFailure?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存同步配置");
          failSaveSyncButton?.click();
          const preservedSyncPassInput = await waitFor(() => {
            const currentSyncCard = document.querySelector('[data-settings-section="sync"]');
            const inputs = Array.from(currentSyncCard?.querySelectorAll("input") ?? []);
            const saveButton = Array.from(currentSyncCard?.querySelectorAll("button") ?? []).find(
              (button) =>
                button.textContent?.replace(/\s+/g, " ").trim() === "保存同步配置" &&
                !button.disabled
            );
            return bodyIncludes("保存失败，修改仍保留，可重新保存") &&
              bodyIncludes("Smoke settings sync save failure") &&
              inputs[0]?.value === syncFailureUrl &&
              inputs[1]?.value === syncFailureUser &&
              inputs[2]?.value === syncFailurePass &&
              Boolean(saveButton)
              ? inputs[2]
              : null;
          }, 3_000);
          delete window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__;
          const syncSettingsAfterFailure = localStorage.getItem("sync-settings");
          const syncSecretAfterFailure = await window.aura?.secrets?.get?.("secret:sync:password");
          settingsSyncSaveFailureVisible =
            bodyIncludes("保存失败，修改仍保留，可重新保存") &&
            bodyIncludes("Smoke settings sync save failure");
          settingsSyncSaveFailurePreserved =
            Boolean(preservedSyncPassInput) && preservedSyncPassInput.value === syncFailurePass;
          settingsSyncSaveFailureDidNotPersist =
            syncSettingsAfterFailure === syncSettingsBeforeFailure &&
            syncSecretAfterFailure === syncSecretBeforeFailure;
          const resetSyncButton = Array.from(
            document.querySelector('[data-settings-section="sync"]')?.querySelectorAll("button") ??
              []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "撤销修改");
          resetSyncButton?.click();
          await waitFor(
            () =>
              !bodyIncludes("Smoke settings sync save failure") &&
              !Array.from(
                document.querySelector('[data-settings-section="sync"]')?.querySelectorAll("input") ??
                  []
              ).some((input) =>
                [syncFailureUrl, syncFailureUser, syncFailurePass].includes(input.value)
              ),
            1_000
          );

          const syncRunUrlInputValue = "https://dav.example.invalid/smoke-run///";
          const syncRunUrl = "https://dav.example.invalid/smoke-run";
          const syncRunUser = "smoke-sync-run-user";
          const syncRunPass = "smoke-sync-run-pass";
          const syncCardForRun = document.querySelector('[data-settings-section="sync"]');
          const syncRunInputs = Array.from(syncCardForRun?.querySelectorAll("input") ?? []);
          const syncRunUrlInput = syncRunInputs[0];
          const syncRunUserInput = syncRunInputs[1];
          const syncRunPassInput = syncRunInputs[2];
          if (syncRunUrlInput && syncRunUserInput && syncRunPassInput) {
            setInputValue(syncRunUrlInput, syncRunUrlInputValue);
            setInputValue(syncRunUserInput, syncRunUser);
            setInputValue(syncRunPassInput, syncRunPass);
            await waitFor(
              () =>
                syncRunUrlInput.value === syncRunUrlInputValue &&
                syncRunUserInput.value === syncRunUser &&
                syncRunPassInput.value === syncRunPass,
              1_000
            );
            window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_RUN__ =
              'Unsupported sync column "works.future_column" in journal/dev-a/000000000001-000000000001.jsonl; update AuraScholar before syncing this library';
            const syncRunButton = Array.from(
              syncCardForRun?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "立即同步");
            syncRunButton?.click();
            settingsSyncRunFailureBusyVisible = Boolean(
              await waitFor(() => {
                const currentSyncCard = document.querySelector('[data-settings-section="sync"]');
                const currentRunButton = Array.from(
                  currentSyncCard?.querySelectorAll("button") ?? []
                ).find((button) => {
                  const label = button.textContent?.replace(/\s+/g, " ").trim();
                  return label === "同步中..." || label === "立即同步";
                });
                return currentRunButton?.disabled &&
                  currentRunButton.getAttribute("aria-busy") === "true" &&
                  currentRunButton.textContent?.includes("同步中") &&
                  bodyIncludes("同步中...")
                  ? currentRunButton
                  : null;
              }, 1_000)
            );
            const syncRunRetryButton = await waitFor(() => {
              const currentSyncCard = document.querySelector('[data-settings-section="sync"]');
              const buttons = Array.from(currentSyncCard?.querySelectorAll("button") ?? []);
              return bodyIncludes("同步失败，配置已保留，可重新同步") &&
                bodyIncludes("远端同步目录包含当前版本还不支持的数据结构") &&
                bodyIncludes("确认所有设备使用同一版本")
                ? buttons.find(
                    (button) =>
                      button.textContent?.replace(/\s+/g, " ").trim() === "立即同步" &&
                      !button.disabled
                  )
                : null;
            }, 3_000);
            delete window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_RUN__;
            const syncRunSettingsRows = localStorage.getItem("sync-settings");
            const syncRunSecret = await window.aura?.secrets?.get?.("secret:sync:password");
            let syncRunStoredUrl = "";
            let syncRunStoredUser = "";
            try {
              const parsedSyncRunSettings = JSON.parse(syncRunSettingsRows ?? "null");
              syncRunStoredUrl =
                typeof parsedSyncRunSettings?.baseUrl === "string"
                  ? parsedSyncRunSettings.baseUrl
                  : "";
              syncRunStoredUser =
                typeof parsedSyncRunSettings?.username === "string"
                  ? parsedSyncRunSettings.username
                  : "";
            } catch {
              syncRunStoredUrl = "";
              syncRunStoredUser = "";
            }
            settingsSyncRunFailureVisible =
              bodyIncludes("同步失败，配置已保留，可重新同步") &&
              bodyIncludes("远端同步目录包含当前版本还不支持的数据结构");
            settingsSyncRunActionableFailureVisible =
              settingsSyncRunFailureVisible &&
              bodyIncludes("请先升级 AuraScholar") &&
              bodyIncludes("确认所有设备使用同一版本") &&
              !bodyIncludes("Unsupported sync column");
            settingsSyncRunFailureRetryVisible = Boolean(syncRunRetryButton);
            settingsSyncRunFailureConfigPreserved =
              syncRunStoredUrl === syncRunUrl &&
              syncRunStoredUser === syncRunUser &&
              syncRunSecret === syncRunPass &&
              syncRunUrlInput.value === syncRunUrl &&
              syncRunUserInput.value === syncRunUser &&
              syncRunPassInput.value === syncRunPass;
            window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_RUN__ =
              "WebDAV MOVE journal/dev-a/0001-0002.jsonl failed: 507";
            syncRunRetryButton?.click();
            const syncRunQuotaRetryButton = await waitFor(() => {
              const currentSyncCard = document.querySelector('[data-settings-section="sync"]');
              const buttons = Array.from(currentSyncCard?.querySelectorAll("button") ?? []);
              return bodyIncludes("同步失败，配置已保留，可重新同步") &&
                bodyIncludes("WebDAV 服务返回 507") &&
                bodyIncludes("远端空间不足") &&
                bodyIncludes("清理云盘空间")
                ? buttons.find(
                    (button) =>
                      button.textContent?.replace(/\s+/g, " ").trim() === "立即同步" &&
                      !button.disabled
                  )
                : null;
            }, 3_000);
            delete window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_RUN__;
            settingsSyncRunQuotaGuidanceVisible =
              Boolean(syncRunQuotaRetryButton) &&
              !bodyIncludes("认证失败或没有目录权限") &&
              !bodyIncludes("Unsupported sync column");
            settingsSyncUrlNormalized =
              syncRunStoredUrl === syncRunUrl && syncRunUrlInput.value === syncRunUrl;
          }
        }

`;
