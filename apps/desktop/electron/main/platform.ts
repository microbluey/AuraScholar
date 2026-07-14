// Main-process implementations of the platform surface the renderer needs:
// CORS-free HTTP, app-data-relative FS, OS notifications, encrypted secrets,
// and a stable device id. Exposed to the renderer via IPC (see preload).
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join, sep } from "node:path";
import { app, clipboard, Notification, safeStorage, shell } from "electron";
import { describeSafeError } from "@aurascholar/platform";
import { handle } from "./ipc";
import { CH, type HttpRequestDTO, type HttpResultDTO } from "../shared";

const appData = () => app.getPath("userData");
const httpControllers = new Map<string, AbortController>();
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
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
  if (url.username || url.password) {
    throw new Error("外部链接不能包含用户名或密码");
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

async function httpRequest(req: HttpRequestDTO): Promise<HttpResultDTO> {
  const url = validateHttpRequestUrl(req.url);
  const controller = new AbortController();
  if (req.requestId) httpControllers.set(req.requestId, controller);
  const timer = req.timeoutMs ? setTimeout(() => controller.abort(), req.timeoutMs) : null;
  try {
    const res = await fetch(url.toString(), {
      method: req.method ?? "GET",
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return { status: res.status, headers, body: buf };
  } catch (error) {
    if (isAbortError(error)) return { aborted: true };
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (req.requestId) httpControllers.delete(req.requestId);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function validateHttpRequestUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("无效的 HTTP 请求地址");
  }
  if (!HTTP_PROTOCOLS.has(url.protocol)) {
    throw new Error(`HTTP 请求不允许使用 ${url.protocol || "未知"} 协议`);
  }
  if (url.username || url.password) {
    throw new Error("HTTP 请求地址不能包含用户名或密码");
  }
  return url;
}

const SECRETS_FILE = () => join(appData(), "secrets.json");
const SECRET_FILE_MODE = 0o600;
const SECRET_ENCRYPTION_UNAVAILABLE_MESSAGE =
  "当前系统未提供安全密钥存储，无法保存 API Key 或同步密码。请启用系统钥匙串或凭据存储后重试。";

interface SecretsMutationResult<T> {
  changed: boolean;
  value: T;
}

let secretsMutationQueue: Promise<void> = Promise.resolve();

async function readSecrets(): Promise<Record<string, string>> {
  try {
    const file = SECRETS_FILE();
    const raw = await fs.readFile(file, "utf8");
    await fs.chmod(file, SECRET_FILE_MODE).catch(() => {});
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeSecrets(map: Record<string, string>): Promise<void> {
  const file = SECRETS_FILE();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(dirname(file), { recursive: true });
  try {
    await fs.writeFile(tmp, JSON.stringify(map), { encoding: "utf8", mode: SECRET_FILE_MODE });
    await fs.chmod(tmp, SECRET_FILE_MODE).catch(() => {});
    await fs.rename(tmp, file);
    await fs.chmod(file, SECRET_FILE_MODE).catch(() => {});
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

async function mutateSecrets<T>(
  mutate: (map: Record<string, string>) => SecretsMutationResult<T> | Promise<SecretsMutationResult<T>>,
): Promise<T> {
  const run = secretsMutationQueue.then(async () => {
    const map = await readSecrets();
    const result = await mutate(map);
    if (result.changed) await writeSecrets(map);
    return result.value;
  });
  secretsMutationQueue = run.then(
    () => {},
    () => {},
  );
  return run;
}

function encodeSecret(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return "v1:" + safeStorage.encryptString(value).toString("base64");
  }
  throw new Error(SECRET_ENCRYPTION_UNAVAILABLE_MESSAGE);
}

function encodeLocalValue(value: string): string {
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
    // Backward compatibility for older builds. Secret writes never create raw
    // entries; non-secret local identifiers may on systems without OS crypto.
    return Buffer.from(stored.slice(4), "base64").toString("utf8");
  }
  return stored;
}

export function registerPlatformHandlers(): void {
  handle(CH.http, (_e, req: HttpRequestDTO) => httpRequest(req));
  handle(CH.httpCancel, (_e, requestId: string) => {
    httpControllers.get(requestId)?.abort();
  });

  handle(CH.fsRead, async (_e, rel: string) => {
    const buf = await fs.readFile(resolveRel(rel));
    return new Uint8Array(buf);
  });
  handle(CH.fsWrite, async (_e, rel: string, data: Uint8Array) => {
    const abs = resolveRel(rel);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, Buffer.from(data));
  });
  handle(CH.fsDelete, async (_e, rel: string) => {
    await fs.rm(resolveRel(rel), { force: true });
  });
  handle(CH.fsExists, async (_e, rel: string) => {
    try {
      await fs.access(resolveRel(rel));
      return true;
    } catch {
      return false;
    }
  });
  handle(CH.fsListDir, async (_e, rel: string) => {
    try {
      return await fs.readdir(resolveRel(rel));
    } catch {
      return [];
    }
  });
  handle(CH.fsMkdirp, async (_e, rel: string) => {
    await fs.mkdir(resolveRel(rel), { recursive: true });
  });

  handle(CH.notify, (_e, title: string, body?: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });
  handle(CH.clipboardReadText, () => clipboard.readText());
  handle(CH.clipboardWriteText, (_e, text: string) => {
    clipboard.writeText(text);
  });
  handle(CH.openExternal, async (_e, url: string) => {
    try {
      await openExternalUrl(url);
      return null;
    } catch (error) {
      return describeSafeError(error);
    }
  });

  handle(CH.secretGet, async (_e, key: string) => {
    await secretsMutationQueue;
    const map = await readSecrets();
    return key in map ? decode(map[key]!) : null;
  });
  handle(CH.secretSet, (_e, key: string, value: string) => mutateSecrets((map) => {
    map[key] = encodeSecret(value);
    return { changed: true, value: undefined };
  }));
  handle(CH.secretDelete, (_e, key: string) => mutateSecrets((map) => {
    const existed = key in map;
    delete map[key];
    return { changed: existed, value: undefined };
  }));

  handle(CH.deviceId, () => getStableDeviceId());
}

export async function getStableDeviceId(): Promise<string> {
  return mutateSecrets((map) => {
    const existed = Boolean(map.__deviceId);
    if (!map.__deviceId) map.__deviceId = encodeLocalValue(randomUUID());
    return { changed: !existed, value: decode(map.__deviceId) };
  });
}
