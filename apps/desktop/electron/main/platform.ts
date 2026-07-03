// Main-process implementations of the platform surface the renderer needs:
// CORS-free HTTP, app-data-relative FS, OS notifications, encrypted secrets,
// and a stable device id. Exposed to the renderer via IPC (see preload).
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join, sep } from "node:path";
import { app, clipboard, ipcMain, Notification, safeStorage, shell } from "electron";
import { CH, type HttpRequestDTO, type HttpResponseDTO } from "../shared";

const appData = () => app.getPath("userData");
const httpControllers = new Map<string, AbortController>();
const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export async function openExternalUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("无效的外部链接");
  }
  if (!EXTERNAL_PROTOCOLS.has(url.protocol)) {
    throw new Error(`不允许打开 ${url.protocol || "未知"} 链接`);
  }
  await shell.openExternal(url.toString());
}

/** Resolve an app-data-relative path, guarding against traversal escapes. */
function resolveRel(rel: string): string {
  const base = appData();
  const abs = join(base, rel);
  if (abs !== base && !abs.startsWith(base + sep)) {
    throw new Error(`path escapes app data: ${rel}`);
  }
  return abs;
}

async function httpRequest(req: HttpRequestDTO): Promise<HttpResponseDTO> {
  const controller = new AbortController();
  if (req.requestId) httpControllers.set(req.requestId, controller);
  const timer = req.timeoutMs ? setTimeout(() => controller.abort(), req.timeoutMs) : null;
  try {
    const res = await fetch(req.url, {
      method: req.method ?? "GET",
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return { status: res.status, headers, body: buf };
  } finally {
    if (timer) clearTimeout(timer);
    if (req.requestId) httpControllers.delete(req.requestId);
  }
}

const SECRETS_FILE = () => join(appData(), "secrets.json");

async function readSecrets(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(SECRETS_FILE(), "utf8");
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeSecrets(map: Record<string, string>): Promise<void> {
  await fs.mkdir(dirname(SECRETS_FILE()), { recursive: true });
  await fs.writeFile(SECRETS_FILE(), JSON.stringify(map), "utf8");
}

function encode(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return "v1:" + safeStorage.encryptString(value).toString("base64");
  }
  return "raw:" + Buffer.from(value, "utf8").toString("base64");
}

function decode(stored: string): string {
  if (stored.startsWith("v1:")) {
    return safeStorage.decryptString(Buffer.from(stored.slice(3), "base64"));
  }
  if (stored.startsWith("raw:")) {
    return Buffer.from(stored.slice(4), "base64").toString("utf8");
  }
  return stored;
}

export function registerPlatformHandlers(): void {
  ipcMain.handle(CH.http, (_e, req: HttpRequestDTO) => httpRequest(req));
  ipcMain.handle(CH.httpCancel, (_e, requestId: string) => {
    httpControllers.get(requestId)?.abort();
  });

  ipcMain.handle(CH.fsRead, async (_e, rel: string) => {
    const buf = await fs.readFile(resolveRel(rel));
    return new Uint8Array(buf);
  });
  ipcMain.handle(CH.fsWrite, async (_e, rel: string, data: Uint8Array) => {
    const abs = resolveRel(rel);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, Buffer.from(data));
  });
  ipcMain.handle(CH.fsDelete, async (_e, rel: string) => {
    await fs.rm(resolveRel(rel), { force: true });
  });
  ipcMain.handle(CH.fsExists, async (_e, rel: string) => {
    try {
      await fs.access(resolveRel(rel));
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle(CH.fsListDir, async (_e, rel: string) => {
    try {
      return await fs.readdir(resolveRel(rel));
    } catch {
      return [];
    }
  });
  ipcMain.handle(CH.fsMkdirp, async (_e, rel: string) => {
    await fs.mkdir(resolveRel(rel), { recursive: true });
  });

  ipcMain.handle(CH.notify, (_e, title: string, body?: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });
  ipcMain.handle(CH.clipboardReadText, () => clipboard.readText());
  ipcMain.handle(CH.clipboardWriteText, (_e, text: string) => {
    clipboard.writeText(text);
  });
  ipcMain.handle(CH.openExternal, async (_e, url: string) => {
    try {
      await openExternalUrl(url);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });

  ipcMain.handle(CH.secretGet, async (_e, key: string) => {
    const map = await readSecrets();
    return key in map ? decode(map[key]!) : null;
  });
  ipcMain.handle(CH.secretSet, async (_e, key: string, value: string) => {
    const map = await readSecrets();
    map[key] = encode(value);
    await writeSecrets(map);
  });
  ipcMain.handle(CH.secretDelete, async (_e, key: string) => {
    const map = await readSecrets();
    delete map[key];
    await writeSecrets(map);
  });

  ipcMain.handle(CH.deviceId, () => getStableDeviceId());
}

export async function getStableDeviceId(): Promise<string> {
  const map = await readSecrets();
  if (!map.__deviceId) {
    map.__deviceId = encode(randomUUID());
    await writeSecrets(map);
  }
  return decode(map.__deviceId);
}
