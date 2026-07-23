import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Graph } from "@phosphor-icons/react";
import { ThemeToggle } from "@aurascholar/ui";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { useModalFocusTrap } from "./components/useModalFocusTrap";
import { CANVAS_COMMAND_PALETTE_REQUEST_EVENT } from "./features/canvas/canvas-command";
import { isImeComposing } from "./keyboard";
import { isPlatformShortcut, shortcutLabel } from "./shortcut-labels";
import { readLocalStorageJson } from "./storage";
import { isDesktopRuntime } from "./services/aura-platform";
import { describeSafeError } from "./services/sensitive-text";

// 阅读器不在导航中 — 它是文献库里点击一篇文献后进入的页面。
// /graph 路由保留供深链使用。
const NAV = [
  { to: "/library", icon: "library", label: "文献库" },
  { to: "/discovery", icon: "search", label: "学术检索" },
  { to: "/canvas", icon: "canvas", label: "空间白板" },
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
  canvasNodes: number;
  snippets: number;
  collections: Array<{
    id: string;
    name: string;
    count: number;
    parentId: string | null;
    sortOrder: number;
  }>;
  tags: Array<{ name: string; color: string | null; count: number }>;
}

const PREVIEW_LIBRARY_STATS: LibraryShellStats = {
  total: 4,
  trash: 0,
  reading: 2,
  unread: 1,
  starred: 1,
  annotations: 13,
  canvasNodes: 18,
  snippets: 5,
  collections: [
    { id: "preview-projects", name: "研究项目", count: 1, parentId: null, sortOrder: 0 },
    {
      id: "preview-transformer",
      name: "Transformer 综述",
      count: 2,
      parentId: "preview-projects",
      sortOrder: 0,
    },
    { id: "preview-life-science", name: "生命科学", count: 1, parentId: null, sortOrder: 1 },
  ],
  tags: [
    { name: "Transformer", color: "#7566f0", count: 1 },
    { name: "深度学习", color: "#ff8a5b", count: 1 },
    { name: "LLM", color: "#42b8d5", count: 1 },
    { name: "待阅读", color: "#d89b38", count: 1 },
  ],
};

interface LibraryViewDetail {
  filter?: "all" | "reading" | "unread" | "noted" | "starred" | "trash";
  collectionId?: string | null;
  tag?: string | null;
}

interface LibraryCollectionMoveDetail {
  id: string;
  parentId: string | null;
  position: number;
}

type LibraryViewState = Required<LibraryViewDetail>;

type LibraryActionEventName =
  | "aurascholar:create-collection"
  | "aurascholar:create-tag"
  | "aurascholar:manage-collections"
  | "aurascholar:manage-tags";

type PendingLibraryCommand =
  | { detail: LibraryViewDetail; kind: "view" }
  | { eventName: LibraryActionEventName; kind: "event" };

interface RuntimeIssue {
  detail?: string;
  id: number;
  message: string;
  title: string;
}

interface AiShellStatus {
  checking: boolean;
  error?: string;
  model: string;
  preview?: boolean;
  ready: boolean;
}

interface SmokeRouteCrashProbe {
  message?: string;
  pathPrefix?: string;
}

type SmokeProbeWindow = Window & {
  __AURASCHOLAR_SMOKE_ROUTE_CRASH__?: SmokeRouteCrashProbe | null;
};

interface AppStatsSmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_DELAY_MS__?: number;
  __AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_COUNT__?: number;
}

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
  "/canvas": "在无限画布中关联文献、摘录、想法与 AI 合成。",
  "/snippets": "整理摘录、批注和可复制的写作素材。",
  "/sentinel": "订阅检索任务，持续追踪新论文。",
  "/homepage": "编辑个人学术主页并导出发布内容。",
  "/settings": "配置 AI、翻译、同步、备份和外观。",
};

const AI_UNCONFIGURED_LABEL = "AI 未配置";
const AI_CHECKING_LABEL = "AI 检查中";
const AI_PREVIEW_MODEL_LABEL = "deepseek-chat";

type AppCommandShortcutAction = "close-global" | "open-canvas" | "open-global";

interface AppCommandShortcutEvent {
  altKey?: boolean;
  ctrlKey?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  key?: string;
  keyCode?: number;
  metaKey?: boolean;
  nativeEvent?: { isComposing?: boolean };
  repeat?: boolean;
  shiftKey?: boolean;
}

export function resolveAppCommandShortcut({
  blockingModal = false,
  commandOpen,
  event,
  pathname,
  platform,
}: {
  blockingModal?: boolean;
  commandOpen: boolean;
  event: AppCommandShortcutEvent;
  pathname: string;
  platform?: string;
}): AppCommandShortcutAction | null {
  if (event.defaultPrevented || event.repeat || isImeComposing(event)) return null;
  if (!isPlatformShortcut(event, "k", platform)) return null;
  if (commandOpen) return "close-global";
  if (blockingModal) return null;
  if (pathname === "/canvas" || pathname.startsWith("/canvas/")) return "open-canvas";
  return "open-global";
}

function readStoredAiModelLabel(): string {
  const parsed = readLocalStorageJson<{ model?: unknown } | null>("ai-settings", null);
  return typeof parsed?.model === "string" ? parsed.model.trim() : "";
}

