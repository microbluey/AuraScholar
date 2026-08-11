import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataCommandDependencies } from "./data-command-runtime";

function assertDiscoverySiteCommandOutputContract(dependencies: DataCommandDependencies): void {
  void dependencies.execute?.("discoverySite.listSites", async () => ({ sites: [] }));
  // @ts-expect-error discoverySite.listSites must preserve its result envelope.
  void dependencies.execute?.("discoverySite.listSites", async () => ({ settings: {} }));
  void dependencies.execute?.("discoverySite.getSettings", async () => ({
    settings: { ezproxyPrefix: "", proxyAddress: "" },
  }));
  // @ts-expect-error discoverySite.getSettings must preserve both fixed settings.
  void dependencies.execute?.("discoverySite.getSettings", async () => ({ settings: {} }));
  void dependencies.transaction("discoverySite.addSite", async () => ({
    created: true,
    site: {
      builtin: false,
      hidden: false,
      homeUrl: "https://example.edu/",
      id: "custom:example",
      name: "Example",
      sortOrder: 1,
      useProxy: false,
    },
    status: "created",
  }));
  // @ts-expect-error discoverySite.addSite must return its complete site result.
  void dependencies.transaction("discoverySite.addSite", async () => ({ created: true }));
  void dependencies.transaction("discoverySite.setSettings", async () => ({
    settings: { ezproxyPrefix: "", proxyAddress: "" },
  }));
  // @ts-expect-error discoverySite.setSettings must return the fixed settings envelope.
  void dependencies.transaction("discoverySite.setSettings", async () => ({ updated: 1 }));
}

void assertDiscoverySiteCommandOutputContract;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Discovery site command architecture", () => {
  it("keeps global site and proxy persistence behind the typed renderer facade", () => {
    const gateway = source("src/services/discovery-sites.ts");
    const contract = source("electron/discovery-site-command-contract.ts");
    const handler = source("electron/main/discovery-site-commands.ts");
    const input = source("electron/main/discovery-site-command-input.ts");
    const dispatcher = source("electron/main/data-commands.ts");
    const envelope = source("electron/main/data-command-envelope.ts");
    const commandNames = [
      "discoverySite.listSites",
      "discoverySite.getSettings",
      "discoverySite.addSite",
      "discoverySite.setSiteProxy",
      "discoverySite.setSiteHidden",
      "discoverySite.removeSite",
      "discoverySite.restoreSite",
      "discoverySite.setSettings",
    ];

    expect(gateway).toContain("window.aura.data.command(name, input)");
    for (const commandName of commandNames) {
      expect(gateway).toContain(`commandDiscoverySite("${commandName}"`);
      expect(contract).toContain(`"${commandName}"`);
      expect(dispatcher).toContain(`case "${commandName}":`);
      expect(envelope).toContain(`"${commandName}",`);
    }
    expect(gateway).not.toContain("getDb");
    expect(gateway).not.toContain("aura-db");
    expect(gateway).not.toContain("window.aura.db");
    expect(gateway).not.toContain("newId");
    expect(gateway).not.toMatch(/\b(?:db|database)\s*\.\s*(?:query|run|exec|queryScalar)\s*\(/);
    expect(gateway).toContain("window.aura.research.clearSiteData");
    expect(gateway).toContain("window.aura.research.siteData");

    for (const sourceText of [handler, input]) {
      expect(sourceText).not.toContain("requireLocalLibraryId");
      expect(sourceText).not.toContain("assertActiveLocalLibrary");
      expect(sourceText).not.toContain("libraryId");
    }
    expect(handler).toContain("executeDiscoverySiteQuery");
    expect(handler).toContain("executeDiscoverySiteMutation");
    expect(handler).toContain("ORDER BY sort_order, name, id");
    expect(handler).toContain("MAX_DISCOVERY_SITE_ROWS + 1");
    expect(handler).toContain("MAX_DISCOVERY_SITE_OUTPUT_BYTES");
    expect(handler).toContain("scope = excluded.scope");
    expect(handler).toContain("WHERE id = ? AND builtin = 0");
    expect(input).toContain("requireExactDiscoverySiteInput");
    expect(input).toContain("Only custom site snapshots can be restored");
    expect(input).toContain("safeNormalizeProxyAddress");
    expect(input).toContain("safeNormalizeEzproxyPrefix");
  });
});
