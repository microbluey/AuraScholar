import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("translation provider command architecture", () => {
  it("keeps provider configuration and credentials main-owned", () => {
    const contract = source("electron/translation-provider-command-contract.ts");
    const commands = source("electron/main/translation-provider-commands.ts");
    const settings = source("electron/main/translation-provider-settings-store.ts");
    const transport = source("electron/main/translation-provider-http.ts");
    const rendererFacade = source("src/services/translate.ts");
    const translateInput = contract.match(
      /export interface TranslateWithConfiguredProviderCommandInput \{([\s\S]*?)\n\}/,
    )?.[1];

    expect(contract).toContain('"translation.translate"');
    expect(contract).toContain('"translation.cancel"');
    expect(contract).toContain('"translation.saveSettings"');
    expect(contract).toContain('"translation.adoptLegacySettings"');
    expect(contract).toContain("requestId: string");
    expect(translateInput).toBeDefined();
    expect(translateInput).not.toContain("baseUrl");
    expect(translateInput).not.toContain("apiKey");
    expect(translateInput).not.toContain("engine:");

    expect(commands).toContain("createConfiguredAiProvider");
    expect(commands).toContain("mainTranslationProviderHttp");
    expect(commands).toContain("settings.requireSettings()");
    expect(commands).toContain("MainTranslationRequestCanceller");
    expect(commands).not.toContain("window.aura");
    expect(settings).toContain("keyBound");
    expect(settings).toContain("permitBoundCredentialReuse: false");
    expect(settings).toContain("sameDeepLTarget");
    expect(transport).toContain('redirect: "error"');
    expect(transport).not.toContain("window.aura");

    expect(rendererFacade).toContain('"translation.getSettings"');
    expect(rendererFacade).toContain('"translation.saveSettings"');
    expect(rendererFacade).toContain('"translation.translate"');
    expect(rendererFacade).toContain('"translation.cancel"');
    expect(rendererFacade).not.toContain("makeTranslator");
    expect(rendererFacade).not.toContain("DeepLTranslator");
    expect(rendererFacade).not.toContain("BaiduTranslator");
    expect(rendererFacade).not.toContain("auraHttp");
    expect(rendererFacade).not.toContain("window.aura.secrets");
  });
});
