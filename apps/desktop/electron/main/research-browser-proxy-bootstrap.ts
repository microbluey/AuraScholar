export interface ResearchBrowserProxySession {
  setProxy(config: { mode?: "direct"; proxyRules?: string }): Promise<void>;
}

async function configureResearchBrowserProxy(
  session: ResearchBrowserProxySession,
  proxy: string,
): Promise<void> {
  await session.setProxy(proxy ? { proxyRules: proxy } : { mode: "direct" });
}

/**
 * Configure a site's persistent Electron session before constructing or
 * selecting a view that can begin its first network navigation.
 */
export async function openResearchTabAfterProxy<T>(
  session: ResearchBrowserProxySession,
  proxy: string,
  open: () => T | Promise<T>,
): Promise<T> {
  await configureResearchBrowserProxy(session, proxy);
  return open();
}

/** Load a newly-created or restored view only after its session is ready. */
export async function loadResearchBrowserViewAfterProxy(
  session: ResearchBrowserProxySession,
  proxy: string,
  proxyAlreadyConfigured: boolean,
  isCurrent: () => boolean,
  loadURL: () => void,
): Promise<boolean> {
  if (!proxyAlreadyConfigured) await configureResearchBrowserProxy(session, proxy);
  if (!isCurrent()) return false;
  loadURL();
  return true;
}
