import { describe, expect, it } from "vitest";
import {
  MAX_TRANSLATION_TEXT_BYTES,
  parseTranslationProviderAdoptLegacySettingsInput,
  parseTranslationProviderCancelInput,
  parseTranslationProviderSaveSettingsInput,
  parseTranslationProviderTranslateInput,
} from "./translation-provider-command-input";

describe("translation provider command input", () => {
  it("accepts only content and cancellation metadata for a translation request", () => {
    expect(
      parseTranslationProviderTranslateInput({
        domain: "计算机科学",
        requestId: "translate-1",
        sourceLang: "en",
        text: "  hello\nworld  ",
      }),
    ).toEqual({
      domain: "计算机科学",
      requestId: "translate-1",
      sourceLang: "en",
      text: "hello\nworld",
    });

    for (const unsafe of [
      {
        requestId: "translate-1",
        text: "hello",
        baseUrl: "https://attacker.example",
      },
      { requestId: "translate-1", text: "hello", apiKey: "stolen-key" },
      { requestId: "translate-1", text: "hello", engine: "deepl" },
      { requestId: "translate-1", text: "hello", targetLang: "fr" },
    ]) {
      expect(() => parseTranslationProviderTranslateInput(unsafe)).toThrow(
        "Invalid translation.translate input",
      );
    }
  });

  it("rejects malformed ids and oversized content before it reaches a provider", () => {
    expect(() =>
      parseTranslationProviderTranslateInput({ requestId: "with space", text: "hello" }),
    ).toThrow("Translation request id is invalid");
    expect(() =>
      parseTranslationProviderTranslateInput({ requestId: "request-1", text: "   " }),
    ).toThrow("Translation text is required");
    expect(() =>
      parseTranslationProviderTranslateInput({
        requestId: "request-1",
        text: "界".repeat(Math.ceil(MAX_TRANSLATION_TEXT_BYTES / 3) + 1),
      }),
    ).toThrow("Translation text is too long");
    expect(() =>
      parseTranslationProviderCancelInput({ requestId: "request-1", other: true }),
    ).toThrow("Invalid translation.cancel input");
  });

  it("normalizes a provider target and refuses URL credentials, queries, and controls", () => {
    expect(
      parseTranslationProviderSaveSettingsInput({
        baidu: { apiKey: " baidu-key ", appid: " app-1 " },
        deepl: { apiKey: " deepl-key ", baseUrl: "https://api.deepl.example/custom///" },
        engine: "deepl",
        targetLang: " zh ",
      }),
    ).toEqual({
      baidu: { apiKey: "baidu-key", appid: "app-1" },
      deepl: { apiKey: "deepl-key", baseUrl: "https://api.deepl.example/custom" },
      engine: "deepl",
      targetLang: "zh",
    });

    for (const baseUrl of [
      "https://key@api.deepl.example",
      "https://api.deepl.example?token=leak",
      "file:///tmp/provider",
      "https://api.deepl.example/\nnext",
    ]) {
      expect(() =>
        parseTranslationProviderSaveSettingsInput({
          baidu: {},
          deepl: { baseUrl },
          engine: "llm",
          targetLang: "zh",
        }),
      ).toThrow();
    }
  });

  it("allows blank legacy keys as absent so the migration can fail closed without losing config", () => {
    expect(
      parseTranslationProviderAdoptLegacySettingsInput({
        baidu: { appid: "", apiKey: "" },
        deepl: { apiKey: "", baseUrl: "https://api.deepl.example/legacy" },
        engine: "deepl",
        targetLang: "zh",
      }),
    ).toEqual({
      baidu: {},
      deepl: { baseUrl: "https://api.deepl.example/legacy" },
      engine: "deepl",
      targetLang: "zh",
    });
  });
});
