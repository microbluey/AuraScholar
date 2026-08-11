import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("renderer filesystem read boundary", () => {
  it("exposes only domain-specific reads instead of arbitrary app-data paths", () => {
    const preload = source("electron/preload.ts");
    const shared = source("electron/shared.ts");
    const platform = source("electron/main/platform.ts");
    const rendererPlatform = source("src/services/aura-platform.ts");

    expect(preload).toContain("readBlobPdf(sha256: string)");
    expect(preload).toContain("readResearchDownload(relPath: string)");
    expect(preload).not.toContain("readFile(path: string)");
    expect(preload).not.toContain("exists(path: string)");
    expect(preload).not.toContain("listDir(path: string)");
    expect(shared).not.toContain('fsRead: "platform:fs:read"');
    expect(shared).not.toContain('fsExists: "platform:fs:exists"');
    expect(shared).not.toContain('fsListDir: "platform:fs:listDir"');
    expect(platform).not.toContain("handle(CH.fsRead,");
    expect(platform).not.toContain("handle(CH.fsExists,");
    expect(platform).not.toContain("handle(CH.fsListDir,");
    expect(rendererPlatform).not.toContain("window.aura.fs.readFile");
    expect(rendererPlatform).not.toContain("window.aura.fs.exists");
    expect(rendererPlatform).not.toContain("window.aura.fs.listDir");
  });

  it("keeps PDF/download consumers on constrained reads and OA acquisition main-owned", () => {
    const reader = source("src/services/library-read.ts");
    const oa = source("src/services/library-oa.ts");
    const downloads = source("src/services/research-downloads.ts");

    expect(reader).toContain("auraFiles.readBlobPdf");
    expect(downloads).toContain("auraFiles.readResearchDownload");
    expect(oa).toContain('data.command("library.ensureOaPdfAttachment"');
    expect(oa).not.toContain("auraFiles.");
    for (const contents of [reader, downloads, oa]) {
      expect(contents).not.toContain("auraFs.readFile");
      expect(contents).not.toContain("auraFs.exists");
    }
  });
});
