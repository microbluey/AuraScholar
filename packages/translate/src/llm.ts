// LLM-backed translator: the default engine. Wraps any AIProvider, so it reuses
// the user's already-configured BYOK model (OpenAI-compatible, etc.) with zero
// extra setup. Academic-tuned prompt: preserve terminology, keep structure,
// never add commentary or invent content.
import type { AIProvider } from "@aurascholar/ai";
import { langLabel, type TranslateInput, type TranslateOptions, type TranslateResult, type Translator } from "./types.js";

export class LlmTranslator implements Translator {
  readonly id = "llm";
  constructor(private readonly provider: AIProvider) {}

  async translate(input: TranslateInput, opts?: TranslateOptions): Promise<TranslateResult> {
    const text = input.text.trim();
    if (!text) return { text: "", engine: this.id };

    const result = await this.provider.generateText({
      messages: [
        { role: "system", content: buildSystemPrompt(input, opts) },
        { role: "user", content: text },
      ],
      temperature: 0.2,
      signal: opts?.signal,
    });
    return {
      text: result.text.trim(),
      engine: `${this.id}:${this.provider.model}`,
    };
  }
}

export function buildSystemPrompt(input: TranslateInput, opts?: TranslateOptions): string {
  const target = langLabel(input.targetLang);
  const source =
    input.sourceLang && input.sourceLang !== "auto"
      ? `from ${langLabel(input.sourceLang)} `
      : "";
  const domain = opts?.domain ? ` The text is from the field of ${opts.domain}; use that field's standard terminology.` : "";
  return [
    `You are a professional academic translator. Translate the user's text ${source}into ${target}.`,
    "Rules:",
    "- Preserve technical terms, named entities, math, and citations exactly.",
    "- Keep the original paragraph/line structure.",
    "- Produce natural, fluent academic prose in the target language.",
    "- Output ONLY the translation. No notes, no original text, no quotation marks around the whole output.",
    domain,
  ]
    .filter(Boolean)
    .join("\n");
}
