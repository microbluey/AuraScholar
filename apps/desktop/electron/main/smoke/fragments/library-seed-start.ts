export const smokeLibrarySeedStart = String.raw`        if (Number(initialWorkCount) === 0) {
          await waitFor(() => bodyIncludes("把第一篇论文放进工作台"), 8_000);
        }
        const emptyStateVisible = bodyIncludes("把第一篇论文放进工作台");
        if (!dbError && Number(initialWorkCount) === 0) {
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READ__ =
            "Smoke library initial load failure";
          document.querySelector('[data-library-action="refresh"]')?.click();
          await waitFor(
            () =>
              bodyIncludes("文献库暂时不可用") &&
              bodyIncludes("Smoke library initial load failure") &&
              Boolean(document.querySelector('button[aria-label="重试读取文献库"]')),
            3_000
          );
          libraryLoadRetryAttempts = 1;
          document.querySelector('button[aria-label="重试读取文献库"]')?.click();
          await waitFor(
            () =>
              bodyIncludes("把第一篇论文放进工作台") &&
              !bodyIncludes("文献库暂时不可用") &&
              !bodyIncludes("Smoke library initial load failure"),
            5_000
          );
          libraryLoadRetryAttempts += 1;
          libraryLoadRetryRecoveryVisible =
            libraryLoadRetryAttempts === 2 &&
            bodyIncludes("把第一篇论文放进工作台") &&
            !bodyIncludes("文献库暂时不可用") &&
            !bodyIncludes("Smoke library initial load failure");
          libraryLoadRetryRecoveryDetail =
            "attempts=" +
            libraryLoadRetryAttempts +
            "; onboarding=" +
            bodyIncludes("把第一篇论文放进工作台") +
            "; error=" +
            bodyIncludes("文献库暂时不可用");
          delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READ__;
        } else {
          libraryLoadRetryRecoveryVisible = true;
          libraryLoadRetryRecoveryDetail =
            "skipped=existing-or-unavailable-library; initialWorkCount=" +
            initialWorkCount +
            "; dbError=" +
            dbError;
        }

        if (!dbError && window.aura?.db?.run && window.aura?.db?.exec) {
          const now = Date.now();
          await window.aura.db.exec("BEGIN");
`;
