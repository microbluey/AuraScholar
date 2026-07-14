// Anthropic Messages API client. Mirrors OpenAICompatibleProvider but adapts to
// Anthropic's shape: system prompt is a top-level field (not a message), auth is
// x-api-key + anthropic-version headers, and the response content is a block
// array. Goes through the platform HttpClient so desktop bypasses CORS and tests
// can stub responses.
import { redactSensitiveText, type HttpClient } from "@aurascholar/platform";
import type { z } from "zod";
import { normalizeHttpBaseUrl } from "./base-url.js";
import type { AIProvider, AIMessage, GenerateOptions, GenerateResult } from "./provider.js";

export interface AnthropicOptions {
  http: HttpClient;
  /** Defaults to https://api.anthropic.com. */
  baseUrl?: string;
  model: string;
  apiKey: string;
  /** Defaults to a recent stable version. */
  anthropicVersion?: string;
}

const DEFAULT_BASE = "https://api.anthropic.com";
const DEFAULT_VERSION = "2023-06-01";

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  readonly model: string;
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly version: string;

  constructor(opts: AnthropicOptions) {
    this.http = opts.http;
    this.baseUrl = normalizeHttpBaseUrl("Anthropic API", opts.baseUrl, DEFAULT_BASE);
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.version = opts.anthropicVersion || DEFAULT_VERSION;
  }

  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    const { system, messages } = splitSystem(options.messages);
    const res = await this.http.request({
      url: `${this.baseUrl}/v1/messages`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": this.version,
      },
      body: JSON.stringify({
        model: this.model,
        system: system || undefined,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options.temperature,
        // Anthropic requires max_tokens; default generously when unset.
        max_tokens: options.maxTokens ?? 4096,
      }),
      timeoutMs: 120_000,
    });
    if (res.status !== 200) {
      throw new Error(
        `Anthropic request failed (${res.status}): ${safeResponseSnippet(res.body, 500)}`,
      );
    }
    const data = JSON.parse(decode(res.body));
    // content is an array of blocks; concatenate the text blocks.
    const text: string = Array.isArray(data.content)
      ? data.content
          .filter((b: { type?: string }) => b.type === "text")
          .map((b: { text?: string }) => b.text ?? "")
          .join("")
      : "";
    return {
      text,
      usage: data.usage
        ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
        : undefined,
    };
  }

  async generateObject<T>(options: GenerateOptions & { schema: z.ZodType<T> }): Promise<T> {
    const { schema, ...rest } = options;
    const jsonOptions: GenerateOptions = {
      ...rest,
      messages: [
        ...rest.messages,
        {
          role: "system",
          content: "Respond with a single valid JSON object only, no prose, no markdown fences.",
        },
      ],
    };
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.generateText(jsonOptions);
      try {
        return schema.parse(JSON.parse(extractJson(result.text)));
      } catch (e) {
        lastError = e;
      }
    }
    throw new Error(
      `AI structured output failed validation after retry: ${redactSensitiveText(String(lastError))}`,
    );
  }
}

/**
 * Anthropic takes the system prompt as a top-level field. Our AIMessage list
 * may carry one or more system messages (flashcards/translate append a JSON
 * instruction) — fold them all into one system string and keep the rest.
 */
function splitSystem(messages: AIMessage[]): { system: string; messages: AIMessage[] } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  return { system, messages: rest };
}

function decode(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}

function safeResponseSnippet(body: Uint8Array, limit: number): string {
  return redactSensitiveText(decode(body)).slice(0, limit);
}

/** Strips markdown fences and surrounding prose around a JSON object. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1]!.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
}
