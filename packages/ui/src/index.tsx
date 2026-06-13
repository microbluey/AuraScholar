import { clsx } from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { applyTheme, type ThemeName } from "@aurascholar/tokens";

// ---------------------------------------------------------------------------
// Theme context
// ---------------------------------------------------------------------------

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  defaultTheme = "dawn",
  onThemeChange,
}: {
  children: ReactNode;
  defaultTheme?: ThemeName;
  onThemeChange?: (t: ThemeName) => void;
}) {
  const [theme, setThemeState] = useState<ThemeName>(defaultTheme);
  const setTheme = useCallback(
    (t: ThemeName) => {
      setThemeState(t);
      onThemeChange?.(t);
    },
    [onThemeChange],
  );
  const toggle = useCallback(
    () => setTheme(theme === "dawn" ? "nocturne" : "dawn"),
    [theme, setTheme],
  );
  useEffect(() => applyTheme(theme), [theme]);
  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return <button className={clsx("au-button", `au-button--${variant}`, className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("au-card", className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx("au-input", className)} {...props} />;
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "accent" | "neutral" | "success" | "warning" | "danger";
}

export function Badge({ variant = "accent", className, ...props }: BadgeProps) {
  return (
    <span
      className={clsx("au-badge", variant !== "accent" && `au-badge--${variant}`, className)}
      {...props}
    />
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" onClick={toggle} aria-label="切换主题" title="切换主题">
      {theme === "dawn" ? "夜间" : "日间"}
    </Button>
  );
}
