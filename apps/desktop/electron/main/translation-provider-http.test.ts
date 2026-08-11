import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_TRANSLATION_PROVIDER_RESPONSE_BYTES,
  requestMainTranslationProviderHttp,
  validateMainTranslationProviderHttpUrl,
} from "./translation-provider-http";

describe("main translation provider HTTP", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses direct main fetch with redirects disabled for authorization-bearing requests", async () => {
    const fetchMock = vi.fn(async () => new Response('{"translations":[]}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestMainTranslationProviderHttp({
        headers: { authorization: "DeepL-Auth-Key main-secret" },
        method: "POST",
        url: "https://api.deepl.example/v2/translate",
      }),
    ).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepl.example/v2/translate",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("rejects URL credentials and non-HTTP URLs before network access", () => {
    for (const url of ["https://key@api.deepl.example/v2/translate", "file:///tmp/translate"]) {
      expect(() => validateMainTranslationProviderHttpUrl(url)).toThrow();
    }
  });

  it("caps a provider response before it can become an oversized IPC result", async () => {
    const oversized = new Uint8Array(MAX_TRANSLATION_PROVIDER_RESPONSE_BYTES + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(oversized, { status: 200 })),
    );

    await expect(
      requestMainTranslationProviderHttp({ url: "https://api.deepl.example/v2/translate" }),
    ).rejects.toThrow("Translation provider response is too large");
  });
});
