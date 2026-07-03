import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ThemeToggle } from "@aurascholar/ui";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { useModalFocusTrap } from "./components/useModalFocusTrap";
import { isImeComposing } from "./keyboard";
import { shortcutLabel } from "./shortcut-labels";
import { readLocalStorageJson } from "./storage";
import { isDesktopRuntime } from "./services/aura-platform";

// 阅读器不在导航中 — 它是文献库里点击一篇文献后进入的页面。
// /graph 路由保留供深链使用。
const NAV = [
  { to: "/library", icon: "library", label: "文献库" },
  { to: "/discovery", icon: "search", label: "学术检索" },
  { to: "/flashcards", icon: "cards", label: "闪卡" },
  { to: "/snippets", icon: "snippet", label: "写作素材" },
  { to: "/sentinel", icon: "radar", label: "检索哨兵" },
  { to: "/homepage", icon: "profile", label: "学术主页" },
  { to: "/settings", icon: "settings", label: "设置" },
] as const;

interface LibraryShellStats {
  total: number;
  trash: number;
  reading: number;
  unread: number;
  starred: number;
  annotations: number;
  flashcards: number;
  snippets: number;
  collections: Array<{ id: string; name: string; count: number }>;
  tags: Array<{ name: string; count: number }>;
}

interface LibraryViewDetail {
  filter?: "all" | "reading" | "unread" | "noted" | "starred" | "trash";
  collectionId?: string | null;
  tag?: string | null;
}

type LibraryViewState = Required<LibraryViewDetail>;

type LibraryActionEventName = "aurascholar:create-collection" | "aurascholar:manage-tags";

type PendingLibraryCommand =
  | { detail: LibraryViewDetail; kind: "view" }
  | { eventName: LibraryActionEventName; kind: "event" };

interface RuntimeIssue {
  detail?: string;
  id: number;
  message: string;
  title: string;
}

interface SmokeRouteCrashProbe {
  message?: string;
  pathPrefix?: string;
}

type SmokeProbeWindow = Window & {
  __AURASCHOLAR_SMOKE_ROUTE_CRASH__?: SmokeRouteCrashProbe | null;
};

interface AppCommand {
  description: string;
  group: string;
  icon: (typeof NAV)[number]["icon"];
  id: string;
  keywords: string[];
  run: () => void;
  title: string;
}

const NAV_DESCRIPTIONS: Record<(typeof NAV)[number]["to"], string> = {
  "/library": "导入、整理、阅读和引用你的论文库。",
  "/discovery": "检索开放学术来源并把结果沉淀到文献库。",
  "/flashcards": "进入间隔复习队列，把论文变成长期记忆。",
  "/snippets": "整理摘录、批注和可复制的写作素材。",
  "/sentinel": "订阅检索任务，持续追踪新论文。",
  "/homepage": "编辑个人学术主页并导出发布内容。",
  "/settings": "配置 AI、翻译、同步、备份和外观。",
};


function readAiModelLabel() {
  const parsed = readLocalStorageJson<{ model?: unknown } | null>("ai-settings", null);
  return typeof parsed?.model === "string" ? parsed.model.trim() || "AI 未配置" : "AI 未配置";
}

function normalizeLibraryView(detail: LibraryViewDetail = {}): LibraryViewState {
  return {
    filter: detail.filter ?? "all",
    collectionId: detail.collectionId ?? null,
    tag: detail.tag ?? null,
  };
}

function sameLibraryView(a: LibraryViewState, b: LibraryViewDetail): boolean {
  const normalized = normalizeLibraryView(b);
  return (
    a.filter === normalized.filter &&
    a.collectionId === normalized.collectionId &&
    a.tag === normalized.tag
  );
}

function dispatchLibraryView(detail: LibraryViewDetail) {
  window.dispatchEvent(new CustomEvent("aurascholar:library-view", { detail }));
}

