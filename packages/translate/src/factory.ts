// Translator factory: maps a TranslateConfig (persisted by the app) to a
// concrete Translator. The LLM engine needs an AIProvider; DeepL/Baidu need the
// platform HttpClient + the user's keys.
import type { AIProvider } from "@aurascholar/ai";
import { describeSafeError, type HttpClient } from "@aurascholar/platform";
import { LlmTranslator } from "./llm.js";
import { DeepLTranslator } from "./deepl.js";
import { BaiduTranslator } from "./baidu.js";
import type { Translator } from "./types.js";

export type TranslateEngine = "llm" | "deepl" | "baidu";

export interface TranslateConfig {
  engine: TranslateEngine;
  targetLang: string;
  deepl?: { apiKey: string; baseUrl?: string };
  baidu?: { appid: string; key: string };
}

export interface TranslatorDeps {
  http: HttpClient;
  /** Resolved lazily so the app can surface "configure AI first" itself. */
  provider?: AIProvider | null;
}

/**
 * Builds the configured translator, or returns a reason string when the engine
 * is missing its credentials/provider (the UI greys out + shows the reason).
 */
export function makeTranslator(
  config: TranslateConfig,
  deps: TranslatorDeps,
): { translator: Translator } | { error: string } {
  switch (config.engine) {
    case "llm":
      if (!deps.provider) return { error: "请先在设置页配置 AI 服务，或改用 DeepL / 百度引擎" };
      return { translator: new LlmTranslator(deps.provider) };
    case "deepl":
      if (!config.deepl?.apiKey) return { error: "请先在设置页填写 DeepL API Key" };
      try {
        return {
          translator: new DeepLTranslator({
            http: deps.http,
            apiKey: config.deepl.apiKey,
            baseUrl: config.deepl.baseUrl,
          }),
        };
      } catch (error) {
        return { error: describeSafeError(error) };
      }
    case "baidu":
      if (!config.baidu?.appid || !config.baidu?.key)
        return { error: "请先在设置页填写百度翻译 APPID 与密钥" };
      return {
        translator: new BaiduTranslator({
          http: deps.http,
          appid: config.baidu.appid,
          key: config.baidu.key,
        }),
      };
    default:
      return { error: `未知翻译引擎: ${config.engine}` };
  }
}
