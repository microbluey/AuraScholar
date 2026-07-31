import { Suspense, lazy, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, Input } from "@aurascholar/ui";
import type { DiscoveryQuery, DiscoverySource } from "@aurascholar/core";
import type { DiscoveryResultWithLibrary } from "../services/discovery";
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
  restoreSite,
  setEzproxyPrefix,
  setHidden,
  setProxyAddress,
  setSiteProxy,
  siteUrl,
  sitesWithData,
  type DiscoverySite,
} from "../services/discovery-sites";
import { subscribeResearchDownloads } from "../services/research-downloads";
import { openExternalUrl, isDesktopRuntime } from "../services/aura-platform";
import { initialFulltextTask } from "../services/fulltext";
import type { ImportDecision } from "../components/ImportConfirmDialog";
import { InlineNotice } from "../components/InlineNotice";
import { useConfirmDialog } from "../components/ConfirmDialog";
import { useModalFocusTrap } from "../components/useModalFocusTrap";
import {
  DiscoverySavedSearchRecentStrip,
  DiscoverySavedSearchRouteSummary,
} from "../features/discovery/DiscoverySavedSearchHome";
import { DiscoverySavedSearchPanel } from "../features/discovery/DiscoverySavedSearchPanel";
import {
  discoveryImportBusyLabel,
  fulltextProfile,
  identifierSignals,
  resultConfidence,
  resultSources,
  sourceLabel,
} from "../features/discovery/discovery-result-model";
import {
  sourceStatusSummary,
  statusLabel,
  type DiscoverySourceStatus,
} from "../features/discovery/discovery-search-model";
import {
  discoverySearchApplied,
  useDiscoverySearchController,
} from "../features/discovery/useDiscoverySearchController";
import { useDiscoveryResultImportController } from "../features/discovery/useDiscoveryResultImportController";
import { useDiscoverySavedSearchController } from "../features/discovery/useDiscoverySavedSearchController";
import { useIngestDraftQueue } from "../features/discovery/useIngestDraftQueue";
import { PendingFulltextTarget } from "../features/discovery/PendingFulltextTarget";
import { planFulltextDownload } from "../features/discovery/fulltext-download-plan";
import { useFulltextTaskController } from "../features/discovery/useFulltextTaskController";
import { useFulltextImportCompletion } from "../features/discovery/useFulltextImportCompletion";
import { useBrowserDownloadImport } from "../features/discovery/useBrowserDownloadImport";
import {
  createDiscoveryInitialState,
  previewDiscoverySourceStatus,
} from "../features/discovery/discovery-initial-state";
import { isImeComposing } from "../keyboard";
import { waitForMinimumElapsed } from "../services/minimum-busy";
import { describeSafeError } from "../services/sensitive-text";

const ImportConfirmDialog = lazy(() =>
  import("../components/ImportConfirmDialog").then((mod) => ({
    default: mod.ImportConfirmDialog,
  })),
);

const SOURCES: Array<{ id: DiscoverySource; label: string; hint: string }> = [
  { id: "openalex", label: "OpenAlex", hint: "覆盖广、引用与 OA 信号丰富" },
  { id: "crossref", label: "Crossref", hint: "DOI 与期刊元数据权威" },
  { id: "s2", label: "Semantic Scholar", hint: "AI/CS/生医方向较强" },
  { id: "arxiv", label: "arXiv", hint: "预印本 ID 精确检索" },
];

const DEFAULT_DISCOVERY_SOURCES = SOURCES.map((source) => source.id);

const SUGGESTED_QUERIES = [
  "retrieval augmented generation",
  "human-centered AI",
  "academic writing support",
  "large language model evaluation",
] as const;

const MIN_SITE_ACTION_BUSY_MS = 250;
const MIN_SITE_PROXY_BUSY_MS = 250;
const MIN_SITE_RESTORE_BUSY_MS = 250;
const MIN_PROXY_CONFIG_SAVE_BUSY_MS = 250;
const MIN_DISCOVERY_SITE_ADD_BUSY_MS = 350;
const MIN_REFERENCE_IMPORT_CONFIRM_BUSY_MS = 350;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function describeUnknownError(value: unknown): string {
  return describeSafeError(value);
}

