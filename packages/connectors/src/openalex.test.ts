import { StubHttpClient } from "@aurascholar/platform";
import { describe, expect, it } from "vitest";
import type { ConnectorContext } from "./client";
import { openalexByDoi, openalexById, openalexCitedBy } from "./openalex";

function ctxWith(http: StubHttpClient): ConnectorContext {
  return { http, mailto: "test@example.com" };
}

describe("OpenAlex request cancellation", () => {
  it.each([
    [
      "openalexByDoi",
      (ctx: ConnectorContext, signal: AbortSignal) =>
        openalexByDoi(ctx, "10.1000/example", { retries: 0, signal }),
    ],
    [
      "openalexById",
      (ctx: ConnectorContext, signal: AbortSignal) =>
        openalexById(ctx, "W2741809807", { retries: 0, signal }),
    ],
    [
      "openalexCitedBy",
      (ctx: ConnectorContext, signal: AbortSignal) =>
        openalexCitedBy(ctx, "W2741809807", 25, { retries: 0, signal }),
    ],
  ])("%s rejects an already-aborted request before issuing HTTP", async (_name, request) => {
    const http = new StubHttpClient();
    const controller = new AbortController();
    controller.abort();

    await expect(request(ctxWith(http), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(http.requests).toHaveLength(0);
  });
});