function dispatchLibraryEvent(eventName: LibraryActionEventName) {
  window.dispatchEvent(new Event(eventName));
}

function commandElementId(id: string): string {
  return `command-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function scoreCommandAction(action: AppCommand, parts: string[]): number | null {
  const title = action.title.toLowerCase();
  const description = action.description.toLowerCase();
  const group = action.group.toLowerCase();
  const keywords = action.keywords.map((keyword) => keyword.toLowerCase());
  const haystack = [title, description, group, ...keywords].join(" ");

  if (!parts.every((part) => haystack.includes(part))) return null;

  return parts.reduce((score, part) => {
    let nextScore = score;
    if (title === part) nextScore += 60;
    else if (title.includes(part)) nextScore += 30;
    if (keywords.some((keyword) => keyword === part)) nextScore += 24;
    else if (keywords.some((keyword) => keyword.includes(part))) nextScore += 16;
    if (group.includes(part)) nextScore += 8;
    if (description.includes(part)) nextScore += 4;
    return nextScore;
  }, 0);
}

function activeRouteLabel(pathname: string): string {
  if (pathname.startsWith("/reader")) return "PDF 阅读器";
  const active = NAV.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
  return active?.label ?? "工作台";
}

function runtimeLabel(): string {
  return isDesktopRuntime() ? "桌面运行时" : "浏览器预览";
}

function describeUnknownError(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === "string") return value;
  if (value == null) return "未知错误";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function runtimeIssueFromErrorEvent(event: ErrorEvent): RuntimeIssue {
  const location = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined;
  return {
    detail: location,
    id: Date.now(),
    message: describeUnknownError(event.error ?? event.message),
    title: "应用捕获到运行时异常",
  };
}

function runtimeIssueFromRejection(event: PromiseRejectionEvent): RuntimeIssue {
  return {
    id: Date.now(),
    message: describeUnknownError(event.reason),
    title: "后台任务遇到异常",
  };
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const previousPathRef = useRef(location.pathname);
  // The reader needs edge-to-edge layout; other pages keep comfortable padding.
  const flush = location.pathname.startsWith("/reader");
  const showLibraryMeta = location.pathname.startsWith("/library");
  const currentLabel = activeRouteLabel(location.pathname);
  const currentRuntime = runtimeLabel();
  const commandShortcut = useMemo(() => shortcutLabel("K", { compactApple: true }), []);
  const [libraryStats, setLibraryStats] = useState<LibraryShellStats | null>(null);
  const [aiModel, setAiModel] = useState(() => readAiModelLabel());
  const [commandOpen, setCommandOpen] = useState(false);
  const [runtimeIssue, setRuntimeIssue] = useState<RuntimeIssue | null>(null);
  const [pendingLibraryCommand, setPendingLibraryCommand] = useState<PendingLibraryCommand | null>(
    null,
  );
  const [activeLibraryView, setActiveLibraryView] = useState<LibraryViewState>(() =>
    normalizeLibraryView(),
  );

  // Catch-up poll on startup, then hourly while the app is open. These services
  // pull network/connectors code, so load them after the shell is interactive.
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    void import("./services/sentinel")
      .then(({ startSentinelLoop }) => startSentinelLoop())
      .catch((error) =>
        setRuntimeIssue({
          id: Date.now(),
          message: describeUnknownError(error),
          title: "检索哨兵启动失败",
        }),
      );
    void import("./services/saved-searches")
      .then(({ startSavedSearchLoop }) => startSavedSearchLoop())
      .catch((error) =>
        setRuntimeIssue({
          id: Date.now(),
          message: describeUnknownError(error),
          title: "检索订阅启动失败",
        }),
      );
  }, []);

  useEffect(() => {
    const previousPath = previousPathRef.current;
    previousPathRef.current = location.pathname;
    if (
      isDesktopRuntime() &&
      previousPath.startsWith("/discovery") &&
      !location.pathname.startsWith("/discovery")
    ) {
      void import("./services/research-browser")
        .then(({ hideResearchViews }) => hideResearchViews())
        .catch((error) =>
          setRuntimeIssue({
            id: Date.now(),
            message: describeUnknownError(error),
            title: "内置浏览器视图隐藏失败",
          }),
        );
    }
  }, [location.pathname]);

  useEffect(() => {
    const onRuntimeError = (event: ErrorEvent) => {
      setRuntimeIssue(runtimeIssueFromErrorEvent(event));
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      setRuntimeIssue(runtimeIssueFromRejection(event));
    };
    window.addEventListener("error", onRuntimeError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onRuntimeError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  const refreshLibraryStats = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setLibraryStats(null);
      return;
    }
    try {
      const { getDb } = await import("./services/aura-db");
      const db = await getDb();
      const [
        totalRows,
        trashRows,
        readingRows,
        unreadRows,
        starredRows,
        annotationRows,
        flashcardRows,
        snippetRows,
        collections,
        tags,
      ] = await Promise.all([
        db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM works WHERE deleted_at IS NULL`),
        db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM works WHERE deleted_at IS NOT NULL`),
        db.query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM works WHERE deleted_at IS NULL AND reading_status = 'reading'`,
        ),
        db.query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM works WHERE deleted_at IS NULL AND reading_status = 'unread'`,
        ),
        db.query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM works WHERE deleted_at IS NULL AND starred = 1`,
        ),
        db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM annotations WHERE deleted_at IS NULL`),
        db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM flashcards WHERE deleted_at IS NULL`),
        db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM snippets WHERE deleted_at IS NULL`),
        db.query<{ id: string; name: string; count: number }>(
          `SELECT c.id, c.name, COUNT(w.id) AS count
           FROM collections c
           LEFT JOIN collection_items ci ON ci.collection_id = c.id
           LEFT JOIN works w ON w.id = ci.work_id AND w.deleted_at IS NULL
           WHERE c.deleted_at IS NULL
           GROUP BY c.id, c.name
           ORDER BY c.name`,
        ),
        db.query<{ name: string; count: number }>(
          `SELECT t.name, COUNT(w.id) AS count
           FROM tags t
           JOIN work_tags wt ON wt.tag_id = t.id
           JOIN works w ON w.id = wt.work_id AND w.deleted_at IS NULL
           WHERE t.deleted_at IS NULL
           GROUP BY t.id, t.name
           ORDER BY count DESC, t.name
           LIMIT 6`,
        ),
      ]);
      setLibraryStats({
        total: totalRows[0]?.n ?? 0,
        trash: trashRows[0]?.n ?? 0,
        reading: readingRows[0]?.n ?? 0,
        unread: unreadRows[0]?.n ?? 0,
        starred: starredRows[0]?.n ?? 0,
        annotations: annotationRows[0]?.n ?? 0,
        flashcards: flashcardRows[0]?.n ?? 0,
        snippets: snippetRows[0]?.n ?? 0,
        collections,
        tags,
      });
    } catch {
      setLibraryStats(null);
    }
  }, []);

  useEffect(() => {
    void refreshLibraryStats();
  }, [refreshLibraryStats]);

  const openLibraryView = useCallback(
    (detail: LibraryViewDetail) => {
      setActiveLibraryView(normalizeLibraryView(detail));
      if (location.pathname.startsWith("/library")) {
        setPendingLibraryCommand(null);
        dispatchLibraryView(detail);
      } else {
        setPendingLibraryCommand({ detail, kind: "view" });
        navigate("/library");
      }
    },
    [location.pathname, navigate],
  );

  const dispatchLibraryAction = useCallback(
    (eventName: LibraryActionEventName) => {
      if (location.pathname.startsWith("/library")) {
        setPendingLibraryCommand(null);
        dispatchLibraryEvent(eventName);
      } else {
        setPendingLibraryCommand({ eventName, kind: "event" });
        navigate("/library");
      }
    },
    [location.pathname, navigate],
  );

  useEffect(() => {
    if (!pendingLibraryCommand || !location.pathname.startsWith("/library")) return;
    const frame = window.requestAnimationFrame(() => {
      if (pendingLibraryCommand.kind === "view") {
        dispatchLibraryView(pendingLibraryCommand.detail);
      } else {
        dispatchLibraryEvent(pendingLibraryCommand.eventName);
      }
      setPendingLibraryCommand(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, pendingLibraryCommand]);

  const commandActions = useMemo<AppCommand[]>(
    () => [
      ...NAV.map((item) => ({
        description: NAV_DESCRIPTIONS[item.to],
        group: "工作区",
        icon: item.icon,
        id: `nav:${item.to}`,
        keywords: [item.label, item.to.replace("/", ""), "打开", "跳转"],
        run: () => navigate(item.to),
        title: item.label,
      })),
      {
        description: "回到系统分组，查看所有未删除文献。",
        group: "文献库视图",
        icon: "library",
        id: "library:all",
        keywords: ["全部", "文献", "library", "all"],
        run: () => openLibraryView({ filter: "all", collectionId: null, tag: null }),
        title: "全部文献",
      },
      {
        description: "只看正在阅读的论文，继续未完成的研究流。",
        group: "文献库视图",
        icon: "library",
        id: "library:reading",
        keywords: ["阅读中", "继续", "reading"],
        run: () => openLibraryView({ filter: "reading", collectionId: null, tag: null }),
        title: "阅读中文献",
      },
      {
        description: "查看尚未处理的新文献。",
        group: "文献库视图",
        icon: "library",
        id: "library:unread",
        keywords: ["未读", "新文献", "unread"],
        run: () => openLibraryView({ filter: "unread", collectionId: null, tag: null }),
        title: "未读文献",
      },
      {
        description: "快速回到标记为重点的论文。",
        group: "文献库视图",
        icon: "library",
        id: "library:starred",
        keywords: ["重点", "收藏", "starred"],
        run: () => openLibraryView({ filter: "starred", collectionId: null, tag: null }),
        title: "重点文献",
      },
      {
        description: "查看被移入回收站的文献并恢复。",
        group: "文献库视图",
        icon: "library",
        id: "library:trash",
        keywords: ["回收站", "删除", "trash"],
        run: () => openLibraryView({ filter: "trash", collectionId: null, tag: null }),
        title: "回收站",
      },
      {
        description: "创建新的文献分组，用于课题、项目或综述。",
        group: "整理动作",
        icon: "library",
        id: "library:create-collection",
        keywords: ["新建分组", "集合", "文件夹", "collection"],
        run: () => dispatchLibraryAction("aurascholar:create-collection"),
        title: "新建分组",
      },
      {
        description: "打开标签管理，合并、重命名或清理标签。",
        group: "整理动作",
        icon: "library",
        id: "library:manage-tags",
        keywords: ["标签", "tag", "管理标签"],
        run: () => dispatchLibraryAction("aurascholar:manage-tags"),
        title: "管理标签",
      },
      {
        description: "配置模型服务，让摘要、重点、翻译和闪卡开始工作。",
        group: "配置",
        icon: "settings",
        id: "settings:ai",
        keywords: ["ai", "模型", "api key", "配置"],
        run: () => navigate("/settings"),
        title: "配置 AI 服务",
      },
    ],
    [dispatchLibraryAction, navigate, openLibraryView],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onLibraryUpdated = () => void refreshLibraryStats();
    const onLibraryViewState = (event: Event) => {
      setActiveLibraryView(normalizeLibraryView((event as CustomEvent<LibraryViewDetail>).detail));
    };
    const onStorage = () => setAiModel(readAiModelLabel());
    const onAiSettingsUpdated = () => setAiModel(readAiModelLabel());
    window.addEventListener("aurascholar:library-updated", onLibraryUpdated);
    window.addEventListener("aurascholar:library-view-state", onLibraryViewState);
    window.addEventListener("aurascholar:snippets-updated", onLibraryUpdated);
    window.addEventListener("aurascholar:ai-settings-updated", onAiSettingsUpdated);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("aurascholar:library-updated", onLibraryUpdated);
      window.removeEventListener("aurascholar:library-view-state", onLibraryViewState);
      window.removeEventListener("aurascholar:snippets-updated", onLibraryUpdated);
      window.removeEventListener("aurascholar:ai-settings-updated", onAiSettingsUpdated);
      window.removeEventListener("storage", onStorage);
    };
  }, [refreshLibraryStats]);

  return (
    <div className={flush ? "app-frame app-frame--immersive" : "app-frame"}>
      <a className="app-skip-link" href="#app-main">
        跳到内容
      </a>
      {runtimeIssue && (
        <RuntimeIssueBanner issue={runtimeIssue} onDismiss={() => setRuntimeIssue(null)} />
      )}
      <div className="app-shell">
        <aside className="app-sidebar" aria-label="主导航">
          <div className="app-sidebar__brand">
            <span className="app-sidebar__mark">A</span>
            <span className="app-sidebar__wordmark">
              <span>
                Aura<span className="accent">Scholar</span>
              </span>
              <small>Research OS</small>
            </span>
          </div>
          <ShellWorkspaceCard
            activeLabel={currentLabel}
            runtime={currentRuntime}
            stats={libraryStats}
            aiModel={aiModel}
          />
          <button
            type="button"
            className="app-command-trigger"
            onClick={() => setCommandOpen(true)}
          >
            <span>快速打开</span>
            <kbd>{commandShortcut}</kbd>
          </button>
          <nav className="app-nav" aria-label="主导航">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className="app-nav-item"
                aria-label={item.label}
                title={item.label}
              >
                <NavIcon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
          {showLibraryMeta && libraryStats && (
            <LibrarySidebarMeta
              stats={libraryStats}
              activeView={activeLibraryView}
              onSelect={openLibraryView}
              onCreateCollection={() =>
                window.dispatchEvent(new Event("aurascholar:create-collection"))
              }
            />
          )}
          <div className="app-sidebar__footer">
            <ShellHealth stats={libraryStats} aiModel={aiModel} runtime={currentRuntime} />
            <ThemeToggle />
          </div>
        </aside>
        <main
          id="app-main"
          className={flush ? "app-main app-main--flush" : "app-main"}
          tabIndex={-1}
        >
          <AppErrorBoundary
            level="route"
            resetKey={`${location.pathname}${location.search}`}
            scope={currentLabel}
          >
            <SmokeRouteCrashProbe locationKey={`${location.pathname}${location.search}`} />
            <Outlet />
          </AppErrorBoundary>
        </main>
      </div>
      <StatusBar
        stats={libraryStats}
        aiModel={aiModel}
        runtime={currentRuntime}
        activeLabel={currentLabel}
      />
      <MobileDock onCommand={() => setCommandOpen(true)} />
      <AppCommandPalette
        actions={commandActions}
        onClose={() => setCommandOpen(false)}
        open={commandOpen}
      />
    </div>
  );
}

function SmokeRouteCrashProbe({ locationKey }: { locationKey: string }) {
  const probe = (window as SmokeProbeWindow).__AURASCHOLAR_SMOKE_ROUTE_CRASH__;
  if (!probe) return null;
  if (!locationKey.startsWith(probe.pathPrefix ?? "/")) return null;
  throw new Error(probe.message ?? "AURASCHOLAR_SMOKE_ROUTE_CRASH");
}

function RuntimeIssueBanner({ issue, onDismiss }: { issue: RuntimeIssue; onDismiss: () => void }) {
  return (
    <aside className="app-runtime-issue" role="status" aria-live="polite">
      <div>
        <strong>{issue.title}</strong>
        <span>{issue.message}</span>
        {issue.detail && <small>{issue.detail}</small>}
      </div>
      <button type="button" onClick={onDismiss}>
        关闭
      </button>
    </aside>
  );
}

function ShellWorkspaceCard({
  activeLabel,
  runtime,
  stats,
  aiModel,
}: {
  activeLabel: string;
  runtime: string;
  stats: LibraryShellStats | null;
  aiModel: string;
}) {
  const aiReady = aiModel !== "AI 未配置";
  return (
    <section className="app-workspace-card" aria-label="当前工作区">
      <span className="app-workspace-card__eyebrow">当前工作区</span>
      <strong>{activeLabel}</strong>
      <div className="app-workspace-card__chips">
        <span>{runtime}</span>
        <span>{aiReady ? "AI 就绪" : "AI 待配置"}</span>
      </div>
      <div className="app-workspace-card__meter" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.max(18, stats ? stats.total * 4 : 24))}%` }} />
      </div>
    </section>
  );
}

