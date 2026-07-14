// OpenAI-compatible chat completions client. Goes through the platform
// HttpClient so desktop bypasses CORS and tests can stub responses. Covers
// OpenAI, DeepSeek, Moonshot, Ollama, vLLM, and any relay endpoint.
import { redactSensitiveText, type HttpClient } from "@aurascholar/platform";
import type { z } from "zod";
import { normalizeHttpBaseUrl } from "./base-url.js";
import type { AIProvider, GenerateOptions, GenerateResult } from "./provider.js";

export interface OpenAICompatibleOptions {
  http: HttpClient;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id = "openai-compatible";
  readonly model: string;
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(opts: OpenAICompatibleOptions) {
    this.http = opts.http;
    this.baseUrl = normalizeHttpBaseUrl("AI API", opts.baseUrl);
    this.model = opts.model;
    this.apiKey = opts.apiKey;
  }

  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    const res = await this.http.request({
      url: `${this.baseUrl}/chat/completions`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: options.messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      }),
      timeoutMs: 120_000,
    });
    if (res.status !== 200) {
      throw new Error(`AI request failed (${res.status}): ${safeResponseSnippet(res.body, 500)}`);
    }
    const data = JSON.parse(decode(res.body));
    const text: string = data.choices?.[0]?.message?.content ?? "";
    return {
      text,
      usage: data.usage
        ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
        : undefined,
    };
  }

  async generateObject<T>(options: GenerateOptions & { schema: z.ZodType<T> }): Promise<T> {
    const { schema, ...rest } = options;
    const jsonInstruction: GenerateOptions = {
      ...rest,
      messages: [
        ...rest.messages,
        { role: "system", content: "Respond with a single valid JSON object only, no prose, no markdown fences." },
      ],
    };
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.generateText(jsonInstruction);
      try {
        const parsed = JSON.parse(extractJson(result.text));
        return schema.parse(parsed);
      } catch (e) {
        lastError = e;
      }
    }
    throw new Error(
      `AI structured output failed validation after retry: ${redactSensitiveText(String(lastError))}`,
    );
  }
}

function decode(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}

function safeResponseSnippet(body: Uint8Array, limit: number): string {
  return redactSensitiveText(decode(body)).slice(0, limit);
}

/** Strips markdown fences and leading/trailing prose around a JSON object. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1]!.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
}
