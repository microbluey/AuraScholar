import { lazy, StrictMode, Suspense, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";
import { ThemeProvider } from "@aurascholar/ui";
import { themeNames, type ThemeName } from "@aurascholar/tokens";
import "@aurascholar/tokens/tokens.css";
import "@aurascholar/ui/styles.css";
import "./app.css";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { readLocalStorageItem, tryWriteLocalStorageItem } from "./storage";

const LibraryPage = lazy(() =>
  import("./pages/LibraryPage").then((m) => ({ default: m.LibraryPage })),
);
const DiscoveryPage = lazy(() =>
  import("./pages/DiscoveryPage").then((m) => ({ default: m.DiscoveryPage })),
);
const ReaderPage = lazy(() =>
  import("./pages/ReaderPage").then((m) => ({ default: m.ReaderPage })),
);
const GraphPage = lazy(() =>
  import("./pages/GraphPage").then((m) => ({ default: m.GraphPage })),
);
const FlashcardsPage = lazy(() =>
  import("./pages/FlashcardsPage").then((m) => ({ default: m.FlashcardsPage })),
);
const SentinelPage = lazy(() =>
  import("./pages/SentinelPage").then((m) => ({ default: m.SentinelPage })),
);
const HomepagePage = lazy(() =>
  import("./pages/HomepagePage").then((m) => ({ default: m.HomepagePage })),
);
const SnippetsPage = lazy(() =>
  import("./pages/SnippetsPage").then((m) => ({ default: m.SnippetsPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

const DEFAULT_THEME: ThemeName = "dawn";
const themeNameSet = new Set<string>(themeNames);

function isThemeName(value: string | null): value is ThemeName {
  return Boolean(value && themeNameSet.has(value));
}

const savedThemeValue = readLocalStorageItem("theme");
const savedTheme = isThemeName(savedThemeValue) ? savedThemeValue : DEFAULT_THEME;

function routeElement(element: ReactNode, label: string) {
  return <Suspense fallback={<RouteLoading label={label} />}>{element}</Suspense>;
}

function RouteLoading({ label }: { label: string }) {
  return (
    <div className="route-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="route-loading__card">
        <span className="route-loading__dot" />
        <strong>正在打开{label}</strong>
        <div className="route-loading__lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/library" replace /> },
      { path: "library", element: routeElement(<LibraryPage />, "文献库") },
      { path: "discovery", element: routeElement(<DiscoveryPage />, "学术检索") },
      { path: "reader", element: routeElement(<ReaderPage />, "PDF 阅读器") },
      { path: "graph", element: routeElement(<GraphPage />, "引文脉络") },
      { path: "flashcards", element: routeElement(<FlashcardsPage />, "闪卡") },
      { path: "snippets", element: routeElement(<SnippetsPage />, "写作素材") },
      { path: "sentinel", element: routeElement(<SentinelPage />, "检索哨兵") },
      { path: "homepage", element: routeElement(<HomepagePage />, "学术主页") },
      { path: "settings", element: routeElement(<SettingsPage />, "设置") },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary level="root" scope="AuraScholar">
      <ThemeProvider
        defaultTheme={savedTheme}
        onThemeChange={(t) => {
          tryWriteLocalStorageItem("theme", t);
        }}
      >
        <RouterProvider router={router} />
      </ThemeProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
