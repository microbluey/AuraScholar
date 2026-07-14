import { describe, expect, it } from "vitest";
import { z } from "zod";
import { StubHttpClient, jsonResponse } from "@aurascholar/platform";
import { AnthropicProvider } from "./anthropic";

describe("AnthropicProvider", () => {
  it("sends system as a top-level field and parses content blocks", async () => {
    const http = new StubHttpClient();
    http.on(/api\.anthropic\.com\/v1\/messages/, (req) => {
      const body = JSON.parse(typeof req.body === "string" ? req.body : "{}");
      // system folded out of messages; auth + version headers present.
      expect(body.system).toBe("You are helpful.");
      expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
      expect(req.headers?.["x-api-key"]).toBe("k");
      expect(req.headers?.["anthropic-version"]).toBeTruthy();
      return jsonResponse(200, {
        content: [{ type: "text", text: "hello" }],
        usage: { input_tokens: 3, output_tokens: 1 },
      });
    });
    const p = new AnthropicProvider({ http, model: "claude-x", apiKey: "k" });
    const out = await p.generateText({
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "hi" },
      ],
    });
    expect(out.text).toBe("hello");
    expect(out.usage).toEqual({ inputTokens: 3, outputTokens: 1 });
  });

  it("concatenates multiple text blocks", async () => {
    const http = new StubHttpClient();
    http.on(/anthropic/, () =>
      jsonResponse(200, {
        content: [
          { type: "text", text: "a" },
          { type: "tool_use" },
          { type: "text", text: "b" },
        ],
      }),
    );
    const p = new AnthropicProvider({ http, model: "claude-x", apiKey: "k" });
    const out = await p.generateText({ messages: [{ role: "user", content: "x" }] });
    expect(out.text).toBe("ab");
  });

  it("normalizes custom base URLs before appending the messages path", async () => {
    const http = new StubHttpClient();
    http.on("https://anthropic.example/custom/v1/messages", () =>
      jsonResponse(200, { content: [{ type: "text", text: "custom" }] }),
    );
    const p = new AnthropicProvider({
      http,
      baseUrl: "https://anthropic.example/custom///",
      model: "claude-x",
      apiKey: "k",
    });
    const out = await p.generateText({ messages: [{ role: "user", content: "x" }] });
    expect(out.text).toBe("custom");
    expect(http.requests[0]?.url).toBe("https://anthropic.example/custom/v1/messages");
  });

  it("rejects unsafe custom base URLs", () => {
    const http = new StubHttpClient();
    const make = (baseUrl: string) =>
      new AnthropicProvider({
        http,
        baseUrl,
        model: "claude-x",
        apiKey: "k",
      });
    expect(() => make("file:///tmp/anthropic")).toThrow("仅支持 http:// 或 https://");
    expect(() => make("https://sk-secret@anthropic.example")).toThrow("不要包含密钥或账号");
    expect(() => make("https://anthropic.example?api_key=inline")).toThrow("不要包含查询参数");
  });

  it("generateObject parses JSON and validates against schema", async () => {
    const http = new StubHttpClient();
    http.on(/anthropic/, () =>
      jsonResponse(200, { content: [{ type: "text", text: '```json\n{"n": 42}\n```' }] }),
    );
    const p = new AnthropicProvider({ http, model: "claude-x", apiKey: "k" });
    const out = await p.generateObject({
      messages: [{ role: "user", content: "give me n" }],
      schema: z.object({ n: z.number() }),
    });
    expect(out).toEqual({ n: 42 });
  });

  it("throws on non-200", async () => {
    const http = new StubHttpClient();
    http.on(/anthropic/, () =>
      jsonResponse(401, {
        error: "bad key",
        client_secret: "anthropic-secret",
        authorization: "Bearer sk-ant-secret",
      }),
    );
    const p = new AnthropicProvider({ http, model: "claude-x", apiKey: "bad" });
    await expect(p.generateText({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(
      /401.*client_secret": "\[redacted\]".*authorization": "\[redacted\]"/,
    );
    await expect(p.generateText({ messages: [{ role: "user", content: "x" }] })).rejects.not.toThrow(
      /anthropic-secret|sk-ant-secret/,
    );
  });
});
