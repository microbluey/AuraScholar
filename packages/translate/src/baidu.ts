// Baidu Translate (通用翻译 API). Signed requests: sign = md5(appid+q+salt+key).
// Goes through the platform HttpClient. Baidu uses its own language codes
// (zh, en, jp, kor, fra, de, auto) — mapped here.
import type { HttpClient } from "@aurascholar/platform";
import { md5 } from "./md5";
import type { TranslateInput, TranslateOptions, TranslateResult, Translator } from "./types";

export interface BaiduOptions {
  http: HttpClient;
  appid: string;
  key: string;
  /** Deterministic salt for tests; otherwise a per-call value is supplied. */
  salt?: string;
}

const ENDPOINT = "https://fanyi-api.baidu.com/api/trans/vip/translate";

const LANG_MAP: Record<string, string> = {
  zh: "zh",
  en: "en",
  ja: "jp",
  ko: "kor",
  fr: "fra",
  de: "de",
  auto: "auto",
};

export class BaiduTranslator implements Translator {
  readonly id = "baidu";
  private readonly http: HttpClient;
  private readonly appid: string;
  private readonly key: string;
  private readonly fixedSalt?: string;

  constructor(opts: BaiduOptions) {
    this.http = opts.http;
    this.appid = opts.appid;
    this.key = opts.key;
    this.fixedSalt = opts.salt;
  }

  async translate(input: TranslateInput, _opts?: TranslateOptions): Promise<TranslateResult> {
    const q = input.text.trim();
    if (!q) return { text: "", engine: this.id };

    const salt = this.fixedSalt ?? saltFrom(q);
    const sign = md5(this.appid + q + salt + this.key);
    const form = new URLSearchParams({
      q,
      from: toBaiduLang(input.sourceLang ?? "auto"),
      to: toBaiduLang(input.targetLang),
      appid: this.appid,
      salt,
      sign,
    });

    const res = await this.http.request({
      url: ENDPOINT,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      timeoutMs: 60_000,
    });
    if (res.status !== 200) {
      throw new Error(`百度翻译失败 (${res.status})`);
    }
    const data = JSON.parse(decode(res.body)) as {
      error_code?: string;
      error_msg?: string;
      trans_result?: Array<{ src: string; dst: string }>;
    };
    if (data.error_code) {
      throw new Error(`百度翻译错误 ${data.error_code}: ${data.error_msg ?? ""}`);
    }
    // Baidu splits on newlines into separate segments; rejoin in order.
    const text = (data.trans_result ?? []).map((r) => r.dst).join("\n");
    return { text, engine: this.id };
  }
}

function toBaiduLang(code: string): string {
  return LANG_MAP[code] ?? code;
}

// Derive a stable-but-varying salt without Math.random (unavailable in some
// sandboxes and not needed — Baidu only requires salt to vary per request).
function saltFrom(q: string): string {
  let h = 0;
  for (let i = 0; i < q.length; i++) h = (h * 31 + q.charCodeAt(i)) & 0x7fffffff;
  return String(h);
}

function decode(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}