function ShellHealth({
  stats,
  aiModel,
  runtime,
}: {
  stats: LibraryShellStats | null;
  aiModel: string;
  runtime: string;
}) {
  const aiReady = aiModel !== "AI 未配置";
  return (
    <div className="app-shell-health" aria-label="状态摘要">
      <div>
        <span>文献</span>
        <strong>{stats ? stats.total.toLocaleString("zh-CN") : "--"}</strong>
      </div>
      <div>
        <span>素材</span>
        <strong>{stats ? stats.snippets.toLocaleString("zh-CN") : "--"}</strong>
      </div>
      <div>
        <span>{runtime}</span>
        <strong>{aiReady ? "AI 就绪" : "配置 AI"}</strong>
      </div>
    </div>
  );
}

function StatusBar({
  stats,
  aiModel,
  runtime,
  activeLabel,
}: {
  stats: LibraryShellStats | null;
  aiModel: string;
  runtime: string;
  activeLabel: string;
}) {
  return (
    <footer className="app-statusbar">
      <div className="app-statusbar__cluster">
        <span className="app-statusbar__dot" />
        <strong>本地优先</strong>
      </div>
      <div className="app-statusbar__cluster">
        <span className="app-statusbar__check" />
        <strong>{runtime}</strong>
      </div>
      {stats && (
        <div className="app-statusbar__metrics">
          <span>
            文献 <strong>{stats.total.toLocaleString("zh-CN")}</strong>
          </span>
          <span>
            笔记 <strong>{stats.annotations.toLocaleString("zh-CN")}</strong>
          </span>
          <span>
            闪卡 <strong>{stats.flashcards.toLocaleString("zh-CN")}</strong>
          </span>
          <span>
            素材 <strong>{stats.snippets.toLocaleString("zh-CN")}</strong>
          </span>
        </div>
      )}
      <div className="app-statusbar__cluster app-statusbar__cluster--end">
        <span>{activeLabel}</span>
        <strong title={aiModel}>{aiModel}</strong>
      </div>
    </footer>
  );
}

