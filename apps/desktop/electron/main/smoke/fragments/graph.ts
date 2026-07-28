export const smokeGraph = String.raw`        location.hash = "#/graph";
        await waitFor(
          () =>
            location.hash === "#/graph" &&
            bodyIncludes("引文脉络") &&
            bodyIncludes("生成最近文献图谱") &&
            bodyIncludes(SAMPLE.title),
          5_000
        );
        const graphEmptyLatestButton = findExactButton("生成最近文献图谱");
        graphEmptyLatestCtaVisible =
          Boolean(graphEmptyLatestButton) &&
          bodyIncludes("最近可构建") &&
          bodyIncludes(SAMPLE.title);
        graphEmptyLatestButton?.click();
        await waitFor(
          () =>
            location.hash.includes("/graph?doi=" + encodeURIComponent(SAMPLE.doi)) &&
            bodyIncludes("引文脉络") &&
            Boolean(document.querySelector(".citation-graph-node")),
          5_000
        );
        graphEmptyLatestCtaHash = location.hash;
        graphEmptyLatestCtaOpened =
          graphEmptyLatestCtaHash.includes("/graph?doi=" + encodeURIComponent(SAMPLE.doi)) &&
          Boolean(document.querySelector(".citation-graph-node"));

        location.hash = "#/graph?doi=" + encodeURIComponent(GRAPH_SMOKE.retryDoi);
        await waitFor(
          () =>
            location.hash.includes("/graph") &&
            bodyIncludes("暂时无法构建图谱") &&
            bodyIncludes("OpenAlex 中找不到这篇论文") &&
            Boolean(findExactButton("重试构建")),
          3_000
        );
        findExactButton("重试构建")?.click();
        await waitFor(
          () =>
            bodyIncludes(GRAPH_SMOKE.retryTitle) &&
            Boolean(document.querySelector(".citation-graph-node")) &&
            !bodyIncludes("暂时无法构建图谱"),
          3_000
        );
        graphRetryRecoveryVisible =
          graphRetryAttempts === 2 &&
          bodyIncludes(GRAPH_SMOKE.retryTitle) &&
          Boolean(document.querySelector(".citation-graph-node")) &&
          !bodyIncludes("暂时无法构建图谱");

        location.hash = "#/graph?doi=" + encodeURIComponent(GRAPH_SMOKE.centerDoi);
        await waitFor(
          () =>
            location.hash.includes("/graph") &&
            bodyIncludes("引文脉络") &&
            bodyIncludes(GRAPH_SMOKE.centerTitle) &&
            Boolean(document.querySelector(".citation-graph-node")),
          5_000
        );
        graphCachedVisible =
          bodyIncludes(GRAPH_SMOKE.centerTitle) &&
          bodyIncludes("思想来源") &&
          Boolean(document.querySelector('[aria-label*="' + GRAPH_SMOKE.referenceTitle + '"]'));
        const graphDoiInput = document.querySelector('input[aria-label="图谱中心论文 DOI"]');
        if (graphDoiInput) {
          setInputValue(graphDoiInput, "10.4242/aurascholar.graph-ime");
          dispatchComposingEnter(graphDoiInput);
          await wait(200);
          graphInputCompositionIgnored =
            location.hash === "#/graph?doi=" + encodeURIComponent(GRAPH_SMOKE.centerDoi) &&
            bodyIncludes(GRAPH_SMOKE.centerTitle) &&
            !bodyIncludes("graph-ime");
        }
        const graphReferenceNode = document.querySelector(
          '[aria-label*="' + GRAPH_SMOKE.referenceTitle + '"]'
        );
        graphReferenceNode?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
        );
        await waitFor(
          () => bodyIncludes(GRAPH_SMOKE.referenceTitle) && Boolean(findExactButton("加入文献库")),
          1_500
        );
        graphNodeKeyboardSelectable =
          graphCachedVisible &&
          bodyIncludes(GRAPH_SMOKE.referenceTitle) &&
          Boolean(findExactButton("加入文献库"));
        window.__AURASCHOLAR_SMOKE_INGEST_FROM_INPUT__ = async (input) => {
          if (input === GRAPH_SMOKE.referenceDoi) return null;
          return undefined;
        };
        const graphImportButton = findExactButton("加入文献库");
        graphImportButton?.click();
        await waitFor(
          () =>
            graphImportButton?.disabled &&
            graphImportButton.getAttribute("aria-busy") === "true" &&
            graphImportButton.textContent?.includes("入库中") &&
            bodyIncludes("正在将《" + GRAPH_SMOKE.referenceTitle + "》加入文献库") &&
            Boolean(findExactButton("以此为中心展开")?.disabled),
          1_000
        );
        graphImportBusyVisible =
          Boolean(graphImportButton?.disabled) &&
          graphImportButton?.getAttribute("aria-busy") === "true" &&
          Boolean(graphImportButton?.textContent?.includes("入库中")) &&
          bodyIncludes("正在将《" + GRAPH_SMOKE.referenceTitle + "》加入文献库") &&
          Boolean(findExactButton("以此为中心展开")?.disabled);
        await waitFor(() => bodyIncludes("没有解析出可入库文献"), 3_000);
        graphImportFailureFeedbackVisible = bodyIncludes("没有解析出可入库文献");
        const graphLibraryCountRows = await window.aura?.db?.query?.(
          "SELECT COUNT(*) AS n FROM works WHERE deleted_at IS NULL AND library_id = ?",
          [libraryId]
        );
        const graphLibraryCountBefore =
          statusbarMetric("文献") ?? Number(graphLibraryCountRows?.[0]?.n ?? 0);
        window.__AURASCHOLAR_SMOKE_INGEST_FROM_INPUT__ = async (input) => {
          if (input === GRAPH_SMOKE.referenceDoi) return null;
          if (input !== GRAPH_SMOKE.successDoi) return undefined;
          const now = Date.now();
          await window.aura.db.run(
            "INSERT OR REPLACE INTO works (id, library_id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              "smoke-work-graph-import-success", libraryId,
              GRAPH_SMOKE.successDoi,
              GRAPH_SMOKE.successTitle,
              "A deterministic smoke-test paper for validating graph import success refresh handling.",
              2025,
              "Smoke Import Journal",
              "article",
              "unread",
              0,
              now,
              now
            ]
          );
          return {
            workId: "smoke-work-graph-import-success",
            deduped: false,
            title: GRAPH_SMOKE.successTitle,
            pdfFetched: false
          };
        };
        const graphSuccessNode = document.querySelector(
          '[aria-label*="' + GRAPH_SMOKE.successTitle + '"]'
        );
        graphSuccessNode?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
        );
        await waitFor(
          () => bodyIncludes(GRAPH_SMOKE.successTitle) && Boolean(findExactButton("加入文献库")),
          1_500
        );
        const graphSuccessImportButton = findExactButton("加入文献库");
        graphSuccessImportButton?.click();
        await waitFor(
          () =>
            bodyIncludes("已加入文献库：《" + GRAPH_SMOKE.successTitle + "》。") &&
            statusbarMetric("文献") === graphLibraryCountBefore + 1,
          3_000
        );
        graphImportSuccessVisible = bodyIncludes(
          "已加入文献库：《" + GRAPH_SMOKE.successTitle + "》。"
        );
        graphImportSuccessStatsUpdated =
          graphImportSuccessVisible && statusbarMetric("文献") === graphLibraryCountBefore + 1;
        delete window.__AURASCHOLAR_SMOKE_INGEST_FROM_INPUT__;
        if (graphDoiInput) {
          window.__AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_DELAY_MS__ = 450;
          window.__AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_COUNT__ = 0;
          setInputValue(graphDoiInput, GRAPH_SMOKE.raceOldDoi);
          findExactButton("生成图谱")?.click();
          await waitFor(
            () => Number(window.__AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_COUNT__ ?? 0) >= 1,
            1_000
          );
          window.__AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_DELAY_MS__ = 0;
          setInputValue(graphDoiInput, GRAPH_SMOKE.raceNewDoi);
          findExactButton("生成图谱")?.click();
          await waitFor(() => bodyIncludes(GRAPH_SMOKE.raceNewTitle), 2_000);
          await wait(650);
          graphLoadRacePreserved =
            bodyIncludes(GRAPH_SMOKE.raceNewTitle) &&
            !bodyIncludes(GRAPH_SMOKE.raceOldTitle) &&
            !bodyIncludes("暂时无法构建图谱");
          delete window.__AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_DELAY_MS__;
          delete window.__AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_COUNT__;
        }
        location.hash = "#/graph?doi=" + encodeURIComponent(GRAPH_SMOKE.deepLinkDoi);
        await waitFor(
          () =>
            location.hash.includes("/graph") &&
            bodyIncludes(GRAPH_SMOKE.deepLinkTitle) &&
            Boolean(document.querySelector(".citation-graph-node")),
          2_000
        );
        const graphDeepLinkInput = document.querySelector('input[aria-label="图谱中心论文 DOI"]');
        graphDeepLinkParamSyncVisible =
          bodyIncludes(GRAPH_SMOKE.deepLinkTitle) &&
          graphDeepLinkInput?.value === GRAPH_SMOKE.deepLinkDoi &&
          !bodyIncludes(GRAPH_SMOKE.raceNewTitle) &&
          !bodyIncludes("暂时无法构建图谱");

        window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_READ__ =
          "Smoke homepage library read failure";
`;
