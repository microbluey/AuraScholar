import { StubHttpClient, jsonResponse } from "@aurascholar/platform";
import { describe, expect, it } from "vitest";
import type { ConnectorContext } from "@aurascholar/connectors";
import { buildCitationGraph } from "./build";

function ctxWith(http: StubHttpClient): ConnectorContext {
  return { http, mailto: "test@example.com" };
}

describe("buildCitationGraph cancellation", () => {
  it("does not issue the center request for an already-aborted signal", async () => {
    const http = new StubHttpClient();
    const controller = new AbortController();
    controller.abort();

    await expect(
      buildCitationGraph(
        ctxWith(http),
        { openalexId: "W2741809807" },
        { retries: 0, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(http.requests).toHaveLength(0);
  });

  it("passes cancellation to the batched reference request", async () => {
    const http = new StubHttpClient();
    const controller = new AbortController();
    http.on(/\/works\/W2741809807\?/, () => {
      controller.abort();
      return jsonResponse(200, {
        id: "https://openalex.org/W2741809807",
        display_name: "Center work",
        referenced_works: ["https://openalex.org/W1"],
      });
    });

    await expect(
      buildCitationGraph(
        ctxWith(http),
        { openalexId: "W2741809807" },
        { retries: 0, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(http.requests).toHaveLength(1);
  });
});