function MobileDock({ onCommand }: { onCommand: () => void }) {
  return (
    <nav className="app-mobile-dock" aria-label="移动主导航">
      <button
        type="button"
        className="app-mobile-dock__item app-mobile-dock__item--command"
        onClick={onCommand}
      >
        <NavIcon name="search" />
        <span>快捷</span>
      </button>
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className="app-mobile-dock__item"
          aria-label={item.label}
          title={item.label}
        >
          <NavIcon name={item.icon} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function AppCommandPalette({
  actions,
  onClose,
  open,
}: {
  actions: AppCommand[];
  onClose: () => void;
  open: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredActions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return actions;
    const parts = normalized.split(/\s+/).filter(Boolean);
    return actions
      .map((action, index) => ({ action, index, score: scoreCommandAction(action, parts) }))
      .filter((result): result is { action: AppCommand; index: number; score: number } => {
        return result.score !== null;
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((result) => result.action);
  }, [actions, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  useModalFocusTrap(dialogRef, {
    active: open,
    initialFocusSelector: "[data-autofocus]",
    onEscape: onClose,
  });

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filteredActions.length - 1)));
  }, [filteredActions.length]);

  if (!open) return null;

  const runAction = (action: AppCommand) => {
    action.run();
    onClose();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % Math.max(1, filteredActions.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        (index) =>
          (index - 1 + Math.max(1, filteredActions.length)) % Math.max(1, filteredActions.length),
      );
      return;
    }
    if (event.key === "Enter" && filteredActions[activeIndex]) {
      event.preventDefault();
      runAction(filteredActions[activeIndex]);
    }
  };

  return (
    <div className="app-command-overlay" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        aria-label="全局命令"
        aria-modal="true"
        className="app-command-palette"
        data-modal-root="true"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="app-command-palette__search">
          <NavIcon name="search" />
          <input
            ref={inputRef}
            aria-activedescendant={
              filteredActions[activeIndex]
                ? commandElementId(filteredActions[activeIndex].id)
                : undefined
            }
            aria-autocomplete="list"
            aria-controls="app-command-list"
            aria-expanded={open}
            aria-label="搜索命令"
            autoComplete="off"
            data-autofocus="true"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="搜索工作区、文献视图或动作..."
            role="combobox"
            value={query}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="app-command-palette__meta">
          <span>全局命令</span>
          <span>{filteredActions.length} 项</span>
        </div>
        <div className="app-command-list" id="app-command-list" role="listbox">
          {filteredActions.length > 0 ? (
            filteredActions.map((action, index) => (
              <button
                key={action.id}
                id={commandElementId(action.id)}
                className={`app-command-item ${index === activeIndex ? "app-command-item--active" : ""}`}
                onClick={() => runAction(action)}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
                type="button"
                aria-selected={index === activeIndex}
              >
                <span className="app-command-item__icon">
                  <NavIcon name={action.icon} />
                </span>
                <span className="app-command-item__body">
                  <strong>{action.title}</strong>
                  <small>{action.description}</small>
                </span>
                <span className="app-command-item__group">{action.group}</span>
              </button>
            ))
          ) : (
            <div className="app-command-empty" role="note">
              <strong>没有匹配命令</strong>
              <span>试试“文献”“AI”“回收站”或“设置”。</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function LibrarySidebarMeta({
  stats,
  activeView,
  onSelect,
  onCreateCollection,
}: {
  stats: LibraryShellStats;
  activeView: LibraryViewState;
  onSelect: (detail: LibraryViewDetail) => void;
  onCreateCollection: () => void;
}) {
  const groups: Array<{
    key: string;
    label: string;
    count: number;
    detail: LibraryViewDetail;
  }> = [
    {
      key: "all",
      label: "全部文献",
      count: stats.total,
      detail: { filter: "all", collectionId: null },
    },
    {
      key: "reading",
      label: "阅读中",
      count: stats.reading,
      detail: { filter: "reading", collectionId: null },
    },
    {
      key: "unread",
      label: "未读",
      count: stats.unread,
      detail: { filter: "unread", collectionId: null },
    },
    {
      key: "starred",
      label: "重点文献",
      count: stats.starred,
      detail: { filter: "starred", collectionId: null },
    },
    {
      key: "trash",
      label: "回收站",
      count: stats.trash,
      detail: { filter: "trash", collectionId: null },
    },
    ...stats.collections.map((c) => ({
      key: c.id,
      label: c.name,
      count: c.count,
      detail: { filter: "all" as const, collectionId: c.id },
    })),
  ];

  return (
    <div className="app-sidebar-meta">
      <div className="app-sidebar-section">
        <div className="app-sidebar-section__head">
          <span>我的分组</span>
          <button type="button" title="新建分组" onClick={onCreateCollection}>
            +
          </button>
        </div>
        {groups.map(({ key, label, count, detail }) => (
          <button
            key={key}
            className={`app-sidebar-subitem ${sameLibraryView(activeView, detail) ? "app-sidebar-subitem--active" : ""}`}
            type="button"
            onClick={() => onSelect(detail)}
          >
            <span>{label}</span>
            <small>{count.toLocaleString("zh-CN")}</small>
          </button>
        ))}
        <button
          className="app-sidebar-subitem app-sidebar-subitem--muted"
          type="button"
          onClick={onCreateCollection}
        >
          <span>新建分组</span>
        </button>
      </div>
      <div className="app-sidebar-section">
        <div className="app-sidebar-section__head">
          <span>标签</span>
        </div>
        {stats.tags.length > 0 ? (
          stats.tags.map((tag, index) => (
            <button
              key={tag.name}
              className={`app-sidebar-tag ${activeView.tag === tag.name ? "app-sidebar-tag--active" : ""}`}
              type="button"
              onClick={() => onSelect({ filter: "all", collectionId: null, tag: tag.name })}
            >
              <span className={`app-sidebar-tag__dot app-sidebar-tag__dot--${tagTone(index)}`} />
              <span>{tag.name}</span>
              <small>{tag.count.toLocaleString("zh-CN")}</small>
            </button>
          ))
        ) : (
          <span className="app-sidebar-empty">暂无标签</span>
        )}
        <button
          className="app-sidebar-subitem app-sidebar-subitem--muted"
          type="button"
          onClick={() => window.dispatchEvent(new Event("aurascholar:manage-tags"))}
        >
          <span>管理标签</span>
        </button>
      </div>
    </div>
  );
}

function tagTone(index: number) {
  return ["teal", "amber", "blue", "green", "purple"][index % 5] ?? "teal";
}

function NavIcon({ name }: { name: (typeof NAV)[number]["icon"] }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "app-nav-item__icon",
  };

  switch (name) {
    case "library":
      return (
        <svg {...common}>
          <path d="M5 4.5h4.5A2.5 2.5 0 0 1 12 7v12a2.5 2.5 0 0 0-2.5-2.5H5z" />
          <path d="M19 4.5h-4.5A2.5 2.5 0 0 0 12 7v12a2.5 2.5 0 0 1 2.5-2.5H19z" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
          <path d="M8.5 11h5" />
        </svg>
      );
    case "cards":
      return (
        <svg {...common}>
          <path d="M7 7.5h10" />
          <path d="M7 12h7" />
          <path d="M5.5 4h13A1.5 1.5 0 0 1 20 5.5v11A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-11A1.5 1.5 0 0 1 5.5 4z" />
          <path d="M7 21h10" />
        </svg>
      );
    case "snippet":
      return (
        <svg {...common}>
          <path d="M7 4h7l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
          <path d="M13 4v5h5" />
          <path d="M9 13h6" />
          <path d="M9 16.5h4" />
        </svg>
      );
    case "radar":
      return (
        <svg {...common}>
          <path d="M12 19a7 7 0 1 0-7-7" />
          <path d="M12 15a3 3 0 1 0-3-3" />
          <path d="M12 12 18 6" />
          <path d="M4 20h16" />
        </svg>
      );
    case "profile":
      return (
        <svg {...common}>
          <path d="M8 4h8a2 2 0 0 1 2 2v14H6V6a2 2 0 0 1 2-2z" />
          <path d="M9 9h6" />
          <path d="M9 13h6" />
          <path d="M9 17h4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
          <path d="M19 12a7 7 0 0 0-.1-1.1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.9-1.1L14.3 3h-4.6l-.3 2.9A7 7 0 0 0 7.5 7l-2.4-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .7.1 1.1l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.9 1.1l.3 2.9h4.6l.3-2.9a7 7 0 0 0 1.9-1.1l2.4 1 2-3.4-2-1.5c.1-.4.1-.7.1-1.1z" />
        </svg>
      );
  }
}
