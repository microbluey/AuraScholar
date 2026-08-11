import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("main-owned OA PDF architecture", () => {
  it("keeps renderer OA acquisition to an opaque work-id command", () => {
    const facade = source("src/services/library-oa.ts");
    const contract = source("electron/library-oa-command-contract.ts");

    expect(facade).toContain('"library.ensureOaPdfAttachment"');
    expect(facade).not.toContain("auraHttp");
    expect(facade).not.toContain("connectorContext");
    expect(facade).not.toContain("fetchValidatedOaPdf");
    expect(contract).toMatch(
      /interface LibraryEnsureOaPdfAttachmentCommandInput\s*\{\s*workId: string;\s*\}/,
    );
    expect(contract).not.toContain("url:");
    expect(contract).not.toContain("headers:");
    expect(contract).not.toContain("body:");
  });

  it("pins publisher HTTPS connections and keeps bytes/provenance inside main", () => {
    const command = source("electron/main/library-oa-commands.ts");
    const workflow = source("electron/main/library-oa-pdf.ts");
    const transport = source("electron/main/oa-pdf-http.ts");

    expect(command).toContain("ensureMainOaPdfAttachment");
    expect(workflow).toContain("stageAndAttachOaPdf");
    expect(workflow).toContain("sourceUrl: downloaded.sourceUrl");
    expect(workflow).not.toContain("return { bytes");
    expect(transport).toContain("resolveOaPdfPublicAddress");
    expect(transport).toContain("agent: false");
    expect(transport).toContain("lookup,");
    expect(transport).toContain("servername: hostname");
    expect(transport).toContain("OA_PDF_MAX_REDIRECTS");
    expect(transport).toContain("OA_PDF_MAX_BYTES");
    expect(transport).not.toContain("fetch(");
  });
});
