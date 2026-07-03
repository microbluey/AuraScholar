// DeepL translator. Goes through the platform HttpClient so desktop bypasses
// CORS and tests can stub. Supports both the free (api-free.deepl.com) and pro
// (api.deepl.com) endpoints — the caller picks the base URL.
import type { HttpClient } from "@aurascholar/platform";
import type { TranslateInput, TranslateOptions, TranslateResult, Translator } from "./types";

export interface DeepLOptions {
  http: HttpClient;
  apiKey: string;
  /** Defaults to the free endpoint. */
  baseUrl?: string;
}

const DEFAULT_BASE = "https://api-free.deepl.com";

export class DeepLTranslator implements Translator {
  readonly id = "deepl";
  private readonly http: HttpClient;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: DeepLOptions) {
    this.http = opts.http;
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
  }

  async translate(input: TranslateInput, _opts?: TranslateOptions): Promise<TranslateResult> {
    const text = input.text.trim();
    if (!text) return { text: "", engine: this.id };

    const form = new URLSearchParams();
    form.set("text", text);
    form.set("target_lang", toDeepLLang(input.targetLang));
    if (input.sourceLang && input.sourceLang !== "auto") {
      form.set("source_lang", toDeepLLang(input.sourceLang));
    }

    const res = await this.http.request({
      url: `${this.baseUrl}/v2/translate`,
      method: "POST",
      headers: {
        authorization: `DeepL-Auth-Key ${this.apiKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      timeoutMs: 60_000,
    });
    if (res.status !== 200) {
      throw new Error(`DeepL 翻译失败 (${res.status}): ${decode(res.body).slice(0, 300)}`);
    }
    const data = JSON.parse(decode(res.body)) as {
      translations?: Array<{ text: string; detected_source_language?: string }>;
    };
    const t = data.translations?.[0];
    return {
      text: t?.text ?? "",
      engine: this.id,
      detectedSourceLang: t?.detected_source_language?.toLowerCase(),
    };
  }
}

/** DeepL wants uppercase ISO codes (EN, ZH, DE, ...). */
function toDeepLLang(code: string): string {
  return code.toUpperCase();
}

function decode(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}
