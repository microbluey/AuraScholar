import { useEffect } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ThemeToggle } from "@aurascholar/ui";
import { startSentinelLoop } from "./services/sentinel";
import { LibraryPage } from "./pages/LibraryPage";
import { ReaderPage } from "./pages/ReaderPage";
import { GraphPage } from "./pages/GraphPage";
import { FlashcardsPage } from "./pages/FlashcardsPage";
import { SentinelPage } from "./pages/SentinelPage";
import { HomepagePage } from "./pages/HomepagePage";
import { SettingsPage } from "./pages/SettingsPage";

// 引文脉络与闪卡提取已并入阅读器;/graph 路由保留供文献库深链使用,不在导航显示。
const NAV = [
  { to: "/library", icon: "📚", label: "文献库" },
  { to: "/reader", icon: "📖", label: "阅读器" },
  { to: "/flashcards", icon: "🗂️", label: "闪卡" },
  { to: "/sentinel", icon: "📡", label: "检索哨兵" },
  { to: "/homepage", icon: "🪪", label: "学术主页" },
  { to: "/settings", icon: "⚙️", label: "设置" },
];

export function App() {
  // Catch-up poll on startup, then hourly while the app is open.
  useEffect(() => startSentinelLoop(), []);
  const location = useLocation();
  // The reader needs edge-to-edge layout; other pages keep comfortable padding.
  const flush = location.pathname.startsWith("/reader");
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar__brand">
          Aura<span className="accent">Scholar</span>
        </div>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} className="app-nav-item">
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
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
  );
}
