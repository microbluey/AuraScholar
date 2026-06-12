// Desktop Platform implementation: Tauri HTTP (no CORS), app-data FS,
// OS notifications. Secrets/scheduler land with later phases.
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  exists,
  mkdir,
  readDir,
  readFile,
  remove,
  writeFile,
  BaseDirectory,
} from "@tauri-apps/plugin-fs";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
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
    const res = await tauriFetch(req.url, {
      method: req.method ?? "GET",
      headers: req.headers,
      body: req.body as BodyInit | undefined,
      signal: req.timeoutMs ? AbortSignal.timeout(req.timeoutMs) : undefined,
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    return {
      status: res.status,
      headers,
      body: new Uint8Array(await res.arrayBuffer()),
    };
  },
};

const BASE = { baseDir: BaseDirectory.AppData } as const;

export const tauriFs: FileSystem = {
  async readFile(path) {
    return readFile(path, BASE);
  },
  async writeFile(path, data) {
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir && !(await exists(dir, BASE))) await mkdir(dir, { ...BASE, recursive: true });
    await writeFile(path, data, BASE);
  },
  async deleteFile(path) {
    await remove(path, BASE);
  },
  async exists(path) {
    return exists(path, BASE);
  },
  async listDir(path) {
    const entries = await readDir(path, BASE);
    return entries.map((e) => e.name);
  },
  async mkdirp(path) {
    if (!(await exists(path, BASE))) await mkdir(path, { ...BASE, recursive: true });
  },
};

export const tauriNotifier: Notifier = {
  async notify(options: NotificationOptions): Promise<void> {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title: options.title, body: options.body });
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
