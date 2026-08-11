// Main-process implementations for renderer platform operations and main-only
// encrypted credentials. The stable device id and every credential remain
// main-owned; renderer calls travel only through the restricted preload IPC
// surface.
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { app, clipboard, Notification, safeStorage, shell } from "electron";
import { handle } from "./ipc";
import {
  deleteRendererMutableFile,
  mkdirpRendererMutablePath,
  readRendererReadableFile,
  resolveRendererBlobPdfPath,
  resolveRendererMutableAppDataPath,
  resolveRendererResearchDownloadPath,
  writeRendererMutableFile,
  type RendererMutationOperation,
} from "./platform-fs-policy";
import { CH } from "../shared";

const appData = () => app.getPath("userData");
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

/** Generic renderer mutations are limited to operation-specific safe roots. */
function resolveRendererMutableRel(rel: string, operation: RendererMutationOperation) {
  return resolveRendererMutableAppDataPath(appData(), rel, operation);
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
  mutate: (
    map: Record<string, string>,
  ) => SecretsMutationResult<T> | Promise<SecretsMutationResult<T>>,
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
  handle(CH.fsWrite, async (_e, rel: string, data: Uint8Array) => {
    await writeRendererMutableFile(resolveRendererMutableRel(rel, "write"), data);
  });
  handle(CH.fsDelete, async (_e, rel: string) => {
    await deleteRendererMutableFile(resolveRendererMutableRel(rel, "delete"));
  });
  handle(CH.fsReadBlobPdf, async (_e, sha256: string) => {
    return readRendererReadableFile(resolveRendererBlobPdfPath(appData(), sha256));
  });
  handle(CH.fsReadResearchDownload, async (_e, relPath: string) => {
    return readRendererReadableFile(resolveRendererResearchDownloadPath(appData(), relPath));
  });
  handle(CH.fsMkdirp, async (_e, rel: string) => {
    await mkdirpRendererMutablePath(resolveRendererMutableRel(rel, "mkdirp"));
  });

  handle(CH.notify, (_e, title: string, body?: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });
  handle(CH.clipboardWriteText, (_e, text: string) => {
    clipboard.writeText(text);
  });
}

/** Main-only secret access used by narrow command owners, never by renderer DTOs. */
export async function getMainSecret(key: string): Promise<string | null> {
  await secretsMutationQueue;
  const map = await readSecrets();
  return key in map ? decode(map[key]!) : null;
}

/** Main-only encrypted secret writer shared with the narrow sync settings owner. */
export function setMainSecret(key: string, value: string): Promise<void> {
  return mutateSecrets((map) => {
    map[key] = encodeSecret(value);
    return { changed: true, value: undefined };
  });
}

/** Main-only encrypted secret deletion shared with the narrow sync settings owner. */
export function deleteMainSecret(key: string): Promise<void> {
  return mutateSecrets((map) => {
    const existed = key in map;
    delete map[key];
    return { changed: existed, value: undefined };
  });
}

export async function getStableDeviceId(): Promise<string> {
  return mutateSecrets((map) => {
    const existed = Boolean(map.__deviceId);
    if (!map.__deviceId) map.__deviceId = encodeLocalValue(randomUUID());
    return { changed: !existed, value: decode(map.__deviceId) };
  });
}
