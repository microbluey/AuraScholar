// DeepL translator. Goes through the platform HttpClient so desktop bypasses
// CORS and tests can stub. Supports both the free (api-free.deepl.com) and pro
// (api.deepl.com) endpoints — the caller picks the base URL.
import { redactSensitiveText, type HttpClient } from "@aurascholar/platform";
import type { TranslateInput, TranslateOptions, TranslateResult, Translator } from "./types.js";

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
    this.baseUrl = normalizeDeepLBaseUrl(opts.baseUrl);
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
      throw new Error(`DeepL 翻译失败 (${res.status}): ${safeResponseSnippet(res.body, 300)}`);
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

function safeResponseSnippet(body: Uint8Array, limit: number): string {
  return redactSensitiveText(decode(body)).slice(0, limit);
}

function normalizeDeepLBaseUrl(value?: string): string {
  const raw = (value || DEFAULT_BASE).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DeepL API 地址格式不正确，请使用完整的 http:// 或 https:// 地址。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("DeepL API 地址仅支持 http:// 或 https://。");
  }
  if (url.username || url.password) {
    throw new Error("DeepL API 地址不要包含密钥或账号，请填写在 API Key 字段中。");
  }
  if (url.search || url.hash) {
    throw new Error("DeepL API 地址请填写接口根地址，不要包含查询参数或 # 片段。");
  }
  return url.toString().replace(/\/+$/, "");
}
