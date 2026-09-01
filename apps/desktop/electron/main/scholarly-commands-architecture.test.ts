import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("main-owned scholarly command architecture", () => {
  it("keeps fixed public scholarly API calls out of renderer services", () => {
    const services = [
      "src/services/discovery.ts",
      "src/services/scholar.ts",
      "src/services/citation-graph.ts",
      "src/services/library.ts",
    ].map(source);
    const client = source("src/services/scholarly-data.ts");
    const resultCodec = source("src/shared/scholarly-command-result-codec.ts");
    const valueCodec = source("src/shared/scholarly-command-value-codec.ts");
    const limits = source("src/shared/scholarly-command-limits.ts");

    for (const service of services) {
      expect(service).not.toContain("auraHttp");
      expect(service).not.toContain("connector-context");
    }
    expect(client).toContain('"discovery.searchOpenSources"');
    expect(client).toContain('"scholar.enrichByDoi"');
    expect(client).toContain('"citationGraph.build"');
    expect(client).toContain('"library.resolveClue"');
    expect(client).toMatch(/data\s*\.\s*command\(\s*"scholarly\.cancelRun"/);
    expect(client).toContain("window.aura.data.command(name");
    expect(client).toContain("decodeScholarlySearchDiscoveryResult");
    expect(client).toContain("decodeScholarEnrichByDoiResult");
    expect(client).toContain("decodeLibraryResolveClueResult");
    expect(client).toContain("decodeScholarlyCancelRunResult");
    for (const rendererSafeSource of [resultCodec, valueCodec, limits]) {
      expect(rendererSafeSource).not.toContain("node:");
      expect(rendererSafeSource).not.toContain("getLibraryDb");
      expect(rendererSafeSource).not.toContain("aura-db");
      expect(rendererSafeSource).not.toContain("window.");
    }
  });

  it("keeps the command surface semantic and the main handler on the allowlisted transport", () => {
    const contract = source("electron/scholarly-command-contract.ts");
    const handler = source("electron/main/scholarly-commands.ts");
    const input = source("electron/main/scholarly-command-input.ts");
    const output = source("electron/main/scholarly-command-output.ts");
    const dispatcher = source("electron/main/data-commands.ts");
    const envelope = source("electron/main/data-command-envelope.ts");

    for (const command of [
      "citationGraph.build",
      "discovery.searchOpenSources",
      "library.resolveClue",
      "scholar.enrichByDoi",
      "scholarly.cancelRun",
    ]) {
      expect(contract).toContain(`"${command}"`);
      expect(dispatcher).toContain(`case "${command}"`);
      expect(envelope).toContain(`"${command}"`);
    }
    expect(contract).not.toMatch(/\b(?:url|headers|body)\s*:/u);
    expect(input).toContain("requireExactInput");
    expect(input).toContain("requireInputWithOptionalFields");
    expect(handler).toContain("mainScholarlyHttp");
    expect(handler).toContain("searchOpenSourcesDetailed");
    expect(handler).toContain("s2EnrichByDoi");
    expect(handler).toContain("buildCitationGraph");
    expect(handler).toContain("resolveClue");
    expect(handler).not.toContain("window.aura");
    expect(output).toContain("MAX_SCHOLARLY_OUTPUT_BYTES");
    expect(handler).toContain("sanitizeDiscoverySearchReport");
    expect(handler).toContain("sanitizeScholarEnrichment");
    expect(handler).toContain("sanitizeCitationGraph");
    expect(handler).toContain("sanitizeResolvedWork");
  });
});
