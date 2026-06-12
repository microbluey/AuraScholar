import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { ThemeToggle } from "@aurascholar/ui";
import { LibraryPage } from "./pages/LibraryPage";
import { FlashcardsPage } from "./pages/FlashcardsPage";
import { SentinelPage } from "./pages/SentinelPage";
import { HomepagePage } from "./pages/HomepagePage";
import { SettingsPage } from "./pages/SettingsPage";

const NAV = [
  { to: "/library", icon: "📚", label: "文献库" },
  { to: "/flashcards", icon: "🗂️", label: "闪卡复习" },
  { to: "/sentinel", icon: "📡", label: "检索哨兵" },
  { to: "/homepage", icon: "🪪", label: "学术主页" },
  { to: "/settings", icon: "⚙️", label: "设置" },
];

export function App() {
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
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/flashcards" element={<FlashcardsPage />} />
          <Route path="/sentinel" element={<SentinelPage />} />
          <Route path="/homepage" element={<HomepagePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