function initialAiShellStatus(): AiShellStatus {
  if (!isDesktopRuntime()) {
    return {
      checking: false,
      model: readStoredAiModelLabel() || AI_PREVIEW_MODEL_LABEL,
      preview: true,
      ready: true,
    };
  }
  const storedModel = readStoredAiModelLabel();
  return {
    checking: true,
    model: storedModel || AI_UNCONFIGURED_LABEL,
    ready: false,
  };
}

async function readAiShellStatus(): Promise<AiShellStatus> {
  if (!isDesktopRuntime()) {
    return {
      checking: false,
      model: readStoredAiModelLabel() || AI_PREVIEW_MODEL_LABEL,
      preview: true,
      ready: true,
    };
  }
  try {
    const { loadAiSettings } = await import("./services/ai");
    const settings = await loadAiSettings();
    if (settings) {
      return {
        checking: false,
        model: settings.model.trim() || AI_UNCONFIGURED_LABEL,
        ready: true,
      };
    }
    return {
      checking: false,
      model: readStoredAiModelLabel() || AI_UNCONFIGURED_LABEL,
      ready: false,
    };
  } catch (error) {
    return {
      checking: false,
      error: describeUnknownError(error),
      model: readStoredAiModelLabel() || AI_UNCONFIGURED_LABEL,
      ready: false,
    };
  }
}

