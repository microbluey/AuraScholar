// Desktop Platform implementation, backed by the Electron preload bridge
// (window.aura). Export names are kept (tauriHttp/tauriFs/tauriNotifier) so the
// many call sites don't churn during the migration; they no longer touch Tauri.
// TODO(rename): rename this module to electron-platform.ts once the dust settles.
import type {
  FileSystem,
  HttpClient,
  HttpRequest,
  HttpResponse,
  NotificationOptions,
  Notifier,
} from "@aurascholar/platform";

export const tauriHttp: HttpClient = {
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

export const tauriFs: FileSystem = {
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

export const tauriNotifier: Notifier = {
  async notify(options: NotificationOptions): Promise<void> {
    await window.aura.notify(options.title, options.body);
  },
};

/** sha256 of file bytes — content addressing for the blob store. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function blobPath(sha256: string, ext = "pdf"): string {
  return `blobs/${sha256.slice(0, 2)}/${sha256}.${ext}`;
}
