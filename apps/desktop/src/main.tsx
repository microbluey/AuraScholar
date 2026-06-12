import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { ThemeProvider } from "@aurascholar/ui";
import type { ThemeName } from "@aurascholar/tokens";
import "@aurascholar/tokens/tokens.css";
import "@aurascholar/ui/styles.css";
import "./app.css";
import { App } from "./App";

const savedTheme = (localStorage.getItem("theme") as ThemeName) ?? "dawn";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider
      defaultTheme={savedTheme}
      onThemeChange={(t) => localStorage.setItem("theme", t)}
    >
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
