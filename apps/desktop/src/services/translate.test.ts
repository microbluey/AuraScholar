import { md5, type Translator } from "@aurascholar/translate";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTranslationCache,
  createCachingTranslator,
  loadTranslateConfig,
  resolveTranslator,
  saveTranslateConfig,
  type TranslationCacheDataSource,
} from "./translate";

const MAIN_DEEPL_SNAPSHOT = {
  baidu: { appid: "", hasApiKey: false },
  deepl: { baseUrl: "https://api.deepl.example/saved", hasApiKey: true },
  engine: "deepl" as const,
  targetLang: "zh",
};

function stubAuraCommand(
  command: ReturnType<typeof vi.fn>,
  initialStorage: Record<string, string> = {},
): Map<string, string> {
  const values = new Map(Object.entries(initialStorage));
  vi.stubGlobal("window", {
    aura: { data: { command } },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  return values;
}

function cache(overrides: Partial<TranslationCacheDataSource> = {}): TranslationCacheDataSource {
  return {
    clear: vi.fn(async () => 0),
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
    ...overrides,
  };
}

function translator(overrides: Partial<Translator> = {}): Translator {
  return {
    id: "test-engine",
    translate: vi.fn(async () => ({ engine: "test-engine", text: "在线译文" })),
    ...overrides,
  };
}

describe("translation cache renderer facade", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a cached translation without calling the network translator", async () => {
    const inner = translator();
    const source = cache({ get: vi.fn(async () => "缓存译文") });
    const wrapped = createCachingTranslator(inner, source);

    await expect(wrapped.translate({ text: " source text ", targetLang: "zh" })).resolves.toEqual({
      engine: "test-engine (缓存)",
      text: "缓存译文",
    });
    expect(source.get).toHaveBeenCalledWith(md5("test-engine\0zh\0source text"));
    expect(inner.translate).not.toHaveBeenCalled();
    expect(source.put).not.toHaveBeenCalled();
  });

  it("preserves network translation when cache reads or writes fail", async () => {
    const inner = translator();
    const source = cache({
      get: vi.fn(async () => {
        throw new Error("cache read failed");
      }),
      put: vi.fn(async () => {
        throw new Error("cache write failed");
      }),
    });
    const wrapped = createCachingTranslator(inner, source);

    await expect(wrapped.translate({ text: "source text", targetLang: "zh" })).resolves.toEqual({
      engine: "test-engine",
      text: "在线译文",
    });
    expect(inner.translate).toHaveBeenCalledWith(
      { text: "source text", targetLang: "zh" },
      undefined,
    );
    expect(source.put).toHaveBeenCalledWith(
      md5("test-engine\0zh\0source text"),
      "test-engine",
      "zh",
      "在线译文",
    );
  });

  it("skips cache work for blank source text and empty translation responses", async () => {
    const inner = translator({
      translate: vi.fn(async () => ({ engine: "test-engine", text: "  " })),
    });
    const source = cache();
    const wrapped = createCachingTranslator(inner, source);

    await expect(wrapped.translate({ text: "   ", targetLang: "zh" })).resolves.toEqual({
      engine: "test-engine",
      text: "",
    });
    await expect(wrapped.translate({ text: "source text", targetLang: "zh" })).resolves.toEqual({
      engine: "test-engine",
      text: "  ",
    });
    expect(inner.translate).toHaveBeenCalledTimes(1);
    expect(source.get).toHaveBeenCalledTimes(1);
    expect(source.put).not.toHaveBeenCalled();
  });

  it("does not return a cache hit after the caller has cancelled", async () => {
    const controller = new AbortController();
    const inner = translator();
    const source = cache({
      get: vi.fn(async () => {
        controller.abort();
        return "too late";
      }),
    });
    const wrapped = createCachingTranslator(inner, source);

    await expect(
      wrapped.translate({ text: "source text", targetLang: "zh" }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(inner.translate).not.toHaveBeenCalled();
  });

  it("clears cache through the narrow typed command and returns its actual count", async () => {
    const command = vi.fn(async () => ({ deleted: 3 }));
    vi.stubGlobal("window", { aura: { data: { command } } });

    await expect(clearTranslationCache()).resolves.toBe(3);
    expect(command).toHaveBeenCalledWith("translationCache.clear", {});
  });

  it("loads only a key-free settings snapshot from main", async () => {
    const command = vi.fn(async (name: string, _input?: unknown) => {
      if (name === "translation.getSettings") return MAIN_DEEPL_SNAPSHOT;
      throw new Error(`unexpected ${name}`);
    });
    stubAuraCommand(command);

    await expect(loadTranslateConfig()).resolves.toEqual(MAIN_DEEPL_SNAPSHOT);
    expect(command).toHaveBeenCalledWith("translation.getSettings", {});
    expect(JSON.stringify(MAIN_DEEPL_SNAPSHOT)).not.toContain("apiKey");
  });

  it("hands a legacy inline key to main once, then removes the renderer record", async () => {
    const command = vi.fn(async (name: string) => {
      if (name === "translation.adoptLegacySettings") return MAIN_DEEPL_SNAPSHOT;
      throw new Error(`unexpected ${name}`);
    });
    const storage = stubAuraCommand(command, {
      "translate-settings": JSON.stringify({
        deepl: { apiKey: "legacy-inline-key", baseUrl: "https://api.deepl.example/v2" },
        engine: "deepl",
        targetLang: "zh",
      }),
    });

    await expect(loadTranslateConfig()).resolves.toEqual(MAIN_DEEPL_SNAPSHOT);
    expect(command).toHaveBeenCalledWith("translation.adoptLegacySettings", {
      baidu: {},
      deepl: { apiKey: "legacy-inline-key", baseUrl: "https://api.deepl.example/v2" },
      engine: "deepl",
      targetLang: "zh",
    });
    expect(storage.has("translate-settings")).toBe(false);
  });

  it("sends replacement keys only to the narrow save command and receives no key back", async () => {
    const command = vi.fn(async (name: string) => {
      if (name === "translation.saveSettings") return MAIN_DEEPL_SNAPSHOT;
      throw new Error(`unexpected ${name}`);
    });
    stubAuraCommand(command);

    await expect(
      saveTranslateConfig({
        deepl: { apiKey: "new-deepl-key", baseUrl: "https://api.deepl.example/saved" },
        engine: "deepl",
        targetLang: "zh",
      }),
    ).resolves.toEqual(MAIN_DEEPL_SNAPSHOT);
    expect(command).toHaveBeenCalledWith("translation.saveSettings", {
      baidu: {},
      deepl: { apiKey: "new-deepl-key", baseUrl: "https://api.deepl.example/saved" },
      engine: "deepl",
      targetLang: "zh",
    });
  });

  it("invokes the configured main translator without sending provider target or key", async () => {
    const command = vi.fn(async (name: string, _input?: unknown) => {
      if (name === "translation.getSettings") return MAIN_DEEPL_SNAPSHOT;
      if (name === "translationCache.get") return { result: null };
      if (name === "translation.translate") return { engine: "deepl", text: "主进程译文" };
      if (name === "translationCache.put") return {};
      throw new Error(`unexpected ${name}`);
    });
    stubAuraCommand(command);

    const resolved = await resolveTranslator();
    if ("error" in resolved) throw new Error(resolved.error);
    await expect(
      resolved.translator.translate(
        { sourceLang: "en", targetLang: "ignored", text: "source text" },
        { domain: "materials" },
      ),
    ).resolves.toEqual({ engine: "deepl", text: "主进程译文" });

    const translationCall = command.mock.calls.find(([name]) => name === "translation.translate");
    const translationInput = translationCall?.[1] as Record<string, unknown> | undefined;
    expect(translationInput).toMatchObject({
      domain: "materials",
      requestId: expect.any(String),
      sourceLang: "en",
      text: "source text",
    });
    expect(translationInput).not.toHaveProperty("apiKey");
    expect(translationInput).not.toHaveProperty("baseUrl");
    expect(translationInput).not.toHaveProperty("engine");
  });

  it("forwards AbortSignal cancellation to the dedicated main command", async () => {
    let resolveProvider: ((result: { engine: string; text: string }) => void) | undefined;
    const command = vi.fn((name: string, _input?: unknown) => {
      if (name === "translation.getSettings") return Promise.resolve(MAIN_DEEPL_SNAPSHOT);
      if (name === "translationCache.get") return Promise.resolve({ result: null });
      if (name === "translation.translate") {
        return new Promise<{ engine: string; text: string }>((resolve) => {
          resolveProvider = resolve;
        });
      }
      if (name === "translation.cancel") return Promise.resolve({ cancelled: true });
      if (name === "translationCache.put") return Promise.resolve({});
      return Promise.reject(new Error(`unexpected ${name}`));
    });
    stubAuraCommand(command);
    const controller = new AbortController();

    const resolved = await resolveTranslator();
    if ("error" in resolved) throw new Error(resolved.error);
    const pending = resolved.translator.translate(
      { targetLang: "zh", text: "cancel me" },
      { signal: controller.signal },
    );
    await vi.waitFor(() =>
      expect(command.mock.calls.some(([name]) => name === "translation.translate")).toBe(true),
    );
    controller.abort();
    await vi.waitFor(() =>
      expect(command.mock.calls.some(([name]) => name === "translation.cancel")).toBe(true),
    );
    resolveProvider?.({ engine: "deepl", text: "too late" });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const translationCall = command.mock.calls.find(([name]) => name === "translation.translate");
    const translationInput = translationCall?.[1] as { requestId?: unknown } | undefined;
    expect(command).toHaveBeenCalledWith("translation.cancel", {
      requestId: translationInput?.requestId,
    });
  });
});
