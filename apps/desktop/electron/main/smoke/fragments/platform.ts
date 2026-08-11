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
        // Credentials are no longer a renderer capability. Dedicated settings
        // commands exercise main-owned encryption later in this smoke flow;
        // this check specifically guards against reintroducing a preload slot.
        platformSecretsRendererIsolated = !Object.hasOwn(window.aura ?? {}, "secrets");
        // Arbitrary network transport is main-owned by narrow commands. The
        // renderer must not receive a generic HTTP proxy or abort handle.
        platformGenericHttpRendererIsolated =
          !Object.hasOwn(window.aura ?? {}, "http") &&
          !Object.hasOwn(window.aura ?? {}, "cancelHttp");
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
