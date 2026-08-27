import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("main-owned filesystem read boundary", () => {
  it("keeps canonical PDF reads behind the typed Reader command", () => {
    const preload = source("electron/preload.ts");
    const shared = source("electron/shared.ts");
    const platform = source("electron/main/platform.ts");
    const dataCommands = source("electron/main/data-commands.ts");
    const readerCommands = source("electron/main/reader-commands.ts");
    const readerContract = source("electron/reader-command-contract.ts");
    const researchBrowser = source("electron/main/research-browser.ts");
    const researchDownloadInput = source("electron/main/research-download-id.ts");
    const rendererPlatform = source("src/services/aura-platform.ts");

    expect(preload).not.toContain("readBlobPdf(sha256: string)");
    expect(preload).not.toContain("files:");
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
    expect(shared).not.toContain("fsReadBlobPdf");
    expect(shared).not.toContain("platform:fs:blob-pdf:read");
    expect(platform).not.toContain("handle(CH.fsRead,");
    expect(platform).not.toContain("handle(CH.fsExists,");
    expect(platform).not.toContain("handle(CH.fsListDir,");
    expect(platform).not.toContain("handle(CH.fsWrite,");
    expect(platform).not.toContain("handle(CH.fsMkdirp,");
    expect(platform).not.toContain("handle(CH.fsDelete,");
    expect(platform).not.toContain("handle(CH.fsReadResearchDownload,");
    expect(platform).not.toContain("handle(CH.fsReadBlobPdf,");
    expect(dataCommands).toContain("readCanonicalPdfBlobFile");
    expect(readerCommands).toContain('"reader.readAttachmentPdf"');
    expect(readerCommands).toContain("dependencies.inspect");
    expect(readerCommands).toContain("dependencies.readPdfBlob");
    expect(readerContract).toContain("ReaderReadAttachmentPdfCommandInput");
    expect(readerContract).toContain('"reader.readAttachmentPdf"');
    expect(shared).toContain('researchConsumeDownload: "research:consumeDownload"');
    expect(researchBrowser).toContain("handle(CH.researchConsumeDownload");
    expect(researchBrowser).toContain("assertResearchDownloadConsumeInput(input)");
    expect(researchDownloadInput).toContain("Object.keys(value).length !== 1");
    expect(rendererPlatform).not.toContain("window.aura.fs.readFile");
    expect(rendererPlatform).not.toContain("window.aura.fs.exists");
    expect(rendererPlatform).not.toContain("window.aura.fs.listDir");
    expect(rendererPlatform).not.toContain("window.aura.fs.writeFile");
    expect(rendererPlatform).not.toContain("window.aura.fs.mkdirp");
  });

  it("keeps PDF/download consumers on typed Reader reads and OA acquisition main-owned", () => {
    const reader = source("src/services/library-read.ts");
    const readerData = source("src/services/reader-session-data.ts");
    const oa = source("src/services/library-oa.ts");
    const downloads = source("src/services/research-downloads.ts");

    expect(reader).toContain("loadReaderAttachmentPdf");
    expect(reader).not.toContain("auraFiles");
    expect(readerData).toContain('data.command("reader.readAttachmentPdf"');
    expect(downloads).toContain("consumeDownload");
    expect(oa).toContain('data.command("library.ensureOaPdfAttachment"');
    expect(oa).not.toContain("auraFiles.");
    for (const contents of [reader, downloads, oa]) {
      expect(contents).not.toContain("auraFs.readFile");
      expect(contents).not.toContain("auraFs.exists");
    }
  });
});
