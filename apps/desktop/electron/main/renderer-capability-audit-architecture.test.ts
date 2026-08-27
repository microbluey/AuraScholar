import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function rendererSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return rendererSourceFiles(path);
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name)) {
      return [];
    }
    return [path];
  });
}

function smokeFragmentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return smokeFragmentFiles(path);
    return entry.isFile() && /\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe("renderer capability audit architecture", () => {
  it("does not re-expose renderer capabilities with no production consumer", () => {
    const shared = source("electron/shared.ts");
    const preload = source("electron/preload.ts");
    const platform = source("electron/main/platform.ts");
    const researchBrowser = source("electron/main/research-browser.ts");
    const main = source("electron/main.ts");
    const rendererPlatform = source("src/services/aura-platform.ts");
    const auraDeclaration = source("src/aura.d.ts");

    for (const channel of [
      "clipboardReadText",
      "openExternal",
      "deviceId",
      "researchSetProxy",
      "citationBridgePort",
    ]) {
      expect(shared).not.toContain(channel);
    }
    for (const surface of [
      "readText(): Promise<string>",
      "deviceId(): Promise<string>",
      "async openExternal",
      "citationBridgePort(): Promise<number | null>",
    ]) {
      expect(preload).not.toContain(surface);
    }
    for (const handler of [
      "handle(CH.clipboardReadText",
      "handle(CH.openExternal",
      "handle(CH.deviceId",
    ]) {
      expect(platform).not.toContain(handler);
    }
    expect(researchBrowser).not.toContain("research:setProxy");
    expect(main).not.toContain("handle(CH.citationBridgePort");
    expect(rendererPlatform).not.toContain("aura.openExternal");
    expect(rendererPlatform).toContain('window.open(safeUrl, "_blank", "noopener,noreferrer")');
    expect(preload).not.toContain("writeFile(path: string");
    expect(preload).not.toContain("mkdirp(path: string");
    expect(shared).not.toContain("fsWrite");
    expect(shared).not.toContain("fsMkdirp");
    expect(platform).not.toContain("handle(CH.fsWrite");
    expect(platform).not.toContain("handle(CH.fsMkdirp");
    expect(platform).not.toContain("handle(CH.fsReadBlobPdf");
    expect(rendererPlatform).not.toContain("window.aura.fs.writeFile");
    expect(rendererPlatform).not.toContain("window.aura.fs.mkdirp");
    expect(rendererPlatform).not.toContain("window.aura.files");
    expect(auraDeclaration).toContain("_AuraApiExcludesRendererFilesystemMutation");
    expect(auraDeclaration).toContain("_AuraApiExcludesRendererFilesystemRead");

    expect(auraDeclaration).toContain("_AuraApiExcludesClipboardReadText");
    expect(auraDeclaration).toContain("_AuraApiExcludesDeviceId");
    expect(auraDeclaration).toContain("_AuraApiExcludesOpenExternal");
    expect(auraDeclaration).toContain("_AuraApiExcludesCitationBridgePort");
  });

  it("preserves the required clipboard write and main-owned citation service", () => {
    const shared = source("electron/shared.ts");
    const preload = source("electron/preload.ts");
    const platform = source("electron/main/platform.ts");
    const main = source("electron/main.ts");
    const smoke = source("electron/main/smoke.ts");

    expect(shared).toContain("clipboardWriteText");
    expect(preload).toContain("writeText(text: string)");
    expect(platform).toContain("handle(CH.clipboardWriteText");
    expect(main).toContain("startCitationBridge()");
    expect(smoke).toContain("inspectCitationBridge");
  });

  it("keeps production renderer and smoke sources off the removed bridge surface", () => {
    const removedSurface =
      /window\.aura(?:\?\.|\.)clipboard(?:\?\.|\.)readText\b|window\.aura(?:\?\.|\.)deviceId\b|window\.aura(?:\?\.|\.)citationBridgePort\b|(?:window\.)?aura(?:\?\.|\.)openExternal\b|window\.aura(?:\?\.|\.)fs\b|window\.aura(?:\?\.|\.)files\b|auraFs\.(?:deleteFile|writeFile|mkdirp)\b|auraFiles\.(?:readResearchDownload|readBlobPdf)\b/u;

    for (const path of rendererSourceFiles(resolve(process.cwd(), "src"))) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(removedSurface);
    }
    for (const path of smokeFragmentFiles(
      resolve(process.cwd(), "electron/main/smoke/fragments"),
    )) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(removedSurface);
    }
  });
});
