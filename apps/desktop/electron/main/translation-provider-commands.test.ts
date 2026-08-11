import type { TranslateResult } from "@aurascholar/translate";
import { describe, expect, it, vi } from "vitest";
import type {
  TranslationProviderCommandRequest,
  TranslationProviderSettingsSnapshot,
} from "../translation-provider-command-contract";
import {
  executeTranslationProviderCommand,
  MainTranslationRequestCanceller,
  type TranslationProviderCommandDependencies,
} from "./translation-provider-commands";
import type { MainTranslationProviderSettings } from "./translation-provider-settings-store";

const SETTINGS: MainTranslationProviderSettings = {
  baidu: { apiKey: "baidu-main-secret", appid: "baidu-app" },
  deepl: { apiKey: "deepl-main-secret", baseUrl: "https://api.deepl.example/saved" },
  engine: "deepl",
  targetLang: "zh",
};

const SNAPSHOT: TranslationProviderSettingsSnapshot = {
  baidu: { appid: "baidu-app", hasApiKey: true },
  deepl: { baseUrl: "https://api.deepl.example/saved", hasApiKey: true },
  engine: "deepl",
  targetLang: "zh",
};

function dependencies(): TranslationProviderCommandDependencies {
  return {
    executor: {
      translate: vi.fn(async () => ({ engine: "deepl", text: "译文" })),
    },
    requests: new MainTranslationRequestCanceller(),
    settings: {
      adoptLegacy: vi.fn(async () => SNAPSHOT),
      getSnapshot: vi.fn(async () => SNAPSHOT),
      requireSettings: vi.fn(async () => SETTINGS),
      save: vi.fn(async () => SNAPSHOT),
    },
  };
}

function request<K extends TranslationProviderCommandRequest["name"]>(
  name: K,
  input: Extract<TranslationProviderCommandRequest, { name: K }>["input"],
): Extract<TranslationProviderCommandRequest, { name: K }> {
  return { input, name } as Extract<TranslationProviderCommandRequest, { name: K }>;
}

describe("main translation provider commands", () => {
  it("returns only a credential-free settings snapshot", async () => {
    const commandDependencies = dependencies();

    await expect(
      executeTranslationProviderCommand(
        request("translation.getSettings", {}),
        commandDependencies,
      ),
    ).resolves.toEqual(SNAPSHOT);
    expect(commandDependencies.settings.getSnapshot).toHaveBeenCalledOnce();
    expect(commandDependencies.executor.translate).not.toHaveBeenCalled();
  });

  it("uses only main-owned provider settings for a translation call", async () => {
    const commandDependencies = dependencies();

    await expect(
      executeTranslationProviderCommand(
        request("translation.translate", {
          domain: "材料学",
          requestId: "translate-main-owned-1",
          sourceLang: "en",
          text: " source text ",
        }),
        commandDependencies,
      ),
    ).resolves.toEqual({ engine: "deepl", text: "译文" });
    expect(commandDependencies.settings.requireSettings).toHaveBeenCalledOnce();
    expect(commandDependencies.executor.translate).toHaveBeenCalledWith(
      SETTINGS,
      { domain: "材料学", sourceLang: "en", text: "source text" },
      expect.any(AbortSignal),
    );
  });

  it("rejects endpoint, engine, and key injection before resolving a saved credential", async () => {
    const commandDependencies = dependencies();
    for (const input of [
      {
        baseUrl: "https://attacker.example/redirect",
        requestId: "translate-injection-1",
        text: "hello",
      },
      { engine: "baidu", requestId: "translate-injection-2", text: "hello" },
      { apiKey: "reuse-main-secret", requestId: "translate-injection-3", text: "hello" },
    ]) {
      await expect(
        executeTranslationProviderCommand(
          { input, name: "translation.translate" } as TranslationProviderCommandRequest,
          commandDependencies,
        ),
      ).rejects.toThrow("Invalid translation.translate input");
    }
    expect(commandDependencies.settings.requireSettings).not.toHaveBeenCalled();
    expect(commandDependencies.executor.translate).not.toHaveBeenCalled();
  });

  it("cancels only an active request and forwards its AbortSignal to the executor", async () => {
    const commandDependencies = dependencies();
    let observedSignal: AbortSignal | null = null;
    commandDependencies.executor.translate = async (_settings, _input, signal) =>
      new Promise<TranslateResult>((_, reject) => {
        observedSignal = signal;
        signal.addEventListener(
          "abort",
          () => {
            const error = new Error("Request aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });
    const pending = executeTranslationProviderCommand(
      request("translation.translate", { requestId: "translate-cancel-1", text: "hello" }),
      commandDependencies,
    );
    await vi.waitFor(() => expect(observedSignal).not.toBeNull());

    await expect(
      executeTranslationProviderCommand(
        request("translation.cancel", { requestId: "translate-cancel-1" }),
        commandDependencies,
      ),
    ).resolves.toEqual({ cancelled: true });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      executeTranslationProviderCommand(
        request("translation.cancel", { requestId: "translate-cancel-1" }),
        commandDependencies,
      ),
    ).resolves.toEqual({ cancelled: false });
  });

  it("bounds provider output and redacts provider errors before returning to renderer", async () => {
    const commandDependencies = dependencies();
    commandDependencies.executor.translate = vi.fn(async () => ({
      engine: "deepl",
      text: "x".repeat(2 * 1024 * 1024 + 1),
    }));
    await expect(
      executeTranslationProviderCommand(
        request("translation.translate", { requestId: "translate-limit-1", text: "hello" }),
        commandDependencies,
      ),
    ).rejects.toThrow("Translation result is too long");

    commandDependencies.executor.translate = vi.fn(async () => {
      throw new Error("provider failed: apiKey=main-secret-value");
    });
    await expect(
      executeTranslationProviderCommand(
        request("translation.translate", { requestId: "translate-redact-1", text: "hello" }),
        commandDependencies,
      ),
    ).rejects.toThrow("apiKey=[redacted]");
    await expect(
      executeTranslationProviderCommand(
        request("translation.translate", { requestId: "translate-redact-2", text: "hello" }),
        commandDependencies,
      ),
    ).rejects.not.toThrow("main-secret-value");
  });
});
