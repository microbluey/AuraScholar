import { isIP } from "node:net";
import type { HttpClient, HttpRequest, HttpResponse } from "@aurascholar/platform";

/**
 * The only remote origins that the main-process scholarly connector runner may
 * contact. Keep this list deliberately small: a renderer-supplied URL must
 * never turn this transport into a general-purpose SSRF primitive.
 */
export const SCHOLARLY_HTTP_ALLOWED_ORIGINS = [
  "https://api.crossref.org",
  "https://api.openalex.org",
  "https://api.semanticscholar.org",
  "https://export.arxiv.org",
  "https://api.unpaywall.org",
] as const;

const allowedOrigins = new Set<string>(SCHOLARLY_HTTP_ALLOWED_ORIGINS);

/** Every request, including time spent waiting for a concurrency slot, is bounded. */
export const SCHOLARLY_HTTP_DEFAULT_TIMEOUT_MS = 30_000;
export const SCHOLARLY_HTTP_MAX_TIMEOUT_MS = 30_000;
export const SCHOLARLY_HTTP_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const SCHOLARLY_HTTP_MAX_REDIRECTS = 5;
export const SCHOLARLY_HTTP_MAX_CONCURRENT_REQUESTS = 8;
export const SCHOLARLY_HTTP_MAX_QUEUED_REQUESTS = 32;

export interface ScholarlyHttpRequestOptions {
  /** Cancels only this request; callers never share renderer request ids here. */
  signal?: AbortSignal;
  /** Optional shorter deadline. Values above 30 seconds are clamped. */
  timeoutMs?: number;
}

export interface ScholarlyHttpResponse extends HttpResponse {
  /** The validated final URL after any allowlisted redirects. */
  url: string;
}

/**
 * Narrow main-only API for new command handlers. It intentionally has no
 * method, headers, or body parameters: scholarly metadata requests are GETs
 * with no caller-controlled HTTP credentials or payload.
 */
export interface ScholarlyHttpTransport {
  get(url: string, options?: ScholarlyHttpRequestOptions): Promise<ScholarlyHttpResponse>;
}

/** Preferred API for main command handlers that do not need a generic client. */
export const scholarlyHttp: ScholarlyHttpTransport = {
  get: getScholarlyHttp,
};

/**
 * Compatibility adapter for the existing connector package. Connector helpers
 * currently depend on `HttpClient`; their informational request headers are
 * deliberately ignored so they cannot expand this transport's capability.
 */
export const mainScholarlyHttp: HttpClient = {
  request: requestMainScholarlyHttp,
};

/**
 * Validate one absolute scholarly endpoint before it reaches `fetch`.
 *
 * Exact-origin matching rejects lookalike suffixes. We additionally reject
 * literal IP addresses, URL credentials, and explicit ports rather than
 * relying only on an origin string comparison.
 */
export function validateScholarlyHttpUrl(rawUrl: string): URL {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    throw new Error("无效的 scholarly HTTP 地址");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("无效的 scholarly HTTP 地址");
  }

  if (url.protocol !== "https:") {
    throw new Error("scholarly HTTP 仅允许 HTTPS 地址");
  }
  if (url.username || url.password) {
    throw new Error("scholarly HTTP 地址不能包含用户名或密码");
  }
  if (url.port || hasExplicitPort(rawUrl)) {
    throw new Error("scholarly HTTP 地址不能包含端口");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) !== 0) {
    throw new Error("scholarly HTTP 地址不能使用 IP 地址");
  }
  if (!allowedOrigins.has(url.origin)) {
    throw new Error("scholarly HTTP 地址不在允许的学术服务列表中");
  }

  return url;
}

/**
 * Main-only GET transport. Redirects are followed manually so every hop is
 * revalidated against the same strict allowlist before a second request opens.
 */
