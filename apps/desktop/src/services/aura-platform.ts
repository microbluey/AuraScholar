// Desktop Platform implementation, backed by the Electron preload bridge
// (window.aura): notifications and small renderer-safe helpers.
import type { NotificationOptions, Notifier } from "@aurascholar/platform";

/** True when running inside the Electron shell (the preload bridge exists). */
export function isDesktopRuntime(): boolean {
  return "aura" in window;
}

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
  const opened = window.open(safeUrl, "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("浏览器阻止了外部链接弹窗");
}

/** sha256 of file bytes — content addressing for the blob store. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
