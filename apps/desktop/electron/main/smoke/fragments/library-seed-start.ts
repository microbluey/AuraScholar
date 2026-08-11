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
          if (!window.aura?.data?.command) {
            throw new Error("Smoke test requires the typed data-command bridge");
          }
          const typedIngestWorkInput = {
            authors: [{ displayName: "Katherine Johnson", position: 0 }],
            doi: TYPED_INGEST_SMOKE.doi,
            title: TYPED_INGEST_SMOKE.title,
            type: "article",
            venueName: TYPED_INGEST_SMOKE.venue,
            year: 2026
          };
          const typedIngestPdfInput = (receipt) => ({
            fetchedVia: "manual",
            fileName: TYPED_INGEST_SMOKE.fileName,
            pageCount: 1,
            stageId: receipt.stageId
          });
          const typedIngestInitialReceipt = await window.aura.data.command("library.stagePdf", {
            bytes: makeSmokePdf(TYPED_INGEST_SMOKE.title)
          });
          const typedIngestInitial = await window.aura.data.command("library.finalizeIngest", {
            mode: "create",
            pdf: typedIngestPdfInput(typedIngestInitialReceipt),
            workInput: typedIngestWorkInput
          });
          const typedIngestDuplicateReceipt = await window.aura.data.command("library.stagePdf", {
            bytes: makeSmokePdf(TYPED_INGEST_SMOKE.title)
          });
          const typedIngestDuplicate = await window.aura.data.command("library.finalizeIngest", {
            mode: "create",
            pdf: typedIngestPdfInput(typedIngestDuplicateReceipt),
            workInput: typedIngestWorkInput
          });
          libraryTypedPdfIngestCommitted =
            typedIngestInitial.pdfFetched === true &&
            typedIngestInitial.deduped === false &&
            typedIngestInitial.attachment?.deduped === false &&
            typedIngestDuplicate.pdfFetched === true &&
            typedIngestDuplicate.deduped === true &&
            typedIngestDuplicate.workId === typedIngestInitial.workId &&
            typedIngestDuplicate.attachment?.deduped === true &&
            typedIngestDuplicate.attachment?.id === typedIngestInitial.attachment?.id;
          libraryTypedPdfIngestDetail =
            "created=" +
            typedIngestInitial.workId +
            "; duplicate=" +
            typedIngestDuplicate.workId +
            "; attachment=" +
            (typedIngestInitial.attachment?.id ?? "missing");
          const now = Date.now();
          await window.aura.db.exec("BEGIN");
`;
