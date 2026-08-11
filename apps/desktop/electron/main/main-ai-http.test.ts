import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_AI_PROVIDER_RESPONSE_BYTES,
  requestMainAiHttp,
  validateMainAiHttpUrl,
} from "./main-ai-http";

describe("main AI provider HTTP", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses direct main fetch with redirects disabled for authorization-bearing requests", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestMainAiHttp({
        headers: { authorization: "Bearer main-only-key" },
        method: "POST",
        url: "https://provider.example/v1/chat/completions",
      }),
    ).resolves.toMatchObject({ status: 200 });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://provider.example/v1/chat/completions",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("rejects URL credentials and non-HTTP URLs before network access", () => {
    for (const url of ["https://key@provider.example/v1", "file:///tmp/provider"]) {
      expect(() => validateMainAiHttpUrl(url)).toThrow();
    }
  });

  it("caps a provider response before it can consume unbounded main-process memory", async () => {
    const oversized = new Uint8Array(MAX_AI_PROVIDER_RESPONSE_BYTES + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(oversized, { status: 200 })),
    );

    await expect(requestMainAiHttp({ url: "https://provider.example/v1/models" })).rejects.toThrow(
      "AI provider response is too large",
    );
  });
});
