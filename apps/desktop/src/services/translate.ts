// Translation service for the desktop app: BYOK-style config in localStorage
// (mirrors ai.ts; keychain migration tracked for before v0.2), and a helper
// that resolves the configured engine into a Translator. The LLM engine reuses
// the AI provider, so the default path needs no extra setup.
import { makeTranslator, type TranslateConfig, type Translator } from "@aurascholar/translate";
import { tauriHttp } from "./tauri-platform";
import { makeProvider } from "./ai";

const SETTINGS_KEY = "translate-settings";

const DEFAULT_CONFIG: TranslateConfig = {
  engine: "llm",
  targetLang: "zh",
};

export function loadTranslateConfig(): TranslateConfig {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as TranslateConfig) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveTranslateConfig(config: TranslateConfig): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(config));
}

/** Resolves the active translator, or an error string the UI can surface. */
export function resolveTranslator(): { translator: Translator } | { error: string } {
  const config = loadTranslateConfig();
  return makeTranslator(config, { http: tauriHttp, provider: makeProvider() });
}
