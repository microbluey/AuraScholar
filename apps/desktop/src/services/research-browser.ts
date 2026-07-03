// Renderer-side wrapper over the Electron main multi-tab research browser
// (electron/main/research-browser.ts). Tabs are WebContentsViews living in the
// main process; here we just issue commands and report the content-area bounds.
import type { Bounds, CaptureResult, ResearchTab } from "../../electron/shared";

export type { ResearchTab, Bounds, CaptureResult };

type ResearchSmokeWindow = Window & {
  __AURASCHOLAR_SMOKE_RESEARCH_HIDE_ERROR__?: string | null;
};

function ready(): boolean {
  return "aura" in window;
}

/** Open (or focus an existing tab for) a site; returns its tab id. */
export async function openResearchTab(
  siteId: string,
  url: string,
  proxy?: string,
): Promise<string | null> {
  if (!ready()) return null;
  return window.aura.research.open(siteId, url, proxy);
}

export async function activateResearchTab(tabId: string): Promise<void> {
  if (!ready()) return;
  await window.aura.research.activate(tabId);
}

/** Current URL of the active tab (for rewriting through EZproxy). */
export async function activeResearchUrl(): Promise<string> {
  if (!ready()) return "";
  return window.aura.research.activeUrl();
}

/** Load a URL into the active tab. */
export async function navigateResearchTab(url: string): Promise<void> {
  if (!ready()) return;
  await window.aura.research.navigate(url);
}

export async function researchGoBack(): Promise<void> {
  if (!ready()) return;
  await window.aura.research.goBack();
}

export async function researchGoForward(): Promise<void> {
  if (!ready()) return;
  await window.aura.research.goForward();
}

export async function researchReload(): Promise<void> {
  if (!ready()) return;
  await window.aura.research.reload();
}

export async function closeResearchTab(tabId: string): Promise<void> {
  if (!ready()) return;
  await window.aura.research.close(tabId);
}

/** Detach all views from the window (when leaving the browser view). */
export async function hideResearchViews(): Promise<void> {
  if (!ready()) return;
  const smokeError = (window as ResearchSmokeWindow).__AURASCHOLAR_SMOKE_RESEARCH_HIDE_ERROR__;
  if (smokeError) throw new Error(smokeError);
  await window.aura.research.hide();
}

export async function setResearchBounds(b: Bounds): Promise<void> {
  if (!ready()) return;
  await window.aura.research.setBounds(b);
}

export async function listResearchTabs(): Promise<ResearchTab[]> {
  if (!ready()) return [];
  return window.aura.research.list();
}

/**
 * Capture the active tab as a PDF for ingest — the fallback for inline /
 * embedded-viewer PDFs that never trigger a real download. A "download" result
 * arrives later via the download-finished subscription; a "print" result has
 * already emitted that event with the rendered page.
 */
export async function captureResearchTab(): Promise<CaptureResult> {
  if (!ready()) return { kind: "none", error: "desktop only" };
  return window.aura.research.capture();
}
