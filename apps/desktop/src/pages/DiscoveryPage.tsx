import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, Input } from "@aurascholar/ui";
import {
  mergeDiscoveryResults,
  type DiscoveryQuery,
  type DiscoverySource,
  type SourceCursor,
} from "@aurascholar/core";
import {
  importDiscoveryResult,
  searchDiscoveryDetailed,
  type DiscoveryResultWithLibrary,
} from "../services/discovery";
import { importReferences, previewReferences } from "../services/import-refs";
import {
  activateResearchTab,
  activeResearchUrl,
  captureResearchTab,
  closeResearchTab,
  hideResearchViews,
  listResearchTabs,
  navigateResearchTab,
  openResearchTab,
  researchGoBack,
  researchGoForward,
  researchReload,
  setResearchBounds,
  type ResearchTab,
} from "../services/research-browser";
import {
  addSite,
  clearSiteData,
  ezproxyRewrite,
  getEzproxyPrefix,
  getProxyAddress,
  listSites,
  removeSite,
  setEzproxyPrefix,
  setHidden,
  setProxyAddress,
  setSiteProxy,
  siteUrl,
  sitesWithData,
  type DiscoverySite,
} from "../services/discovery-sites";
import { subscribeResearchDownloads } from "../services/research-downloads";
import {
  attachStagedPdf,
  commitIngest,
  restoreDedup,
  type IngestDraft,
} from "../services/library";
import { tauriFs } from "../services/tauri-platform";
import { ImportConfirmDialog, type ImportDecision } from "../components/ImportConfirmDialog";
import {
  clearSavedSearchBadge,
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  runSavedSearch,
  type SavedSearchView,
} from "../services/saved-searches";

const SOURCES: Array<{ id: DiscoverySource; label: string; hint: string }> = [
  { id: "openalex", label: "OpenAlex", hint: "覆盖广、引用与 OA 信号丰富" },
  { id: "crossref", label: "Crossref", hint: "DOI 与期刊元数据权威" },
  { id: "s2", label: "Semantic Scholar", hint: "AI/CS/生医方向较强" },
  { id: "arxiv", label: "arXiv", hint: "预印本 ID 精确检索" },
];

