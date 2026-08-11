import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mainScholarlyHttp,
  SCHOLARLY_HTTP_MAX_CONCURRENT_REQUESTS,
  SCHOLARLY_HTTP_MAX_RESPONSE_BYTES,
  scholarlyHttp,
  validateScholarlyHttpUrl,
} from "./scholarly-http";

describe("main scholarly HTTP", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("only accepts the fixed HTTPS scholarly origins", () => {
    for (const url of [
      "https://api.crossref.org/works",
      "https://api.openalex.org/works",
      "https://api.semanticscholar.org/graph/v1/paper/search",
      "https://export.arxiv.org/api/query?search_query=all:test",
      "https://api.unpaywall.org/v2/10.1%2Fexample?email=test%40example.com",
    ]) {
      expect(validateScholarlyHttpUrl(url).toString()).toBe(url);
    }
  });

  it("rejects insecure, credentialed, port, IP, and suffix lookalike URLs before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const url of [
      "http://api.crossref.org/works",
      "https://token@api.crossref.org/works",
      "https://api.crossref.org:443/works",
      "https://api.crossref.org:8443/works",
      "https://127.0.0.1/works",
      "https://[::1]/works",
      "https://api.crossref.org.attacker.example/works",
      "https://api.crossref.org.evil/works",
      "https://localhost/works",
      "file:///tmp/works",
    ]) {
      await expect(scholarlyHttp.get(url)).rejects.toThrow();
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the compatibility client a fixed GET with no caller headers or body", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _options?: RequestInit) => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      mainScholarlyHttp.request({
        body: undefined,
        headers: { authorization: "Bearer must-not-reach-network" },
        method: "GET",
        url: "https://api.openalex.org/works?search=test",
      }),
    ).resolves.toMatchObject({ status: 200 });

    const [, options] = fetchMock.mock.calls[0] ?? [];
    expect(options).toMatchObject({ credentials: "omit", method: "GET", redirect: "manual" });
    expect(options).not.toHaveProperty("body");
    expect(options).not.toHaveProperty("headers");

    await expect(
      mainScholarlyHttp.request({
        method: "POST",
        url: "https://api.openalex.org/works",
      }),
    ).rejects.toThrow("仅允许 GET");
    await expect(
      mainScholarlyHttp.request({
        body: "no payloads",
        url: "https://api.openalex.org/works",
      }),
    ).rejects.toThrow("不允许请求体");
  });

  it("manually follows only revalidated allowlisted redirects", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { location: "https://api.openalex.org/works/W1" },
          status: 302,
        }),
      )
      .mockResolvedValueOnce(new Response('{"id":"W1"}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      scholarlyHttp.get("https://api.crossref.org/works/10.1%2Fexample"),
    ).resolves.toMatchObject({
      status: 200,
      url: "https://api.openalex.org/works/W1",
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.crossref.org/works/10.1%2Fexample",
      "https://api.openalex.org/works/W1",
    ]);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toMatchObject({ method: "GET", redirect: "manual" });
    }
  });

  it("does not follow a redirect outside the scholarly allowlist", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          headers: { location: "https://169.254.169.254/latest/meta-data" },
          status: 302,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(scholarlyHttp.get("https://api.crossref.org/works")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caps declared and streamed response bodies at 8 MiB", async () => {
    const declaredTooLarge = vi.fn(
      async () =>
        new Response("small", {
          headers: { "content-length": String(SCHOLARLY_HTTP_MAX_RESPONSE_BYTES + 1) },
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", declaredTooLarge);
    await expect(scholarlyHttp.get("https://api.crossref.org/works")).rejects.toThrow("too large");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(SCHOLARLY_HTTP_MAX_RESPONSE_BYTES + 1))),
    );
    await expect(scholarlyHttp.get("https://api.crossref.org/works")).rejects.toThrow("too large");
  });

  it("propagates a caller abort without affecting another in-flight request", async () => {
    let firstSignal: AbortSignal | undefined;
    let secondSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((url: string, options: RequestInit) => {
      if (url.endsWith("/first")) {
        firstSignal = options.signal ?? undefined;
        return waitForAbort(firstSignal);
      }
      secondSignal = options.signal ?? undefined;
      return Promise.resolve(new Response("second", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstController = new AbortController();
    const first = scholarlyHttp.get("https://api.openalex.org/first", {
      signal: firstController.signal,
    });
    const second = scholarlyHttp.get("https://api.openalex.org/second");
    await vi.waitFor(() => expect(firstSignal).toBeDefined());
    firstController.abort();

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toMatchObject({
      body: new TextEncoder().encode("second"),
      status: 200,
    });
    expect(secondSignal?.aborted).toBe(false);
  });

  it("bounds concurrent fetches and removes an aborted queued request", async () => {
    const fetchMock = vi.fn((_url: string, options: RequestInit) =>
      waitForAbort(options.signal ?? undefined),
    );
    vi.stubGlobal("fetch", fetchMock);

    const activeControllers = Array.from(
      { length: SCHOLARLY_HTTP_MAX_CONCURRENT_REQUESTS },
      () => new AbortController(),
    );
    const activeRequests = activeControllers.map((controller, index) =>
      scholarlyHttp.get(`https://api.openalex.org/works/active-${index}`, {
        signal: controller.signal,
      }),
    );
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledTimes(SCHOLARLY_HTTP_MAX_CONCURRENT_REQUESTS),
    );

    const queuedController = new AbortController();
    const queuedRequest = scholarlyHttp.get("https://api.openalex.org/works/queued", {
      signal: queuedController.signal,
    });
    queuedController.abort();
    await expect(queuedRequest).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(SCHOLARLY_HTTP_MAX_CONCURRENT_REQUESTS);

    for (const controller of activeControllers) controller.abort();
    await Promise.allSettled(activeRequests);
  });

  it("uses a finite timeout and converts deadline aborts to a timeout error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: RequestInit) => waitForAbort(options.signal ?? undefined)),
    );

    await expect(
      scholarlyHttp.get("https://api.unpaywall.org/v2/10.1%2Fexample", { timeoutMs: 5 }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});

function waitForAbort(signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    if (!signal) {
      reject(new Error("missing request signal"));
      return;
    }
    const onAbort = () => {
      const error = new Error("fetch aborted");
      error.name = "AbortError";
      reject(error);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
