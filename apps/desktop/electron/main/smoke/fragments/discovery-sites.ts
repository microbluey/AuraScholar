export const smokeDiscoverySites = String.raw`        findButton("管理站点")?.click();
        await waitFor(() => document.querySelector(".discovery-card__manage"), 2_000);
        const proxyConfigInputs = Array.from(document.querySelectorAll(".discovery-proxy-bar input"));
        const proxyConfigInput = proxyConfigInputs[0];
        const ezproxyConfigInput = proxyConfigInputs[1];
        if (proxyConfigInput) {
          setInputValue(proxyConfigInput, DISCOVERY_PROXY_CONFIG_SMOKE);
          await wait(100);
          const saveProxyButton = findExactButton("保存代理");
          saveProxyButton?.click();
          await waitFor(
            () =>
              saveProxyButton?.disabled &&
              saveProxyButton.getAttribute("aria-busy") === "true" &&
              saveProxyButton.textContent?.includes("保存中") &&
              bodyIncludes("保存代理地址..."),
            1_000
          );
          discoveryProxyConfigSaveBusyVisible = Boolean(
            saveProxyButton?.disabled &&
              saveProxyButton.textContent?.includes("保存中") &&
              bodyIncludes("保存代理地址...")
          );
          discoveryProxyConfigSaveAriaBusyVisible =
            discoveryProxyConfigSaveBusyVisible &&
            saveProxyButton?.getAttribute("aria-busy") === "true";
          await waitFor(() => bodyIncludes("已保存代理地址"), 3_000);
          const proxyConfigRows = await window.aura.db.query(
            "SELECT value_json FROM settings WHERE key = 'research.proxy'"
          );
          try {
            discoveryProxyConfigValue = JSON.parse(proxyConfigRows[0]?.value_json ?? "null");
          } catch {
            discoveryProxyConfigValue = null;
          }
          discoveryProxyConfigSaved =
            discoveryProxyConfigSaveBusyVisible &&
            discoveryProxyConfigSaveAriaBusyVisible &&
            discoveryProxyConfigValue === DISCOVERY_PROXY_CONFIG_SMOKE;
          setInputValue(proxyConfigInput, DISCOVERY_PROXY_CREDENTIAL_SMOKE);
          await wait(100);
          saveProxyButton?.click();
          await waitFor(() => bodyIncludes("代理配置无效:代理地址中不能包含用户名或密码"), 2_000);
          discoveryProxyCredentialsRejected = bodyIncludes(
            "代理配置无效:代理地址中不能包含用户名或密码"
          );
          const proxyCredentialRows = await window.aura.db.query(
            "SELECT value_json FROM settings WHERE key = 'research.proxy'"
          );
          let proxyCredentialValue = null;
          try {
            proxyCredentialValue = JSON.parse(proxyCredentialRows[0]?.value_json ?? "null");
          } catch {
            proxyCredentialValue = null;
          }
          discoveryProxyCredentialDidNotPersist =
            proxyCredentialValue === DISCOVERY_PROXY_CONFIG_SMOKE &&
            !String(proxyCredentialRows[0]?.value_json ?? "").includes("smoke-user");
        }
        if (ezproxyConfigInput) {
          setInputValue(ezproxyConfigInput, DISCOVERY_EZPROXY_CONFIG_SMOKE);
          await wait(100);
          const saveEzproxyButton = findExactButton("保存前缀");
          saveEzproxyButton?.click();
          await waitFor(
            () =>
              saveEzproxyButton?.disabled &&
              saveEzproxyButton.getAttribute("aria-busy") === "true" &&
              saveEzproxyButton.textContent?.includes("保存中") &&
              bodyIncludes("保存图书馆前缀..."),
            1_000
          );
          discoveryEzproxyConfigSaveBusyVisible = Boolean(
            saveEzproxyButton?.disabled &&
              saveEzproxyButton.textContent?.includes("保存中") &&
              bodyIncludes("保存图书馆前缀...")
          );
          discoveryEzproxyConfigSaveAriaBusyVisible =
            discoveryEzproxyConfigSaveBusyVisible &&
            saveEzproxyButton?.getAttribute("aria-busy") === "true";
          await waitFor(() => bodyIncludes("已保存图书馆前缀"), 3_000);
          const ezproxyConfigRows = await window.aura.db.query(
            "SELECT value_json FROM settings WHERE key = 'research.ezproxy'"
          );
          try {
            discoveryEzproxyConfigValue = JSON.parse(ezproxyConfigRows[0]?.value_json ?? "null");
          } catch {
            discoveryEzproxyConfigValue = null;
          }
          discoveryEzproxyConfigSaved =
            discoveryEzproxyConfigSaveBusyVisible &&
            discoveryEzproxyConfigSaveAriaBusyVisible &&
            discoveryEzproxyConfigValue === DISCOVERY_EZPROXY_CONFIG_SMOKE;
          setInputValue(ezproxyConfigInput, DISCOVERY_EZPROXY_CREDENTIAL_SMOKE);
          await wait(100);
          saveEzproxyButton?.click();
          await waitFor(
            () => bodyIncludes("图书馆前缀无效:图书馆前缀中不能包含用户名或密码"),
            2_000
          );
          discoveryEzproxyCredentialsRejected = bodyIncludes(
            "图书馆前缀无效:图书馆前缀中不能包含用户名或密码"
          );
          const ezproxyCredentialRows = await window.aura.db.query(
            "SELECT value_json FROM settings WHERE key = 'research.ezproxy'"
          );
          let ezproxyCredentialValue = null;
          try {
            ezproxyCredentialValue = JSON.parse(ezproxyCredentialRows[0]?.value_json ?? "null");
          } catch {
            ezproxyCredentialValue = null;
          }
          discoveryEzproxyCredentialDidNotPersist =
            ezproxyCredentialValue === DISCOVERY_EZPROXY_CONFIG_SMOKE &&
            !String(ezproxyCredentialRows[0]?.value_json ?? "").includes("smoke-user");
        }
        const proxySiteCard = Array.from(document.querySelectorAll(".discovery-card-wrap")).find(
          (card) => card.textContent?.includes(DISCOVERY_PROXY_SITE_SMOKE.name)
        );
        const proxyToggleButton = Array.from(
          proxySiteCard?.querySelectorAll(".discovery-card__manage button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "走代理");
        proxyToggleButton?.click();
        await waitFor(
          () =>
            proxyToggleButton?.disabled &&
            proxyToggleButton.getAttribute("aria-busy") === "true" &&
            proxyToggleButton.textContent?.includes("更新中"),
          1_000
        );
        discoverySiteProxyToggleBusyVisible = Boolean(
          proxyToggleButton?.disabled &&
            proxyToggleButton.getAttribute("aria-busy") === "true" &&
            proxyToggleButton.textContent?.includes("更新中")
        );
        await waitFor(
          () => bodyIncludes("已开启站点代理:" + DISCOVERY_PROXY_SITE_SMOKE.name),
          3_000
        );
        const proxyRows = await window.aura.db.query(
          "SELECT use_proxy FROM discovery_sites WHERE id = ?",
          [DISCOVERY_PROXY_SITE_SMOKE.id]
        );
        discoverySiteProxyValue = Number(proxyRows[0]?.use_proxy ?? 0);
        discoverySiteProxyToggled =
          discoverySiteProxyToggleBusyVisible &&
          bodyIncludes("已开启站点代理:" + DISCOVERY_PROXY_SITE_SMOKE.name) &&
          discoverySiteProxyValue === 1;

        const hideSiteButton = Array.from(
          document.querySelectorAll(".discovery-card__manage button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "隐藏");
        const hideSiteName =
          hideSiteButton
            ?.closest(".discovery-card-wrap")
            ?.querySelector(".discovery-card__body strong")
            ?.textContent?.trim() ?? "";
        hideSiteButton?.click();
        const discoveryConfirm = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("隐藏内置站点？") ? dialog : null;
        }, 3_000);
        discoverySiteActionConfirmVisible = Boolean(
          discoveryConfirm?.textContent?.includes("可以在管理站点时从隐藏列表恢复")
        );
        const cancelDiscoveryConfirm = Array.from(
          discoveryConfirm?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
        cancelDiscoveryConfirm?.click();
        await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
        discoverySiteActionConfirmCancelled =
          discoverySiteActionConfirmVisible &&
          Boolean(document.querySelector(".discovery-page--home")) &&
          !document.querySelector('[role="dialog"]') &&
          bodyIncludes("学术检索");

        hideSiteButton?.click();
        const discoveryConfirmHide = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("隐藏内置站点？") ? dialog : null;
        }, 3_000);
        const confirmHideButton = Array.from(
          discoveryConfirmHide?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "隐藏站点");
        confirmHideButton?.click();
        await waitFor(
          () =>
            hideSiteButton?.disabled &&
            hideSiteButton.getAttribute("aria-busy") === "true" &&
            hideSiteButton.textContent?.includes("隐藏中"),
          1_000
        );
        discoverySiteHideActionBusyVisible = Boolean(
          hideSiteButton?.disabled &&
            hideSiteButton.getAttribute("aria-busy") === "true" &&
            hideSiteButton.textContent?.includes("隐藏中")
        );
        await waitFor(() => bodyIncludes("已隐藏站点:" + hideSiteName), 3_000);
        const hiddenSiteRows = await window.aura.db.query(
          "SELECT hidden FROM discovery_sites WHERE name = ? LIMIT 1",
          [hideSiteName]
        );
        discoverySiteHideActionHiddenValue = Number(hiddenSiteRows[0]?.hidden ?? 0);
        discoverySiteHideActionConfirmed =
          discoverySiteHideActionBusyVisible &&
          Boolean(hideSiteName) &&
          bodyIncludes("已隐藏站点:" + hideSiteName) &&
          discoverySiteHideActionHiddenValue === 1;

        const removableSiteCard = Array.from(document.querySelectorAll(".discovery-card-wrap")).find(
          (card) => card.textContent?.includes(REMOVABLE_DISCOVERY_SITE_SMOKE.name)
        );
        const removeSiteButton = Array.from(
          removableSiteCard?.querySelectorAll(".discovery-card__manage button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除");
        const removeSiteFailureRowsBefore = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM discovery_sites WHERE id = ?",
          [REMOVABLE_DISCOVERY_SITE_SMOKE.id]
        );
        removeSiteButton?.click();
        const removeSiteFailureConfirm = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("删除自定义站点？") ? dialog : null;
        }, 3_000);
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_REMOVE_SITE__ =
          DISCOVERY_SITE_REMOVE_FAILURE_SMOKE.error;
        try {
          const confirmFailedRemoveButton = Array.from(
            removeSiteFailureConfirm?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除站点");
          confirmFailedRemoveButton?.click();
          discoverySiteRemoveFailureBusyVisible = Boolean(
            await waitFor(
              () =>
                removeSiteButton?.disabled &&
                removeSiteButton.getAttribute("aria-busy") === "true" &&
                removeSiteButton.textContent?.includes("删除中")
                  ? removeSiteButton
                  : null,
              1_000
            )
          );
          await waitFor(
            () =>
              bodyIncludes("删除站点失败，站点仍保留，可重新删除") &&
              bodyIncludes(DISCOVERY_SITE_REMOVE_FAILURE_SMOKE.error),
            3_000
          );
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_REMOVE_SITE__;
        }
        const removeSiteFailureRowsAfter = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM discovery_sites WHERE id = ?",
          [REMOVABLE_DISCOVERY_SITE_SMOKE.id]
        );
        const removableSiteCardAfterFailure = Array.from(
          document.querySelectorAll(".discovery-card-wrap")
        ).find((card) => card.textContent?.includes(REMOVABLE_DISCOVERY_SITE_SMOKE.name));
        const removeSiteButtonAfterFailure = Array.from(
          removableSiteCardAfterFailure?.querySelectorAll(".discovery-card__manage button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除");
        discoverySiteRemoveFailureVisible =
          bodyIncludes("删除站点失败，站点仍保留，可重新删除") &&
          bodyIncludes(DISCOVERY_SITE_REMOVE_FAILURE_SMOKE.error);
        discoverySiteRemoveFailurePreserved = Boolean(
          removableSiteCardAfterFailure &&
            removeSiteButtonAfterFailure &&
            !removeSiteButtonAfterFailure.disabled &&
            removeSiteButtonAfterFailure.getAttribute("aria-busy") !== "true" &&
            !document.querySelector('button[aria-label="撤销删除站点"]')
        );
        discoverySiteRemoveFailureDidNotPersist =
          Number(removeSiteFailureRowsBefore[0]?.n ?? 0) ===
          Number(removeSiteFailureRowsAfter[0]?.n ?? -1);
        removeSiteButtonAfterFailure?.click();
        const removeSiteConfirm = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("删除自定义站点？") ? dialog : null;
        }, 3_000);
        const confirmRemoveButton = Array.from(
          removeSiteConfirm?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除站点");
        confirmRemoveButton?.click();
        await waitFor(
          () =>
            removeSiteButtonAfterFailure?.disabled &&
            removeSiteButtonAfterFailure.getAttribute("aria-busy") === "true" &&
            removeSiteButtonAfterFailure.textContent?.includes("删除中"),
          1_000
        );
        discoverySiteRemoveActionBusyVisible = Boolean(
          removeSiteButtonAfterFailure?.disabled &&
            removeSiteButtonAfterFailure.getAttribute("aria-busy") === "true" &&
            removeSiteButtonAfterFailure.textContent?.includes("删除中")
        );
        await waitFor(
          () => bodyIncludes("已删除站点:" + REMOVABLE_DISCOVERY_SITE_SMOKE.name),
          3_000
        );
        const removableSiteRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM discovery_sites WHERE id = ?",
          [REMOVABLE_DISCOVERY_SITE_SMOKE.id]
        );
        discoverySiteRemoveActionCount = Number(removableSiteRows[0]?.n ?? 0);
        discoverySiteRemoveActionDeleted =
          discoverySiteRemoveActionBusyVisible &&
          bodyIncludes("已删除站点:" + REMOVABLE_DISCOVERY_SITE_SMOKE.name) &&
          discoverySiteRemoveActionCount === 0;

        const removeSiteUndoButton = await waitFor(
          () => document.querySelector('button[aria-label="撤销删除站点"]'),
          1_000
        );
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_RESTORE_SITE__ =
          DISCOVERY_SITE_RESTORE_FAILURE_SMOKE.error;
        try {
          removeSiteUndoButton?.click();
          discoverySiteRemoveUndoFailureBusyVisible = Boolean(
            await waitFor(() => {
              const button = document.querySelector('button[aria-label="撤销删除站点"]');
              return button instanceof HTMLButtonElement &&
                button.getAttribute("aria-busy") === "true" &&
                button.disabled &&
                button.textContent?.includes("撤销中") &&
                bodyIncludes("正在撤销删除站点")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("撤销删除站点失败，撤销入口仍保留，可重新撤销") &&
              bodyIncludes(DISCOVERY_SITE_RESTORE_FAILURE_SMOKE.error),
            3_000
          );
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_RESTORE_SITE__;
        }
        const removeSiteUndoFailureRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM discovery_sites WHERE id = ?",
          [REMOVABLE_DISCOVERY_SITE_SMOKE.id]
        );
        const removeSiteUndoButtonAfterFailure = await waitFor(() => {
          const button = document.querySelector('button[aria-label="撤销删除站点"]');
          return button instanceof HTMLButtonElement &&
            !button.disabled &&
            button.getAttribute("aria-busy") !== "true"
            ? button
            : null;
        }, 1_000);
        discoverySiteRemoveUndoFailureVisible =
          bodyIncludes("撤销删除站点失败，撤销入口仍保留，可重新撤销") &&
          bodyIncludes(DISCOVERY_SITE_RESTORE_FAILURE_SMOKE.error);
        discoverySiteRemoveUndoFailurePreserved = Boolean(removeSiteUndoButtonAfterFailure);
        discoverySiteRemoveUndoFailureDidNotPersist =
          Number(removeSiteUndoFailureRows[0]?.n ?? -1) === 0;
        removeSiteUndoButtonAfterFailure?.click();
        discoverySiteRemoveUndoBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销删除站点"]');
            return button instanceof HTMLButtonElement &&
              button.getAttribute("aria-busy") === "true" &&
              button.disabled &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销删除站点")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("已恢复站点:" + REMOVABLE_DISCOVERY_SITE_SMOKE.name) &&
            Boolean(
              Array.from(document.querySelectorAll(".discovery-card-wrap")).find((card) =>
                card.textContent?.includes(REMOVABLE_DISCOVERY_SITE_SMOKE.name)
              )
            ),
          3_000
        );
        const restoredSiteRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n, COALESCE(MAX(name), '') AS name, COALESCE(MAX(home_url), '') AS home_url, COALESCE(MAX(search_url), '') AS search_url, COALESCE(MAX(hidden), 1) AS hidden FROM discovery_sites WHERE id = ?",
          [REMOVABLE_DISCOVERY_SITE_SMOKE.id]
        );
        discoverySiteRemoveUndoRecovered =
          discoverySiteRemoveUndoBusyVisible &&
          Number(restoredSiteRows[0]?.n ?? 0) === 1 &&
          restoredSiteRows[0]?.name === REMOVABLE_DISCOVERY_SITE_SMOKE.name &&
          restoredSiteRows[0]?.home_url === REMOVABLE_DISCOVERY_SITE_SMOKE.homeUrl &&
          restoredSiteRows[0]?.search_url === REMOVABLE_DISCOVERY_SITE_SMOKE.searchUrl &&
          Number(restoredSiteRows[0]?.hidden ?? 1) === 0;

        const manualHiddenRestoreButton = Array.from(
          document.querySelectorAll(".discovery-hidden-row button")
        ).find((button) => button.textContent?.includes(MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.name));
        manualHiddenRestoreButton?.click();
        await waitFor(
          () =>
            manualHiddenRestoreButton?.disabled &&
            manualHiddenRestoreButton.getAttribute("aria-busy") === "true" &&
            manualHiddenRestoreButton.textContent?.includes("恢复中"),
          1_000
        );
        discoveryManualHiddenSiteRestoreBusyVisible = Boolean(
          manualHiddenRestoreButton?.disabled &&
            manualHiddenRestoreButton.getAttribute("aria-busy") === "true" &&
            manualHiddenRestoreButton.textContent?.includes("恢复中")
        );
        await waitFor(
          () => bodyIncludes("已恢复站点:" + MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.name),
          3_000
        );
        const manualHiddenSiteRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n, COALESCE(MAX(hidden), 0) AS hidden FROM discovery_sites WHERE home_url = ?",
          [MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.homeUrl]
        );
        discoveryManualHiddenSiteRestoredCount = Number(manualHiddenSiteRows[0]?.n ?? 0);
        discoveryManualHiddenSiteRestored =
          discoveryManualHiddenSiteRestoreBusyVisible &&
          bodyIncludes("已恢复站点:" + MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.name) &&
          discoveryManualHiddenSiteRestoredCount === 1 &&
          Number(manualHiddenSiteRows[0]?.hidden ?? 1) === 0;

        findButton("添加站点")?.click();
        await waitFor(() => document.querySelector(".discovery-add-form"), 2_000);
        const addSiteForm = document.querySelector(".discovery-add-form");
        const siteNameInput = addSiteForm?.querySelector('input[placeholder^="站点名称"]');
        const siteHomeInput = addSiteForm?.querySelector('input[placeholder^="主页 URL"]');
        const siteSearchInput = addSiteForm?.querySelector('input[placeholder^="可选:检索 URL"]');
        if (addSiteForm && siteNameInput && siteHomeInput) {
          setInputValue(siteNameInput, "Smoke Duplicate Site Copy");
          setInputValue(siteHomeInput, "smoke-site.example");
          if (siteSearchInput) setInputValue(siteSearchInput, DISCOVERY_SITE_SMOKE.searchUrl);
          const addSiteSubmit = Array.from(addSiteForm.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "添加"
          );
          addSiteSubmit?.click();
          await waitFor(
            () =>
              addSiteForm.getAttribute("aria-busy") === "true" &&
              addSiteSubmit?.disabled &&
              addSiteSubmit.getAttribute("aria-busy") === "true" &&
              addSiteSubmit.textContent?.includes("添加中"),
            1_000
          );
          discoveryDuplicateSiteAddBusyVisible = Boolean(
            addSiteForm.getAttribute("aria-busy") === "true" &&
              addSiteSubmit?.disabled &&
              addSiteSubmit.getAttribute("aria-busy") === "true" &&
              addSiteSubmit.textContent?.includes("添加中")
          );
          await waitFor(() => bodyIncludes("站点已存在"), 2_000);
          const duplicateSiteRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM discovery_sites WHERE home_url = ?",
            [DISCOVERY_SITE_SMOKE.homeUrl]
          );
          discoveryDuplicateSiteCount = Number(duplicateSiteRows[0]?.n ?? 0);
          discoveryDuplicateSiteMessageVisible = bodyIncludes("站点已存在");
          discoveryDuplicateSiteBlocked =
            discoveryDuplicateSiteAddBusyVisible &&
            discoveryDuplicateSiteMessageVisible &&
            discoveryDuplicateSiteCount === 1;
        }

        findButton("添加站点")?.click();
        await waitFor(() => document.querySelector(".discovery-add-form"), 2_000);
        const restoreSiteForm = document.querySelector(".discovery-add-form");
        const restoreSiteNameInput = restoreSiteForm?.querySelector('input[placeholder^="站点名称"]');
        const restoreSiteHomeInput = restoreSiteForm?.querySelector('input[placeholder^="主页 URL"]');
        const restoreSiteSearchInput = restoreSiteForm?.querySelector(
          'input[placeholder^="可选:检索 URL"]'
        );
        if (restoreSiteForm && restoreSiteNameInput && restoreSiteHomeInput) {
          setInputValue(restoreSiteNameInput, "Smoke Hidden Duplicate Site Copy");
          setInputValue(restoreSiteHomeInput, "hidden-smoke-site.example");
          if (restoreSiteSearchInput) {
            setInputValue(restoreSiteSearchInput, HIDDEN_DISCOVERY_SITE_SMOKE.searchUrl);
          }
          const restoreSiteSubmit = Array.from(restoreSiteForm.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "添加"
          );
          restoreSiteSubmit?.click();
          await waitFor(
            () =>
              restoreSiteForm.getAttribute("aria-busy") === "true" &&
              restoreSiteSubmit?.disabled &&
              restoreSiteSubmit.getAttribute("aria-busy") === "true" &&
              restoreSiteSubmit.textContent?.includes("添加中"),
            1_000
          );
          discoveryHiddenSiteAddBusyVisible = Boolean(
            restoreSiteForm.getAttribute("aria-busy") === "true" &&
              restoreSiteSubmit?.disabled &&
              restoreSiteSubmit.getAttribute("aria-busy") === "true" &&
              restoreSiteSubmit.textContent?.includes("添加中")
          );
          await waitFor(() => bodyIncludes("已恢复站点"), 2_000);
          const hiddenDuplicateSiteRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n, COALESCE(MAX(hidden), 0) AS hidden FROM discovery_sites WHERE home_url = ?",
            [HIDDEN_DISCOVERY_SITE_SMOKE.homeUrl]
          );
          discoveryHiddenDuplicateSiteCount = Number(hiddenDuplicateSiteRows[0]?.n ?? 0);
          discoveryHiddenDuplicateSiteMessageVisible = bodyIncludes("已恢复站点");
          discoveryHiddenSiteRestored =
            discoveryHiddenSiteAddBusyVisible &&
            discoveryHiddenDuplicateSiteMessageVisible &&
            discoveryHiddenDuplicateSiteCount === 1 &&
            Number(hiddenDuplicateSiteRows[0]?.hidden ?? 1) === 0;
        }

        findButton("添加站点")?.click();
        await waitFor(() => document.querySelector(".discovery-add-form"), 2_000);
        const credentialSiteForm = document.querySelector(".discovery-add-form");
        const credentialSiteNameInput = credentialSiteForm?.querySelector(
          'input[placeholder^="站点名称"]'
        );
        const credentialSiteHomeInput = credentialSiteForm?.querySelector(
          'input[placeholder^="主页 URL"]'
        );
        const credentialSiteSearchInput = credentialSiteForm?.querySelector(
          'input[placeholder^="可选:检索 URL"]'
        );
        if (credentialSiteForm && credentialSiteNameInput && credentialSiteHomeInput) {
          setInputValue(credentialSiteNameInput, DISCOVERY_CREDENTIAL_SITE_SMOKE.name);
          setInputValue(credentialSiteHomeInput, DISCOVERY_CREDENTIAL_SITE_SMOKE.homeUrl);
          if (credentialSiteSearchInput) {
            setInputValue(credentialSiteSearchInput, DISCOVERY_CREDENTIAL_SITE_SMOKE.searchUrl);
          }
          const credentialSiteSubmit = Array.from(credentialSiteForm.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "添加"
          );
          credentialSiteSubmit?.click();
          await waitFor(
            () => bodyIncludes("添加站点失败:主页 URL 中不能包含用户名或密码"),
            2_000
          );
          const credentialSiteRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM discovery_sites WHERE home_url LIKE ?",
            ["%credential-smoke-site.example%"]
          );
          discoverySiteCredentialsRejected = bodyIncludes(
            "添加站点失败:主页 URL 中不能包含用户名或密码"
          );
          discoverySiteCredentialDidNotPersist = Number(credentialSiteRows[0]?.n ?? 0) === 0;
          const credentialSiteCancel = Array.from(credentialSiteForm.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消"
          );
          credentialSiteCancel?.click();
        }

`;
