import { useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ThemeToggle } from "@aurascholar/ui";
import { startSentinelLoop } from "./services/sentinel";
import { getDb } from "./services/tauri-db";
import { LibraryPage } from "./pages/LibraryPage";
import { ReaderPage } from "./pages/ReaderPage";
import { GraphPage } from "./pages/GraphPage";
import { FlashcardsPage } from "./pages/FlashcardsPage";
import { SentinelPage } from "./pages/SentinelPage";
import { HomepagePage } from "./pages/HomepagePage";
import { SettingsPage } from "./pages/SettingsPage";

// 阅读器不在导航中 — 它是文献库里点击一篇文献后进入的页面。
// /graph 路由保留供深链使用。
const NAV = [
  { to: "/library", icon: "library", label: "文献库" },
  { to: "/flashcards", icon: "cards", label: "闪卡" },
  { to: "/sentinel", icon: "radar", label: "检索哨兵" },
  { to: "/homepage", icon: "profile", label: "学术主页" },
  { to: "/settings", icon: "settings", label: "设置" },
] as const;

interface LibraryShellStats {
  total: number;
  reading: number;
  unread: number;
  starred: number;
  annotations: number;
  flashcards: number;
  collections: Array<{ id: string; name: string; count: number }>;
  tags: Array<{ name: string; count: number }>;
}

interface LibraryViewDetail {
  filter?: "all" | "reading" | "unread" | "starred";
  collectionId?: string | null;
  tag?: string | null;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function readAiModelLabel() {
  const raw = localStorage.getItem("ai-settings");
  if (!raw) return "AI 未配置";
  try {
    const parsed = JSON.parse(raw) as { model?: string };
    return parsed.model?.trim() || "AI 未配置";
  } catch {
    return "AI 未配置";
  }
}

export function App() {
  // Catch-up poll on startup, then hourly while the app is open.
  useEffect(() => {
    if ("__TAURI_INTERNALS__" in window) startSentinelLoop();
  }, []);
  const location = useLocation();
  const navigate = useNavigate();
  // The reader needs edge-to-edge layout; other pages keep comfortable padding.
  const flush = location.pathname.startsWith("/reader");
  const showLibraryMeta = location.pathname.startsWith("/library");
  const [libraryStats, setLibraryStats] = useState<LibraryShellStats | null>(null);
  const [aiModel, setAiModel] = useState(() => readAiModelLabel());

  const refreshLibraryStats = useCallback(async () => {
    if (!showLibraryMeta || !isTauriRuntime()) {
      setLibraryStats(null);
      return;
    }
    const db = await getDb();
    const [
      totalRows,
      readingRows,
      unreadRows,
      starredRows,
      annotationRows,
      flashcardRows,
      collections,
      tags,
    ] = await Promise.all([
      db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM works WHERE deleted_at IS NULL`),
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
      db.query<{ id: string; name: string; count: number }>(
        `SELECT c.id, c.name, COUNT(ci.work_id) AS count
         FROM collections c
         LEFT JOIN collection_items ci ON ci.collection_id = c.id
         WHERE c.deleted_at IS NULL
         GROUP BY c.id, c.name
         ORDER BY c.name`,
      ),
      db.query<{ name: string; count: number }>(
        `SELECT t.name, COUNT(wt.work_id) AS count
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
      reading: readingRows[0]?.n ?? 0,
      unread: unreadRows[0]?.n ?? 0,
      starred: starredRows[0]?.n ?? 0,
      annotations: annotationRows[0]?.n ?? 0,
      flashcards: flashcardRows[0]?.n ?? 0,
      collections,
      tags,
    });
  }, [showLibraryMeta]);

  useEffect(() => {
    void refreshLibraryStats();
  }, [refreshLibraryStats]);

  const openLibraryView = useCallback(
    (detail: LibraryViewDetail) => {
      navigate("/library");
      window.dispatchEvent(new CustomEvent("aurascholar:library-view", { detail }));
    },
    [navigate],
  );

  useEffect(() => {
    const onLibraryUpdated = () => void refreshLibraryStats();
    const onStorage = () => setAiModel(readAiModelLabel());
    window.addEventListener("aurascholar:library-updated", onLibraryUpdated);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("aurascholar:library-updated", onLibraryUpdated);
      window.removeEventListener("storage", onStorage);
    };
  }, [refreshLibraryStats]);

  return (
    <div className="app-frame">
      <div className="app-shell">
        <aside className="app-sidebar">
          <div className="app-sidebar__brand">
            <span className="app-sidebar__mark">A</span>
            <span>
              Aura<span className="accent">Scholar</span>
            </span>
          </div>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className="app-nav-item">
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
          {showLibraryMeta && libraryStats && (
            <LibrarySidebarMeta
              stats={libraryStats}
              onSelect={openLibraryView}
              onCreateCollection={() =>
                window.dispatchEvent(new Event("aurascholar:create-collection"))
              }
            />
          )}
          <div className="app-sidebar__footer">
            <ThemeToggle />
          </div>
        </aside>
        <main className={flush ? "app-main app-main--flush" : "app-main"}>
          <Routes>
            <Route path="/" element={<Navigate to="/library" replace />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/reader" element={<ReaderPage />} />
            <Route path="/graph" element={<GraphPage />} />
            <Route path="/flashcards" element={<FlashcardsPage />} />
            <Route path="/sentinel" element={<SentinelPage />} />
            <Route path="/homepage" element={<HomepagePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
      <StatusBar stats={showLibraryMeta ? libraryStats : null} aiModel={aiModel} />
    </div>
  );
}

function StatusBar({ stats, aiModel }: { stats: LibraryShellStats | null; aiModel: string }) {
  return (
    <footer className="app-statusbar">
      <div className="app-statusbar__cluster">
        <span className="app-statusbar__dot" />
        <strong>本地优先</strong>
      </div>
      <div className="app-statusbar__cluster">
        <span className="app-statusbar__check" />
        <strong>本地库</strong>
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
        </div>
      )}
      <div className="app-statusbar__cluster app-statusbar__cluster--end">
        <span>AI 模型</span>
        <strong>{aiModel}</strong>
      </div>
    </footer>
  );
}

function LibrarySidebarMeta({
  stats,
  onSelect,
  onCreateCollection,
}: {
  stats: LibraryShellStats;
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
            className={`app-sidebar-subitem ${label === "全部文献" ? "app-sidebar-subitem--active" : ""}`}
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
      {stats.tags.length > 0 && (
        <div className="app-sidebar-section">
          <div className="app-sidebar-section__head">
            <span>标签</span>
          </div>
          {stats.tags.map((tag, index) => (
            <button
              key={tag.name}
              className="app-sidebar-tag"
              type="button"
              onClick={() => onSelect({ filter: "all", collectionId: null, tag: tag.name })}
            >
              <span className={`app-sidebar-tag__dot app-sidebar-tag__dot--${tagTone(index)}`} />
              <span>{tag.name}</span>
              <small>{tag.count.toLocaleString("zh-CN")}</small>
            </button>
          ))}
          <button
            className="app-sidebar-subitem app-sidebar-subitem--muted"
            type="button"
            onClick={() => window.dispatchEvent(new Event("aurascholar:manage-tags"))}
          >
            <span>管理标签</span>
          </button>
        </div>
      )}
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
    case "cards":
      return (
        <svg {...common}>
          <path d="M7 7.5h10" />
          <path d="M7 12h7" />
          <path d="M5.5 4h13A1.5 1.5 0 0 1 20 5.5v11A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-11A1.5 1.5 0 0 1 5.5 4z" />
          <path d="M7 21h10" />
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
