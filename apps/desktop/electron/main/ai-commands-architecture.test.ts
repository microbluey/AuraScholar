import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("main-owned AI provider architecture", () => {
  it("keeps AI provider configuration, egress, and commits outside renderer", () => {
    const contract = source("electron/ai-command-contract.ts");
    const commands = source("electron/main/ai-commands.ts");
    const commandInput = source("electron/main/ai-command-input.ts");
    const facade = source("src/services/ai-data.ts");
    const ai = source("src/services/ai.ts");
    const canvas = source("src/services/canvas-ai.ts");
    const provider = source("electron/main/ai-provider.ts");
    const settings = source("electron/main/ai-settings-store.ts");
    const transport = source("electron/main/main-ai-http.ts");
    const flashcardInput = contract.match(
      /export interface AiGenerateFlashcardsCommandInput \{([\s\S]*?)\n\}/,
    )?.[1];
    const canvasInput = contract.match(
      /export interface AiSynthesizeCanvasCommandInput \{([\s\S]*?)\n\}/,
    )?.[1];
    const testInput = contract.match(
      /export interface AiTestProviderCommandInput \{([\s\S]*?)\n\}/,
    )?.[1];

    expect(contract).toContain('"ai.generateFlashcards"');
    expect(contract).toContain('"ai.synthesizeCanvas"');
    expect(contract).toContain('"ai.testProvider"');
    expect(contract).toContain('"ai.saveSettings"');
    expect(contract).toContain('"ai.cancelRun"');
    expect(contract).toContain('"ai.getFlashcardTarget"');
    expect(contract).toContain('"ai.commitFlashcardGeneration"');
    expect(contract).toContain('"ai.recordFlashcardFailure"');
    expect(flashcardInput).toBeDefined();
    expect(flashcardInput).not.toContain("baseUrl");
    expect(flashcardInput).not.toContain("apiKey");
    expect(flashcardInput).not.toContain("model");
    expect(canvasInput).toBeDefined();
    expect(testInput).toBeDefined();
    for (const providerInput of [canvasInput, testInput]) {
      expect(providerInput).not.toContain("baseUrl");
      expect(providerInput).not.toContain("apiKey");
      expect(providerInput).not.toContain("model");
    }
    expect(commands).toContain("requireLocalLibraryId");
    expect(commands).toContain("assertActiveLocalLibrary");
    expect(commands).toContain("assertCanvasSourcesInActiveLibrary");
    expect(commands).toContain("createConfiguredAiProvider");
    expect(commands).toContain("MainAiRunRegistry");
    expect(commands).toContain("FlashcardsRepo");
    expect(commands).toContain("dependencies.execute");
    expect(commands).not.toContain("dependencies.transaction");
    expect(commands).not.toContain("window.aura");
    expect(commands).toContain('from "./ai-command-input"');
    expect(commandInput).toContain("requireExactAiInput");
    expect(commandInput).toContain("MAX_AI_CANVAS_SOURCE_TOTAL_BYTES");
    expect(commandInput).not.toContain("window.aura");
    expect(commands.split("\n").length).toBeLessThanOrEqual(500);
    expect(commandInput.split("\n").length).toBeLessThanOrEqual(500);
    expect(facade).not.toContain("window.aura.db");
    expect(facade).toContain('"ai.cancelRun"');
    expect(facade).toContain('"ai.generateFlashcards"');
    expect(facade).toContain('"ai.synthesizeCanvas"');
    expect(ai).toContain("getAiFlashcardTarget");
    expect(ai).toContain("generateAiFlashcards");
    expect(ai).toContain("recordAiFlashcardFailure");
    expect(ai).not.toContain("makeProvider");
    expect(ai).not.toContain("OpenAICompatibleProvider");
    expect(ai).not.toContain("AnthropicProvider");
    expect(ai).not.toContain("auraHttp");
    expect(ai).not.toContain("SECRET_KEYS");
    expect(canvas).toContain("synthesizeAiCanvas");
    expect(canvas).not.toContain("makeProvider");
    expect(canvas).not.toContain("generateCanvasSynthesis");
    expect(provider).toContain("mainAiSettingsStore");
    expect(provider).not.toContain("window.aura");
    expect(transport).toContain('redirect: "error"');
    expect(transport).toContain("MAX_AI_PROVIDER_RESPONSE_BYTES");
    expect(transport).not.toContain("CH.http");
    expect(settings).toContain("apiKeyBound");
    expect(settings).toContain("更改 AI 服务地址、类型或模型时，请重新填写 API Key。");
    expect(ai).not.toContain("getLibraryDb");
    expect(ai).not.toContain("aura-db");
    expect(ai).not.toContain("FlashcardsRepo");
    expect(ai).not.toContain("INSERT INTO ai_jobs");
    expect(ai).not.toMatch(/\b(?:SELECT|INSERT|UPDATE|DELETE)\s+/);
  });
});
