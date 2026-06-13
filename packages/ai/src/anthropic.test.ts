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
    http.on(/anthropic/, () => jsonResponse(401, { error: "bad key" }));
    const p = new AnthropicProvider({ http, model: "claude-x", apiKey: "bad" });
    await expect(p.generateText({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(
      /401/,
    );
  });
});