async function waitForAppStatsSmokeAfterReadDelay(): Promise<void> {
  const smokeWindow = window as AppStatsSmokeWindow;
  const delayMs = smokeWindow.__AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_DELAY_MS__;
  if (typeof delayMs !== "number" || delayMs <= 0) return;
  smokeWindow.__AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_COUNT__ =
    (smokeWindow.__AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_COUNT__ ?? 0) + 1;
  await new Promise((resolve) => window.setTimeout(resolve, delayMs));
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

function sidebarViewLabel(label: string, count: number, active: boolean): string {
  return `${label}，${count.toLocaleString("zh-CN")} 篇文献${active ? "，当前视图" : ""}`;
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
  return describeSafeError(value);
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

function isBenignResizeObserverDiagnostic(event: ErrorEvent): boolean {
  if (event.error != null) return false;
  return (
    event.message === "ResizeObserver loop completed with undelivered notifications." ||
    event.message === "ResizeObserver loop limit exceeded"
  );
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
  // The reader and spatial canvas need edge-to-edge layout; other pages keep comfortable padding.
  const flush = location.pathname.startsWith("/reader") || location.pathname.startsWith("/canvas");
  const showLibraryMeta = location.pathname.startsWith("/library");
  const currentLabel = activeRouteLabel(location.pathname);
  const currentRuntime = runtimeLabel();
  const commandShortcut = useMemo(() => shortcutLabel("K", { compactApple: true }), []);
  const [libraryStats, setLibraryStats] = useState<LibraryShellStats | null>(null);
  const [aiStatus, setAiStatus] = useState<AiShellStatus>(() => initialAiShellStatus());
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandSession, setCommandSession] = useState(0);
  const [runtimeIssue, setRuntimeIssue] = useState<RuntimeIssue | null>(null);
  const [pendingLibraryCommand, setPendingLibraryCommand] = useState<PendingLibraryCommand | null>(
    null,
  );
  const [activeLibraryView, setActiveLibraryView] = useState<LibraryViewState>(() =>
    normalizeLibraryView(),
  );
  const commandReturnFocusRef = useRef<HTMLElement | null>(null);
  const libraryStatsRefreshSeqRef = useRef(0);
  const aiStatusRefreshSeqRef = useRef(0);
  const openSettingsSection = useCallback(
    (section: "ai" | "sync" | "translate") => navigate(`/settings?section=${section}`),
    [navigate],
  );
  const openAiSettings = useCallback(() => openSettingsSection("ai"), [openSettingsSection]);

  const rememberCommandReturnFocus = useCallback((target?: HTMLElement | null) => {
    const candidate = target ?? document.activeElement;
    commandReturnFocusRef.current =
      candidate instanceof HTMLElement && candidate !== document.body ? candidate : null;
  }, []);

  const restoreCommandReturnFocus = useCallback(() => {
    window.setTimeout(() => {
      const target = commandReturnFocusRef.current;
      commandReturnFocusRef.current = null;
      if (target?.isConnected) {
        target.focus({ preventScroll: true });
      }
    }, 0);
  }, []);

  const openCommandPalette = useCallback(
    (target?: HTMLElement | null) => {
      rememberCommandReturnFocus(target);
      setCommandSession((session) => session + 1);
      setCommandOpen(true);
    },
    [rememberCommandReturnFocus],
  );

  const closeCommandPalette = useCallback(() => {
    setCommandOpen(false);
    restoreCommandReturnFocus();
  }, [restoreCommandReturnFocus]);

  const toggleCommandPalette = useCallback(() => {
    if (commandOpen) {
      setCommandOpen(false);
      restoreCommandReturnFocus();
      return;
    }
    rememberCommandReturnFocus();
    setCommandSession((session) => session + 1);
    setCommandOpen(true);
  }, [commandOpen, rememberCommandReturnFocus, restoreCommandReturnFocus]);

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
      // Chromium reports these layout diagnostics as global errors even when the
      // observer successfully delivers the next frame. They are not app crashes.
      if (isBenignResizeObserverDiagnostic(event)) {
        event.preventDefault();
        return;
      }
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
    const seq = libraryStatsRefreshSeqRef.current + 1;
    libraryStatsRefreshSeqRef.current = seq;
    if (!isDesktopRuntime()) {
      if (libraryStatsRefreshSeqRef.current !== seq) return;
      setLibraryStats(PREVIEW_LIBRARY_STATS);
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
        canvasNodeRows,
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
        db.query<{ n: number }>(
          `SELECT COUNT(*) AS n
           FROM annotations a
           JOIN works w ON w.id = a.work_id AND w.deleted_at IS NULL
           WHERE a.deleted_at IS NULL`,
        ),
        db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM canvas_nodes`),
        db.query<{ n: number }>(
          `SELECT COUNT(*) AS n
           FROM snippets s
           JOIN works w ON w.id = s.work_id AND w.deleted_at IS NULL
           WHERE s.deleted_at IS NULL`,
        ),
        db.query<{
          id: string;
          name: string;
          parent_id: string | null;
          sort_order: number;
          count: number;
        }>(
          `SELECT c.id, c.name, c.parent_id, c.sort_order, COUNT(w.id) AS count
           FROM collections c
           LEFT JOIN collection_items ci ON ci.collection_id = c.id
           LEFT JOIN works w ON w.id = ci.work_id AND w.deleted_at IS NULL
           WHERE c.deleted_at IS NULL
           GROUP BY c.id, c.name, c.parent_id, c.sort_order
           ORDER BY c.sort_order, c.name, c.id`,
        ),
        db.query<{ name: string; color: string | null; count: number }>(
          `SELECT t.name, t.color, COUNT(DISTINCT w.id) AS count
           FROM tags t
           LEFT JOIN work_tags wt ON wt.tag_id = t.id
           LEFT JOIN works w ON w.id = wt.work_id AND w.deleted_at IS NULL
           WHERE t.deleted_at IS NULL
           GROUP BY t.id, t.name, t.color
           ORDER BY count DESC, t.name`,
        ),
      ]);
      await waitForAppStatsSmokeAfterReadDelay();
      if (libraryStatsRefreshSeqRef.current !== seq) return;
      setLibraryStats({
        total: totalRows[0]?.n ?? 0,
        trash: trashRows[0]?.n ?? 0,
        reading: readingRows[0]?.n ?? 0,
        unread: unreadRows[0]?.n ?? 0,
        starred: starredRows[0]?.n ?? 0,
        annotations: annotationRows[0]?.n ?? 0,
        canvasNodes: canvasNodeRows[0]?.n ?? 0,
        snippets: snippetRows[0]?.n ?? 0,
        collections: collections.map((collection) => ({
          id: collection.id,
          name: collection.name,
          count: collection.count,
          parentId: collection.parent_id,
          sortOrder: collection.sort_order,
        })),
        tags,
      });
    } catch {
      if (libraryStatsRefreshSeqRef.current !== seq) return;
      setLibraryStats(null);
    }
  }, []);

  useEffect(() => {
    const refreshId = window.setTimeout(() => {
      void refreshLibraryStats();
    }, 0);
    return () => {
      window.clearTimeout(refreshId);
      libraryStatsRefreshSeqRef.current += 1;
    };
  }, [refreshLibraryStats]);

  const refreshAiStatus = useCallback(async () => {
    const seq = aiStatusRefreshSeqRef.current + 1;
    aiStatusRefreshSeqRef.current = seq;
    setAiStatus((current) => ({
      ...current,
      checking: true,
      error: undefined,
    }));
    const next = await readAiShellStatus();
    if (aiStatusRefreshSeqRef.current !== seq) return;
    setAiStatus(next);
  }, []);

  useEffect(() => {
    const refreshId = window.setTimeout(() => {
      void refreshAiStatus();
    }, 0);
    return () => {
      window.clearTimeout(refreshId);
      aiStatusRefreshSeqRef.current += 1;
    };
  }, [refreshAiStatus]);

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
        description: "回到全部文献，查看所有未删除内容。",
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
        description: "创建新的文献文件夹，用于课题、项目或综述。",
        group: "整理动作",
        icon: "library",
        id: "library:create-collection",
        keywords: ["新建文件夹", "分组", "集合", "collection"],
        run: () => dispatchLibraryAction("aurascholar:create-collection"),
        title: "新建目录",
      },
      {
        description: "查看目录层级，重命名、移动或删除目录。",
        group: "整理动作",
        icon: "library",
        id: "library:manage-collections",
        keywords: ["目录", "文件夹", "分组", "管理目录", "collection"],
        run: () => dispatchLibraryAction("aurascholar:manage-collections"),
        title: "管理目录",
      },
      {
        description: "创建一个可跨目录使用的新标签。",
        group: "整理动作",
        icon: "library",
        id: "library:create-tag",
        keywords: ["新建标签", "标签", "tag", "标记"],
        run: () => dispatchLibraryAction("aurascholar:create-tag"),
        title: "新建标签",
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
        description: "配置模型服务，让摘要、观点合成、翻译和研究辅助开始工作。",
        group: "配置",
        icon: "settings",
        id: "settings:ai",
        keywords: ["ai", "模型", "api key", "配置"],
        run: () => openAiSettings(),
        title: "配置 AI 服务",
      },
      {
        description: "选择翻译引擎、目标语言，或清除本地翻译缓存。",
        group: "配置",
        icon: "settings",
        id: "settings:translate",
        keywords: ["翻译", "translate", "deepl", "百度", "缓存", "配置"],
        run: () => openSettingsSection("translate"),
        title: "配置阅读翻译",
      },
      {
        description: "配置 WebDAV、导出整库备份或导入 JSON 备份。",
        group: "配置",
        icon: "settings",
        id: "settings:sync",
        keywords: ["同步", "备份", "webdav", "backup", "导出", "导入", "配置"],
        run: () => openSettingsSection("sync"),
        title: "配置同步与备份",
      },
    ],
    [dispatchLibraryAction, navigate, openAiSettings, openLibraryView, openSettingsSection],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modalRoots = Array.from(
        document.querySelectorAll<HTMLElement>("[data-modal-root='true']"),
      );
      const topModal = modalRoots.at(-1);
      const action = resolveAppCommandShortcut({
        blockingModal: Boolean(topModal && topModal.dataset.canvasCommandPalette !== "true"),
        commandOpen,
        event,
        pathname: location.pathname,
      });
      if (!action) return;

      event.preventDefault();
      if (action === "open-canvas") {
        window.dispatchEvent(
          new CustomEvent(CANVAS_COMMAND_PALETTE_REQUEST_EVENT, {
            detail: { source: "keyboard" },
          }),
        );
        return;
      }
      toggleCommandPalette();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandOpen, location.pathname, toggleCommandPalette]);

  useEffect(() => {
    const onLibraryUpdated = () => void refreshLibraryStats();
    const onLibraryViewState = (event: Event) => {
      setActiveLibraryView(normalizeLibraryView((event as CustomEvent<LibraryViewDetail>).detail));
    };
    const onStorage = () => void refreshAiStatus();
    const onAiSettingsUpdated = () => void refreshAiStatus();
    window.addEventListener("aurascholar:library-updated", onLibraryUpdated);
    window.addEventListener("aurascholar:canvas-updated", onLibraryUpdated);
    window.addEventListener("aurascholar:library-view-state", onLibraryViewState);
    window.addEventListener("aurascholar:snippets-updated", onLibraryUpdated);
    window.addEventListener("aurascholar:ai-settings-updated", onAiSettingsUpdated);
    window.addEventListener("storage", onStorage);
    return () => {
      libraryStatsRefreshSeqRef.current += 1;
      aiStatusRefreshSeqRef.current += 1;
      window.removeEventListener("aurascholar:library-updated", onLibraryUpdated);
      window.removeEventListener("aurascholar:canvas-updated", onLibraryUpdated);
      window.removeEventListener("aurascholar:library-view-state", onLibraryViewState);
      window.removeEventListener("aurascholar:snippets-updated", onLibraryUpdated);
      window.removeEventListener("aurascholar:ai-settings-updated", onAiSettingsUpdated);
      window.removeEventListener("storage", onStorage);
    };
  }, [refreshAiStatus, refreshLibraryStats]);

  return (
    <div className={flush ? "app-frame app-frame--immersive" : "app-frame"}>
      <a className="app-skip-link" href="#app-main">
        跳到内容
      </a>
      {runtimeIssue && (
        <RuntimeIssueBanner issue={runtimeIssue} onDismiss={() => setRuntimeIssue(null)} />
      )}
      <div className="app-shell">
        <aside
          className={`app-sidebar ${showLibraryMeta ? "app-sidebar--library" : ""}`}
          aria-label="主导航"
        >
          <div className="app-sidebar__brand">
            <span className="app-sidebar__mark">A</span>
            <span className="app-sidebar__wordmark">
              <span>
                Aura<span className="accent">Scholar</span>
              </span>
              <small>Research, your way</small>
            </span>
          </div>
          {!showLibraryMeta && (
            <ShellWorkspaceCard
              activeLabel={currentLabel}
              runtime={currentRuntime}
              stats={libraryStats}
              aiStatus={aiStatus}
              onConfigureAi={openAiSettings}
            />
          )}
          <button
            type="button"
            className="app-command-trigger"
            onClick={(event) => openCommandPalette(event.currentTarget)}
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
              onCreateCollection={(parentId) =>
                window.dispatchEvent(
                  new CustomEvent("aurascholar:create-collection", {
                    detail: { parentId: parentId ?? null },
                  }),
                )
              }
              onRenameCollection={(collection) =>
                window.dispatchEvent(
                  new CustomEvent("aurascholar:rename-collection", {
                    detail: { id: collection.id, name: collection.name },
                  }),
                )
              }
              onDeleteCollection={(collection) =>
                window.dispatchEvent(
                  new CustomEvent("aurascholar:delete-collection", {
                    detail: { id: collection.id, name: collection.name },
                  }),
                )
              }
              onMoveCollection={(detail) => {
                setLibraryStats((current) =>
                  current
                    ? {
                        ...current,
                        collections: moveLibraryShellCollection(current.collections, detail),
                      }
                    : current,
                );
                window.dispatchEvent(new CustomEvent("aurascholar:move-collection", { detail }));
              }}
            />
          )}
          <div className="app-sidebar__footer">
            {!showLibraryMeta && (
              <ShellHealth
                stats={libraryStats}
                aiStatus={aiStatus}
                runtime={currentRuntime}
                onConfigureAi={openAiSettings}
              />
            )}
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
        aiStatus={aiStatus}
        runtime={currentRuntime}
        activeLabel={currentLabel}
        onConfigureAi={openAiSettings}
      />
      <MobileDock onCommand={openCommandPalette} />
      <AppCommandPalette
        key={commandSession}
        actions={commandActions}
        onClose={closeCommandPalette}
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
  aiStatus,
  onConfigureAi,
}: {
  activeLabel: string;
  runtime: string;
  stats: LibraryShellStats | null;
  aiStatus: AiShellStatus;
  onConfigureAi: () => void;
}) {
  return (
    <section className="app-workspace-card" aria-label="当前工作区">
      <span className="app-workspace-card__eyebrow">当前工作区</span>
      <strong>{activeLabel}</strong>
      <div className="app-workspace-card__chips">
        <span>{runtime}</span>
        {aiStatus.preview ? (
          <span title={aiStatus.model}>AI 预览</span>
        ) : aiStatus.ready ? (
          <span>AI 就绪</span>
        ) : aiStatus.checking ? (
          <span>{AI_CHECKING_LABEL}</span>
        ) : (
          <button type="button" onClick={onConfigureAi} title={aiStatus.error}>
            AI 待配置
          </button>
        )}
      </div>
      <div className="app-workspace-card__meter" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.max(18, stats ? stats.total * 4 : 24))}%` }} />
      </div>
    </section>
  );
}

