export const smokeDiscoveryResults = String.raw`        window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__ = {
          acceptAnyQuery: true,
          query: DISCOVERY_SEARCH_RETRY_SMOKE.query,
          title: DISCOVERY_SEARCH_RETRY_SMOKE.title,
          doi: DISCOVERY_SEARCH_RETRY_SMOKE.doi
        };
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_SEARCH__ =
          DISCOVERY_SEARCH_RETRY_SMOKE.error;
        try {
          const failedSearch =
            window.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_SEARCH__?.(
              DISCOVERY_SEARCH_RETRY_SMOKE.query,
              ["crossref"]
            ) ?? Promise.resolve(false);
          await failedSearch;
          await waitFor(
            () =>
              bodyIncludes("检索没有完成") &&
              bodyIncludes(DISCOVERY_SEARCH_RETRY_SMOKE.error) &&
              Boolean(findExactButton("重试检索")),
            4_000
          );
          const searchFailureVisible =
            bodyIncludes("检索没有完成") &&
            bodyIncludes(DISCOVERY_SEARCH_RETRY_SMOKE.error) &&
            Boolean(findExactButton("重试检索"));
          findExactButton("重试检索")?.click();
          await waitFor(
            () =>
              bodyIncludes(DISCOVERY_SEARCH_RETRY_SMOKE.title) &&
              !bodyIncludes("检索没有完成") &&
              !bodyIncludes(DISCOVERY_SEARCH_RETRY_SMOKE.error),
            4_000
          );
          const searchRecovered =
            bodyIncludes(DISCOVERY_SEARCH_RETRY_SMOKE.title) &&
            !bodyIncludes("检索没有完成") &&
            !bodyIncludes(DISCOVERY_SEARCH_RETRY_SMOKE.error);
          discoverySearchRetryRecoveryVisible =
            searchFailureVisible && searchRecovered;
          discoverySearchRetryRecoveryDetail = [
            "failure=" + searchFailureVisible,
            "status=" + bodyIncludes("失败"),
            "recovered=" + searchRecovered,
            "title=" + bodyIncludes(DISCOVERY_SEARCH_RETRY_SMOKE.title),
            "results=" + text(".discovery-results").slice(0, 220)
          ].join("; ");
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_SEARCH__;
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
        }

        window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__ = {
          ...DISCOVERY_TRUST_SMOKE,
          acceptAnyQuery: true
        };
        try {
          const discoverySearchButton = () =>
            Array.from(document.querySelectorAll(".discovery-command button")).find((button) =>
              /检索开放源|检索中/.test(button.textContent?.replace(/\s+/g, " ").trim() ?? "")
            );
          const discoverySearchPromise =
            window.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_SEARCH__?.(
              DISCOVERY_TRUST_SMOKE.query
            ) ?? Promise.resolve(false);
          await waitFor(
            () => {
              const button = discoverySearchButton();
              const progress = document.querySelector(".discovery-search-progress");
              return button?.disabled &&
                button.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("检索中") &&
                progress?.getAttribute("role") === "status" &&
                progress.getAttribute("aria-live") === "polite" &&
                progress.getAttribute("aria-busy") === "true"
                ? button
                : null;
            },
            1_000
          );
          discoverySearchBusyVisible = Boolean(
            discoverySearchButton()?.disabled &&
              discoverySearchButton()?.textContent?.includes("检索中")
          );
          discoverySearchAriaBusyVisible =
            discoverySearchBusyVisible &&
            discoverySearchButton()?.getAttribute("aria-busy") === "true";
          const discoverySearchProgress = document.querySelector(".discovery-search-progress");
          discoverySearchProgressLiveVisible =
            discoverySearchAriaBusyVisible &&
            discoverySearchProgress?.getAttribute("role") === "status" &&
            discoverySearchProgress.getAttribute("aria-live") === "polite" &&
            discoverySearchProgress.getAttribute("aria-busy") === "true";
          await discoverySearchPromise;
          await waitFor(
            () =>
              bodyIncludes(DISCOVERY_TRUST_SMOKE.title) &&
              bodyIncludes("可信度强") &&
              bodyIncludes("开放 PDF 可用"),
            4_000
          );
          discoveryTrustSignalsVisible =
            bodyIncludes(DISCOVERY_TRUST_SMOKE.title) &&
            bodyIncludes("可信度强") &&
            bodyIncludes("稳定标识") &&
            bodyIncludes("3 个数据源佐证") &&
            bodyIncludes("DOI " + DISCOVERY_TRUST_SMOKE.doi);
          discoveryFulltextCueVisible =
            bodyIncludes("开放 PDF 可用") &&
            bodyIncludes("入库时会尝试获取开放 PDF") &&
            bodyIncludes("全文状态");
          discoveryTrustSignalsDetail = [
            "title=" + bodyIncludes(DISCOVERY_TRUST_SMOKE.title),
            "strong=" + bodyIncludes("可信度强"),
            "stable=" + bodyIncludes("稳定标识"),
            "sources=" + bodyIncludes("3 个数据源佐证"),
            "doi=" + bodyIncludes("DOI " + DISCOVERY_TRUST_SMOKE.doi),
            "fulltext=" + bodyIncludes("开放 PDF 可用"),
            "fulltextDetail=" + bodyIncludes("入库时会尝试获取开放 PDF"),
            "searchBusy=" + discoverySearchBusyVisible,
            "searchAria=" + discoverySearchAriaBusyVisible,
            "progressLive=" + discoverySearchProgressLiveVisible,
            "results=" + text(".discovery-results").slice(0, 220),
            "detail=" + text(".discovery-detail-card").slice(0, 220)
          ].join("; ");

          const detailImportButton = () =>
            Array.from(document.querySelectorAll(".discovery-detail-actions button")).find(
              (button) => button.textContent?.includes("加入文献库")
            );
          detailImportButton()?.click();
          await waitFor(
            () =>
              bodyIncludes("正在加入文献库并获取开放 PDF") &&
              bodyIncludes("导入并抓取 PDF..."),
            1_000
          );
          discoveryImportBusyVisible =
            bodyIncludes("正在加入文献库并获取开放 PDF") &&
            bodyIncludes("导入并抓取 PDF...");
          await waitFor(
            () =>
              bodyIncludes("开放 PDF 未能自动获取") &&
              bodyIncludes("待补全文") &&
              bodyIncludes("去找全文"),
            4_000
          );
          discoveryImportFulltextFallbackVisible =
            bodyIncludes("开放 PDF 未能自动获取") &&
            bodyIncludes("待补全文") &&
            bodyIncludes("去找全文") &&
            bodyIncludes("开放 PDF 未能自动挂载");
          discoveryTrustSignalsDetail +=
            "; importBusy=" +
            discoveryImportBusyVisible +
            "; importFallback=" +
            discoveryImportFulltextFallbackVisible +
            "; afterImportDetail=" +
            text(".discovery-detail-card").slice(0, 220);
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
        }

        window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__ = {
          acceptAnyQuery: true,
          query: DISCOVERY_LOAD_MORE_SMOKE.query,
          title: DISCOVERY_LOAD_MORE_SMOKE.firstTitle,
          doi: DISCOVERY_LOAD_MORE_SMOKE.firstDoi,
          hasMore: true,
          page: 1
        };
        try {
          await (window.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_SEARCH__?.(
            DISCOVERY_LOAD_MORE_SMOKE.query,
            ["crossref"]
          ) ?? Promise.resolve(false));
          await waitFor(
            () =>
              bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.firstTitle) && bodyIncludes("加载更多"),
            4_000
          );
          window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__ = {
            acceptAnyQuery: true,
            query: DISCOVERY_LOAD_MORE_SMOKE.query,
            title: DISCOVERY_LOAD_MORE_SMOKE.recoveredTitle,
            doi: DISCOVERY_LOAD_MORE_SMOKE.recoveredDoi,
            hasMore: false,
            page: 2
          };
          window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_LOAD_MORE__ =
            DISCOVERY_LOAD_MORE_SMOKE.error;
          const loadMoreButton = () =>
            Array.from(document.querySelectorAll(".discovery-load-more > button")).find(
              (button) => button.textContent?.replace(/\s+/g, " ").trim() === "加载更多"
            );
          loadMoreButton()?.click();
          await waitFor(
            () =>
              bodyIncludes("加载更多没有完成") &&
              bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.error) &&
              Boolean(document.querySelector('button[aria-label="重试加载更多结果"]')),
            4_000
          );
          const retryButtonReady = () =>
            Array.from(
              document.querySelectorAll('button[aria-label="重试加载更多结果"]')
            ).find(
              (button) =>
                !button.disabled &&
                button.textContent?.replace(/\s+/g, " ").trim() === "重试加载更多"
            );
          await waitFor(() => retryButtonReady(), 4_000);
          const retryVisible =
            bodyIncludes("加载更多没有完成") &&
            bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.error) &&
            Boolean(retryButtonReady());
          const retryButton = retryButtonReady();
          retryButton?.click();
          await waitFor(
            () =>
              bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.recoveredTitle) &&
              !bodyIncludes("加载更多没有完成") &&
              !document.querySelector('button[aria-label="重试加载更多结果"]'),
            4_000
          );
          const recovered =
            bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.recoveredTitle) &&
            !bodyIncludes("加载更多没有完成") &&
            !document.querySelector('button[aria-label="重试加载更多结果"]');
          discoveryLoadMoreRetryRecoveryVisible = retryVisible && recovered;
          discoveryLoadMoreRetryRecoveryDetail = [
            "retryVisible=" + retryVisible,
            "error=" + bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.error),
            "recovered=" + recovered,
            "first=" + bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.firstTitle),
            "next=" + bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.recoveredTitle),
            "results=" + text(".discovery-results").slice(0, 220)
          ].join("; ");
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_LOAD_MORE__;
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
        }

        window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_READ__ =
          "Smoke settings AI config read failure";
`;
