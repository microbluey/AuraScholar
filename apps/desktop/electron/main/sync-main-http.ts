import type { HttpClient, HttpRequest, HttpResponse } from "@aurascholar/platform";

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Direct main-process transport for the sync runner. It intentionally does
 * not use a renderer-facing generic HTTP IPC channel or request ids.
 */
export const mainSyncHttp: HttpClient = {
  request: requestMainSyncHttp,
};

export async function requestMainSyncHttp(request: HttpRequest): Promise<HttpResponse> {
  const url = validateMainSyncHttpUrl(request.url);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = request.timeoutMs ? setTimeout(() => controller.abort(), request.timeoutMs) : null;

  try {
    const response = await fetch(url, {
      body: request.body,
      headers: request.headers,
      method: request.method ?? "GET",
      signal: controller.signal,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      body: new Uint8Array(await response.arrayBuffer()),
      headers,
      status: response.status,
    };
  } finally {
    if (timer) clearTimeout(timer);
    request.signal?.removeEventListener("abort", onAbort);
  }
}

export function validateMainSyncHttpUrl(rawUrl: string): string {
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
  return url.toString();
}
