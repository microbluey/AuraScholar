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
    const researchBrowser = source("electron/main/research-browser.ts");
    const researchDownloads = source("electron/main/research-download-store.ts");
    const rendererPlatform = source("src/services/aura-platform.ts");

    expect(preload).toContain("readBlobPdf(sha256: string)");
    expect(preload).toContain("consumeDownload(input: ConsumeResearchDownloadInput)");
    expect(preload).not.toContain("readFile(path: string)");
    expect(preload).not.toContain("exists(path: string)");
    expect(preload).not.toContain("listDir(path: string)");
    expect(preload).not.toContain("writeFile(path: string");
    expect(preload).not.toContain("mkdirp(path: string");
    expect(shared).not.toContain('fsRead: "platform:fs:read"');
    expect(shared).not.toContain('fsExists: "platform:fs:exists"');
    expect(shared).not.toContain('fsListDir: "platform:fs:listDir"');
    expect(shared).not.toContain("fsWrite");
    expect(shared).not.toContain("fsMkdirp");
    expect(shared).not.toContain("fsDelete");
    expect(shared).not.toContain("fsReadResearchDownload");
    expect(platform).not.toContain("handle(CH.fsRead,");
    expect(platform).not.toContain("handle(CH.fsExists,");
    expect(platform).not.toContain("handle(CH.fsListDir,");
    expect(platform).not.toContain("handle(CH.fsWrite,");
    expect(platform).not.toContain("handle(CH.fsMkdirp,");
    expect(platform).not.toContain("handle(CH.fsDelete,");
    expect(platform).not.toContain("handle(CH.fsReadResearchDownload,");
    expect(shared).toContain('researchConsumeDownload: "research:consumeDownload"');
    expect(researchBrowser).toContain("handle(CH.researchConsumeDownload");
    expect(researchBrowser).toContain("assertResearchDownloadConsumeInput(input)");
    expect(researchDownloads).toContain("Object.keys(value).length !== 1");
    expect(rendererPlatform).not.toContain("window.aura.fs.readFile");
    expect(rendererPlatform).not.toContain("window.aura.fs.exists");
    expect(rendererPlatform).not.toContain("window.aura.fs.listDir");
    expect(rendererPlatform).not.toContain("window.aura.fs.writeFile");
    expect(rendererPlatform).not.toContain("window.aura.fs.mkdirp");
  });

  it("keeps PDF/download consumers on constrained reads and OA acquisition main-owned", () => {
    const reader = source("src/services/library-read.ts");
    const oa = source("src/services/library-oa.ts");
    const downloads = source("src/services/research-downloads.ts");

    expect(reader).toContain("auraFiles.readBlobPdf");
    expect(downloads).toContain("consumeDownload");
    expect(oa).toContain('data.command("library.ensureOaPdfAttachment"');
    expect(oa).not.toContain("auraFiles.");
    for (const contents of [reader, downloads, oa]) {
      expect(contents).not.toContain("auraFs.readFile");
      expect(contents).not.toContain("auraFs.exists");
    }
  });
});