function ShellHealth({
  stats,
  aiStatus,
  runtime,
  onConfigureAi,
}: {
  stats: LibraryShellStats | null;
  aiStatus: AiShellStatus;
  runtime: string;
  onConfigureAi: () => void;
}) {
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
        {aiStatus.preview ? (
          <strong title={aiStatus.model}>AI 预览</strong>
        ) : aiStatus.ready ? (
          <strong>AI 就绪</strong>
        ) : aiStatus.checking ? (
          <strong>{AI_CHECKING_LABEL}</strong>
        ) : (
          <button
            type="button"
            className="app-shell-health__action"
            onClick={onConfigureAi}
            title={aiStatus.error}
          >
            配置 AI
          </button>
        )}
      </div>
    </div>
  );
}

function StatusBar({
  stats,
  aiStatus,
  runtime,
  activeLabel,
  onConfigureAi,
}: {
  stats: LibraryShellStats | null;
  aiStatus: AiShellStatus;
  runtime: string;
  activeLabel: string;
  onConfigureAi: () => void;
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
            白板节点 <strong>{stats.canvasNodes.toLocaleString("zh-CN")}</strong>
          </span>
          <span>
            素材 <strong>{stats.snippets.toLocaleString("zh-CN")}</strong>
          </span>
        </div>
      )}
      <div className="app-statusbar__cluster app-statusbar__cluster--end">
        <span>{activeLabel}</span>
        {aiStatus.preview ? (
          <strong title={aiStatus.model}>AI 预览</strong>
        ) : aiStatus.ready ? (
          <strong title={aiStatus.model}>{aiStatus.model}</strong>
        ) : aiStatus.checking ? (
          <strong>{AI_CHECKING_LABEL}</strong>
        ) : (
          <button
            type="button"
            className="app-statusbar__ai-action"
            onClick={onConfigureAi}
            title={aiStatus.error}
          >
            配置 AI
          </button>
        )}
      </div>
    </footer>
  );
}

