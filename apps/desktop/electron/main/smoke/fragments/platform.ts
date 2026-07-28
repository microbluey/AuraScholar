export const smokePlatform = String.raw`        let dbError = null;
        try {
          if (window.aura?.db?.query && window.aura?.db?.queryScalar) {
            const libraryRows = await window.aura.db.query(
              "SELECT value_json FROM settings WHERE key = 'local.library_id' LIMIT 1"
            );
            const parsedLibraryId = libraryRows[0]?.value_json
              ? JSON.parse(libraryRows[0].value_json)
              : "";
            if (typeof parsedLibraryId !== "string" || parsedLibraryId.length === 0) {
              throw new Error("Smoke test requires an explicit local Library identity");
            }
            libraryId = parsedLibraryId;
            const countRows = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM works WHERE library_id = ?",
              [libraryId]
            );
            initialWorkCount = Number(countRows[0]?.n ?? 0);
          }
        } catch (error) {
          dbError = error instanceof Error ? error.message : String(error);
        }
        try {
          const secretKeys = Array.from({ length: 8 }, (_item, index) =>
            "smoke:concurrent-secret:" + index
          );
          await Promise.all(secretKeys.map((key) => window.aura?.secrets?.delete?.(key)));
          await Promise.all(
            secretKeys.map((key, index) =>
              window.aura?.secrets?.set?.(key, "concurrent-secret-value-" + index)
            )
          );
          const secretValues = await Promise.all(
            secretKeys.map((key) => window.aura?.secrets?.get?.(key))
          );
          platformSecretsConcurrentWritesPreserved = secretValues.every(
            (value, index) => value === "concurrent-secret-value-" + index
          );
          await Promise.all(secretKeys.map((key) => window.aura?.secrets?.delete?.(key)));
        } catch {
          platformSecretsConcurrentWritesPreserved = false;
        }
        try {
          await window.aura?.openExternal?.("javascript:alert('aurascholar-smoke')");
        } catch {
          externalUnsafeRejected = true;
        }
        try {
          await window.aura?.openExternal?.("https://user:pass@example.com/aurascholar-smoke");
        } catch {
          externalCredentialsRejected = true;
        }
        try {
          await window.aura?.http?.({ url: "file:///private/tmp/aurascholar-smoke-http" });
        } catch {
          try {
            await window.aura?.http?.({
              url: "https://user:pass@example.com/aurascholar-smoke-http",
            });
          } catch {
            platformHttpUnsafeRejected = true;
          }
        }
        try {
          await window.aura?.research?.open?.(
            "smoke-unsafe-url",
            "file:///private/tmp/aurascholar-smoke-research",
          );
        } catch {
          try {
            await window.aura?.research?.open?.(
              "smoke-unsafe-url",
              "https://user:pass@example.com/aurascholar-smoke-research",
            );
          } catch {
            researchUnsafeUrlRejected = true;
          }
        }
        try {
          const citationBridgePort = await waitFor(
            async () => window.aura?.citationBridgePort?.(),
            2_000
          );
          if (citationBridgePort) {
            const bridgeBase = "http://127.0.0.1:" + citationBridgePort;
            const pingRes = await fetch(bridgeBase + "/ping");
            const pingJson = await pingRes.json().catch(() => null);
            citationBridgePingOk =
              pingRes.status === 200 &&
              pingJson?.ok === true &&
              pingJson?.app === "aurascholar" &&
              pingRes.headers.get("cache-control") === "no-store";

            const unauthRes = await fetch(bridgeBase + "/works/search?q=smoke");
            const unauthJson = await unauthRes.json().catch(() => null);
            citationBridgeUnauthRejected =
              unauthRes.status === 401 && unauthJson?.error === "bad token";

            const methodRes = await fetch(bridgeBase + "/ping", { method: "POST" });
            const methodJson = await methodRes.json().catch(() => null);
            citationBridgeMethodGuard =
              methodRes.status === 405 &&
              methodJson?.error === "method not allowed" &&
              (methodRes.headers.get("allow") ?? "").includes("GET");
          }
        } catch {
          citationBridgePingOk = false;
          citationBridgeUnauthRejected = false;
          citationBridgeMethodGuard = false;
        }
        const beforeExternalNavigation = location.href;
        try {
          location.href = "file:///private/tmp/aurascholar-smoke-navigation.html";
          await wait(250);
          externalNavigationBlocked =
            location.href === beforeExternalNavigation && document.title === "AuraScholar";
        } catch {
          externalNavigationBlocked =
            location.href === beforeExternalNavigation && document.title === "AuraScholar";
        }

`;
