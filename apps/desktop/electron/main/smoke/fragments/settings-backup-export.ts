export const smokeSettingsBackupExport = String.raw`        const backupExportButton = () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => {
              const label = button.textContent?.replace(/\s+/g, " ").trim();
              return label === "导出整库备份" || label === "导出中...";
            }
          );
        const backupExportGraphCacheKey = "smoke-backup-export-graph-cache";
        const backupExportTranslationCacheKey = "smoke-backup-export-translation-cache";
        const backupExportDiscoverySiteId = "smoke-backup-export-discovery-site";
        const backupExportSavedSearchId = "smoke-backup-export-saved-search";
        const backupExportDerivedArtifactId = "smoke-backup-export-derived-artifact";
        await window.aura.db.run(
          "INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)",
          [
            backupExportGraphCacheKey,
            JSON.stringify({ stale: "backup-export-graph-cache" }),
            Date.now()
          ]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO translation_cache (cache_key, engine, target_lang, result, created_at) VALUES (?, ?, ?, ?, ?)",
          [
            backupExportTranslationCacheKey,
            "smoke-export-cache",
            "zh",
            "backup-export-translation-cache",
            Date.now()
          ]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO discovery_sites (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, 9999, 0, ?, ?)",
          [
            backupExportDiscoverySiteId,
            "Smoke Backup Credential Site",
            "https://site-user:site-pass@discovery.example.test/",
            "https://search-user:search-pass@search.example.test/search",
            Date.now(),
            Date.now()
          ]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO saved_searches (id, library_id, query, sources_json, seen_ids_json, new_count, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)",
          [
            backupExportSavedSearchId, libraryId,
            "Smoke backup credential source",
            JSON.stringify(["https://source-user:source-pass@source.example.test/feed"]),
            "[]",
            "Fetch failed https://inline-user:inline-pass@inline.example.test/error",
            Date.now(),
            Date.now()
          ]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO derived_artifacts (id, library_id, source_table, source_id, kind, model, prompt_hash, input_hash, payload_json, local_only, syncable, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)",
          [
            backupExportDerivedArtifactId,
            libraryId,
            "works",
            SAMPLE.workId,
            "reader-digest",
            "smoke-model",
            "smoke-prompt",
            "smoke-input",
            JSON.stringify({
              apiKey: "artifact-secret-key",
              nested: {
                accessToken: "artifact-access-token",
                client_secret: "artifact-client-secret",
                cookie: "artifact-cookie",
                id_token: "artifact-id-token",
                session_id: "artifact-session-id",
                sourceUrl: "https://artifact-user:artifact-pass@artifact.example.test/path"
              }
            }),
            Date.now(),
            Date.now()
          ]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)",
          [
            "research.proxy",
            JSON.stringify("http://backup-user:backup-pass@127.0.0.1:9876"),
            Date.now()
          ]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)",
          [
            "research.ezproxy",
            JSON.stringify("https://campus-user:campus-pass@login.ezproxy.example.edu/login?url="),
            Date.now()
          ]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)",
          ["secret:legacy:apiKey", JSON.stringify("backup-secret-key"), Date.now()]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)",
          ["local.library_id", JSON.stringify(libraryId), Date.now()]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)",
          ["local.device_id", JSON.stringify("smoke-backup-local-device"), Date.now()]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)",
          ["sync.smoke-backup.last_pushed_at", JSON.stringify(123456), Date.now()]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)",
          [
            "sync.conflict.smoke-backup.works.w1.title",
            JSON.stringify({ losingValue: "stale" }),
            Date.now()
          ]
        );
        const originalBackupAnchorClick = HTMLAnchorElement.prototype.click;
        const originalBackupExportCreateObjectUrl = URL.createObjectURL;
        let backupDownloadCount = 0;
        let backupDownloadName = "";
        let backupExportTextPromise = Promise.resolve("");
        URL.createObjectURL = (blob) => {
          if (blob instanceof Blob) backupExportTextPromise = blob.text();
          return "blob:aurascholar-backup-smoke";
        };
        HTMLAnchorElement.prototype.click = function () {
          if (this.download?.startsWith("aurascholar-backup-") && this.download.endsWith(".json")) {
            backupDownloadCount += 1;
            backupDownloadName = this.download;
            return;
          }
          return originalBackupAnchorClick.call(this);
        };
        try {
          backupExportButton()?.click();
          await waitFor(
            () =>
              backupExportButton()?.disabled &&
              bodyIncludes("正在导出整库备份") &&
              bodyIncludes("导出中..."),
            1_000
          );
          settingsBackupExportBusyVisible = Boolean(
            backupExportButton()?.disabled &&
              bodyIncludes("正在导出整库备份") &&
              bodyIncludes("导出中...")
          );
          settingsBackupExportAriaBusyVisible = Boolean(
            settingsBackupExportBusyVisible &&
              backupExportButton()?.getAttribute("aria-busy") === "true"
          );
          await waitFor(
            () =>
              !backupExportButton()?.disabled &&
              bodyIncludes("整库 JSON 备份已导出") &&
              bodyIncludes(".json") &&
              bodyIncludes("KB"),
            3_000
          );
          settingsBackupExportSuccessVisible =
            backupDownloadCount === 1 &&
            backupDownloadName.startsWith("aurascholar-backup-") &&
            bodyIncludes("整库 JSON 备份已导出") &&
            bodyIncludes(backupDownloadName);
          try {
            const backupSafety = JSON.parse(
              localStorage.getItem("library-backup-safety") ?? "null"
            );
            settingsBackupExportRecencyVisible =
              bodyIncludes("最近备份") &&
              bodyIncludes("已备份") &&
              bodyIncludes("恢复提醒") &&
              bodyIncludes("PDF 需重挂载") &&
              bodyIncludes("格式 v3") &&
              backupSafety?.filename === backupDownloadName &&
              typeof backupSafety?.exportedAt === "string" &&
              Number.isFinite(Date.parse(backupSafety.exportedAt)) &&
              backupSafety?.size > 0 &&
              backupSafety?.version === 3;
          } catch {
            settingsBackupExportRecencyVisible = false;
          }
          const exportedBackupText = await backupExportTextPromise;
          try {
            const exportedBackup = JSON.parse(exportedBackupText);
            const settingsRows = Array.isArray(exportedBackup?.tables?.settings)
              ? exportedBackup.tables.settings
              : [];
            const exportedTables =
              exportedBackup?.tables && typeof exportedBackup.tables === "object"
                ? exportedBackup.tables
                : {};
            const proxyRow = settingsRows.find((row) => row?.key === "research.proxy");
            const ezproxyRow = settingsRows.find((row) => row?.key === "research.ezproxy");
            const discoveryRows = Array.isArray(exportedBackup?.tables?.discovery_sites)
              ? exportedBackup.tables.discovery_sites
              : [];
            const savedSearchRows = Array.isArray(exportedBackup?.tables?.saved_searches)
              ? exportedBackup.tables.saved_searches
              : [];
            const derivedArtifactRows = Array.isArray(exportedBackup?.tables?.derived_artifacts)
              ? exportedBackup.tables.derived_artifacts
              : [];
            const discoveryRow = discoveryRows.find(
              (row) => row?.id === backupExportDiscoverySiteId
            );
            const savedSearchRow = savedSearchRows.find(
              (row) => row?.id === backupExportSavedSearchId
            );
            const derivedArtifactRow = derivedArtifactRows.find(
              (row) => row?.id === backupExportDerivedArtifactId
            );
            const proxyValue = proxyRow ? JSON.parse(proxyRow.value_json) : "";
            const ezproxyValue = ezproxyRow ? JSON.parse(ezproxyRow.value_json) : "";
            const savedSearchSources = savedSearchRow
              ? JSON.parse(savedSearchRow.sources_json)
              : [];
            const derivedArtifactPayload = derivedArtifactRow
              ? JSON.parse(derivedArtifactRow.payload_json)
              : null;
            settingsBackupExportEphemeralDataExcluded =
              !Object.hasOwn(exportedTables, "graph_cache") &&
              !Object.hasOwn(exportedTables, "translation_cache") &&
              !exportedBackupText.includes(backupExportGraphCacheKey) &&
              !exportedBackupText.includes(backupExportTranslationCacheKey) &&
              !exportedBackupText.includes("backup-export-graph-cache") &&
              !exportedBackupText.includes("backup-export-translation-cache");
            settingsBackupExportSecretsSanitized =
              proxyValue === "http://127.0.0.1:9876/" &&
              ezproxyValue === "https://login.ezproxy.example.edu/login?url=" &&
              discoveryRow?.home_url === "https://discovery.example.test/" &&
              discoveryRow?.search_url === "https://search.example.test/search" &&
              savedSearchSources[0] === "https://source.example.test/feed" &&
              savedSearchRow?.last_error ===
                "Fetch failed https://inline.example.test/error" &&
              derivedArtifactPayload?.apiKey === "" &&
              derivedArtifactPayload?.nested?.accessToken === "" &&
              derivedArtifactPayload?.nested?.client_secret === "" &&
              derivedArtifactPayload?.nested?.cookie === "" &&
              derivedArtifactPayload?.nested?.id_token === "" &&
              derivedArtifactPayload?.nested?.session_id === "" &&
              derivedArtifactPayload?.nested?.sourceUrl === "https://artifact.example.test/path" &&
              !settingsRows.some((row) => row?.key === "secret:legacy:apiKey") &&
              !settingsRows.some(
                (row) =>
                  row?.key === "local.library_id" ||
                  row?.key === "local.device_id" ||
                  (typeof row?.key === "string" && row.key.startsWith("sync."))
              ) &&
              !exportedBackupText.includes("backup-pass") &&
              !exportedBackupText.includes("campus-pass") &&
              !exportedBackupText.includes("site-user") &&
              !exportedBackupText.includes("site-pass") &&
              !exportedBackupText.includes("source-user") &&
              !exportedBackupText.includes("source-pass") &&
              !exportedBackupText.includes("inline-user") &&
              !exportedBackupText.includes("inline-pass") &&
              !exportedBackupText.includes("artifact-user") &&
              !exportedBackupText.includes("artifact-pass") &&
              !exportedBackupText.includes("artifact-secret-key") &&
              !exportedBackupText.includes("artifact-access-token") &&
              !exportedBackupText.includes("artifact-client-secret") &&
              !exportedBackupText.includes("artifact-cookie") &&
              !exportedBackupText.includes("artifact-id-token") &&
              !exportedBackupText.includes("artifact-session-id") &&
              !exportedBackupText.includes("backup-secret-key") &&
              !exportedBackupText.includes("smoke-backup-local-device") &&
              !exportedBackupText.includes("sync.smoke-backup.last_pushed_at") &&
              !exportedBackupText.includes("sync.conflict.smoke-backup");
          } catch {
            settingsBackupExportSecretsSanitized = false;
          }
        } finally {
          HTMLAnchorElement.prototype.click = originalBackupAnchorClick;
          URL.createObjectURL = originalBackupExportCreateObjectUrl;
        }

        const originalBackupCreateObjectUrl = URL.createObjectURL;
        URL.createObjectURL = () => {
          throw new Error("smoke-backup-export-failed");
        };
        try {
          backupExportButton()?.click();
          await waitFor(
            () => bodyIncludes("导出失败：smoke-backup-export-failed"),
            3_000
          );
          settingsBackupExportFailureVisible = bodyIncludes("导出失败：smoke-backup-export-failed");
        } finally {
          URL.createObjectURL = originalBackupCreateObjectUrl;
        }

`;
