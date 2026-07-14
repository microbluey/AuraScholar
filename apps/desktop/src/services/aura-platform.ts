// Desktop Platform implementation, backed by the Electron preload bridge
// (window.aura): CORS-free HTTP, app-data FS, notifications, and helpers.
import type {
  FileSystem,
  HttpClient,
  HttpRequest,
  HttpResponse,
  NotificationOptions,
  Notifier,
} from "@aurascholar/platform";


/** True when running inside the Electron shell (the preload bridge exists). */
export function isDesktopRuntime(): boolean {
  return "aura" in window;
}

export const auraHttp: HttpClient = {
  async request(req: HttpRequest): Promise<HttpResponse> {
    if (req.signal?.aborted) throw abortError();
    const requestId = req.signal ? crypto.randomUUID() : undefined;
    const onAbort = () => {
      if (requestId) void window.aura.cancelHttp(requestId);
    };
    req.signal?.addEventListener("abort", onAbort, { once: true });
    const res = await window.aura
      .http({
        requestId,
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: req.body,
        timeoutMs: req.timeoutMs,
      })
      .finally(() => req.signal?.removeEventListener("abort", onAbort));
    if ("aborted" in res) throw abortError();
    if (req.signal?.aborted) throw abortError();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = v;
    return { status: res.status, headers, body: res.body };
  },
};

function abortError(): Error {
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

export const auraFs: FileSystem = {
  readFile(path) {
    return window.aura.fs.readFile(path);
  },
  writeFile(path, data) {
    return window.aura.fs.writeFile(path, data);
  },
  deleteFile(path) {
    return window.aura.fs.deleteFile(path);
  },
  exists(path) {
    return window.aura.fs.exists(path);
  },
  listDir(path) {
    return window.aura.fs.listDir(path);
  },
  mkdirp(path) {
    return window.aura.fs.mkdirp(path);
  },
};

export const auraNotifier: Notifier = {
  async notify(options: NotificationOptions): Promise<void> {
    await window.aura.notify(options.title, options.body);
  },
};

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function normalizeExternalUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("无效的外部链接");
  }
  if (!EXTERNAL_PROTOCOLS.has(url.protocol)) {
    throw new Error(`不允许打开 ${url.protocol || "未知"} 链接`);
  }
  if (url.username || url.password) {
    throw new Error("外部链接不能包含用户名或密码");
  }
  return url.toString();
}

export async function openExternalUrl(url: string): Promise<void> {
  const safeUrl = normalizeExternalUrl(url);
  const aura = (window as Window & { aura?: Window["aura"] }).aura;
  if (aura) {
    await aura.openExternal(safeUrl);
    return;
  }
  const opened = window.open(safeUrl, "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("浏览器阻止了外部链接弹窗");
}

/** sha256 of file bytes — content addressing for the blob store. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function blobPath(sha256: string, ext = "pdf"): string {
  return `blobs/${sha256.slice(0, 2)}/${sha256}.${ext}`;
}
