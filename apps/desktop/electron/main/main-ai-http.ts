import type { HttpClient, HttpRequest, HttpResponse } from "@aurascholar/platform";

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
/** Bounds an untrusted configured-provider response before JSON parsing. */
export const MAX_AI_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * Direct main-process transport for configured AI providers. It never crosses
 * a renderer-facing generic HTTP IPC bridge; request cancellation stays
 * attached to the provider command's AbortSignal.
 */
export const mainAiHttp: HttpClient = {
  request: requestMainAiHttp,
};

export async function requestMainAiHttp(request: HttpRequest): Promise<HttpResponse> {
  const url = validateMainAiHttpUrl(request.url);
  if (request.signal?.aborted) throw abortError();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = request.timeoutMs ? setTimeout(() => controller.abort(), request.timeoutMs) : null;

  try {
    const response = await fetch(url, {
      body: request.body,
      headers: request.headers,
      method: request.method ?? "GET",
      // The configured provider endpoint is allowed to receive this request,
      // but it must not redirect an authorization-bearing request elsewhere.
      redirect: "error",
      signal: controller.signal,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      body: await readBoundedResponseBody(response),
      headers,
      status: response.status,
    };
  } finally {
    if (timer) clearTimeout(timer);
    request.signal?.removeEventListener("abort", onAbort);
  }
}

async function readBoundedResponseBody(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AI_PROVIDER_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error("AI provider response is too large");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value;
      if (!(value instanceof Uint8Array) || value.byteLength === 0) continue;
      length += value.byteLength;
      if (length > MAX_AI_PROVIDER_RESPONSE_BYTES) {
        throw new Error("AI provider response is too large");
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function abortError(): Error {
  const error = new Error("AI request cancelled");
  error.name = "AbortError";
  return error;
}

export function validateMainAiHttpUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("无效的 AI HTTP 请求地址");
  }
  if (!HTTP_PROTOCOLS.has(url.protocol)) {
    throw new Error("AI HTTP 请求仅支持 http:// 或 https:// 地址");
  }
  if (url.username || url.password) {
    throw new Error("AI HTTP 请求地址不能包含用户名或密码");
  }
  return url.toString();
}