function isDesktopRuntime(): boolean {
  return "aura" in window;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function faviconUrl(homeUrl: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(homeUrl))}&sz=64`;
}

type SourceStatus =
  | "idle"
  | "searching"
  | "done"
  | "empty"
  | "timeout"
  | "error"
  | "rate_limited"
  | "stopped";
type Mode = "home" | "opensource" | "browser";
type SortKey = "relevance" | "year" | "citations";

export function DiscoveryPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("home");
  const [query, setQuery] = useState("");

  // Sites
  const [sites, setSites] = useState<DiscoverySite[]>([]);
  const [siteData, setSiteData] = useState<Set<string>>(() => new Set());
  const [managing, setManaging] = useState(false);
  const [addingSite, setAddingSite] = useState(false);
  const [newSite, setNewSite] = useState({ name: "", homeUrl: "", searchUrl: "" });
  const [proxy, setProxy] = useState("");
  const [ezproxy, setEzproxy] = useState("");

  // Open-source search
  const [selectedSources, setSelectedSources] = useState<Set<DiscoverySource>>(
    () => new Set(SOURCES.map((s) => s.id)),
  );
  const [results, setResults] = useState<DiscoveryResultWithLibrary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  // Advanced query fields (sent to the API, not just client filtering).
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [author, setAuthor] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [venue, setVenue] = useState("");
  // API-level sort: changing it re-runs the search so the API re-ranks.
  const [sortBy, setSortBy] = useState<SortKey>("relevance");
  // Per-source pagination cursors for "load more"; plus a client-only OA filter.
  const [cursors, setCursors] = useState<Partial<Record<DiscoverySource, SourceCursor>>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [oaOnly, setOaOnly] = useState(false);
  // Saved searches ("检索订阅").
  const [savedSearches, setSavedSearches] = useState<SavedSearchView[]>([]);
  const [savingSearch, setSavingSearch] = useState(false);
  const [sourceStatus, setSourceStatus] = useState<Record<DiscoverySource, SourceStatus>>(
    () =>
      Object.fromEntries(SOURCES.map((source) => [source.id, "idle"])) as Record<
        DiscoverySource,
        SourceStatus
      >,
  );

  // Browser (multi-tab; views live in the Electron main process)
  const [tabs, setTabs] = useState<ResearchTab[]>([]);
  const [webImporting, setWebImporting] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [browserToastKey, setBrowserToastKey] = useState(0);
  // Pending import confirmation from a browser download (analyze → confirm).
  const [confirmDraft, setConfirmDraft] = useState<IngestDraft | null>(null);
  // "Find full text" target: a downloaded PDF should attach to this work.
  const [pendingWork, setPendingWork] = useState<{ id: string; title: string } | null>(null);
  // Mirror in a ref so the download subscription (deps: [mode]) reads it fresh.
  const pendingWorkRef = useRef(pendingWork);
  pendingWorkRef.current = pendingWork;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchTokenRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const visibleSites = useMemo(() => sites.filter((s) => !s.hidden), [sites]);
  const activeTab = useMemo(() => tabs.find((t) => t.active) ?? null, [tabs]);

  const refreshSites = useCallback(async () => {
    const list = await listSites();
    setSites(list);
    setSiteData(await sitesWithData(list.map((s) => s.id)));
  }, []);

  const refreshSavedSearches = useCallback(async () => {
    if (!isDesktopRuntime()) return;
    setSavedSearches(await listSavedSearches());
  }, []);

  useEffect(() => {
    void refreshSites();
    void getProxyAddress().then(setProxy);
    void getEzproxyPrefix().then(setEzproxy);
  }, [refreshSites]);

  // Open the browser at a paper's landing page (publisher via DOI, else Scholar
  // title search), remembering the target work so the download attaches to it.
  const openFulltextBrowser = useCallback(
    (target: { id: string; title: string; doi?: string }) => {
      const url = target.doi
        ? `https://doi.org/${target.doi}`
        : `https://scholar.google.com/scholar?q=${encodeURIComponent(target.title)}`;
      setPendingWork({ id: target.id, title: target.title });
      setMode("browser");
      const dest = ezproxy.trim() ? (ezproxyRewrite(ezproxy, url) ?? url) : url;
      void openResearchTab("_fulltext", dest, proxy);
    },
    [ezproxy, proxy],
  );

  // "Find full text" hand-off from the library (via query params).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const workId = searchParams.get("pendingWorkId");
    const url = searchParams.get("url");
    if (!workId || !url || !isDesktopRuntime()) return;
    const title = searchParams.get("pendingTitle") ?? "";
    setPendingWork({ id: workId, title });
    setMode("browser");
    const target = ezproxy.trim() ? (ezproxyRewrite(ezproxy, url) ?? url) : url;
    void openResearchTab("_fulltext", target, proxy);
    // Consume the params so a refresh/back doesn't reopen.
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, ezproxy, proxy]);

  const openViaLibrary = useCallback(async () => {
    if (!ezproxy.trim()) {
      setMessage("请先在“管理站点”里填写图书馆 EZproxy 前缀");
      return;
    }
    const current = await activeResearchUrl();
    if (!current) return;
    const rewritten = ezproxyRewrite(ezproxy, current);
    if (!rewritten) {
      setMessage("当前地址或图书馆前缀不是有效 http/https URL");
      return;
    }
    await navigateResearchTab(rewritten);
    setMessage("已通过图书馆入口重新打开(走学校订阅身份)");
  }, [ezproxy]);

  // Fallback for full-text that renders inline (embedded viewer / blob / inline
  // disposition) and never triggers a real download. Direct .pdf URLs stream
  // through the normal download → ingest path; everything else is rendered to
  // PDF. Either way the resulting file arrives via the download-finished
  // subscription below, which posts the "已捕获并入库" toast.
  const capturePage = useCallback(async () => {
    setWebImporting(true);
    setMessage("正在抓取当前页面...");
    try {
      const result = await captureResearchTab();
      if (result.kind === "none") {
        setMessage(`抓取失败:${result.error ?? "当前没有可抓取的页面"}`);
      } else if (result.kind === "print") {
        setMessage("已将当前页面渲染为 PDF,正在入库...");
      } else {
        setMessage("正在下载并入库...");
      }
    } catch (e) {
      setMessage(`抓取失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWebImporting(false);
    }
  }, []);

  const saveProxy = useCallback(async () => {
    try {
      await setProxyAddress(proxy);
      setMessage(null);
    } catch (e) {
      setMessage(`代理配置无效:${e instanceof Error ? e.message : String(e)}`);
    }
  }, [proxy]);

  const saveEzproxy = useCallback(async () => {
    try {
      await setEzproxyPrefix(ezproxy);
      setMessage(null);
    } catch (e) {
      setMessage(`图书馆前缀无效:${e instanceof Error ? e.message : String(e)}`);
    }
  }, [ezproxy]);

  // Re-check stored-data state whenever we return to the home grid.
  useEffect(() => {
    if (mode === "home" && sites.length > 0) {
      void sitesWithData(sites.map((s) => s.id)).then(setSiteData);
    }
  }, [mode, sites]);

  // Year/venue/author now filter at the API; only the OA toggle stays client-side.
  // The engine already sorts the merged set by the chosen key; we keep a final
  // client sort as a stable tiebreak across sources.
  const displayedResults = useMemo(() => {
    const filtered = results.filter((r) => !oaOnly || !!r.work.oaPdfUrl);
    if (sortBy === "year") {
      return [...filtered].sort((a, b) => (b.work.year ?? 0) - (a.work.year ?? 0));
    }
    if (sortBy === "citations") {
      return [...filtered].sort(
        (a, b) => (b.work.citedByCount ?? -1) - (a.work.citedByCount ?? -1),
      );
    }
    return filtered; // relevance — already ordered by the merge step
  }, [results, sortBy, oaOnly]);

  // Any selected source still has more pages to fetch.
  const canLoadMore = useMemo(
    () => [...selectedSources].some((s) => cursors[s]?.hasMore),
    [selectedSources, cursors],
  );

  const buildQuery = useCallback(
    (): DiscoveryQuery => ({
      text: query.trim(),
      author: author.trim() || undefined,
      yearFrom: yearFrom.trim() ? Number(yearFrom.trim()) : undefined,
      yearTo: yearTo.trim() ? Number(yearTo.trim()) : undefined,
      venue: venue.trim() || undefined,
    }),
    [query, author, yearFrom, yearTo, venue],
  );

  const selectedResult = useMemo(
    () => displayedResults.find((r) => r.id === selectedId) ?? displayedResults[0] ?? null,
    [displayedResults, selectedId],
  );

  // ---- Saved searches: load on mount, refresh when the loop posts updates ----
  useEffect(() => {
    void refreshSavedSearches();
    const onUpdate = () => void refreshSavedSearches();
    window.addEventListener("aurascholar:saved-searches-updated", onUpdate);
    return () => window.removeEventListener("aurascholar:saved-searches-updated", onUpdate);
  }, [refreshSavedSearches]);

  // ---- Browser: tab list sync + bounds reporting + downloads ----

  // Keep our tab list mirror in sync with the main process.
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    void listResearchTabs().then(setTabs);
    return window.aura.research.onTabsChanged(setTabs);
  }, []);

  // Closing the last tab returns to the site grid rather than stranding the
  // user on an empty "opening..." spinner.
  useEffect(() => {
    if (mode === "browser" && tabs.length === 0) {
      void hideResearchViews();
      setMode("home");
    }
  }, [mode, tabs.length]);

  // Report the content-area rectangle to main, which positions the active view
  // exactly there. This is the whole reason the embedded view never overlaps.
  useEffect(() => {
    if (mode !== "browser" || !isDesktopRuntime()) return;
    const host = hostRef.current;
    if (!host) return;
    const report = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      void setResearchBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(host);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [mode]);

  // Detach the native views from the window when we leave the browser view.
  useEffect(() => {
    if (mode !== "browser") void hideResearchViews();
  }, [mode]);

  useEffect(() => {
    if (mode === "browser" && message) setBrowserToastKey((key) => key + 1);
  }, [message, mode]);

  // Toggle a body class so App can collapse its sidebar while browsing.
  useEffect(() => {
    document.body.classList.toggle("research-fullscreen", mode === "browser");
    return () => document.body.classList.remove("research-fullscreen");
  }, [mode]);

  // Subscribe to intercepted downloads while the browser view is active.
  // PDFs are analyzed (not auto-written): a dedup hit attaches directly, anything
  // else opens a confirm card — but only after detaching the native view, which
  // would otherwise paint over the DOM overlay.
  useEffect(() => {
    if (mode !== "browser") return;
    return subscribeResearchDownloads(
      (result) => {
        if (result.kind === "ignored") return;
        if (result.kind === "error") {
          setMessage(`捕获下载失败:${result.error ?? "未知错误"}`);
        } else if (result.kind === "references") {
          setMessage(`引用文件已导入:新增 ${result.imported ?? 0} 篇`);
        } else if (result.kind === "pdf" && result.draft) {
          let draft = result.draft;
          // If this download was launched via "find full text", default the card
          // to attaching the PDF to that work.
          const target = pendingWorkRef.current;
          if (target && !draft.dedup) {
            draft = { ...draft, targetWorkId: target.id, targetTitle: target.title };
          }
          if (draft.dedup) {
            void handleBrowserDedup(draft);
          } else {
            void hideResearchViews();
            setConfirmDraft(draft);
          }
        }
      },
      (fileName) => setMessage(`正在下载并识别:${fileName}…`),
    );
  }, [mode]);

  // A downloaded PDF whose work is already in the library: attach + surface,
  // no confirm card.
  const handleBrowserDedup = useCallback(async (draft: IngestDraft) => {
    if (!draft.dedup) return;
    await restoreDedup(draft.dedup.workId);
    if (draft.pdf) await attachStagedPdf(draft.dedup.workId, draft.pdf).catch(() => {});
    if (draft.pdf?.relPath) void tauriFs.deleteFile(draft.pdf.relPath).catch(() => {});
    setMessage(`已在库中:${draft.dedup.title}`);
    window.dispatchEvent(new Event("aurascholar:library-updated"));
  }, []);

  const finishBrowserImport = useCallback(
    (draft: IngestDraft | null) => {
      if (draft?.pdf?.relPath) void tauriFs.deleteFile(draft.pdf.relPath).catch(() => {});
      setConfirmDraft(null);
      setPendingWork(null); // find-full-text target consumed
      // Re-show the browser view we detached before opening the card.
      if (mode === "browser") {
        const active = tabs.find((t) => t.active);
        if (active) void activateResearchTab(active.tabId);
      }
    },
    [mode, tabs],
  );

  const handleBrowserCommit = useCallback(
    async (decision: ImportDecision) => {
      const draft = confirmDraft;
      if (decision.mode === "attach") {
        await restoreDedup(decision.workId);
        if (decision.pdf) await attachStagedPdf(decision.workId, decision.pdf);
        setMessage("已将 PDF 挂到所选文献");
      } else {
        const result = await commitIngest({
          workInput: decision.workInput,
          pdf: decision.pdf,
          source: "browser",
        });
        setMessage(`已入库:${result.title}`);
      }
      window.dispatchEvent(new Event("aurascholar:library-updated"));
      finishBrowserImport(draft);
    },
    [confirmDraft, finishBrowserImport],
  );

  const handleBrowserCancel = useCallback(() => {
    setMessage("已取消入库");
    finishBrowserImport(confirmDraft);
  }, [confirmDraft, finishBrowserImport]);

  const exitBrowser = useCallback(() => {
    void hideResearchViews();
    setMessage(null);
    setMode("home");
  }, []);

  const runSearch = useCallback(async () => {
    if (!query.trim() || searching) return;
    if (!isDesktopRuntime()) {
      setMessage("开放检索需要桌面应用的网络能力;浏览器预览仅用于查看界面。");
      return;
    }
    const sources = Array.from(selectedSources);
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const token = searchTokenRef.current + 1;
    searchTokenRef.current = token;
    setSearching(true);
    setResults([]);
    setSelectedId(null);
    setCursors({}); // fresh search resets pagination
    setSourceStatus(
      Object.fromEntries(
        SOURCES.map((source) => [source.id, sources.includes(source.id) ? "searching" : "idle"]),
      ) as Record<DiscoverySource, SourceStatus>,
    );
    setMessage(null);
    const structured = buildQuery();
    try {
      const settled = await Promise.all(
        sources.map(async (source) => {
          const report = await searchDiscoveryDetailed(structured, [source], controller.signal, {
            sort: sortBy,
          });
          if (searchTokenRef.current !== token) return [];
          const status = report.sources[source]?.status ?? "empty";
          setSourceStatus((prev) => ({ ...prev, [source]: uiSourceStatus(status) }));
          if (report.cursors[source]) {
            setCursors((prev) => ({ ...prev, [source]: report.cursors[source] }));
          }
          setResults((prev) => {
            const next = mergeLibraryResults([...prev, ...report.results]);
            setSelectedId((current) => current ?? next[0]?.id ?? null);
            return next;
          });
          return report.results;
        }),
      );
      if (searchTokenRef.current !== token) return;
      const finalResults = mergeLibraryResults(settled.flat());
      setResults(finalResults);
      setSelectedId((current) => current ?? finalResults[0]?.id ?? null);
      setMessage(
        finalResults.length > 0
          ? `找到 ${finalResults.length} 条候选结果`
          : "没有找到结果,换个关键词试试",
      );
    } catch (e) {
      if (searchTokenRef.current !== token) return;
      setMessage(`检索失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (searchTokenRef.current === token) {
        setSearching(false);
        searchAbortRef.current = null;
      }
    }
  }, [query, selectedSources, searching, buildQuery, sortBy]);

  // Fetch the next page from each selected source that still has more, then
  // merge into the existing result set (cross-page duplicates are deduped).
  const loadMore = useCallback(async () => {
    if (loadingMore || !canLoadMore) return;
    const sources = [...selectedSources].filter((s) => cursors[s]?.hasMore);
    if (sources.length === 0) return;
    setLoadingMore(true);
    const controller = new AbortController();
    const structured = buildQuery();
    try {
      await Promise.all(
        sources.map(async (source) => {
          const report = await searchDiscoveryDetailed(structured, [source], controller.signal, {
            sort: sortBy,
            cursors: { [source]: cursors[source] },
          });
          setCursors((prev) => ({ ...prev, [source]: report.cursors[source] }));
          setResults((prev) => mergeLibraryResults([...prev, ...report.results]));
        }),
      );
    } catch (e) {
      setMessage(`加载更多失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, canLoadMore, selectedSources, cursors, buildQuery, sortBy]);

  // Re-run the search when the sort key changes (API re-ranks server-side).
  // Skip the initial render and when there's nothing searched yet.
  const sortInitRef = useRef(true);
  useEffect(() => {
    if (sortInitRef.current) {
      sortInitRef.current = false;
      return;
    }
    if (query.trim() && results.length > 0 && !searching) void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  const stopSearch = useCallback(() => {
    searchTokenRef.current += 1;
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setSearching(false);
    setSourceStatus(
      (prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([source, status]) => [
            source,
            status === "searching" ? "stopped" : status,
          ]),
        ) as Record<DiscoverySource, SourceStatus>,
    );
    setMessage("已停止检索");
  }, []);

  const toggleSource = useCallback((source: DiscoverySource) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next.size > 0 ? next : prev;
    });
  }, []);

  const saveCurrentSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || !isDesktopRuntime()) return;
    setSavingSearch(true);
    try {
      await createSavedSearch(q, [...selectedSources]);
      await refreshSavedSearches();
      setMessage(`已保存检索订阅:“${q}”,有新结果时会通知你`);
    } catch (e) {
      setMessage(`保存订阅失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingSearch(false);
    }
  }, [query, selectedSources, refreshSavedSearches]);

  const openSavedSearch = useCallback(
    async (saved: SavedSearchView) => {
      setQuery(saved.query);
      if (saved.sources) setSelectedSources(new Set(saved.sources));
      if (saved.newCount > 0) {
        await clearSavedSearchBadge(saved.id);
        await refreshSavedSearches();
      }
      await runSearch();
    },
    // runSearch is defined above; referencing it here is safe at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshSavedSearches],
  );

  const removeSavedSearch = useCallback(
    async (id: string) => {
      await deleteSavedSearch(id);
      await refreshSavedSearches();
    },
    [refreshSavedSearches],
  );

  const runSavedSearchNow = useCallback(
    async (id: string) => {
      setMessage("正在检查订阅的新结果...");
      const n = await runSavedSearch(id);
      await refreshSavedSearches();
      setMessage(n > 0 ? `发现 ${n} 篇新结果` : "暂无新结果");
    },
    [refreshSavedSearches],
  );

  const importResult = useCallback(async (result: DiscoveryResultWithLibrary) => {
    if (!isDesktopRuntime()) {
      setMessage("浏览器预览模式下不会写入本地文献库");
      return;
    }
    setImportingId(result.id);
    try {
      const imported = await importDiscoveryResult(result.work);
      setMessage(
        imported.deduped
          ? `已在库中:${imported.title}`
          : `已入库:${imported.title}${imported.pdfFetched ? "(含开放 PDF)" : "(暂无 PDF,可去找全文)"}`,
      );
      setResults((prev) =>
        prev.map((item) =>
          item.id === result.id
            ? {
                ...item,
                inLibrary: true,
                libraryWorkId: imported.workId,
                needsFulltext: !imported.pdfFetched,
              }
            : item,
        ),
      );
      setSelectedId(result.id);
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    } catch (e) {
      setMessage(`入库失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImportingId(null);
    }
  }, []);

  const importReferenceText = useCallback(async (text: string) => {
    if (!text.trim()) return;
    if (!isDesktopRuntime()) {
      setMessage("浏览器预览模式下不会写入本地文献库");
      return;
    }
    setWebImporting(true);
    try {
      const preview = previewReferences(text);
      if (preview.length === 0) {
        setMessage("没有解析出文献。请选择 BibTeX、RIS、NBIB、ENW 或 CSL-JSON 文件。");
        return;
      }
      const summary = await importReferences(text);
      setMessage(
        `引用文件导入完成:新增 ${summary.imported} 篇,已存在 ${summary.deduped} 篇(共 ${summary.total} 条)`,
      );
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    } catch (e) {
      setMessage(`导入失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWebImporting(false);
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      await importReferenceText(await file.text());
    },
    [importReferenceText],
  );

  const openSite = useCallback(
    (site: DiscoverySite) => {
      const url = siteUrl(site, query);
      if (!isDesktopRuntime()) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      setMessage(null);
      setMode("browser");
      void openResearchTab(site.id, url, site.useProxy ? proxy : "");
    },
    [query, proxy],
  );

  const handleAddSite = useCallback(async () => {
    if (!newSite.name.trim() || !newSite.homeUrl.trim()) return;
    const homeUrl = /^https?:\/\//.test(newSite.homeUrl)
      ? newSite.homeUrl
      : `https://${newSite.homeUrl}`;
    try {
      await addSite({ name: newSite.name, homeUrl, searchUrl: newSite.searchUrl });
      setNewSite({ name: "", homeUrl: "", searchUrl: "" });
      setAddingSite(false);
      await refreshSites();
    } catch (e) {
      setMessage(`添加站点失败:${e instanceof Error ? e.message : String(e)}`);
    }
  }, [newSite, refreshSites]);

  const handleSiteAction = useCallback(
    async (site: DiscoverySite, action: "remove" | "hide" | "clear") => {
      try {
        if (action === "remove") await removeSite(site.id);
        else if (action === "hide") await setHidden(site.id, true);
        else if (action === "clear") {
          await clearSiteData(site);
          setMessage(`已清除 ${site.name} 的网站数据`);
        }
        await refreshSites();
      } catch (e) {
        setMessage(`操作失败:${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [refreshSites],
  );

  // ---- Browser view: tab bar + content host ----
  if (mode === "browser") {
    return (
      <div className="discovery-page discovery-page--browser">
        <div className="research-tabbar">
          <div className="research-nav">
            <Button variant="secondary" onClick={exitBrowser}>
              ← 站点
            </Button>
            <button
              type="button"
              className="research-nav__btn"
              title="后退"
              disabled={!activeTab?.canGoBack}
              onClick={() => void researchGoBack()}
            >
              ‹
            </button>
            <button
              type="button"
              className="research-nav__btn"
              title="前进"
              disabled={!activeTab?.canGoForward}
              onClick={() => void researchGoForward()}
            >
              ›
            </button>
            <button
              type="button"
              className="research-nav__btn"
              title="刷新"
              disabled={!activeTab || activeTab.archived}
              onClick={() => void researchReload()}
            >
              ↻
            </button>
          </div>
          <div className="research-tabs">
            {tabs.map((tab) => (
              <div
                key={tab.tabId}
                className={`research-tab ${tab.active ? "research-tab--active" : ""} ${tab.archived ? "research-tab--archived" : ""}`}
                onClick={() => void activateResearchTab(tab.tabId)}
                title={tab.archived ? "已休眠 — 点击恢复" : tab.url}
              >
                <span className="research-tab__title">{tab.title || hostOf(tab.url)}</span>
                <button
                  type="button"
                  className="research-tab__close"
                  onClick={(e) => {
                    e.stopPropagation();
                    void closeResearchTab(tab.tabId);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="research-tabbar__actions">
            {ezproxy.trim() && (
              <Button variant="secondary" onClick={() => void openViaLibrary()}>
                通过图书馆打开
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={webImporting || !activeTab || activeTab.archived}
              title="抓取当前页面为 PDF 并入库(适用于内嵌阅读器/无法直接下载的全文)"
              onClick={() => void capturePage()}
            >
              {webImporting ? "处理中..." : "抓取本页入库"}
            </Button>
            <Button variant="secondary" onClick={() => void fileInputRef.current?.click()}>
              {webImporting ? "导入中..." : "导入引用文件"}
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".bib,.ris,.json,.nbib,.enw,application/json,text/plain"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
        </div>
        <div ref={hostRef} className="research-browser-host">
          {!activeTab && <span>正在打开...</span>}
          {activeTab?.archived && (
            <span>正在恢复 {activeTab.title || hostOf(activeTab.url)}...</span>
          )}
        </div>
        {message && (
          <p key={browserToastKey} className="research-browser-status" role="status">
            {message}
          </p>
        )}
        {confirmDraft && (
          <ImportConfirmDialog
            draft={confirmDraft}
            onCommit={handleBrowserCommit}
            onCancel={handleBrowserCancel}
          />
        )}
      </div>
    );
  }

  // ---- Open-source aggregated search view ----
  if (mode === "opensource") {
    return (
      <div className="discovery-page">
        <button type="button" className="discovery-back-link" onClick={() => setMode("home")}>
          ← 返回学术检索
        </button>
        <p className="app-page-kicker">Open sources</p>
        <h1 className="app-page-title">开放源聚合检索</h1>
        <p className="app-page-subtitle">
          OpenAlex、Crossref、Semantic Scholar、arXiv
          原生聚合检索;结果自动标记是否已在库中,一键入库会复用去重和开放 PDF 获取逻辑。
        </p>

        <div className="discovery-grid">
          <section className="discovery-search">
            <Card className="discovery-command-card">
              <div className="discovery-command">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void runSearch()}
                  placeholder="输入关键词、论文标题、DOI 或 arXiv ID"
                  disabled={searching}
                />
                <Button onClick={() => void runSearch()} disabled={searching || !query.trim()}>
                  检索开放源
                </Button>
                {searching ? (
                  <Button variant="secondary" onClick={stopSearch}>
                    停止
                  </Button>
                ) : (
                  isDesktopRuntime() && (
                    <Button
                      variant="secondary"
                      onClick={() => void saveCurrentSearch()}
                      disabled={savingSearch || !query.trim()}
                      title="保存为订阅:定期在后台重跑此检索,有新论文时通知你"
                    >
                      {savingSearch ? "保存中..." : "保存为订阅"}
                    </Button>
                  )
                )}
              </div>
              <SearchProgress sources={SOURCES} statuses={sourceStatus} searching={searching} />
              <div className="discovery-source-row">
                {SOURCES.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    className={`discovery-source-chip ${selectedSources.has(source.id) ? "discovery-source-chip--active" : ""}`}
                    title={source.hint}
                    disabled={searching}
                    onClick={() => toggleSource(source.id)}
                  >
                    {source.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="discovery-advanced-toggle"
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                {advancedOpen ? "▾ 高级检索" : "▸ 高级检索"}
              </button>
              {advancedOpen && (
                <div className="discovery-advanced">
                  <label className="discovery-refine__field">
                    作者
                    <Input
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                      placeholder="如 Vaswani"
                      disabled={searching}
                    />
                  </label>
                  <label className="discovery-refine__field">
                    年份从
                    <Input
                      type="number"
                      value={yearFrom}
                      onChange={(e) => setYearFrom(e.target.value)}
                      placeholder="如 2017"
                      disabled={searching}
                    />
                  </label>
                  <label className="discovery-refine__field">
                    年份到
                    <Input
                      type="number"
                      value={yearTo}
                      onChange={(e) => setYearTo(e.target.value)}
                      placeholder="如 2024"
                      disabled={searching}
                    />
                  </label>
                  <label className="discovery-refine__field">
                    期刊/会议
                    <Input
                      value={venue}
                      onChange={(e) => setVenue(e.target.value)}
                      placeholder="如 NeurIPS"
                      disabled={searching}
                    />
                  </label>
                  <p className="discovery-advanced__hint">
                    布尔逻辑(AND/OR/NOT)在 arXiv 精确生效,其它源按关键词相关度匹配。
                  </p>
                </div>
              )}
            </Card>

            {savedSearches.length > 0 && (
              <div className="discovery-subs">
                <div className="discovery-subs__head">检索订阅</div>
                <div className="discovery-subs__list">
                  {savedSearches.map((saved) => (
                    <div key={saved.id} className="discovery-sub">
                      <button
                        type="button"
                        className="discovery-sub__main"
                        onClick={() => void openSavedSearch(saved)}
                        title="点击重新运行此检索"
                      >
                        <span className="discovery-sub__query">{saved.query}</span>
                        {saved.newCount > 0 && (
                          <Badge variant="success">{saved.newCount} 新</Badge>
                        )}
                      </button>
                      <button
                        type="button"
                        className="discovery-sub__action"
                        title="立即检查新结果"
                        onClick={() => void runSavedSearchNow(saved.id)}
                      >
                        ↻
                      </button>
                      <button
                        type="button"
                        className="discovery-sub__action"
                        title="删除订阅"
                        onClick={() => void removeSavedSearch(saved.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {message && <p className="library-command__message">{message}</p>}

            {results.length > 0 && (
              <div className="discovery-refine">
                <label className="discovery-refine__field">
                  排序
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortKey)}
                    disabled={searching}
                  >
                    <option value="relevance">相关度</option>
                    <option value="year">年份(新→旧)</option>
                    <option value="citations">被引(高→低)</option>
                  </select>
                </label>
                <label className="discovery-refine__check">
                  <input
                    type="checkbox"
                    checked={oaOnly}
                    onChange={(e) => setOaOnly(e.target.checked)}
                  />
                  仅开放全文
                </label>
                <span className="discovery-refine__count">
                  {displayedResults.length}/{results.length}
                </span>
              </div>
            )}

            <div className="discovery-results">
              {results.length === 0 ? (
                <div className="library-empty au-surface">
                  <h3>从开放数据源发现文献</h3>
                  <p className="au-text-muted">
                    检索结果会自动标记是否已在库中;入库时会复用现有去重和开放 PDF 获取逻辑。
                  </p>
                </div>
              ) : displayedResults.length === 0 ? (
                <div className="library-empty au-surface">
                  <h3>没有符合筛选条件的结果</h3>
                  <p className="au-text-muted">放宽年份、期刊或开放全文筛选试试。</p>
                </div>
              ) : (
                displayedResults.map((result) => (
                  <ResultCard
                    key={result.id}
                    result={result}
                    selected={selectedResult?.id === result.id}
                    importing={importingId === result.id}
                    onSelect={() => setSelectedId(result.id)}
                    onPrimaryAction={() => {
                      if (result.inLibrary && result.libraryWorkId) {
                        navigate(`/reader?work=${encodeURIComponent(result.libraryWorkId)}`);
                      } else {
                        void importResult(result);
                      }
                    }}
                    onFindFulltext={() => {
                      if (result.libraryWorkId) {
                        openFulltextBrowser({
                          id: result.libraryWorkId,
                          title: result.work.title,
                          doi: result.work.doi,
                        });
                      }
                    }}
                  />
                ))
              )}
              {results.length > 0 && canLoadMore && (
                <div className="discovery-load-more">
                  <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore ? "加载中…" : "加载更多"}
                  </Button>
                </div>
              )}
            </div>
          </section>

          <aside className="discovery-panel">
            <Card className="discovery-detail-card">
              <h3 className="au-heading">结果详情</h3>
              {selectedResult ? (
                <>
                  <h4>{selectedResult.work.title}</h4>
                  <dl className="discovery-detail-list">
                    <div>
                      <dt>来源</dt>
                      <dd>{sourceLabel(selectedResult.source)}</dd>
                    </div>
                    <div>
                      <dt>年份</dt>
                      <dd>{selectedResult.work.year ?? "未知"}</dd>
                    </div>
                    <div>
                      <dt>期刊/会议</dt>
                      <dd>{selectedResult.work.venueName ?? "未标注"}</dd>
                    </div>
                    <div>
                      <dt>被引次数</dt>
                      <dd>{selectedResult.work.citedByCount ?? "未知"}</dd>
                    </div>
                    <div>
                      <dt>开放全文</dt>
                      <dd>{selectedResult.work.oaPdfUrl ? "可尝试下载" : "未发现"}</dd>
                    </div>
                  </dl>
                  <Button
                    onClick={() =>
                      selectedResult.inLibrary && selectedResult.libraryWorkId
                        ? navigate(
                            `/reader?work=${encodeURIComponent(selectedResult.libraryWorkId)}`,
                          )
                        : void importResult(selectedResult)
                    }
                    disabled={importingId === selectedResult.id}
                  >
                    {selectedResult.inLibrary
                      ? "打开库中文献"
                      : importingId === selectedResult.id
                        ? "导入中..."
                        : "加入文献库"}
                  </Button>
                  {selectedResult.inLibrary && selectedResult.needsFulltext && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (selectedResult.libraryWorkId) {
                          openFulltextBrowser({
                            id: selectedResult.libraryWorkId,
                            title: selectedResult.work.title,
                            doi: selectedResult.work.doi,
                          });
                        }
                      }}
                    >
                      去找全文
                    </Button>
                  )}
                </>
              ) : (
                <p className="au-text-muted">选择一个结果查看详情。</p>
              )}
            </Card>
          </aside>
        </div>
      </div>
    );
  }

  // ---- Home: site card grid ----
  return (
    <div className="discovery-page">
      <p className="app-page-kicker">Research discovery</p>
      <div className="discovery-home-head">
        <div>
          <h1 className="app-page-title">学术检索</h1>
          <p className="app-page-subtitle">
            两种检索方式:开放源聚合检索拿结构化元数据,内置浏览器登录机构账号取全文。下方按需选择。
          </p>
        </div>
        <Button variant="secondary" onClick={() => setManaging((v) => !v)}>
          {managing ? "完成" : "管理站点"}
        </Button>
      </div>

      {message && <p className="library-command__message">{message}</p>}

      {managing && (
        <div className="discovery-proxy-bar">
          <span className="au-text-muted">代理地址</span>
          <Input
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
            onBlur={() => void saveProxy()}
            placeholder="如 http://127.0.0.1:7890(留空=直连)"
          />
          <small className="au-text-muted">
            仅勾选「走代理」的站点经此代理;其余走系统网络(校园网 VPN 不受影响)。
          </small>
          <span className="au-text-muted">图书馆前缀</span>
          <Input
            value={ezproxy}
            onChange={(e) => setEzproxy(e.target.value)}
            onBlur={() => void saveEzproxy()}
            placeholder="学校 EZproxy 前缀,如 https://login.ezproxy.lib.xxx.edu.cn/login?url="
          />
          <small className="au-text-muted">
            填后,浏览订阅期刊时点工具栏「通过图书馆打开」即可用学校订阅身份重新加载(不必走代理)。
          </small>
        </div>
      )}

      <div className="discovery-modes-hint">
        <div className="discovery-modes-hint__item">
          <span className="discovery-modes-hint__tag">∑ 聚合检索</span>
          按关键词 / 标题 / DOI 跨 OpenAlex、Crossref、Semantic Scholar、arXiv
          拿结构化元数据,可筛选排序、一键去重入库。适合快速调研、找全某主题。
        </div>
        <div className="discovery-modes-hint__item">
          <span className="discovery-modes-hint__tag">🌐 站点浏览</span>
          在内置浏览器里登录机构账号浏览各数据库,站内下载或「抓取本页」自动入库。适合获取付费墙后的全文。
        </div>
      </div>

      <div className="discovery-cards">
        <button
          type="button"
          className="discovery-card discovery-card--special"
          onClick={() => {
            setMessage(null);
            setMode("opensource");
          }}
        >
          <div className="discovery-card__icon discovery-card__icon--special">∑</div>
          <div className="discovery-card__body">
            <strong>开放源聚合检索</strong>
            <small>OpenAlex · Crossref · Semantic Scholar · arXiv · 一键入库</small>
          </div>
        </button>

        {visibleSites.map((site) => {
          const hasData = siteData.has(site.id);
          return (
            <div key={site.id} className="discovery-card-wrap">
              <button type="button" className="discovery-card" onClick={() => openSite(site)}>
                <SiteIcon site={site} />
                <div className="discovery-card__body">
                  <strong>{site.name}</strong>
                  <small>{hostOf(site.homeUrl)}</small>
                </div>
              </button>
              {managing && (
                <div className="discovery-card__manage">
                  <button
                    type="button"
                    className={site.useProxy ? "discovery-card__manage--on" : ""}
                    title="该站的内置浏览器是否走代理(其余走系统网络/校园网)"
                    onClick={() => void setSiteProxy(site.id, !site.useProxy).then(refreshSites)}
                  >
                    {site.useProxy ? "✓ 走代理" : "走代理"}
                  </button>
                  <button
                    type="button"
                    disabled={!hasData}
                    onClick={() => void handleSiteAction(site, "clear")}
                  >
                    {hasData ? "清除数据" : "无数据"}
                  </button>
                  {site.builtin ? (
                    <button type="button" onClick={() => void handleSiteAction(site, "hide")}>
                      隐藏
                    </button>
                  ) : (
                    <button type="button" onClick={() => void handleSiteAction(site, "remove")}>
                      删除
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {managing && (
          <button
            type="button"
            className="discovery-card discovery-card--add"
            onClick={() => setAddingSite(true)}
          >
            <div className="discovery-card__icon">＋</div>
            <div className="discovery-card__body">
              <strong>添加站点</strong>
              <small>自定义学术网站</small>
            </div>
          </button>
        )}
      </div>

      {managing && sites.some((s) => s.hidden) && (
        <div className="discovery-hidden-row">
          <span className="au-text-muted">已隐藏:</span>
          {sites
            .filter((s) => s.hidden)
            .map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void setHidden(s.id, false).then(refreshSites)}
              >
                {s.name} 恢复
              </button>
            ))}
        </div>
      )}

      {addingSite && (
        <Card className="discovery-add-form">
          <h3 className="au-heading">添加自定义站点</h3>
          <Input
            value={newSite.name}
            onChange={(e) => setNewSite((s) => ({ ...s, name: e.target.value }))}
            placeholder="站点名称,如 IEEE Xplore"
          />
          <Input
            value={newSite.homeUrl}
            onChange={(e) => setNewSite((s) => ({ ...s, homeUrl: e.target.value }))}
            placeholder="主页 URL,如 https://ieeexplore.ieee.org/"
          />
          <Input
            value={newSite.searchUrl}
            onChange={(e) => setNewSite((s) => ({ ...s, searchUrl: e.target.value }))}
            placeholder="可选:检索 URL 前缀(关键词会拼接在后面)"
          />
          <div className="web-import-actions">
            <Button
              onClick={() => void handleAddSite()}
              disabled={!newSite.name.trim() || !newSite.homeUrl.trim()}
            >
              添加
            </Button>
            <Button variant="secondary" onClick={() => setAddingSite(false)}>
              取消
            </Button>
          </div>
        </Card>
      )}

      <Card className="web-import-card">
        <h3 className="au-heading">导入引用文件</h3>
        <p className="au-text-muted">
          已有从网站导出的 BibTeX、RIS、NBIB、ENW 或 CSL-JSON 文件?直接导入文献库(会自动去重)。
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".bib,.ris,.json,.nbib,.enw,application/json,text/plain"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
        <div className="web-import-actions">
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
            {webImporting ? "导入中..." : "选择文件导入"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function SiteIcon({ site }: { site: DiscoverySite }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div className="discovery-card__icon">{site.name.slice(0, 1).toUpperCase()}</div>;
  }
  return (
    <img
      className="discovery-card__favicon"
      src={faviconUrl(site.homeUrl)}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

// A single aggregated-search result row. Presentational: all behaviour comes in
// through callbacks so the parent keeps ownership of selection/import state.
function ResultCard({
  result,
  selected,
  importing,
  onSelect,
  onPrimaryAction,
  onFindFulltext,
}: {
  result: DiscoveryResultWithLibrary;
  selected: boolean;
  importing: boolean;
  onSelect: () => void;
  onPrimaryAction: () => void;
  onFindFulltext: () => void;
}) {
  const { work } = result;
  return (
    <article
      className={`discovery-result ${selected ? "discovery-result--selected" : ""}`}
      onClick={onSelect}
    >
      <div className="discovery-result__head">
        <strong>{work.title}</strong>
        <div className="discovery-result__badges">
          <Badge variant="neutral">{sourceLabel(result.source)}</Badge>
          {result.inLibrary && <Badge variant="success">已入库</Badge>}
          {work.oaPdfUrl && <Badge>OA PDF</Badge>}
        </div>
      </div>
      <p className="discovery-result__meta">
        {work.authors
          .slice(0, 4)
          .map((a) => a.displayName)
          .join(", ") || "作者未知"}
        {work.authors.length > 4 ? " 等" : ""}
        {work.year ? ` · ${work.year}` : ""}
        {work.venueName ? ` · ${work.venueName}` : ""}
        {work.citedByCount != null ? ` · 被引 ${work.citedByCount}` : ""}
      </p>
      {work.abstract && <p className="discovery-result__abstract">{work.abstract}</p>}
      <div className="discovery-result__actions">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrimaryAction();
          }}
          disabled={importing}
        >
          {result.inLibrary ? "打开" : importing ? "导入中..." : "加入文献库"}
        </button>
        {result.inLibrary && result.needsFulltext && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFindFulltext();
            }}
          >
            去找全文
          </button>
        )}
        {work.doi && <span>DOI {work.doi}</span>}
        {work.arxivId && <span>arXiv {work.arxivId}</span>}
      </div>
    </article>
  );
}

function SearchProgress({
  sources,
  statuses,
  searching,
}: {
  sources: typeof SOURCES;
  statuses: Record<DiscoverySource, SourceStatus>;
  searching: boolean;
}) {
  if (!searching && Object.values(statuses).every((status) => status === "idle")) return null;
  return (
    <div className="discovery-search-progress">
      {sources.map((source) => {
        const status = statuses[source.id];
        return (
          <span
            key={source.id}
            className={`discovery-search-progress__item discovery-search-progress__item--${status}`}
          >
            <i />
            {source.label}
            <small>{statusLabel(status)}</small>
          </span>
        );
      })}
    </div>
  );
}

function statusLabel(status: SourceStatus): string {
  switch (status) {
    case "searching":
      return "检索中";
    case "done":
      return "完成";
    case "empty":
      return "无结果";
    case "timeout":
      return "超时";
    case "error":
      return "失败";
    case "rate_limited":
      return "限流";
    case "stopped":
      return "已停止";
    case "idle":
      return "未启用";
  }
}

function uiSourceStatus(status: string): SourceStatus {
  if (status === "aborted") return "stopped";
  if (status === "timeout" || status === "error" || status === "rate_limited") return status;
  if (status === "done" || status === "empty") return status;
  return "error";
}

function sourceLabel(source: DiscoverySource): string {
  switch (source) {
    case "crossref":
      return "Crossref";
    case "openalex":
      return "OpenAlex";
    case "s2":
      return "Semantic Scholar";
    case "arxiv":
      return "arXiv";
  }
}

function mergeLibraryResults(results: DiscoveryResultWithLibrary[]): DiscoveryResultWithLibrary[] {
  return mergeDiscoveryResults(results, mergeStatus);
}

function mergeStatus(
  fallback: DiscoveryResultWithLibrary | undefined,
  preferred: DiscoveryResultWithLibrary,
): DiscoveryResultWithLibrary {
  return {
    ...preferred,
    inLibrary: preferred.inLibrary || fallback?.inLibrary || false,
    libraryWorkId: preferred.libraryWorkId ?? fallback?.libraryWorkId,
    score: Math.max(preferred.score, fallback?.score ?? 0),
  };
}
