export { themes, themeNames, highlightColors } from "./generated";
export type { ThemeName, TokenName, HighlightColor } from "./generated";

/** Reads a semantic token's current value from the DOM (theme-aware). */
export function getTokenValue(token: string, el?: HTMLElement): string {
  const target = el ?? document.documentElement;
  return getComputedStyle(target).getPropertyValue(`--${token}`).trim();
}

/** Applies a theme by setting the data-theme attribute on <html>. */
export function applyTheme(theme: string): void {
  document.documentElement.setAttribute("data-theme", theme);
}
