// AIProvider is one of the two business-model cornerstone interfaces:
// every AI feature in the app talks to this interface and nothing else.
// Implementations: openai-compatible (BYOK — covers OpenAI, DeepSeek, Ollama,
// any relay), anthropic (BYOK), official (paid managed service, same shape).
import type { z } from "zod";

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AIProvider {
  readonly id: string;
  /** Model identifier as configured by the user, e.g. "gpt-4o" or "claude-fable-5". */
  readonly model: string;
  generateText(options: GenerateOptions): Promise<GenerateResult>;
  /** Structured output: prompts for JSON, validates against the schema, retries once on mismatch. */
  generateObject<T>(options: GenerateOptions & { schema: z.ZodType<T> }): Promise<T>;
}

export interface AIProviderConfig {
  /** "openai-compatible" | "anthropic" | "official" */
  kind: string;
  /** Base URL of the API endpoint (user-configurable for BYOK). */
  baseUrl: string;
  model: string;
  /** Secret-store key under which the API key is stored — never the key itself. */
  apiKeySecret: string;
}

/** Rough token estimate (≈4 chars/token for Latin, ≈1.7 for CJK) shown to BYOK users before a call. */
export function estimateTokens(text: string): number {
  let cjk = 0;
  for (const ch of text) if (/[一-鿿぀-ヿ가-힯]/.test(ch)) cjk++;
  const latin = text.length - cjk;
  return Math.ceil(latin / 4 + cjk / 1.7);
}
