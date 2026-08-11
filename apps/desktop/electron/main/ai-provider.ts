import { AnthropicProvider, OpenAICompatibleProvider, type AIProvider } from "@aurascholar/ai";
import type { HttpClient } from "@aurascholar/platform";
import { mainAiHttp } from "./main-ai-http";
import { mainAiSettingsStore, type MainAiSettingsStore } from "./ai-settings-store";

export interface ConfiguredAiProviderDependencies {
  http: HttpClient;
  settings: Pick<MainAiSettingsStore, "requireSettings">;
}

const defaultDependencies: ConfiguredAiProviderDependencies = {
  http: mainAiHttp,
  settings: mainAiSettingsStore,
};

/**
 * Main-only provider factory shared by AI and LLM-translation commands.
 * Crucially, it accepts no renderer DTO: endpoint/model/key always come from
 * the durable main-owned binding established by `ai.saveSettings`.
 */
export async function createConfiguredAiProvider(
  dependencies: ConfiguredAiProviderDependencies = defaultDependencies,
): Promise<AIProvider> {
  const settings = await dependencies.settings.requireSettings();
  if (settings.kind === "anthropic") {
    return new AnthropicProvider({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl || undefined,
      http: dependencies.http,
      model: settings.model,
    });
  }
  return new OpenAICompatibleProvider({
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    http: dependencies.http,
    model: settings.model,
  });
}
