import { StubHttpClient } from "@aurascholar/platform";
import { describe, expect, it } from "vitest";
import type { ConnectorContext } from "./client";
import {
  normalizeOpenAlex,
  openalexByDoi,
  openalexById,
  openalexCitedBy,
} from "./openalex";

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

describe("normalizeOpenAlex", () => {
  it("uses only explicit PDF locations for oaPdfUrl", () => {
    expect(
      normalizeOpenAlex({
        id: "https://openalex.org/W1",
        title: "Best OA PDF",
        best_oa_location: { pdf_url: "https://repository.example/paper.pdf" },
        primary_location: { pdf_url: "https://publisher.example/paper.pdf" },
        open_access: { oa_url: "https://publisher.example/article" },
      }).oaPdfUrl,
    ).toBe("https://repository.example/paper.pdf");

    expect(
      normalizeOpenAlex({
        id: "https://openalex.org/W2",
        title: "Primary PDF",
        primary_location: { pdf_url: "https://publisher.example/primary.pdf" },
      }).oaPdfUrl,
    ).toBe("https://publisher.example/primary.pdf");
  });

  it("does not treat an open-access landing page as a PDF", () => {
    const work = normalizeOpenAlex({
      id: "https://openalex.org/W3",
      title: "Landing page only",
      open_access: { oa_url: "https://publisher.example/article" },
    });

    expect(work.oaPdfUrl).toBeUndefined();
  });
});
