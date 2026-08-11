import { Buffer } from "node:buffer";
import {
  BaiduTranslator,
  DeepLTranslator,
  LlmTranslator,
  type TranslateResult,
} from "@aurascholar/translate";
import { toSafeError } from "@aurascholar/platform";
import type {
  TranslationProviderCommandOutput,
  TranslationProviderCommandRequest,
  TranslateWithConfiguredProviderCommandInput,
} from "../translation-provider-command-contract";
import { createConfiguredAiProvider } from "./ai-provider";
import {
  parseTranslationProviderAdoptLegacySettingsInput,
  parseTranslationProviderCancelInput,
  parseTranslationProviderGetSettingsInput,
  parseTranslationProviderSaveSettingsInput,
  parseTranslationProviderTranslateInput,
} from "./translation-provider-command-input";
import { mainTranslationProviderHttp } from "./translation-provider-http";
import {
  mainTranslationProviderSettingsStore,
  type MainTranslationProviderSettings,
  type MainTranslationProviderSettingsStore,
} from "./translation-provider-settings-store";

const MAX_TRANSLATION_ENGINE_LENGTH = 1_024;
const MAX_TRANSLATION_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_TRANSLATION_RESULT_LENGTH = 2 * 1024 * 1024;
const MAX_TRANSLATION_RESULT_BYTES = 4 * 1024 * 1024;
const MAX_TRANSLATION_SOURCE_LANGUAGE_LENGTH = 64;

export interface MainTranslationProviderExecutor {
  translate(
    settings: MainTranslationProviderSettings,
    input: Omit<TranslateWithConfiguredProviderCommandInput, "requestId">,
    signal: AbortSignal,
  ): Promise<TranslateResult>;
}

export interface TranslationRequestCanceller {
  begin(requestId: string): AbortSignal;
  cancel(requestId: string): boolean;
  finish(requestId: string): void;
}

export interface TranslationProviderCommandDependencies {
  executor: MainTranslationProviderExecutor;
  requests: TranslationRequestCanceller;
  settings: Pick<
    MainTranslationProviderSettingsStore,
    "adoptLegacy" | "getSnapshot" | "requireSettings" | "save"
  >;
}

/**
 * Dedicated command owner for translator settings and provider execution. The
 * translate DTO deliberately contains only content and cancellation metadata;
 * its engine, endpoint, account id, and credentials all resolve in main.
 */
export async function executeTranslationProviderCommand(
  request: TranslationProviderCommandRequest,
  dependencies: TranslationProviderCommandDependencies = defaultDependencies,
): Promise<TranslationProviderCommandOutput<TranslationProviderCommandRequest["name"]>> {
  switch (request.name) {
    case "translation.getSettings":
      parseTranslationProviderGetSettingsInput(request.input);
      return dependencies.settings.getSnapshot();
    case "translation.saveSettings":
      return dependencies.settings.save(parseTranslationProviderSaveSettingsInput(request.input));
    case "translation.adoptLegacySettings":
      return dependencies.settings.adoptLegacy(
        parseTranslationProviderAdoptLegacySettingsInput(request.input),
      );
    case "translation.cancel": {
      const input = parseTranslationProviderCancelInput(request.input);
      return { cancelled: dependencies.requests.cancel(input.requestId) };
    }
    case "translation.translate": {
      const input = parseTranslationProviderTranslateInput(request.input);
      const signal = dependencies.requests.begin(input.requestId);
      try {
        throwIfAborted(signal);
        const settings = await dependencies.settings.requireSettings();
        throwIfAborted(signal);
        const result = await dependencies.executor.translate(
          settings,
          {
            ...(input.domain ? { domain: input.domain } : {}),
            ...(input.sourceLang ? { sourceLang: input.sourceLang } : {}),
            text: input.text,
          },
          signal,
        );
        return requireBoundedTranslationOutput(result);
      } catch (error) {
        throw toSafeError(error);
      } finally {
        dependencies.requests.finish(input.requestId);
      }
    }
  }
}

/** Tracks only active request IDs; completed requests cannot be cancelled later. */
export class MainTranslationRequestCanceller implements TranslationRequestCanceller {
  private readonly controllers = new Map<string, AbortController>();

  begin(requestId: string): AbortSignal {
    if (this.controllers.has(requestId)) {
      throw new Error("Translation request is already active");
    }
    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    return controller.signal;
  }

  cancel(requestId: string): boolean {
    const controller = this.controllers.get(requestId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  finish(requestId: string): void {
    this.controllers.delete(requestId);
  }
}

const defaultDependencies: TranslationProviderCommandDependencies = {
  executor: { translate: translateWithMainOwnedProvider },
  requests: new MainTranslationRequestCanceller(),
  settings: mainTranslationProviderSettingsStore,
};

async function translateWithMainOwnedProvider(
  settings: MainTranslationProviderSettings,
  input: Omit<TranslateWithConfiguredProviderCommandInput, "requestId">,
  signal: AbortSignal,
): Promise<TranslateResult> {
  const translateInput = {
    ...(input.sourceLang ? { sourceLang: input.sourceLang } : {}),
    targetLang: settings.targetLang,
    text: input.text,
  };
  const options = {
    ...(input.domain ? { domain: input.domain } : {}),
    signal,
  };
  switch (settings.engine) {
    case "llm": {
      const provider = await createConfiguredAiProvider();
      return new LlmTranslator(provider).translate(translateInput, options);
    }
    case "deepl":
      return new DeepLTranslator({
        apiKey: settings.deepl.apiKey,
        baseUrl: settings.deepl.baseUrl,
        http: mainTranslationProviderHttp,
      }).translate(translateInput, options);
    case "baidu":
      return new BaiduTranslator({
        appid: settings.baidu.appid,
        http: mainTranslationProviderHttp,
        key: settings.baidu.apiKey,
      }).translate(translateInput, options);
  }
}

function requireBoundedTranslationOutput(result: TranslateResult) {
  const text = requireOutputText(
    result.text,
    "Translation result",
    MAX_TRANSLATION_RESULT_LENGTH,
    MAX_TRANSLATION_RESULT_BYTES,
  );
  const engine = requireOutputText(
    result.engine,
    "Translation engine",
    MAX_TRANSLATION_ENGINE_LENGTH,
    MAX_TRANSLATION_ENGINE_LENGTH * 4,
  );
  const detectedSourceLang = result.detectedSourceLang
    ? requireOutputText(
        result.detectedSourceLang,
        "Detected translation source language",
        MAX_TRANSLATION_SOURCE_LANGUAGE_LENGTH,
        MAX_TRANSLATION_SOURCE_LANGUAGE_LENGTH * 4,
      )
    : undefined;
  const output = {
    ...(detectedSourceLang ? { detectedSourceLang } : {}),
    engine,
    text,
  };
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_TRANSLATION_OUTPUT_BYTES) {
    throw new Error(`Translation output is limited to ${MAX_TRANSLATION_OUTPUT_BYTES} bytes`);
  }
  return output;
}

function requireOutputText(
  value: unknown,
  label: string,
  maximumLength: number,
  maximumBytes: number,
): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  if (value.length > maximumLength || Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new Error(`${label} is too long`);
  }
  return value;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("Request aborted");
  error.name = "AbortError";
  throw error;
}
