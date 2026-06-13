// Translation is one of the reader's two highest-frequency actions (alongside
// annotation). Every translation feature talks to the Translator interface and
// nothing else, mirroring the AIProvider design. Implementations:
//   llm    — wraps an AIProvider (default; reuses the user's BYOK model)
//   deepl  — DeepL API (user-supplied key)
//   baidu  — Baidu Translate API (user-supplied appid + key)

/** ISO-639-1 code or "auto" for source detection. */
export type LangCode = string;

export interface TranslateInput {
  text: string;
  /** Source language; "auto" or omitted = let the engine detect. */
  sourceLang?: LangCode;
  /** Target language, e.g. "zh" | "en". */
  targetLang: LangCode;
}

export interface TranslateResult {
  text: string;
  /** Which engine produced this — surfaced in the UI. */
  engine: string;
  /** Detected source language, when the engine reports it. */
  detectedSourceLang?: LangCode;
}

export interface TranslateOptions {
  signal?: AbortSignal;
  /**
   * Domain hint for terminology fidelity, e.g. "计算机科学" / "材料学".
   * LLM engines fold it into the prompt; others ignore it.
   */
  domain?: string;
}

export interface Translator {
  readonly id: string;
  translate(input: TranslateInput, opts?: TranslateOptions): Promise<TranslateResult>;
}

export const TARGET_LANGS: Array<{ code: LangCode; label: string }> = [
  { code: "zh", label: "中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
];

export function langLabel(code: LangCode): string {
  return TARGET_LANGS.find((l) => l.code === code)?.label ?? code;
}
