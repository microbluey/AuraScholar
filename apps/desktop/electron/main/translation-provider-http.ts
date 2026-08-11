import type { HttpClient, HttpRequest, HttpResponse } from "@aurascholar/platform";

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
export const MAX_TRANSLATION_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * Direct main-process transport for DeepL and Baidu. It never goes through the
 * renderer's generic HTTP bridge and refuses redirects so a configured BYOK
 * credential cannot be forwarded to a different origin by the provider.
 */
export const mainTranslationProviderHttp: HttpClient = {
  request: requestMainTranslationProviderHttp,
};

export async function requestMainTranslationProviderHttp(
  request: HttpRequest,
): Promise<HttpResponse> {
  const url = validateMainTranslationProviderHttpUrl(request.url);
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
      // A custom DeepL endpoint can be explicitly configured, but it may not
      // redirect the authorization-bearing request to another endpoint.
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

export function validateMainTranslationProviderHttpUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("无效的翻译服务 HTTP 地址");
  }
  if (!HTTP_PROTOCOLS.has(url.protocol)) {
    throw new Error(`翻译服务 HTTP 地址不允许使用 ${url.protocol || "未知"} 协议`);
  }
  if (url.username || url.password) {
    throw new Error("翻译服务 HTTP 地址不能包含用户名或密码");
  }
  return url.toString();
}

async function readBoundedResponseBody(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TRANSLATION_PROVIDER_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Translation provider response is too large");
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
      if (length > MAX_TRANSLATION_PROVIDER_RESPONSE_BYTES) {
        throw new Error("Translation provider response is too large");
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
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}
