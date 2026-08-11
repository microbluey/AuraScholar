import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Discovery Library status command architecture", () => {
  it("keeps active-Library matching behind a bounded, scoped main handler", () => {
    const contract = source("electron/discovery-library-status-command-contract.ts");
    const centralContract = source("electron/data-command-contract.ts");
    const dispatcher = source("electron/main/data-commands.ts");
    const envelope = source("electron/main/data-command-envelope.ts");
    const handler = source("electron/main/discovery-library-status-commands.ts");

    expect(contract).toContain('"discovery.getLibraryStatus"');
    expect(centralContract).toContain("DiscoveryLibraryStatusDataCommandMap");
    expect(dispatcher).toContain("executeDiscoveryLibraryStatusCommand");
    expect(envelope).toContain('"discovery.getLibraryStatus"');
    expect(contract).toContain("DiscoveryLibraryStatusProbe");
    expect(contract).toContain("hasPdf: boolean");
    expect(contract).not.toMatch(/\blibraryId\s*:/);
    expect(handler).toContain("MAX_DISCOVERY_LIBRARY_STATUS_PROBES");
    expect(handler).toContain("MAX_DISCOVERY_LIBRARY_STATUS_INPUT_BYTES");
    expect(handler).toContain("MAX_DISCOVERY_LIBRARY_STATUS_OUTPUT_BYTES");
    expect(handler).toContain("requireLocalLibraryId");
    expect(handler).toContain("assertActiveLocalLibrary");
    expect(handler).toContain("hasConflictingDiscoveryIdentifiers");
    expect(handler).toContain("a.kind = 'pdf'");
    expect(handler).toContain("a.deleted_at IS NULL");
    expect(handler).toContain("w.deleted_at IS NULL");
  });

  it("keeps the renderer facade free of a database handle and central-map casts", () => {
    const discovery = source("src/services/discovery.ts");
    const facade = source("src/services/discovery-library-status.ts");

    expect(facade).toContain("DiscoveryLibraryStatusCommandClient");
    expect(facade).toContain("signal?.throwIfAborted()");
    expect(facade).toContain("workFingerprint");
    expect(facade).not.toContain("getLibraryDb");
    expect(facade).not.toContain("aura-db");
    expect(facade).not.toContain("window.aura");
    expect(facade).not.toContain("as unknown as");
    expect(discovery).toContain("loadDiscoveryLibraryStatuses");
    expect(discovery).toContain("isDesktopRuntime");
    expect(discovery).not.toContain("getLibraryDb");
    expect(discovery).not.toContain("aura-db");
    expect(discovery).not.toContain("hasConflictingDiscoveryIdentifiers");
    expect(discovery).not.toContain("workFingerprint");
    expect(discovery).not.toMatch(/\b(?:db|database)\.query\b/);
  });
});
