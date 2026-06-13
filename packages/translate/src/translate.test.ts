import { describe, expect, it } from "vitest";
import { StubHttpClient, jsonResponse } from "@aurascholar/platform";
import type { AIProvider } from "@aurascholar/ai";
import { md5 } from "./md5";
import { buildSystemPrompt } from "./llm";
import { makeTranslator } from "./factory";
import { DeepLTranslator } from "./deepl";
import { BaiduTranslator } from "./baidu";

function fakeProvider(reply: string): AIProvider {
  return {
    id: "fake",
    model: "fake-model",
    async generateText() {
      return { text: reply };
    },
    async generateObject() {
      throw new Error("not used");
    },
  };
}

describe("md5", () => {
  it("matches known vectors", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5("The quick brown fox jumps over the lazy dog")).toBe(
      "9e107d9d372bb6826bd81d3542a419d6",
    );
  });
});

describe("buildSystemPrompt", () => {
  it("names the target language and folds in a domain hint", () => {
    const p = buildSystemPrompt({ text: "x", targetLang: "zh" }, { domain: "材料学" });
    expect(p).toContain("中文");
    expect(p).toContain("材料学");
  });
});

describe("makeTranslator", () => {
  const http = new StubHttpClient();

  it("errors when LLM engine has no provider", () => {
    const r = makeTranslator({ engine: "llm", targetLang: "zh" }, { http, provider: null });
    expect("error" in r).toBe(true);
  });

  it("builds an LLM translator when a provider is present", async () => {
    const r = makeTranslator(
      { engine: "llm", targetLang: "zh" },
      { http, provider: fakeProvider("  你好  ") },
    );
    expect("translator" in r).toBe(true);
    if ("translator" in r) {
      const out = await r.translator.translate({ text: "hello", targetLang: "zh" });
      expect(out.text).toBe("你好");
      expect(out.engine).toContain("fake-model");
    }
  });

  it("errors when DeepL key missing", () => {
    const r = makeTranslator({ engine: "deepl", targetLang: "zh" }, { http });
    expect("error" in r).toBe(true);
  });

  it("errors when Baidu credentials missing", () => {
    const r = makeTranslator({ engine: "baidu", targetLang: "zh" }, { http });
    expect("error" in r).toBe(true);
  });
});

describe("DeepLTranslator", () => {
  it("posts and parses translations", async () => {
    const http = new StubHttpClient();
    http.on(/deepl\.com\/v2\/translate/, () =>
      jsonResponse(200, {
        translations: [{ text: "你好世界", detected_source_language: "EN" }],
      }),
    );
    const t = new DeepLTranslator({ http, apiKey: "k" });
    const out = await t.translate({ text: "hello world", targetLang: "zh" });
    expect(out.text).toBe("你好世界");
    expect(out.detectedSourceLang).toBe("en");
  });
});

describe("BaiduTranslator", () => {
  it("signs the request and joins multi-line results", async () => {
    const http = new StubHttpClient();
    http.on(/fanyi-api\.baidu\.com/, (req) => {
      const body = typeof req.body === "string" ? req.body : "";
      const params = new URLSearchParams(body);
      // Verify the documented signature: md5(appid + q + salt + key).
      const expected = md5("app1" + params.get("q") + params.get("salt") + "secret");
      expect(params.get("sign")).toBe(expected);
      return jsonResponse(200, { trans_result: [{ src: "a", dst: "甲" }, { src: "b", dst: "乙" }] });
    });
    const t = new BaiduTranslator({ http, appid: "app1", key: "secret", salt: "1234" });
    const out = await t.translate({ text: "a\nb", targetLang: "zh" });
    expect(out.text).toBe("甲\n乙");
  });
});
