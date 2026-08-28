export interface ResearchBrowserProxySession {
  setProxy(config: { mode?: "direct"; proxyRules?: string }): Promise<void>;
}

type ResearchBrowserProxy = string | (() => string);

const pendingProxyTasks = new WeakMap<ResearchBrowserProxySession, Promise<void>>();

function proxyValue(proxy: ResearchBrowserProxy): string {
  return typeof proxy === "function" ? proxy() : proxy;
}

/** Serialize a Session's proxy mutation with the first request that needs it. */
function queueResearchBrowserProxy<T>(
  session: ResearchBrowserProxySession,
  task: () => T | Promise<T>,
): Promise<T> {
  const previous = pendingProxyTasks.get(session);
  let next: Promise<T>;
  if (previous) {
    next = previous.catch(() => undefined).then(task);
  } else {
    try {
      next = Promise.resolve(task());
    } catch (error) {
      next = Promise.reject(error);
    }
  }
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  pendingProxyTasks.set(session, settled);
  void settled.finally(() => {
    if (pendingProxyTasks.get(session) === settled) pendingProxyTasks.delete(session);
  });
  return next;
}

async function configureResearchBrowserProxy(
  session: ResearchBrowserProxySession,
  proxy: string,
): Promise<void> {
  await session.setProxy(proxy ? { proxyRules: proxy } : { mode: "direct" });
}

/**
 * Configure a session and run a network-starting action without allowing a
 * second tab for the same site to replace the proxy in between.
 */
export function runResearchBrowserAfterProxy<T>(
  session: ResearchBrowserProxySession,
  proxy: ResearchBrowserProxy,
  isCurrent: () => boolean,
  run: () => T | Promise<T>,
): Promise<T | undefined> {
  return queueResearchBrowserProxy(session, async () => {
    if (!isCurrent()) return undefined;
    await configureResearchBrowserProxy(session, proxyValue(proxy));
    return isCurrent() ? run() : undefined;
  });
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
  return queueResearchBrowserProxy(session, async () => {
    await configureResearchBrowserProxy(session, proxy);
    return open();
  });
}

/** Load a newly-created or restored view only after its session is ready. */
export async function loadResearchBrowserViewAfterProxy(
  session: ResearchBrowserProxySession,
  proxy: ResearchBrowserProxy,
  proxyAlreadyConfigured: boolean,
  isCurrent: () => boolean,
  loadURL: () => void,
): Promise<boolean> {
  if (proxyAlreadyConfigured) {
    // createView calls this synchronously inside openResearchTabAfterProxy's
    // queued callback. Re-enqueueing would let a later proxy change overtake
    // this tab's first request.
    if (!isCurrent()) return false;
    loadURL();
    return true;
  }
  return (
    (await runResearchBrowserAfterProxy(session, proxy, isCurrent, () => {
      loadURL();
      return true;
    })) ?? false
  );
}