function MobileDock({ onCommand }: { onCommand: (target?: HTMLElement | null) => void }) {
  return (
    <nav className="app-mobile-dock" aria-label="移动主导航">
      <button
        type="button"
        className="app-mobile-dock__item app-mobile-dock__item--command"
        onClick={(event) => onCommand(event.currentTarget)}
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
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);
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
  const boundedActiveIndex =
    filteredActions.length === 0 ? 0 : Math.min(activeIndex, filteredActions.length - 1);

  useModalFocusTrap(dialogRef, {
    active: open,
    initialFocusSelector: "[data-autofocus]",
    onEscape: onClose,
  });

  useEffect(() => {
    if (!open) return;
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [boundedActiveIndex, filteredActions, open]);

  if (!open) return null;

  const runAction = (action: AppCommand) => {
    action.run();
    onClose();
  };

  const clearCommandSearch = () => {
    setQuery("");
    setActiveIndex(0);
    inputRef.current?.focus();
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
    if (event.key === "Enter" && filteredActions[boundedActiveIndex]) {
      event.preventDefault();
      runAction(filteredActions[boundedActiveIndex]);
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
              filteredActions[boundedActiveIndex]
                ? commandElementId(filteredActions[boundedActiveIndex].id)
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
                className={`app-command-item ${
                  index === boundedActiveIndex ? "app-command-item--active" : ""
                }`}
                onClick={() => runAction(action)}
                onMouseEnter={() => setActiveIndex(index)}
                ref={index === boundedActiveIndex ? activeOptionRef : undefined}
                role="option"
                type="button"
                aria-selected={index === boundedActiveIndex}
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
              <button
                type="button"
                className="app-command-empty__clear"
                aria-label="清空命令搜索"
                onClick={clearCommandSearch}
              >
                清空搜索
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

type LibraryShellCollection = LibraryShellStats["collections"][number];

interface LibraryCollectionTreeNode extends LibraryShellCollection {
  children: LibraryCollectionTreeNode[];
}

function buildLibraryCollectionTree(
  collections: LibraryShellCollection[],
): LibraryCollectionTreeNode[] {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const nodes = new Map<string, LibraryCollectionTreeNode>(
    collections.map((collection) => [
      collection.id,
      { ...collection, children: [] } as LibraryCollectionTreeNode,
    ]),
  );
  const roots: LibraryCollectionTreeNode[] = [];

  const hasValidParent = (collection: LibraryShellCollection) => {
    if (!collection.parentId || collection.parentId === collection.id) return false;
    let cursor: string | null = collection.parentId;
    const seen = new Set([collection.id]);
    while (cursor) {
      if (seen.has(cursor)) return false;
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return byId.has(collection.parentId);
  };

  for (const collection of collections) {
    const node = nodes.get(collection.id)!;
    if (hasValidParent(collection)) {
      nodes.get(collection.parentId!)!.children.push(node);
    } else {
      node.parentId = null;
      roots.push(node);
    }
  }

  const sortTree = (items: LibraryCollectionTreeNode[]) => {
    items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));
    items.forEach((item) => sortTree(item.children));
  };
  sortTree(roots);
  return roots;
}

function moveLibraryShellCollection(
  collections: LibraryShellCollection[],
  detail: LibraryCollectionMoveDetail,
): LibraryShellCollection[] {
  const moving = collections.find((collection) => collection.id === detail.id);
  if (!moving) return collections;
  const targetSiblings = collections
    .filter((collection) => collection.id !== detail.id && collection.parentId === detail.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));
  const position = Math.max(0, Math.min(Math.trunc(detail.position), targetSiblings.length));
  targetSiblings.splice(position, 0, { ...moving, parentId: detail.parentId });
  const targetOrder = new Map(targetSiblings.map((collection, index) => [collection.id, index]));
  const previousSiblings = collections
    .filter((collection) => collection.id !== detail.id && collection.parentId === moving.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));
  const previousOrder = new Map(
    previousSiblings.map((collection, index) => [collection.id, index]),
  );
  return collections.map((collection) => {
    if (targetOrder.has(collection.id)) {
      return {
        ...collection,
        parentId: detail.parentId,
        sortOrder: targetOrder.get(collection.id)!,
      };
    }
    if (moving.parentId !== detail.parentId && previousOrder.has(collection.id)) {
      return { ...collection, sortOrder: previousOrder.get(collection.id)! };
    }
    return collection;
  });
}

type CollectionDropPosition = "before" | "inside" | "after";

interface CollectionDropTarget {
  id: string;
  position: CollectionDropPosition;
}

interface CollectionContextMenuState {
  collectionId: string | null;
  x: number;
  y: number;
}

function collectionContains(
  collections: LibraryShellCollection[],
  ancestorId: string,
  collectionId: string,
): boolean {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const seen = new Set<string>();
  let cursor = byId.get(collectionId)?.parentId ?? null;
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestorId) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

function CollectionTreeBranch({
  nodes,
  depth,
  activeView,
  collapsedIds,
  draggingId,
  dropTarget,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onRequestContextMenu,
  onCreateCollection,
  onSelect,
  onToggle,
}: {
  nodes: LibraryCollectionTreeNode[];
  depth: number;
  activeView: LibraryViewState;
  collapsedIds: Set<string>;
  draggingId: string | null;
  dropTarget: CollectionDropTarget | null;
  onDragEnd: () => void;
  onDragOver: (event: ReactDragEvent<HTMLDivElement>, node: LibraryCollectionTreeNode) => void;
  onDragStart: (event: ReactDragEvent<HTMLDivElement>, id: string) => void;
  onDrop: (event: ReactDragEvent<HTMLDivElement>, node: LibraryCollectionTreeNode) => void;
  onRequestContextMenu: (node: LibraryCollectionTreeNode, x: number, y: number) => void;
  onCreateCollection: (parentId?: string) => void;
  onSelect: (detail: LibraryViewDetail) => void;
  onToggle: (id: string) => void;
}) {
  return nodes.map((node) => {
    const detail: LibraryViewDetail = { filter: "all", collectionId: node.id, tag: null };
    const isActive = sameLibraryView(activeView, detail);
    const hasChildren = node.children.length > 0;
    const expanded = hasChildren && !collapsedIds.has(node.id);
    return (
      <div
        className="app-sidebar-treeitem"
        key={node.id}
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
      >
        <div
          className={`app-sidebar-collection ${
            isActive ? "app-sidebar-collection--active" : ""
          } ${draggingId === node.id ? "app-sidebar-collection--dragging" : ""} ${
            dropTarget?.id === node.id ? `app-sidebar-collection--drop-${dropTarget.position}` : ""
          }`}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable
          aria-grabbed={draggingId === node.id}
          title="拖动可调整顺序；拖到文件夹中可改变层级"
          onDragStart={(event) => onDragStart(event, node.id)}
          onDragOver={(event) => onDragOver(event, node)}
          onDragEnd={onDragEnd}
          onDrop={(event) => onDrop(event, node)}
          onContextMenu={(event) => {
            event.preventDefault();
            onRequestContextMenu(node, event.clientX, event.clientY);
          }}
        >
          {hasChildren ? (
            <button
              type="button"
              className={`app-sidebar-collection__toggle ${
                expanded ? "app-sidebar-collection__toggle--expanded" : ""
              }`}
              aria-label={`${expanded ? "收起" : "展开"}文件夹 ${node.name}`}
              onClick={() => onToggle(node.id)}
            >
              ›
            </button>
          ) : (
            <span className="app-sidebar-collection__spacer" aria-hidden="true" />
          )}
          <button
            type="button"
            className="app-sidebar-collection__main"
            aria-current={isActive ? "page" : undefined}
            aria-label={sidebarViewLabel(node.name, node.count, isActive)}
            aria-pressed={isActive}
            onClick={() => onSelect(detail)}
            onKeyDown={(event) => {
              if (!(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
                return;
              }
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              onRequestContextMenu(node, rect.left + 20, rect.bottom + 4);
            }}
            title={`${node.name}；右键或双指点按可管理文件夹`}
          >
            <span className="app-sidebar-collection__folder" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <path d="M2.8 5.2h5l1.5 1.7h7.9v7.9H2.8z" />
              </svg>
            </span>
            <span className="app-sidebar-collection__name">{node.name}</span>
          </button>
          <small>{node.count.toLocaleString("zh-CN")}</small>
          <button
            type="button"
            className="app-sidebar-collection__add"
            aria-label={`在 ${node.name} 中新建子文件夹`}
            title="新建子文件夹"
            onClick={() => onCreateCollection(node.id)}
          >
            +
          </button>
        </div>
        {expanded && (
          <div role="group">
            <CollectionTreeBranch
              nodes={node.children}
              depth={depth + 1}
              activeView={activeView}
              collapsedIds={collapsedIds}
              draggingId={draggingId}
              dropTarget={dropTarget}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              onDragStart={onDragStart}
              onDrop={onDrop}
              onRequestContextMenu={onRequestContextMenu}
              onCreateCollection={onCreateCollection}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          </div>
        )}
      </div>
    );
  });
}

function LibrarySidebarMeta({
  stats,
  activeView,
  onSelect,
  onCreateCollection,
  onDeleteCollection,
  onMoveCollection,
  onRenameCollection,
}: {
  stats: LibraryShellStats;
  activeView: LibraryViewState;
  onSelect: (detail: LibraryViewDetail) => void;
  onCreateCollection: (parentId?: string) => void;
  onDeleteCollection: (collection: LibraryShellCollection) => void;
  onMoveCollection: (detail: LibraryCollectionMoveDetail) => void;
  onRenameCollection: (collection: LibraryShellCollection) => void;
}) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<CollectionDropTarget | null>(null);
  const [contextMenu, setContextMenu] = useState<CollectionContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const collectionTree = useMemo(
    () => buildLibraryCollectionTree(stats.collections),
    [stats.collections],
  );
  const toggleCollection = (id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearDragState = () => {
    setDraggingId(null);
    setDropTarget(null);
  };
  const canDropOn = (nodeId: string) =>
    Boolean(
      draggingId &&
      draggingId !== nodeId &&
      !collectionContains(stats.collections, draggingId, nodeId),
    );
  const handleDragStart = (event: ReactDragEvent<HTMLDivElement>, id: string) => {
    setDraggingId(id);
    setDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };
  const handleDragOver = (
    event: ReactDragEvent<HTMLDivElement>,
    node: LibraryCollectionTreeNode,
  ) => {
    if (!canDropOn(node.id)) {
      event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = (event.clientY - rect.top) / Math.max(rect.height, 1);
    const position: CollectionDropPosition =
      offset < 0.25 ? "before" : offset > 0.75 ? "after" : "inside";
    setDropTarget({ id: node.id, position });
  };
  const commitMove = (node: LibraryCollectionTreeNode, position: CollectionDropPosition) => {
    if (!draggingId || !canDropOn(node.id)) return;
    if (position === "inside") {
      const childCount = stats.collections.filter(
        (collection) => collection.id !== draggingId && collection.parentId === node.id,
      ).length;
      setCollapsedIds((current) => {
        const next = new Set(current);
        next.delete(node.id);
        return next;
      });
      onMoveCollection({ id: draggingId, parentId: node.id, position: childCount });
      return;
    }
    const siblings = stats.collections
      .filter((collection) => collection.id !== draggingId && collection.parentId === node.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));
    const targetIndex = siblings.findIndex((collection) => collection.id === node.id);
    onMoveCollection({
      id: draggingId,
      parentId: node.parentId,
      position: Math.max(0, targetIndex + (position === "after" ? 1 : 0)),
    });
  };
  const handleDrop = (event: ReactDragEvent<HTMLDivElement>, node: LibraryCollectionTreeNode) => {
    event.preventDefault();
    event.stopPropagation();
    if (dropTarget?.id === node.id) commitMove(node, dropTarget.position);
    clearDragState();
  };
  const handleRootDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggingId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ id: "__root__", position: "inside" });
  };
  const handleRootDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (draggingId) {
      const rootCount = stats.collections.filter(
        (collection) => collection.id !== draggingId && collection.parentId === null,
      ).length;
      onMoveCollection({ id: draggingId, parentId: null, position: rootCount });
    }
    clearDragState();
  };

  const allWorksActive = sameLibraryView(activeView, {
    filter: "all",
    collectionId: null,
    tag: null,
  });
  const openContextMenu = useCallback((collectionId: string | null, x: number, y: number) => {
    const menuWidth = 184;
    const menuHeight = collectionId ? 238 : 52;
    setContextMenu({
      collectionId,
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: Event) => {
      if (event.target instanceof Node && contextMenuRef.current?.contains(event.target)) return;
      setContextMenu(null);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    const focusId = window.requestAnimationFrame(() => {
      contextMenuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    });
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusId);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  const contextCollection = contextMenu?.collectionId
    ? (stats.collections.find((collection) => collection.id === contextMenu.collectionId) ?? null)
    : null;
  const runContextAction = (action: () => void) => {
    setContextMenu(null);
    action();
  };

  return (
    <div className="app-sidebar-meta">
      <section className="app-sidebar-section app-sidebar-section--collections">
        <div
          className={`app-sidebar-library-root-row ${
            allWorksActive ? "app-sidebar-library-root-row--active" : ""
          } ${dropTarget?.id === "__root__" ? "app-sidebar-library-root-row--drop-inside" : ""}`}
          onDragOver={handleRootDragOver}
          onDrop={handleRootDrop}
          onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => {
            event.preventDefault();
            openContextMenu(null, event.clientX, event.clientY);
          }}
        >
          <button
            type="button"
            className="app-sidebar-library-root app-sidebar-library-root--all"
            aria-current={allWorksActive ? "page" : undefined}
            onClick={() => onSelect({ filter: "all", collectionId: null, tag: null })}
            onKeyDown={(event) => {
              if (!(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
                return;
              }
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              openContextMenu(null, rect.left + 20, rect.bottom + 4);
            }}
            title="全部文献；右键或双指点按可新建文件夹"
          >
            <span className="app-sidebar-library-root__icon" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <path d="M3 5.4h5l1.5 1.7H17v8.1H3z" />
              </svg>
            </span>
            <span>全部文献</span>
            <small>{stats.total.toLocaleString("zh-CN")}</small>
          </button>
          <div className="app-sidebar-section__actions">
            <button
              type="button"
              aria-label="新建目录"
              title="新建目录"
              onClick={() => onCreateCollection()}
            >
              ＋
            </button>
          </div>
        </div>
        {collectionTree.length > 0 ? (
          <div className="app-sidebar-collection-tree" role="tree" aria-label="文件夹树">
            <CollectionTreeBranch
              nodes={collectionTree}
              depth={0}
              activeView={activeView}
              collapsedIds={collapsedIds}
              draggingId={draggingId}
              dropTarget={dropTarget}
              onDragEnd={clearDragState}
              onDragOver={handleDragOver}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
              onRequestContextMenu={(node, x, y) => openContextMenu(node.id, x, y)}
              onCreateCollection={onCreateCollection}
              onSelect={onSelect}
              onToggle={toggleCollection}
            />
          </div>
        ) : (
          <button
            className="app-sidebar-empty-action"
            type="button"
            onClick={() => onCreateCollection()}
          >
            新建第一个文件夹
          </button>
        )}
      </section>
      <button
        type="button"
        className={`app-sidebar-library-root app-sidebar-library-root--trash ${
          sameLibraryView(activeView, { filter: "trash", collectionId: null, tag: null })
            ? "app-sidebar-library-root--active"
            : ""
        }`}
        aria-current={
          sameLibraryView(activeView, { filter: "trash", collectionId: null, tag: null })
            ? "page"
            : undefined
        }
        onClick={() => onSelect({ filter: "trash", collectionId: null, tag: null })}
      >
        <span className="app-sidebar-library-root__icon" aria-hidden="true">
          <svg viewBox="0 0 20 20">
            <path d="M4.8 6.2h10.4l-.7 9.1H5.5z" />
            <path d="M3.6 4.2h12.8M7.4 4.2V2.8h5.2v1.4M8 8.2v4.9M12 8.2v4.9" />
          </svg>
        </span>
        <span>回收站</span>
        <small>{stats.trash.toLocaleString("zh-CN")}</small>
      </button>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="app-sidebar-context-menu"
          role="menu"
          aria-label={contextCollection ? `${contextCollection.name} 文件夹操作` : "全部文献操作"}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitem']"),
            );
            const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
            const direction = event.key === "ArrowDown" ? 1 : -1;
            items[(currentIndex + direction + items.length) % items.length]?.focus();
          }}
        >
          {contextCollection ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  runContextAction(() =>
                    onSelect({
                      filter: "all",
                      collectionId: contextCollection.id,
                      tag: null,
                    }),
                  )
                }
              >
                打开
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => runContextAction(() => onCreateCollection(contextCollection.id))}
              >
                新建子文件夹
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => runContextAction(() => onRenameCollection(contextCollection))}
              >
                重命名
              </button>
              {contextCollection.parentId && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const parent = stats.collections.find(
                      (collection) => collection.id === contextCollection.parentId,
                    );
                    const parentId = parent?.parentId ?? null;
                    const position = stats.collections.filter(
                      (collection) =>
                        collection.id !== contextCollection.id && collection.parentId === parentId,
                    ).length;
                    runContextAction(() =>
                      onMoveCollection({ id: contextCollection.id, parentId, position }),
                    );
                  }}
                >
                  移到上一级
                </button>
              )}
              <span className="app-sidebar-context-menu__separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="app-sidebar-context-menu__danger"
                onClick={() => runContextAction(() => onDeleteCollection(contextCollection))}
              >
                删除文件夹…
              </button>
            </>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => runContextAction(() => onCreateCollection())}
            >
              新建文件夹
            </button>
          )}
        </div>
      )}
    </div>
  );
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
    case "canvas":
      return <Graph size={18} weight="regular" aria-hidden className="app-nav-item__icon" />;
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