export async function getScholarlyHttp(
  rawUrl: string,
  options: ScholarlyHttpRequestOptions = {},
): Promise<ScholarlyHttpResponse> {
  const initialUrl = validateScholarlyHttpUrl(rawUrl);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  if (options.signal?.aborted) throw abortError();

  const controller = new AbortController();
  let abortedByCaller = false;
  let timedOut = false;
  const onAbort = () => {
    abortedByCaller = true;
    controller.abort();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let release: (() => void) | undefined;
  try {
    release = await scholarlyRequestLimiter.acquire(controller.signal);
    return await fetchWithValidatedRedirects(initialUrl, controller.signal);
  } catch (error) {
    if (abortedByCaller || options.signal?.aborted) throw abortError();
    if (timedOut) throw timeoutError();
    if (controller.signal.aborted) throw abortError();
    throw error;
  } finally {
    release?.();
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Adapter for `@aurascholar/connectors`. It rejects write-like use and ignores
 * the package's convenience headers; the actual fetch stays a fixed GET with
 * no caller-provided headers or body.
 */
export async function requestMainScholarlyHttp(request: HttpRequest): Promise<HttpResponse> {
  if (request.method !== undefined && request.method !== "GET") {
    throw new Error("scholarly HTTP 仅允许 GET 请求");
  }
  if (request.body !== undefined) {
    throw new Error("scholarly HTTP 不允许请求体");
  }

  return getScholarlyHttp(request.url, {
    signal: request.signal,
    timeoutMs: request.timeoutMs,
  });
}

async function fetchWithValidatedRedirects(
  initialUrl: URL,
  signal: AbortSignal,
): Promise<ScholarlyHttpResponse> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; ; redirectCount += 1) {
    throwIfAborted(signal);
    const response = await fetch(currentUrl.toString(), {
      // Do not copy request headers or body from a caller. Node/Electron may
      // still add its standard transport headers, but this module has no
      // caller-controlled HTTP credential surface.
      credentials: "omit",
      method: "GET",
      redirect: "manual",
      signal,
    });

    if (!isRedirect(response.status)) {
      return responseFromFetch(response, currentUrl);
    }

    const location = response.headers.get("location");
    if (!location) {
      return responseFromFetch(response, currentUrl);
    }
    if (redirectCount >= SCHOLARLY_HTTP_MAX_REDIRECTS) {
      await cancelResponseBody(response);
      throw new Error("scholarly HTTP 重定向次数过多");
    }

    let redirectedUrl: URL;
    try {
      redirectedUrl = new URL(location, currentUrl);
    } catch {
      await cancelResponseBody(response);
      throw new Error("scholarly HTTP 重定向地址无效");
    }

    await cancelResponseBody(response);
    currentUrl = validateScholarlyHttpUrl(redirectedUrl.toString());
  }
}

async function responseFromFetch(response: Response, url: URL): Promise<ScholarlyHttpResponse> {
  return {
    body: await readBoundedResponseBody(response),
    headers: headersToRecord(response.headers),
    status: response.status,
    url: url.toString(),
  };
}

async function readBoundedResponseBody(response: Response): Promise<Uint8Array> {
  const declaredLength = contentLength(response.headers.get("content-length"));
  if (declaredLength !== null && declaredLength > SCHOLARLY_HTTP_MAX_RESPONSE_BYTES) {
    await cancelResponseBody(response);
    throw new Error("Scholarly HTTP response is too large");
  }

  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength === 0) continue;
      length += chunk.value.byteLength;
      if (length > SCHOLARLY_HTTP_MAX_RESPONSE_BYTES) {
        throw new Error("Scholarly HTTP response is too large");
      }
      chunks.push(chunk.value);
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

function contentLength(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const length = Number(trimmed);
  return Number.isSafeInteger(length) ? length : Number.POSITIVE_INFINITY;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return SCHOLARLY_HTTP_DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("scholarly HTTP 超时必须是正整数");
  }
  return Math.min(timeoutMs, SCHOLARLY_HTTP_MAX_TIMEOUT_MS);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function abortError(): Error {
  const error = new Error("Scholarly HTTP request aborted");
  error.name = "AbortError";
  return error;
}

function timeoutError(): Error {
  const error = new Error("Scholarly HTTP request timed out");
  error.name = "TimeoutError";
  return error;
}

/** Reject an explicit `:port`, including the otherwise-normalized `:443`. */
function hasExplicitPort(rawUrl: string): boolean {
  const authority = rawUrl.match(/^\s*https:\/\/([^/?#]*)/i)?.[1];
  if (!authority) return false;
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  return host.includes(":");
}

interface QueuedRequest {
  onAbort: () => void;
  reject: (reason?: unknown) => void;
  resolve: (release: () => void) => void;
  signal: AbortSignal;
}

/** A small FIFO limiter prevents independent command invocations from flooding an API. */
class ScholarlyRequestLimiter {
  private activeRequests = 0;
  private readonly queuedRequests: QueuedRequest[] = [];

  acquire(signal: AbortSignal): Promise<() => void> {
    throwIfAborted(signal);
    if (this.activeRequests < SCHOLARLY_HTTP_MAX_CONCURRENT_REQUESTS) {
      this.activeRequests += 1;
      return Promise.resolve(this.releaseOnce());
    }
    if (this.queuedRequests.length >= SCHOLARLY_HTTP_MAX_QUEUED_REQUESTS) {
      throw new Error("scholarly HTTP 请求队列已满");
    }

    return new Promise((resolve, reject) => {
      const waiter: QueuedRequest = {
        onAbort: () => {},
        reject,
        resolve,
        signal,
      };
      waiter.onAbort = () => {
        const index = this.queuedRequests.indexOf(waiter);
        if (index === -1) return;
        this.queuedRequests.splice(index, 1);
        signal.removeEventListener("abort", waiter.onAbort);
        reject(abortError());
      };
      this.queuedRequests.push(waiter);
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      if (signal.aborted) waiter.onAbort();
    });
  }

  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  private release(): void {
    this.activeRequests -= 1;
    while (this.queuedRequests.length > 0) {
      const waiter = this.queuedRequests.shift();
      if (!waiter) return;
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      if (waiter.signal.aborted) {
        waiter.reject(abortError());
        continue;
      }
      this.activeRequests += 1;
      waiter.resolve(this.releaseOnce());
      return;
    }
  }
}

const scholarlyRequestLimiter = new ScholarlyRequestLimiter();
