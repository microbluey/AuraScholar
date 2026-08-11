import type { TranslateEngine } from "@aurascholar/translate";
import type { AiProviderKind } from "../../services/ai";
import type {
  AiSettingsSnapshot,
  SettingsUrlValidation,
  TranslateSettingsSnapshot,
} from "./settings-contracts";

const DEFAULT_TRANSLATE_TARGET_LANG = "zh";

export function translateEngineLabel(engine: TranslateEngine): string {
  if (engine === "deepl") return "DeepL";
  if (engine === "baidu") return "百度翻译";
  return "大模型";
}

export function urlSafeHost(value: string): string {
  const url = newURL(value);
  return url?.host || "WebDAV 已填写";
}

export function makeAiSettingsSnapshot(
  kind: AiProviderKind,
  baseUrl: string,
  model: string,
  apiKey: string,
  hasApiKey: boolean,
): AiSettingsSnapshot {
  return {
    kind,
    baseUrl: kind === "anthropic" ? baseUrl.trim() : baseUrl.trim().replace(/\/$/, ""),
    model: model.trim(),
    hasApiKey,
    apiKey: apiKey.trim(),
  };
}

export function makeTranslateSettingsSnapshot(
  engine: TranslateEngine,
  targetLang: string,
  deeplKey: string,
  baiduAppid: string,
  baiduKey: string,
  deeplBaseUrl = "",
  hasDeepLApiKey = Boolean(deeplKey.trim()),
  hasBaiduApiKey = Boolean(baiduKey.trim()),
): TranslateSettingsSnapshot {
  return {
    engine,
    targetLang: targetLang.trim() || DEFAULT_TRANSLATE_TARGET_LANG,
    hasBaiduApiKey,
    hasDeepLApiKey,
    deeplBaseUrl: deeplBaseUrl.trim(),
    deeplKey: deeplKey.trim(),
    baiduAppid: baiduAppid.trim(),
    baiduKey: baiduKey.trim(),
  };
}

export function validateTranslateConfig(settings: TranslateSettingsSnapshot): string | null {
  if (settings.engine === "deepl" && !settings.hasDeepLApiKey) {
    return "请填写 DeepL API Key，或切换为大模型翻译。";
  }
  if (settings.engine === "baidu" && (!settings.baiduAppid || !settings.hasBaiduApiKey)) {
    return "请填写百度翻译 APPID 和密钥，或切换为大模型翻译。";
  }
  return null;
}

export function normalizeAiBaseUrl(kind: AiProviderKind, value: string): SettingsUrlValidation {
  const raw = value.trim();
  if (!raw) {
    return kind === "anthropic"
      ? { ok: true, value: "" }
      : { message: "请填写 OpenAI 兼容 API 地址。", ok: false };
  }
  const url = newURL(raw);
  if (!url) {
    return {
      message: "AI API 地址格式不正确，请使用完整的 http:// 或 https:// 地址。",
      ok: false,
    };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      message: "AI API 地址仅支持 http:// 或 https://。",
      ok: false,
    };
  }
  if (url.username || url.password) {
    return {
      message: "AI API 地址不要包含密钥或账号，请填写在 API Key 字段中。",
      ok: false,
    };
  }
  if (url.search || url.hash) {
    return {
      message: "AI API 地址请填写接口根地址，不要包含查询参数或 # 片段。",
      ok: false,
    };
  }
  return { ok: true, value: url.toString().replace(/\/+$/, "") };
}

export function sameAiSettings(a: AiSettingsSnapshot, b: AiSettingsSnapshot): boolean {
  return (
    a.kind === b.kind &&
    a.baseUrl === b.baseUrl &&
    a.model === b.model &&
    a.hasApiKey === b.hasApiKey &&
    a.apiKey === b.apiKey
  );
}

export function sameTranslateSettings(
  a: TranslateSettingsSnapshot,
  b: TranslateSettingsSnapshot,
): boolean {
  return (
    a.engine === b.engine &&
    a.targetLang === b.targetLang &&
    a.hasDeepLApiKey === b.hasDeepLApiKey &&
    a.hasBaiduApiKey === b.hasBaiduApiKey &&
    a.deeplBaseUrl === b.deeplBaseUrl &&
    a.deeplKey === b.deeplKey &&
    a.baiduAppid === b.baiduAppid &&
    a.baiduKey === b.baiduKey
  );
}

function newURL(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