function faviconUrl(homeUrl: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(homeUrl))}&sz=64`;
}

type Mode = "home" | "opensource" | "browser";
type SortKey = "relevance" | "year" | "citations";
type SiteManagementAction = "remove" | "hide" | "clear";

const PREVIEW_DISCOVERY_QUERY = "human-centered AI";

const PREVIEW_DISCOVERY_RESULTS: DiscoveryResultWithLibrary[] = [
  {
    id: "preview-discovery-human-centered-ai",
    inLibrary: false,
    matchedSources: ["openalex", "s2", "crossref"],
    score: 98,
    source: "openalex",
    work: {
      abstract:
        "A practical overview of human-centered AI methods, covering evaluation, collaboration patterns, and the risks of deploying automated systems without user feedback loops.",
      authors: [
        { displayName: "Zhiwei Lin", family: "Lin", given: "Zhiwei", position: 0 },
        { displayName: "Maya Chen", family: "Chen", given: "Maya", position: 1 },
        { displayName: "Nora Patel", family: "Patel", given: "Nora", position: 2 },
      ],
      citedByCount: 184,
      doi: "10.1145/preview.hcai.2024",
      oaPdfUrl: "https://example.edu/papers/human-centered-ai.pdf",
      openalexId: "W-preview-hcai",
      s2Id: "preview-hcai-s2",
      source: "openalex",
      title: "Human-Centered AI Systems for Research Workflows",
      venueName: "CHI",
      venueType: "conference",
      year: 2024,
    },
  },
  {
    id: "preview-discovery-literature-sensemaking",
    inLibrary: false,
    matchedSources: ["s2", "openalex"],
    score: 94,
    source: "s2",
    work: {
      abstract:
        "Studies how researchers build evidence maps from large paper collections, with design implications for search, citation triage, and writing-oriented note reuse.",
      authors: [
        { displayName: "Elena Rossi", family: "Rossi", given: "Elena", position: 0 },
        { displayName: "Jun Park", family: "Park", given: "Jun", position: 1 },
      ],
      citedByCount: 96,
      doi: "10.48550/arXiv.2402.01234",
      openalexId: "W-preview-sensemaking",
      s2Id: "preview-sensemaking-s2",
      source: "s2",
      title: "Literature Sensemaking with Retrieval-Augmented Assistants",
      venueName: "arXiv",
      venueType: "repository",
      year: 2024,
    },
  },
  {
    id: "preview-discovery-evaluation",
    inLibrary: false,
    matchedSources: ["crossref"],
    score: 87,
    source: "crossref",
    work: {
      abstract:
        "Compares evaluation protocols for AI-assisted scholarly writing tools, emphasizing provenance, citation grounding, and researcher control.",
      authors: [
        { displayName: "Samira Haddad", family: "Haddad", given: "Samira", position: 0 },
        { displayName: "Leo Martins", family: "Martins", given: "Leo", position: 1 },
        { displayName: "Zhiwei Lin", family: "Lin", given: "Zhiwei", position: 2 },
      ],
      citedByCount: 41,
      doi: "10.1145/preview.eval.2023",
      source: "crossref",
      title: "Evaluating AI Writing Support for Scholarly Knowledge Work",
      venueName: "CSCW",
      venueType: "conference",
      year: 2023,
    },
  },
];

interface SiteRemoveUndoState {
  message: string;
  site: DiscoverySite;
}

interface DiscoverySmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__?: unknown;
  __AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_REMOVE_SITE__?: unknown;
  __AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_RESTORE_SITE__?: unknown;
  __AURASCHOLAR_SMOKE_DISCOVERY_REPLACED_ACTIVE_SEARCH__?: boolean;
  __AURASCHOLAR_SMOKE_RUN_DISCOVERY_LOAD_MORE__?: () => Promise<boolean>;
  __AURASCHOLAR_SMOKE_RUN_DISCOVERY_SEARCH__?: (
    query: string,
    sources?: DiscoverySource[],
  ) => Promise<boolean>;
}

function consumeDiscoverySmokeRemoveSiteFailure(): Error | null {
  const target = window as DiscoverySmokeWindow;
  const failure = target.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_REMOVE_SITE__;
  if (failure == null) return null;
  delete target.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_REMOVE_SITE__;
  return failure instanceof Error ? failure : new Error(describeUnknownError(failure));
}

function consumeDiscoverySmokeRestoreSiteFailure(): Error | null {
  const target = window as DiscoverySmokeWindow;
  const failure = target.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_RESTORE_SITE__;
  if (failure == null) return null;
  delete target.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_RESTORE_SITE__;
  return failure instanceof Error ? failure : new Error(describeUnknownError(failure));
}

export function DiscoveryPage() {
  const navigate = useNavigate();
  const [initialState] = useState(() =>
    createDiscoveryInitialState({
      allSources: DEFAULT_DISCOVERY_SOURCES,
      previewQuery: PREVIEW_DISCOVERY_QUERY,
      previewResults: PREVIEW_DISCOVERY_RESULTS,
    }),
  );
  const [mode, setMode] = useState<Mode>(initialState.mode);
  const modeRef = useRef(mode);
  const [query, setQuery] = useState(initialState.query);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Sites
  const [sites, setSites] = useState<DiscoverySite[]>([]);
  const [siteData, setSiteData] = useState<Set<string>>(() => new Set());
  const [managing, setManaging] = useState(false);
  const [addingSite, setAddingSite] = useState(false);
  const [addingSiteBusy, setAddingSiteBusy] = useState(false);
  const [siteActions, setSiteActions] = useState<Map<string, SiteManagementAction>>(
    () => new Map(),
  );
  const siteActionsRef = useRef<Map<string, SiteManagementAction>>(new Map());
  const [proxyingSiteIds, setProxyingSiteIds] = useState<Set<string>>(() => new Set());
  const proxyingSiteIdsRef = useRef<Set<string>>(new Set());
  const [restoringSiteIds, setRestoringSiteIds] = useState<Set<string>>(() => new Set());
  const restoringSiteIdsRef = useRef<Set<string>>(new Set());
  const [newSite, setNewSite] = useState({ name: "", homeUrl: "", searchUrl: "" });
  const [proxy, setProxy] = useState("");
  const proxyRef = useRef("");
  const [savingProxy, setSavingProxy] = useState(false);
  const savingProxyRef = useRef(false);
  const [ezproxy, setEzproxy] = useState("");
  const ezproxyRef = useRef("");
  const [savingEzproxy, setSavingEzproxy] = useState(false);
  const savingEzproxyRef = useRef(false);

  // Open-source search
  const [selectedSources, setSelectedSources] = useState<Set<DiscoverySource>>(
    () => new Set(SOURCES.map((s) => s.id)),
  );
  // Advanced query fields (sent to the API, not just client filtering).
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [author, setAuthor] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [venue, setVenue] = useState("");
  // API-level sort: changing it re-runs the search so the API re-ranks.
  const [sortBy, setSortBy] = useState<SortKey>("relevance");
  // Pagination belongs to the search controller; this is the client-only OA filter.
  const [oaOnly, setOaOnly] = useState(false);
  const [siteRemoveUndo, setSiteRemoveUndo] = useState<SiteRemoveUndoState | null>(null);
  const [siteRemoveUndoBusy, setSiteRemoveUndoBusy] = useState(false);

  // Browser (multi-tab; views live in the Electron main process)
  const [tabs, setTabs] = useState<ResearchTab[]>([]);
  const [openingBrowserTab, setOpeningBrowserTab] = useState(false);
  const [webImporting, setWebImporting] = useState(false);
  const [referenceImportPreview, setReferenceImportPreview] = useState<{
    count: number;
    fileName?: string;
    previewOnly: boolean;
    text: string;
  } | null>(null);

  const [message, setMessage] = useState<string | null>(null);
  const [browserToastKey, setBrowserToastKey] = useState(0);
  const { confirm, confirmDialog } = useConfirmDialog();
  // Pending import confirmation from a browser download (analyze → confirm).
  const {
    activeDraft: confirmDraft,
    activeKey: confirmDraftKey,
    dismiss: dismissConfirmDraft,
    enqueue: enqueueConfirmDraft,
    pendingCount: pendingConfirmDraftCount,
    remove: removeConfirmDraft,
    snapshot: confirmDraftQueueSnapshot,
  } = useIngestDraftQueue();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const openSourceSearchInputRef = useRef<HTMLInputElement>(null);
  const boundsErrorReportedRef = useRef(false);

  const desktopRuntime = isDesktopRuntime();
  const buildQuery = useCallback(
    (text = query): DiscoveryQuery => ({
      text: text.trim(),
      author: author.trim() || undefined,
      yearFrom: yearFrom.trim() ? Number(yearFrom.trim()) : undefined,
      yearTo: yearTo.trim() ? Number(yearTo.trim()) : undefined,
      venue: venue.trim() || undefined,
    }),
    [query, author, yearFrom, yearTo, venue],
  );
  const discoverySearch = useDiscoverySearchController({
    allSources: DEFAULT_DISCOVERY_SOURCES,
    initialSnapshot: {
      results: initialState.results,
      selectedId: initialState.selectedId,
      sourceStatus: initialState.sourceStatus,
    },
    onMessage: setMessage,
    preview: desktopRuntime
      ? undefined
      : {
          message:
            "浏览器预览正在展示一组聚合检索样例；桌面应用会实时查询 OpenAlex、Crossref、Semantic Scholar 和 arXiv。",
          results: PREVIEW_DISCOVERY_RESULTS,
          sourceStatus: (sources) =>
            previewDiscoverySourceStatus(DEFAULT_DISCOVERY_SOURCES, sources),
        },
  });
  const {
    cancel: cancelDiscoverySearch,
    clear: clearDiscoverySearch,
    cursors,
    loadMore: loadMoreDiscoveryResults,
    loadingMore,
    loadMoreError,
    results,
    search: executeDiscoverySearch,
    searchError,
    searching,
    hasResult: hasDiscoveryResult,
    select: selectDiscoveryResult,
    selectedId,
    sourceStatus,
    updateResultByIdentity: updateDiscoveryResultByIdentity,
  } = discoverySearch;
  const {
    importResult,
    importing: importingDiscoveryResult,
    isImporting: isImportingDiscoveryResult,
  } = useDiscoveryResultImportController({
    desktopRuntime,
    hasResult: hasDiscoveryResult,
    onMessage: setMessage,
    results,
    selectResult: selectDiscoveryResult,
    updateResultByIdentity: updateDiscoveryResultByIdentity,
  });
  const visibleSites = useMemo(() => sites.filter((s) => !s.hidden), [sites]);
  const activeTab = useMemo(() => tabs.find((t) => t.active) ?? null, [tabs]);
  const firstSearchSite = useMemo(
    () => visibleSites.find((site) => site.searchUrl) ?? visibleSites[0] ?? null,
    [visibleSites],
  );
  const sourceCount = selectedSources.size;
  const activeSourceStatus = useMemo(() => sourceStatusSummary(sourceStatus), [sourceStatus]);
  const hasOpenSourceSearchRun =
    query.trim().length > 0 &&
    Object.values(sourceStatus).some((status) => status !== "idle" && status !== "searching");
  const showOpenSourceSearchError = !searching && results.length === 0 && Boolean(searchError);
  const showOpenSourceNoResults =
    !showOpenSourceSearchError && !searching && results.length === 0 && hasOpenSourceSearchRun;

  const hideBrowserViewsWithFeedback = useCallback(async (): Promise<boolean> => {
    try {
      await hideResearchViews();
      return true;
    } catch (error) {
      setMessage(`浏览器视图隐藏失败:${describeUnknownError(error)}`);
      return false;
    }
  }, []);

  const runBrowserAction = useCallback((label: string, operation: () => Promise<void>) => {
    void operation().catch((error) => setMessage(`${label}失败:${describeUnknownError(error)}`));
  }, []);

  const openResearchTabWithFeedback = useCallback(
    (
      siteId: string,
      url: string,
      tabProxy?: string,
      options: {
        keepBrowserOnFailure?: boolean;
        onOpened?: (tabId: string) => void;
        reuseExisting?: boolean;
      } = {},
    ) => {
      setOpeningBrowserTab(true);
      void openResearchTab(siteId, url, tabProxy, { reuseExisting: options.reuseExisting })
        .then((tabId) => {
          if (!tabId) {
            setMessage("内置浏览器仅在桌面应用中可用");
            if (!options.keepBrowserOnFailure) setMode("home");
            return;
          }
          options.onOpened?.(tabId);
          return listResearchTabs().then(setTabs);
        })
        .catch((error) => {
          setMessage(`打开站点失败:${describeUnknownError(error)}`);
          if (!options.keepBrowserOnFailure) setMode("home");
        })
        .finally(() => {
          setOpeningBrowserTab(false);
        });
    },
    [],
  );

  const refreshSites = useCallback(async () => {
    const list = await listSites();
    setSites(list);
    setSiteData(await sitesWithData(list.map((s) => s.id)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initId = window.setTimeout(() => {
      void refreshSites();
      void getProxyAddress().then((value) => {
        if (cancelled) return;
        proxyRef.current = value;
        setProxy(value);
      });
      void getEzproxyPrefix().then((value) => {
        if (cancelled) return;
        ezproxyRef.current = value;
        setEzproxy(value);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(initId);
    };
  }, [refreshSites]);

  const [searchParams, setSearchParams] = useSearchParams();
  const {
    openBrowser: openFulltextTaskBrowser,
    openTarget: openFulltextBrowser,
    replace: replacePendingFulltextTask,
    start: startFulltextTask,
    task: pendingFulltextTask,
    taskRef: pendingFulltextTaskRef,
  } = useFulltextTaskController({
    clearSearch: clearDiscoverySearch,
    desktopRuntime,
    ezproxy,
    initialTask: initialState.pendingTask,
    onConfirmDraft: enqueueConfirmDraft,
    onMessage: setMessage,
    onMode: setMode,
    onQuery: setQuery,
    openResearchTab: openResearchTabWithFeedback,
    proxy,
  });

  // "Find full text" hand-off from Reader/Library (via a shared task contract).
  useEffect(() => {
    const task = initialFulltextTask(searchParams);
    if (!task) return;
    const handoffId = window.setTimeout(() => {
      // Consume the params so a refresh/back doesn't reopen.
      setSearchParams({}, { replace: true });
      startFulltextTask(task);
    }, 0);
    return () => window.clearTimeout(handoffId);
  }, [searchParams, setSearchParams, startFulltextTask]);

  const openViaLibrary = useCallback(async () => {
    if (!ezproxy.trim()) {
      setMessage("请先在“管理站点”里填写图书馆 EZproxy 前缀");
      return;
    }
    try {
      const current = await activeResearchUrl();
      if (!current) return;
      const rewritten = ezproxyRewrite(ezproxy, current);
      if (!rewritten) {
        setMessage("当前地址或图书馆前缀不是有效 http/https URL");
        return;
      }
      await navigateResearchTab(rewritten);
      setMessage("已通过图书馆入口重新打开(走学校订阅身份)");
    } catch (error) {
      setMessage(`通过图书馆打开失败:${describeUnknownError(error)}`);
    }
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
        setMessage(
          `抓取失败:${result.error ? describeUnknownError(result.error) : "当前没有可抓取的页面"}`,
        );
      } else if (result.kind === "print") {
        setMessage("已将当前页面渲染为 PDF,正在入库...");
      } else {
        setMessage("正在下载并入库...");
      }
    } catch (e) {
      setMessage(`抓取失败:${describeUnknownError(e)}`);
    } finally {
      setWebImporting(false);
    }
  }, []);

  const saveProxy = useCallback(async () => {
    if (savingProxyRef.current) return;
    const startedAt = Date.now();
    savingProxyRef.current = true;
    setSavingProxy(true);
    try {
      await setProxyAddress(proxyRef.current);
      await waitForMinimumElapsed(startedAt, MIN_PROXY_CONFIG_SAVE_BUSY_MS);
      setMessage("已保存代理地址");
    } catch (e) {
      setMessage(`代理配置无效:${describeUnknownError(e)}`);
    } finally {
      savingProxyRef.current = false;
      setSavingProxy(false);
    }
  }, []);

  const saveEzproxy = useCallback(async () => {
    if (savingEzproxyRef.current) return;
    const startedAt = Date.now();
    savingEzproxyRef.current = true;
    setSavingEzproxy(true);
    try {
      await setEzproxyPrefix(ezproxyRef.current);
      await waitForMinimumElapsed(startedAt, MIN_PROXY_CONFIG_SAVE_BUSY_MS);
      setMessage("已保存图书馆前缀");
    } catch (e) {
      setMessage(`图书馆前缀无效:${describeUnknownError(e)}`);
    } finally {
      savingEzproxyRef.current = false;
      setSavingEzproxy(false);
    }
  }, []);

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
    () => Object.values(cursors).some((cursor) => cursor?.hasMore),
    [cursors],
  );

  const selectedResult = useMemo(
    () => displayedResults.find((r) => r.id === selectedId) ?? displayedResults[0] ?? null,
    [displayedResults, selectedId],
  );

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
    if (
      mode === "browser" &&
      tabs.length === 0 &&
      !openingBrowserTab &&
      !pendingFulltextTask
    ) {
      const closeId = window.setTimeout(() => {
        void hideBrowserViewsWithFeedback();
        setMode("home");
      }, 0);
      return () => window.clearTimeout(closeId);
    }
  }, [
    hideBrowserViewsWithFeedback,
    mode,
    openingBrowserTab,
    pendingFulltextTask,
    tabs.length,
  ]);

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
      })
        .then(() => {
          boundsErrorReportedRef.current = false;
        })
        .catch((error) => {
          if (boundsErrorReportedRef.current) return;
          boundsErrorReportedRef.current = true;
          setMessage(`浏览器视图定位失败:${describeUnknownError(error)}`);
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
    if (mode === "browser") return;
    const detachId = window.setTimeout(() => {
      void hideBrowserViewsWithFeedback();
    }, 0);
    return () => window.clearTimeout(detachId);
  }, [hideBrowserViewsWithFeedback, mode]);

  useEffect(() => {
    if (mode !== "browser" || !message) return;
    const toastId = window.setTimeout(() => {
      setBrowserToastKey((key) => key + 1);
    }, 0);
    return () => window.clearTimeout(toastId);
  }, [message, mode]);

  // Toggle a body class so App can collapse its sidebar while browsing.
  useEffect(() => {
    document.body.classList.toggle("research-fullscreen", mode === "browser");
    return () => document.body.classList.remove("research-fullscreen");
  }, [mode]);

  const markWorkFulltextReady = useCallback(
    (workId: string) => {
      for (const result of results) {
        if (result.libraryWorkId !== workId) continue;
        updateDiscoveryResultByIdentity(result, (current) => ({
          ...current,
          inLibrary: true,
          libraryWorkId: workId,
          needsFulltext: false,
        }));
      }
    },
    [results, updateDiscoveryResultByIdentity],
  );

  const restoreActiveBrowserTab = useCallback(() => {
    const active = tabs.find((tab) => tab.active);
    if (active) runBrowserAction("恢复浏览器标签", () => activateResearchTab(active.tabId));
  }, [runBrowserAction, tabs]);
  const {
    deferBrowserFallback,
    finish: finishBrowserImport,
    markLeaving: markFulltextImportLeaving,
    resumeIfQueueEmpty,
  } = useFulltextImportCompletion({
    dismissDraft: dismissConfirmDraft,
    hideBrowserViews: hideBrowserViewsWithFeedback,
    markWorkReady: markWorkFulltextReady,
    mode,
    navigate,
    onMessage: setMessage,
    onMode: setMode,
    openTaskBrowser: openFulltextTaskBrowser,
    queueSnapshot: confirmDraftQueueSnapshot,
    replaceTask: replacePendingFulltextTask,
    restoreActiveBrowserTab,
    taskRef: pendingFulltextTaskRef,
  });

  const {
    handleDedup: handleBrowserDedup,
    queueConfirmation: queueBrowserConfirmation,
  } = useBrowserDownloadImport({
    enqueueDraft: enqueueConfirmDraft,
    finish: finishBrowserImport,
    hideBrowserViews: hideBrowserViewsWithFeedback,
    modeRef,
    onMessage: setMessage,
    removeDraft: removeConfirmDraft,
    resumeIfQueueEmpty,
  });

  // Subscribe to intercepted downloads while the browser view is active.
  // A task target only applies to the exact research tab bound to that task.
  useEffect(() => {
    if (mode !== "browser") return;
    return subscribeResearchDownloads(
      (result) => {
        if (result.kind === "ignored") return;
        if (result.kind === "error") {
          setMessage(`捕获下载失败:${describeUnknownError(result.error)}`);
        } else if (result.kind === "references") {
          setMessage(`引用文件已导入:新增 ${result.imported ?? 0} 篇`);
        } else if (result.kind === "pdf" && result.draft) {
          const plan = planFulltextDownload(
            pendingFulltextTaskRef.current,
            result.ownerTabId,
            result.draft,
          );
          if (plan.kind === "attach-dedup") {
            void handleBrowserDedup(plan.draft);
          } else {
            queueBrowserConfirmation(plan.draft);
          }
        }
      },
      (payload) => setMessage(`正在下载并识别:${payload.fileName}…`),
    );
  }, [
    handleBrowserDedup,
    mode,
    pendingFulltextTaskRef,
    queueBrowserConfirmation,
  ]);

  const handleBrowserCommit = useCallback(
    async (decision: ImportDecision) => {
      const draft = confirmDraft;
      const { attachStagedPdf, commitIngest, restoreDedup } =
        await import("../services/library-actions");
      let completedWorkId: string;
      if (decision.mode === "attach") {
        await restoreDedup(decision.workId);
        if (decision.pdf) await attachStagedPdf(decision.workId, decision.pdf);
        setMessage("已将 PDF 挂到所选文献");
        completedWorkId = decision.workId;
      } else {
        const result = await commitIngest({
          workInput: decision.workInput,
          pdf: decision.pdf,
          source: "browser",
        });
        setMessage(`已入库:${result.title}`);
        completedWorkId = result.workId;
      }
      window.dispatchEvent(new Event("aurascholar:library-updated"));
      finishBrowserImport(draft, completedWorkId);
    },
    [confirmDraft, finishBrowserImport],
  );

  const handleBrowserCancel = useCallback(() => {
    const task = pendingFulltextTaskRef.current;
    const continueInBrowser =
      Boolean(confirmDraft?.targetHandoffId) &&
      confirmDraft?.targetHandoffId === task?.handoffId &&
      !task?.targetTabId;
    setMessage(confirmDraft?.targetWorkId ? "已取消本次挂载，补全文目标仍保留" : "已取消入库");
    if (continueInBrowser && task) deferBrowserFallback(task);
    finishBrowserImport(confirmDraft);
  }, [
    confirmDraft,
    deferBrowserFallback,
    finishBrowserImport,
    pendingFulltextTaskRef,
  ]);

  const exitBrowser = useCallback(() => {
    markFulltextImportLeaving();
    setMessage(null);
    replacePendingFulltextTask(null);
    void hideBrowserViewsWithFeedback();
    setMode("home");
  }, [
    hideBrowserViewsWithFeedback,
    markFulltextImportLeaving,
    replacePendingFulltextTask,
  ]);

  const runSearch = useCallback(
    async (options: { query?: string; sources?: DiscoverySource[] } = {}): Promise<boolean> => {
      const searchText = (options.query ?? query).trim();
      if (!searchText) return false;
      const requestedSources = options.sources ?? Array.from(selectedSources);
      const sources = requestedSources.length > 0 ? requestedSources : DEFAULT_DISCOVERY_SOURCES;
      if (searching) {
        (window as DiscoverySmokeWindow).__AURASCHOLAR_SMOKE_DISCOVERY_REPLACED_ACTIVE_SEARCH__ =
          true;
      }
      if (!desktopRuntime || options.query !== undefined) setQuery(searchText);
      const outcome = await executeDiscoverySearch({
        query: buildQuery(searchText),
        sort: sortBy,
        sources,
      });
      return discoverySearchApplied(outcome);
    },
    [buildQuery, desktopRuntime, executeDiscoverySearch, query, searching, selectedSources, sortBy],
  );

  // Re-run the search when the sort key changes (API re-ranks server-side).
  // Skip the initial render and when there's nothing searched yet.
  const sortInitRef = useRef(true);
  useEffect(() => {
    if (sortInitRef.current) {
      sortInitRef.current = false;
      return;
    }
    if (query.trim() && results.length > 0 && !searching) {
      const searchId = window.setTimeout(() => {
        void runSearch();
      }, 0);
      return () => window.clearTimeout(searchId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  const stopSearch = useCallback(() => {
    cancelDiscoverySearch();
    setMessage("已停止检索");
  }, [cancelDiscoverySearch]);

  const clearOpenSourceSearch = useCallback(() => {
    clearDiscoverySearch();
    setQuery("");
    setMessage(null);
    window.setTimeout(() => openSourceSearchInputRef.current?.focus(), 0);
  }, [clearDiscoverySearch]);

  const toggleSource = useCallback((source: DiscoverySource) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next.size > 0 ? next : prev;
    });
  }, []);

  const fillSuggestedQuery = useCallback((value: string) => {
    setQuery(value);
    setMessage(null);
  }, []);

  const runOpenSearchFromHome = useCallback(() => {
    setMode("opensource");
    if (query.trim()) void runSearch();
  }, [query, runSearch]);

  const openSavedSearchQuery = useCallback(
    async ({ query: savedQuery, sources }: { query: string; sources: DiscoverySource[] }) => {
      setMode("opensource");
      setQuery(savedQuery);
      setSelectedSources(new Set(sources));
      return runSearch({ query: savedQuery, sources });
    },
    [runSearch],
  );
  const savedSearchController = useDiscoverySavedSearchController({
    confirm,
    defaultSources: DEFAULT_DISCOVERY_SOURCES,
    enabled: desktopRuntime,
    onMessage: setMessage,
    onOpenSearch: openSavedSearchQuery,
    query,
    selectedSources,
  });
  const {
    check: runSavedSearchNow,
    newCount: savedNewCount,
    open: openSavedSearch,
    recentItems: recentSavedSearches,
    remove: removeSavedSearch,
    restoreLastDelete: undoSavedSearchDelete,
    rowActions: savedSearchRowActions,
    saveCurrent: saveCurrentSearch,
    saving: savingSearch,
  } = savedSearchController;

  useEffect(() => {
    const target = window as DiscoverySmokeWindow;
    const runSmokeSearch = async (text: string, sources?: DiscoverySource[]): Promise<boolean> => {
      if (!target.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__) return false;
      const nextSources = sources && sources.length > 0 ? sources : DEFAULT_DISCOVERY_SOURCES;
      setMode("opensource");
      setQuery(text);
      setSelectedSources(new Set(nextSources));
      return runSearch({ query: text, sources: nextSources });
    };
    const runSmokeLoadMore = async (): Promise<boolean> =>
      discoverySearchApplied(await loadMoreDiscoveryResults());
    target.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_SEARCH__ = runSmokeSearch;
    target.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_LOAD_MORE__ = runSmokeLoadMore;
    return () => {
      if (target.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_SEARCH__ === runSmokeSearch) {
        delete target.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_SEARCH__;
      }
      if (target.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_LOAD_MORE__ === runSmokeLoadMore) {
        delete target.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_LOAD_MORE__;
      }
    };
  }, [loadMoreDiscoveryResults, runSearch]);

  const undoSiteRemove = useCallback(async () => {
    if (!siteRemoveUndo || siteRemoveUndoBusy || !desktopRuntime) return;
    const startedAt = Date.now();
    setSiteRemoveUndoBusy(true);
    setMessage("正在撤销删除站点...");
    try {
      const smokeFailure = consumeDiscoverySmokeRestoreSiteFailure();
      if (smokeFailure) {
        await waitForMinimumElapsed(startedAt, MIN_SITE_ACTION_BUSY_MS);
        throw smokeFailure;
      }
      await restoreSite(siteRemoveUndo.site);
      await waitForMinimumElapsed(startedAt, MIN_SITE_ACTION_BUSY_MS);
      await refreshSites();
      setSiteRemoveUndo(null);
      setMessage(`已恢复站点:${siteRemoveUndo.site.name}`);
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_SITE_ACTION_BUSY_MS);
      setMessage(`撤销删除站点失败，撤销入口仍保留，可重新撤销:${describeUnknownError(e)}`);
    } finally {
      setSiteRemoveUndoBusy(false);
    }
  }, [desktopRuntime, refreshSites, siteRemoveUndo, siteRemoveUndoBusy]);

  const openLibraryResult = useCallback(
    (result: DiscoveryResultWithLibrary) => {
      if (!result.libraryWorkId) return;
      if (!desktopRuntime) {
        navigate(`/reader?work=${encodeURIComponent(result.libraryWorkId)}`);
        return;
      }
      navigate(`/reader?work=${encodeURIComponent(result.libraryWorkId)}`);
    },
    [desktopRuntime, navigate],
  );

  const importReferenceText = useCallback(async (text: string, fileName?: string) => {
    if (!text.trim()) return;
    setWebImporting(true);
    try {
      const { previewReferences } = await import("../services/import-refs");
      const preview = previewReferences(text);
      if (preview.length === 0) {
        setMessage("没有解析出文献。请选择 BibTeX、RIS、NBIB、ENW 或 CSL-JSON 文件。");
        return;
      }
      const previewOnly = !isDesktopRuntime();
      setReferenceImportPreview({ count: preview.length, fileName, previewOnly, text });
      setMessage(
        previewOnly
          ? `已解析出 ${preview.length} 条文献；确认后会在本页模拟导入，不写入真实文献库。`
          : `已解析出 ${preview.length} 条文献，请确认后入库`,
      );
    } catch (e) {
      setMessage(`解析失败:${describeUnknownError(e)}`);
    } finally {
      setWebImporting(false);
    }
  }, []);

  const confirmReferenceImport = useCallback(async () => {
    if (!referenceImportPreview) return;
    const startedAt = Date.now();
    setWebImporting(true);
    try {
      if (referenceImportPreview.previewOnly) {
        await waitForMinimumElapsed(startedAt, MIN_REFERENCE_IMPORT_CONFIRM_BUSY_MS);
        setReferenceImportPreview(null);
        setMessage(
          `预览已模拟导入 ${referenceImportPreview.count} 条引用；真实写入、去重和附件关联会在桌面应用中完成。`,
        );
        return;
      }
      const { importReferences } = await import("../services/import-refs");
      const summary = await importReferences(referenceImportPreview.text);
      await waitForMinimumElapsed(startedAt, MIN_REFERENCE_IMPORT_CONFIRM_BUSY_MS);
      setMessage(
        `引用文件导入完成:新增 ${summary.imported} 篇,已存在 ${summary.deduped} 篇(共 ${summary.total} 条)`,
      );
      setReferenceImportPreview(null);
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_REFERENCE_IMPORT_CONFIRM_BUSY_MS);
      setMessage(`导入失败，当前文献库未写入部分导入，可重新导入:${describeUnknownError(e)}`);
    } finally {
      setWebImporting(false);
    }
  }, [referenceImportPreview]);

  const cancelReferenceImport = useCallback(() => {
    if (webImporting) return;
    setReferenceImportPreview(null);
    setMessage("已取消导入引用文件");
  }, [webImporting]);

  const handleFile = useCallback(
    async (file: File) => {
      await importReferenceText(await file.text(), file.name);
    },
    [importReferenceText],
  );

  const openSite = useCallback(
    (site: DiscoverySite) => {
      const url = siteUrl(site, query);
      if (!isDesktopRuntime()) {
        void openExternalUrl(url).catch((error) =>
          setMessage(`打开外部链接失败:${describeUnknownError(error)}`),
        );
        return;
      }
      setMessage(null);
      replacePendingFulltextTask(null);
      setMode("browser");
      openResearchTabWithFeedback(site.id, url, site.useProxy ? proxy : "");
    },
    [openResearchTabWithFeedback, query, proxy, replacePendingFulltextTask],
  );

  const openPrimarySite = useCallback(() => {
    if (!firstSearchSite) {
      setMessage("暂无可打开的学术站点。");
      return;
    }
    openSite(firstSearchSite);
  }, [firstSearchSite, openSite]);

  const handleAddSite = useCallback(async () => {
    if (addingSiteBusy || !newSite.name.trim() || !newSite.homeUrl.trim()) return;
    const homeUrl = /^https?:\/\//.test(newSite.homeUrl)
      ? newSite.homeUrl
      : `https://${newSite.homeUrl}`;
    const startedAt = Date.now();
    setAddingSiteBusy(true);
    setMessage(null);
    try {
      const result = await addSite({ name: newSite.name, homeUrl, searchUrl: newSite.searchUrl });
      await refreshSites();
      await waitForMinimumElapsed(startedAt, MIN_DISCOVERY_SITE_ADD_BUSY_MS);
      setNewSite({ name: "", homeUrl: "", searchUrl: "" });
      setAddingSite(false);
      const feedback =
        result.status === "created"
          ? `已添加站点:${result.site.name}`
          : result.status === "restored"
            ? `已恢复站点:${result.site.name}`
            : `站点已存在:${result.site.name}`;
      setMessage(feedback);
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_DISCOVERY_SITE_ADD_BUSY_MS);
      setMessage(`添加站点失败:${describeUnknownError(e)}`);
    } finally {
      setAddingSiteBusy(false);
    }
  }, [addingSiteBusy, newSite, refreshSites]);

  const restoreHiddenSite = useCallback(
    async (site: DiscoverySite) => {
      if (restoringSiteIdsRef.current.has(site.id)) return;
      const startedAt = Date.now();
      const nextRestoring = new Set(restoringSiteIdsRef.current);
      nextRestoring.add(site.id);
      restoringSiteIdsRef.current = nextRestoring;
      setRestoringSiteIds(nextRestoring);
      setMessage(null);
      try {
        await setHidden(site.id, false);
        await waitForMinimumElapsed(startedAt, MIN_SITE_RESTORE_BUSY_MS);
        await refreshSites();
        setMessage(`已恢复站点:${site.name}`);
      } catch (e) {
        setMessage(`恢复站点失败:${describeUnknownError(e)}`);
      } finally {
        const updatedRestoring = new Set(restoringSiteIdsRef.current);
        updatedRestoring.delete(site.id);
        restoringSiteIdsRef.current = updatedRestoring;
        setRestoringSiteIds(updatedRestoring);
      }
    },
    [refreshSites],
  );

  const toggleSiteProxy = useCallback(
    async (site: DiscoverySite) => {
      if (proxyingSiteIdsRef.current.has(site.id)) return;
      const startedAt = Date.now();
      const nextProxying = new Set(proxyingSiteIdsRef.current);
      nextProxying.add(site.id);
      proxyingSiteIdsRef.current = nextProxying;
      setProxyingSiteIds(nextProxying);
      setMessage(null);
      const nextUseProxy = !site.useProxy;
      try {
        await setSiteProxy(site.id, nextUseProxy);
        await waitForMinimumElapsed(startedAt, MIN_SITE_PROXY_BUSY_MS);
        await refreshSites();
        setMessage(`${nextUseProxy ? "已开启" : "已关闭"}站点代理:${site.name}`);
      } catch (e) {
        setMessage(`更新站点代理失败:${describeUnknownError(e)}`);
      } finally {
        const updatedProxying = new Set(proxyingSiteIdsRef.current);
        updatedProxying.delete(site.id);
        proxyingSiteIdsRef.current = updatedProxying;
        setProxyingSiteIds(updatedProxying);
      }
    },
    [refreshSites],
  );

  const handleSiteAction = useCallback(
    async (site: DiscoverySite, action: SiteManagementAction) => {
      if (siteActionsRef.current.has(site.id)) return;
      const confirmed = await confirm(
        action === "remove"
          ? {
              title: "删除自定义站点？",
              description: `将从检索入口移除「${site.name}」。`,
              details: [
                "这只删除站点配置，不会删除文献库中的论文。",
                "删除后需要重新添加 URL 才能再次使用。",
              ],
              confirmLabel: "删除站点",
              tone: "warning",
            }
          : action === "hide"
            ? {
                title: "隐藏内置站点？",
                description: `「${site.name}」会从当前入口列表隐藏。`,
                details: ["可以在管理站点时从隐藏列表恢复。", "文献库和订阅数据不会受影响。"],
                confirmLabel: "隐藏站点",
                tone: "neutral",
              }
            : {
                title: "清除网站数据？",
                description: `将清除「${site.name}」在内置浏览器里的本地数据。`,
                details: [
                  "这可能会退出该站点登录状态，并清除 cookie / cache。",
                  "文献库、检索订阅和已下载 PDF 不会被删除。",
                ],
                confirmLabel: "清除数据",
                tone: "warning",
              },
      );
      if (!confirmed) return;
      const startedAt = Date.now();
      const nextActions = new Map(siteActionsRef.current);
      nextActions.set(site.id, action);
      siteActionsRef.current = nextActions;
      setSiteActions(nextActions);
      setMessage(null);
      let removedSiteUndo: SiteRemoveUndoState | null = null;
      try {
        if (action === "remove") {
          const smokeFailure = consumeDiscoverySmokeRemoveSiteFailure();
          if (smokeFailure) {
            await waitForMinimumElapsed(startedAt, MIN_SITE_ACTION_BUSY_MS);
            throw smokeFailure;
          }
          await removeSite(site.id);
          const undoMessage = `已删除站点:${site.name}`;
          removedSiteUndo = { message: undoMessage, site };
          setSiteRemoveUndo(removedSiteUndo);
          setMessage(undoMessage);
        } else if (action === "hide") {
          setSiteRemoveUndo(null);
          await setHidden(site.id, true);
          setMessage(`已隐藏站点:${site.name}`);
        } else if (action === "clear") {
          setSiteRemoveUndo(null);
          await clearSiteData(site);
          setMessage(`已清除 ${site.name} 的网站数据`);
        }
        await waitForMinimumElapsed(startedAt, MIN_SITE_ACTION_BUSY_MS);
        await refreshSites();
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_SITE_ACTION_BUSY_MS);
        if (action === "remove" && !removedSiteUndo) {
          setMessage(`删除站点失败，站点仍保留，可重新删除:${describeUnknownError(e)}`);
        } else if (action === "remove" && removedSiteUndo) {
          setSiteRemoveUndo(removedSiteUndo);
          setMessage(`删除站点后刷新失败，撤销入口已保留:${describeUnknownError(e)}`);
        } else {
          setMessage(`操作失败:${describeUnknownError(e)}`);
        }
      } finally {
        const updatedActions = new Map(siteActionsRef.current);
        updatedActions.delete(site.id);
        siteActionsRef.current = updatedActions;
        setSiteActions(updatedActions);
      }
    },
    [confirm, refreshSites],
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
              onClick={() => runBrowserAction("后退", researchGoBack)}
            >
              ‹
            </button>
            <button
              type="button"
              className="research-nav__btn"
              title="前进"
              disabled={!activeTab?.canGoForward}
              onClick={() => runBrowserAction("前进", researchGoForward)}
            >
              ›
            </button>
            <button
              type="button"
              className="research-nav__btn"
              title="刷新"
              disabled={!activeTab || activeTab.archived}
              onClick={() => runBrowserAction("刷新", researchReload)}
            >
              ↻
            </button>
          </div>
          <div className="research-tabs">
            {tabs.map((tab) => (
              <div
                key={tab.tabId}
                className={`research-tab ${tab.active ? "research-tab--active" : ""} ${tab.archived ? "research-tab--archived" : ""}`}
                onClick={() => runBrowserAction("切换标签", () => activateResearchTab(tab.tabId))}
                title={tab.archived ? "已休眠 — 点击恢复" : tab.url}
              >
                <span className="research-tab__title">{tab.title || hostOf(tab.url)}</span>
                <button
                  type="button"
                  className="research-tab__close"
                  onClick={(e) => {
                    e.stopPropagation();
                    runBrowserAction("关闭标签", () => closeResearchTab(tab.tabId));
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
        {pendingFulltextTask && (
          <PendingFulltextTarget
            title={pendingFulltextTask.title}
            detail={
              pendingFulltextTask.targetTabId
                ? "仅从本次全文任务标签下载或抓取的 PDF 会优先挂回这篇文献。"
                : "正在检查开放全文并准备专属浏览标签。"
            }
          />
        )}
        <div ref={hostRef} className="research-browser-host">
          {!activeTab && <span>正在打开...</span>}
          {activeTab?.archived && (
            <span>正在恢复 {activeTab.title || hostOf(activeTab.url)}...</span>
          )}
        </div>
        <InlineNotice key={browserToastKey} className="research-browser-status" message={message} />
        {confirmDraft && (
          <Suspense
            fallback={
              <div className="route-loading" role="status" aria-live="polite" aria-busy="true">
                正在打开入库确认...
              </div>
            }
          >
            <ImportConfirmDialog
              key={confirmDraftKey}
              draft={confirmDraft}
              onCommit={handleBrowserCommit}
              onCancel={handleBrowserCancel}
            />
            {pendingConfirmDraftCount > 0 && (
              <span className="sr-only" role="status">
                另有 {pendingConfirmDraftCount} 个下载等待核对
              </span>
            )}
          </Suspense>
        )}
        {confirmDialog}
      </div>
    );
  }

  // ---- Open-source aggregated search view ----
  if (mode === "opensource") {
    return (
      <div className="discovery-page discovery-page--opensource">
        <button type="button" className="discovery-back-link" onClick={() => setMode("home")}>
          ← 返回学术检索
        </button>

        {pendingFulltextTask && (
          <PendingFulltextTarget
            title={pendingFulltextTask.title}
            detail={
              desktopRuntime
                ? "可继续检索开放 PDF 线索，或切到站点浏览后把下载 PDF 挂回这篇文献。"
                : "浏览器预览已保留目标；桌面应用会打开全文来源并把 PDF 挂回这篇文献。"
            }
          />
        )}

        <section className="discovery-search-hero">
          <div>
            <p className="app-page-kicker">Open sources</p>
            <h1 className="app-page-title">开放源聚合检索</h1>
            <p className="app-page-subtitle">
              同时查询开放元数据源，自动识别库中文献、开放 PDF 与可订阅的主题。
            </p>
          </div>
          <div className="discovery-summary" aria-label="开放源检索状态">
            <span
              className={
                searching
                  ? "discovery-summary__item discovery-summary__item--live"
                  : "discovery-summary__item"
              }
            >
              <strong>{activeSourceStatus}</strong>
              <small>检索状态</small>
            </span>
            <span className="discovery-summary__item">
              <strong>{results.length}</strong>
              <small>候选结果</small>
            </span>
            <span className="discovery-summary__item">
              <strong>{sourceCount}</strong>
              <small>数据源</small>
            </span>
          </div>
        </section>

        <div className="discovery-grid">
          <section className="discovery-search">
            <Card className="discovery-command-card" aria-busy={searching || undefined}>
              <div className="discovery-command-card__head">
                <div>
                  <h2>检索控制台</h2>
                  <p>输入主题、标题、DOI 或 arXiv ID，结果会边返回边合并去重。</p>
                </div>
                <Badge variant={desktopRuntime ? "success" : "warning"}>
                  {desktopRuntime ? "桌面检索" : "浏览器预览"}
                </Badge>
              </div>
              <div className="discovery-command">
                <input
                  ref={openSourceSearchInputRef}
                  className="au-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !isImeComposing(e) && void runSearch()}
                  placeholder="输入关键词、论文标题、DOI 或 arXiv ID"
                  aria-label="开放源检索关键词"
                  disabled={searching}
                />
                <Button
                  onClick={() => void runSearch()}
                  disabled={searching || !query.trim()}
                  aria-busy={searching || undefined}
                >
                  {searching ? "检索中..." : "检索开放源"}
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
                      aria-busy={savingSearch || undefined}
                      title="保存为订阅:定期在后台重跑此检索,有新论文时通知你"
                    >
                      {savingSearch ? "保存中..." : "保存为订阅"}
                    </Button>
                  )
                )}
              </div>
              <div className="discovery-command-hint">
                <strong>建议</strong>
                {SUGGESTED_QUERIES.map((item) => (
                  <button key={item} type="button" onClick={() => fillSuggestedQuery(item)}>
                    {item}
                  </button>
                ))}
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

            <DiscoverySavedSearchPanel
              message={message}
              snapshot={savedSearchController}
              onCheck={runSavedSearchNow}
              onDelete={removeSavedSearch}
              onOpen={openSavedSearch}
              onUndo={undoSavedSearchDelete}
            />

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
                <div className="discovery-search-empty au-surface">
                  {showOpenSourceSearchError ? (
                    <>
                      <Badge variant="danger">Search failed</Badge>
                      <h3>检索没有完成</h3>
                      <p>
                        {searchError}
                        <br />
                        当前数据源暂时不可用，重试会保留关键词和筛选条件。
                      </p>
                      <div className="discovery-empty-actions">
                        <Button
                          type="button"
                          onClick={() => void runSearch()}
                          disabled={!query.trim()}
                        >
                          重试检索
                        </Button>
                        <Button
                          variant="secondary"
                          type="button"
                          aria-label="清空开放源检索"
                          onClick={clearOpenSourceSearch}
                        >
                          清空搜索
                        </Button>
                      </div>
                    </>
                  ) : showOpenSourceNoResults ? (
                    <>
                      <Badge variant="warning">No matches</Badge>
                      <h3>没有找到匹配文献</h3>
                      <p>换一个关键词、放宽高级检索条件，或稍后重试当前数据源。</p>
                      <div className="discovery-empty-actions">
                        <Button
                          type="button"
                          onClick={() => void runSearch()}
                          disabled={!query.trim()}
                        >
                          重试检索
                        </Button>
                        <Button
                          variant="secondary"
                          type="button"
                          aria-label="清空开放源检索"
                          onClick={clearOpenSourceSearch}
                        >
                          清空搜索
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Badge variant="neutral">Ready</Badge>
                      <h3>从开放数据源发现文献</h3>
                      <p>结果会自动去重、标记库中状态，并保留开放 PDF 线索，适合作为调研起点。</p>
                      <div className="discovery-empty-steps">
                        <span>
                          <strong>01</strong>
                          填主题或 DOI
                        </span>
                        <span>
                          <strong>02</strong>
                          筛选数据源
                        </span>
                        <span>
                          <strong>03</strong>
                          一键入库
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ) : displayedResults.length === 0 ? (
                <div className="discovery-search-empty discovery-search-empty--compact au-surface">
                  <h3>没有符合筛选条件的结果</h3>
                  <p>放宽年份、期刊或开放全文筛选试试。</p>
                </div>
              ) : (
                displayedResults.map((result) => (
                  <ResultCard
                    key={result.id}
                    result={result}
                    selected={selectedResult?.id === result.id}
                    importing={isImportingDiscoveryResult(result)}
                    importBlocked={importingDiscoveryResult}
                    onSelect={() => selectDiscoveryResult(result.id)}
                    onPrimaryAction={() => {
                      if (result.inLibrary && result.libraryWorkId) {
                        openLibraryResult(result);
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
                          arxivId: result.work.arxivId,
                          url: result.work.oaPdfUrl ?? result.work.url,
                        });
                      }
                    }}
                  />
                ))
              )}
              {results.length > 0 && !searching && (canLoadMore || loadMoreError) && (
                <div className="discovery-load-more">
                  {loadMoreError && (
                    <div className="discovery-load-more__error" role="alert">
                      <div>
                        <strong>加载更多没有完成</strong>
                        <span>{loadMoreError}</span>
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => void loadMoreDiscoveryResults()}
                        disabled={searching || loadingMore || !canLoadMore}
                        aria-busy={loadingMore || undefined}
                        aria-label="重试加载更多结果"
                      >
                        {loadingMore ? "重试中…" : "重试加载更多"}
                      </Button>
                    </div>
                  )}
                  {canLoadMore && (
                    <Button
                      variant="secondary"
                      onClick={() => void loadMoreDiscoveryResults()}
                      disabled={searching || loadingMore}
                      aria-busy={loadingMore || undefined}
                    >
                      {loadingMore ? "加载中…" : "加载更多"}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </section>

          <aside className="discovery-panel">
            <Card className="discovery-detail-card">
              <div className="discovery-detail-card__head">
                <div>
                  <h3 className="au-heading">结果详情</h3>
                  <p>选择左侧论文后，这里会显示入库和找全文动作。</p>
                </div>
              </div>
              {selectedResult ? (
                <ResultDetail
                  result={selectedResult}
                  importing={isImportingDiscoveryResult(selectedResult)}
                  importBlocked={importingDiscoveryResult}
                  onPrimaryAction={() =>
                    selectedResult.inLibrary && selectedResult.libraryWorkId
                      ? openLibraryResult(selectedResult)
                      : void importResult(selectedResult)
                  }
                  onFindFulltext={() => {
                    if (selectedResult.libraryWorkId) {
                      openFulltextBrowser({
                        id: selectedResult.libraryWorkId,
                        title: selectedResult.work.title,
                        doi: selectedResult.work.doi,
                        arxivId: selectedResult.work.arxivId,
                        url: selectedResult.work.oaPdfUrl ?? selectedResult.work.url,
                      });
                    }
                  }}
                />
              ) : (
                <div className="discovery-detail-empty">
                  <strong>等待结果</strong>
                  <span>检索并选择一篇论文后，可以加入文献库或跳转获取全文。</span>
                </div>
              )}
            </Card>
          </aside>
        </div>
        {confirmDialog}
      </div>
    );
  }

  // ---- Home: site card grid ----
  return (
    <div className="discovery-page discovery-page--home">
      <section className="discovery-home-hero">
        <div>
          <p className="app-page-kicker">Research discovery</p>
          <h1 className="app-page-title">学术检索</h1>
          <p className="app-page-subtitle">
            从开放元数据到机构全文，把发现、入库和后续阅读连成一条顺手的路径。
          </p>
        </div>
        <div className="discovery-summary" aria-label="学术检索状态">
          <span className="discovery-summary__item discovery-summary__item--live">
            <strong>{desktopRuntime ? "桌面" : "预览"}</strong>
            <small>运行环境</small>
          </span>
          <span className="discovery-summary__item">
            <strong>{visibleSites.length}</strong>
            <small>可用站点</small>
          </span>
          <span className="discovery-summary__item">
            <strong>{savedNewCount}</strong>
            <small>订阅新结果</small>
          </span>
        </div>
      </section>

      {siteRemoveUndo &&
      (message === siteRemoveUndo.message ||
        siteRemoveUndoBusy ||
        message?.startsWith("撤销删除站点失败，撤销入口仍保留")) ? (
        <InlineNotice className="library-command__message" message={message}>
          <span className="library-command__message-text">{message}</span>
          <button
            type="button"
            className="library-command__message-action"
            onClick={() => void undoSiteRemove()}
            disabled={siteRemoveUndoBusy}
            aria-busy={siteRemoveUndoBusy ? "true" : undefined}
            aria-label="撤销删除站点"
          >
            {siteRemoveUndoBusy ? "撤销中..." : "撤销"}
          </button>
        </InlineNotice>
      ) : (
        <InlineNotice className="library-command__message" message={message} />
      )}

      <Card className="discovery-launch-card">
        <div className="discovery-launch-card__head">
          <div>
            <h2>发现入口</h2>
            <p>输入一次关键词，可以走开放源聚合检索，也可以带到站点浏览器中继续找全文。</p>
          </div>
          <Button variant="secondary" onClick={() => setManaging((v) => !v)}>
            {managing ? "完成" : "管理站点"}
          </Button>
        </div>
        <div className="discovery-launch-command">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !isImeComposing(event)) runOpenSearchFromHome();
            }}
            placeholder="输入主题、论文标题、DOI 或 arXiv ID"
            aria-label="学术检索关键词"
          />
          <Button onClick={runOpenSearchFromHome}>
            {query.trim() ? "聚合检索" : "打开聚合检索"}
          </Button>
          <Button variant="secondary" onClick={openPrimarySite} disabled={!firstSearchSite}>
            {firstSearchSite ? `站点检索` : "暂无站点"}
          </Button>
        </div>
        <div className="discovery-command-hint">
          <strong>建议</strong>
          {SUGGESTED_QUERIES.map((item) => (
            <button key={item} type="button" onClick={() => fillSuggestedQuery(item)}>
              {item}
            </button>
          ))}
        </div>
      </Card>

      {managing && (
        <div className="discovery-proxy-bar">
          <span className="au-text-muted">代理地址</span>
          <Input
            value={proxy}
            aria-busy={savingProxy || undefined}
            onChange={(e) => {
              proxyRef.current = e.target.value;
              setProxy(e.target.value);
            }}
            onBlur={() => void saveProxy()}
            disabled={savingProxy}
            placeholder="如 http://127.0.0.1:7890(留空=直连)"
          />
          <Button
            variant="secondary"
            onClick={() => void saveProxy()}
            disabled={savingProxy}
            aria-busy={savingProxy || undefined}
          >
            {savingProxy ? "保存中..." : "保存代理"}
          </Button>
          {savingProxy && <small className="au-text-muted">保存代理地址...</small>}
          <small className="au-text-muted">
            仅勾选「走代理」的站点经此代理;其余走系统网络(校园网 VPN 不受影响)。
          </small>
          <span className="au-text-muted">图书馆前缀</span>
          <Input
            value={ezproxy}
            aria-busy={savingEzproxy || undefined}
            onChange={(e) => {
              ezproxyRef.current = e.target.value;
              setEzproxy(e.target.value);
            }}
            onBlur={() => void saveEzproxy()}
            disabled={savingEzproxy}
            placeholder="学校 EZproxy 前缀,如 https://login.ezproxy.lib.xxx.edu.cn/login?url="
          />
          <Button
            variant="secondary"
            onClick={() => void saveEzproxy()}
            disabled={savingEzproxy}
            aria-busy={savingEzproxy || undefined}
          >
            {savingEzproxy ? "保存中..." : "保存前缀"}
          </Button>
          {savingEzproxy && <small className="au-text-muted">保存图书馆前缀...</small>}
          <small className="au-text-muted">
            填后,浏览订阅期刊时点工具栏「通过图书馆打开」即可用学校订阅身份重新加载(不必走代理)。
          </small>
        </div>
      )}

      <div className="discovery-route-grid">
        <button
          type="button"
          className="discovery-route-card discovery-route-card--primary"
          onClick={runOpenSearchFromHome}
        >
          <span className="discovery-route-card__mark">∑</span>
          <strong>开放源聚合</strong>
          <small>{sourceCount} 个数据源 · 去重 · 入库 · 订阅</small>
        </button>
        <button
          type="button"
          className="discovery-route-card"
          onClick={openPrimarySite}
          disabled={!firstSearchSite}
        >
          <span className="discovery-route-card__mark">⌁</span>
          <strong>站点浏览取全文</strong>
          <small>{firstSearchSite ? `${firstSearchSite.name} 起步` : "桌面应用中显示站点"}</small>
        </button>
        <DiscoverySavedSearchRouteSummary
          newCount={savedNewCount}
          recentCount={recentSavedSearches.length}
        />
      </div>

      <DiscoverySavedSearchRecentStrip
        items={recentSavedSearches}
        rowActions={savedSearchRowActions}
        onOpen={openSavedSearch}
      />

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
          const siteAction = siteActions.get(site.id);
          const proxying = proxyingSiteIds.has(site.id);
          const siteBusy = Boolean(siteAction);
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
                    aria-busy={proxying || undefined}
                    disabled={proxying || siteBusy}
                    title="该站的内置浏览器是否走代理(其余走系统网络/校园网)"
                    onClick={() => void toggleSiteProxy(site)}
                  >
                    {proxying ? "更新中..." : site.useProxy ? "✓ 走代理" : "走代理"}
                  </button>
                  <button
                    type="button"
                    aria-busy={siteAction === "clear" || undefined}
                    disabled={!hasData || siteBusy}
                    onClick={() => void handleSiteAction(site, "clear")}
                  >
                    {siteAction === "clear" ? "清理中..." : hasData ? "清除数据" : "无数据"}
                  </button>
                  {site.builtin ? (
                    <button
                      type="button"
                      aria-busy={siteAction === "hide" || undefined}
                      disabled={siteBusy}
                      onClick={() => void handleSiteAction(site, "hide")}
                    >
                      {siteAction === "hide" ? "隐藏中..." : "隐藏"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-busy={siteAction === "remove" || undefined}
                      disabled={siteBusy}
                      onClick={() => void handleSiteAction(site, "remove")}
                    >
                      {siteAction === "remove" ? "删除中..." : "删除"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {visibleSites.length === 0 && (
          <div className="discovery-card discovery-card--empty" aria-live="polite">
            <div className="discovery-card__icon">⌁</div>
            <div className="discovery-card__body">
              <strong>{desktopRuntime ? "暂无站点" : "浏览器预览模式"}</strong>
              <small>
                {desktopRuntime
                  ? "打开管理站点添加常用数据库"
                  : "桌面应用会显示 Google Scholar、PubMed、IEEE 等站点"}
              </small>
            </div>
          </div>
        )}

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
            .map((s) => {
              const restoring = restoringSiteIds.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-busy={restoring || undefined}
                  disabled={restoring}
                  onClick={() => void restoreHiddenSite(s)}
                >
                  {s.name} {restoring ? "恢复中..." : "恢复"}
                </button>
              );
            })}
        </div>
      )}

      {addingSite && (
        <Card className="discovery-add-form" aria-busy={addingSiteBusy || undefined}>
          <h3 className="au-heading">添加自定义站点</h3>
          <Input
            value={newSite.name}
            onChange={(e) => setNewSite((s) => ({ ...s, name: e.target.value }))}
            placeholder="站点名称,如 IEEE Xplore"
            disabled={addingSiteBusy}
          />
          <Input
            value={newSite.homeUrl}
            onChange={(e) => setNewSite((s) => ({ ...s, homeUrl: e.target.value }))}
            placeholder="主页 URL,如 https://ieeexplore.ieee.org/"
            disabled={addingSiteBusy}
          />
          <Input
            value={newSite.searchUrl}
            onChange={(e) => setNewSite((s) => ({ ...s, searchUrl: e.target.value }))}
            placeholder="可选:检索 URL 前缀(关键词会拼接在后面)"
            disabled={addingSiteBusy}
          />
          <div className="web-import-actions">
            <Button
              onClick={() => void handleAddSite()}
              disabled={addingSiteBusy || !newSite.name.trim() || !newSite.homeUrl.trim()}
              aria-busy={addingSiteBusy || undefined}
            >
              {addingSiteBusy ? "添加中..." : "添加"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setAddingSite(false)}
              disabled={addingSiteBusy}
            >
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
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={webImporting}
          >
            {webImporting ? "解析中..." : "选择文件导入"}
          </Button>
        </div>
      </Card>
      {referenceImportPreview && (
        <ReferenceImportPreviewDialog
          count={referenceImportPreview.count}
          fileName={referenceImportPreview.fileName}
          importing={webImporting}
          previewOnly={referenceImportPreview.previewOnly}
          onClose={cancelReferenceImport}
          onConfirm={() => void confirmReferenceImport()}
        />
      )}
      {confirmDialog}
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

function ReferenceImportPreviewDialog({
  count,
  fileName,
  importing,
  previewOnly,
  onClose,
  onConfirm,
}: {
  count: number;
  fileName?: string;
  importing: boolean;
  previewOnly: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const requestClose = useCallback(() => {
    if (!importing) onClose();
  }, [importing, onClose]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: requestClose,
  });

  return (
    <div className="library-modal-overlay" role="presentation" onMouseDown={requestClose}>
      <section
        ref={dialogRef}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        aria-busy={importing || undefined}
        className="library-modal reference-import-preview"
        data-modal-root="true"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="library-modal__head">
          <div>
            <Badge variant="accent">待确认</Badge>
            <h2 id={titleId}>确认导入引用文件</h2>
          </div>
          <button
            type="button"
            className="library-modal__close"
            onClick={requestClose}
            aria-label="关闭确认导入引用文件"
            title="关闭确认导入引用文件"
            disabled={importing}
          >
            ×
          </button>
        </div>
        <p className="au-text-muted" id={descriptionId} style={{ fontSize: 13 }}>
          已解析出 <strong>{count}</strong> 条文献。
          {previewOnly
            ? "当前是浏览器预览，确认后只会模拟导入结果，不写入真实文献库。"
            : "确认后才会写入文献库，导入时会按 DOI 与标题自动去重。"}
        </p>
        {fileName && (
          <div className="reference-import-preview__file">
            <span>文件</span>
            <strong>{fileName}</strong>
          </div>
        )}
        {importing && (
          <p className="reference-import-preview__status" role="status" aria-live="polite">
            正在导入引用文件...
          </p>
        )}
        <div className="library-modal-actions reference-import-preview__actions">
          <Button
            data-autofocus="true"
            onClick={onConfirm}
            disabled={importing}
            aria-busy={importing || undefined}
          >
            {importing ? "导入中..." : previewOnly ? `模拟导入 ${count} 条` : `导入 ${count} 条`}
          </Button>
          <Button variant="secondary" onClick={requestClose} disabled={importing}>
            取消
          </Button>
        </div>
      </section>
    </div>
  );
}

// A single aggregated-search result row. Presentational: all behaviour comes in
// through callbacks so the parent keeps ownership of selection/import state.
function ResultCard({
  result,
  selected,
  importing,
  importBlocked,
  onSelect,
  onPrimaryAction,
  onFindFulltext,
}: {
  result: DiscoveryResultWithLibrary;
  selected: boolean;
  importing: boolean;
  importBlocked: boolean;
  onSelect: () => void;
  onPrimaryAction: () => void;
  onFindFulltext: () => void;
}) {
  const { work } = result;
  const confidence = resultConfidence(result);
  const fulltext = fulltextProfile(result);
  const sources = resultSources(result);
  const importActionBlocked = !result.inLibrary && importBlocked;
  return (
    <article
      className={`discovery-result ${selected ? "discovery-result--selected" : ""}`}
      onClick={onSelect}
    >
      <div className="discovery-result__head">
        <strong>{work.title}</strong>
        <div className="discovery-result__badges">
          <Badge variant="neutral">{sourceLabel(result.source)}</Badge>
          <Badge variant={confidence.variant}>{confidence.badge}</Badge>
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
      <div className="discovery-result__signals" aria-label="结果可信度与全文线索">
        <span>{confidence.detail}</span>
        <span>
          {sources.length >= 2
            ? `${sources.length} 源`
            : `${sourceLabel(sources[0] ?? result.source)} 单源`}
        </span>
        <span>{fulltext.label}</span>
      </div>
      <div className="discovery-result__actions">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (importActionBlocked) return;
            onPrimaryAction();
          }}
          disabled={importing}
          aria-disabled={importActionBlocked || undefined}
          aria-busy={importing || undefined}
          aria-label={
            importActionBlocked && !importing
              ? "加入文献库（另一篇文献正在入库，请稍候）"
              : undefined
          }
          title={importActionBlocked && !importing ? "另一篇文献正在入库，请稍候" : undefined}
        >
          {result.inLibrary ? "打开" : importing ? discoveryImportBusyLabel(result) : "加入文献库"}
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

function ResultDetail({
  result,
  importing,
  importBlocked,
  onPrimaryAction,
  onFindFulltext,
}: {
  result: DiscoveryResultWithLibrary;
  importing: boolean;
  importBlocked: boolean;
  onPrimaryAction: () => void;
  onFindFulltext: () => void;
}) {
  const { work } = result;
  const confidence = resultConfidence(result);
  const fulltext = fulltextProfile(result);
  const sources = resultSources(result).map(sourceLabel).join(" / ");
  const identifiers = identifierSignals(work);
  const importActionBlocked = !result.inLibrary && importBlocked;

  return (
    <>
      <h4>{work.title}</h4>
      <div
        className={`discovery-detail-signal discovery-detail-signal--${confidence.tier}`}
        aria-label="结果可信度"
      >
        <Badge variant={confidence.variant}>{confidence.badge}</Badge>
        <strong>{confidence.detail}</strong>
      </div>
      <dl className="discovery-detail-list">
        <div>
          <dt>数据源</dt>
          <dd title={sources}>{sources}</dd>
        </div>
        <div>
          <dt>标识符</dt>
          <dd title={identifiers.join(" · ") || undefined}>
            {identifiers.length ? identifiers.join(" · ") : "暂无稳定标识"}
          </dd>
        </div>
        <div>
          <dt>年份</dt>
          <dd>{work.year ?? "未知"}</dd>
        </div>
        <div>
          <dt>期刊/会议</dt>
          <dd title={work.venueName ?? undefined}>{work.venueName ?? "未标注"}</dd>
        </div>
        <div>
          <dt>被引次数</dt>
          <dd>{work.citedByCount ?? "未知"}</dd>
        </div>
        <div>
          <dt>全文状态</dt>
          <dd>{fulltext.label}</dd>
        </div>
      </dl>
      <div className="discovery-detail-fulltext" aria-label="全文线索">
        <Badge variant={fulltext.variant}>{fulltext.label}</Badge>
        <span>{fulltext.detail}</span>
      </div>
      <div className="discovery-detail-actions">
        <Button
          onClick={() => {
            if (!importActionBlocked) onPrimaryAction();
          }}
          disabled={importing}
          aria-disabled={importActionBlocked || undefined}
          aria-busy={importing || undefined}
          aria-label={
            importActionBlocked && !importing
              ? "加入文献库（另一篇文献正在入库，请稍候）"
              : undefined
          }
          title={importActionBlocked && !importing ? "另一篇文献正在入库，请稍候" : undefined}
        >
          {result.inLibrary
            ? "打开库中文献"
            : importing
              ? discoveryImportBusyLabel(result)
              : "加入文献库"}
        </Button>
        {result.inLibrary && result.needsFulltext && (
          <Button variant="secondary" onClick={onFindFulltext}>
            去找全文
          </Button>
        )}
      </div>
    </>
  );
}

function SearchProgress({
  sources,
  statuses,
  searching,
}: {
  sources: typeof SOURCES;
  statuses: Record<DiscoverySource, DiscoverySourceStatus>;
  searching: boolean;
}) {
  if (!searching && Object.values(statuses).every((status) => status === "idle")) return null;
  return (
    <div
      className="discovery-search-progress"
      role="status"
      aria-live="polite"
      aria-busy={searching || undefined}
    >
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
