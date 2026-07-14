import { describe, expect, it } from "vitest";
import { StubHttpClient, jsonResponse } from "@aurascholar/platform";
import { OpenAICompatibleProvider } from "./openai-compatible";

describe("OpenAICompatibleProvider", () => {
  it("normalizes base URLs before appending the chat completions path", async () => {
    const http = new StubHttpClient();
    http.on("https://api.example.com/v1/chat/completions", (req) => {
      expect(req.headers?.authorization).toBe("Bearer k");
      return jsonResponse(200, {
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      });
    });
    const provider = new OpenAICompatibleProvider({
      http,
      baseUrl: "https://api.example.com/v1///",
      model: "model-x",
      apiKey: "k",
    });

    const out = await provider.generateText({ messages: [{ role: "user", content: "hi" }] });

    expect(out.text).toBe("hello");
    expect(out.usage).toEqual({ inputTokens: 2, outputTokens: 1 });
    expect(http.requests[0]?.url).toBe("https://api.example.com/v1/chat/completions");
  });

  it("rejects unsafe base URLs", () => {
    const http = new StubHttpClient();
    const make = (baseUrl: string) =>
      new OpenAICompatibleProvider({
        http,
        baseUrl,
        model: "model-x",
        apiKey: "k",
      });
    expect(() => make("file:///tmp/model")).toThrow("仅支持 http:// 或 https://");
    expect(() => make("https://sk-secret@api.example.com/v1")).toThrow("不要包含密钥或账号");
    expect(() => make("https://api.example.com/v1?api_key=inline")).toThrow("不要包含查询参数");
  });

  it("redacts provider error bodies before throwing", async () => {
    const http = new StubHttpClient();
    http.on(/chat\/completions/, () =>
      jsonResponse(401, {
        error: {
          message:
            "upstream rejected Authorization: Bearer sk-live-openai and apiKey=provider-secret",
        },
      }),
    );
    const provider = new OpenAICompatibleProvider({
      http,
      baseUrl: "https://api.example.com/v1",
      model: "model-x",
      apiKey: "local-key",
    });

    await expect(provider.generateText({ messages: [{ role: "user", content: "hi" }] })).rejects
      .toThrow(/AI request failed \(401\).*Authorization: \[redacted\].*apiKey=\[redacted\]/);
    await expect(provider.generateText({ messages: [{ role: "user", content: "hi" }] })).rejects
      .not.toThrow(/sk-live-openai|provider-secret/);
  });
});
