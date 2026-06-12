// Shared HTTP plumbing for all scholarly API connectors: per-host rate
// limiting, exponential backoff on 429/5xx, JSON decoding. All public APIs we
// use ask for a contact email (Crossref polite pool, Unpaywall, OpenAlex) —
// pass it once here.
import type { HttpClient, HttpResponse } from "@aurascholar/platform";

export interface ConnectorContext {
  http: HttpClient;
  /** Contact email for polite pools. Required by Unpaywall, recommended by Crossref/OpenAlex. */
  mailto: string;
  userAgent?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message?: string,
  ) {
    super(message ?? `API request failed (${status}): ${url}`);
  }
}

interface RateLimiter {
  /** Resolves when the caller may proceed. */
  acquire(): Promise<void>;
}

/** Simple token-interval limiter: at most one request per `intervalMs` per host. */
class IntervalLimiter implements RateLimiter {
  private next = 0;
  constructor(private readonly intervalMs: number) {}
  async acquire(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.next - now);
    this.next = Math.max(now, this.next) + this.intervalMs;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

const limiters = new Map<string, RateLimiter>();

function limiterFor(url: string): RateLimiter {
  const host = new URL(url).host;
  let limiter = limiters.get(host);
  if (!limiter) {
    // 10 req/s for OpenAlex/Crossref polite pools; conservative default elsewhere.
    const interval = /openalex|crossref/.test(host) ? 100 : 250;
    limiter = new IntervalLimiter(interval);
    limiters.set(host, limiter);
  }
  return limiter;
}

export async function getJson<T = unknown>(
  ctx: ConnectorContext,
  url: string,
  opts?: { retries?: number },
): Promise<T> {
  const res = await getRaw(ctx, url, opts);
  return JSON.parse(new TextDecoder().decode(res.body)) as T;
}

export async function getRaw(
  ctx: ConnectorContext,
  url: string,
  opts?: { retries?: number },
): Promise<HttpResponse> {
  const retries = opts?.retries ?? 3;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await limiterFor(url).acquire();
    try {
      const res = await ctx.http.request({
        url,
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": ctx.userAgent ?? `AuraScholar/0.1 (mailto:${ctx.mailto})`,
        },
        timeoutMs: 30_000,
      });
      if (res.status === 200) return res;
      if (res.status === 404) throw new ApiError(404, url, `Not found: ${url}`);
      if (res.status === 429 || res.status >= 500) {
        lastError = new ApiError(res.status, url);
        await backoff(attempt, res.headers["retry-after"]);
        continue;
      }
      throw new ApiError(res.status, url);
    } catch (e) {
      if (e instanceof ApiError && e.status !== 429 && e.status < 500) throw e;
      lastError = e;
      await backoff(attempt);
    }
  }
  throw lastError;
}

async function backoff(attempt: number, retryAfter?: string): Promise<void> {
  const hinted = retryAfter ? Number(retryAfter) * 1000 : 0;
  const base = Math.min(8000, 500 * 2 ** attempt);
  const jitter = Math.random() * 250;
  await new Promise((r) => setTimeout(r, Math.max(hinted, base + jitter)));
}
