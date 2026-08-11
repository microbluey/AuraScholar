import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return productionTypeScriptFiles(path);
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name)) {
      return [];
    }
    return [path];
  });
}

describe("renderer generic HTTP capability boundary", () => {
  it("removes the generic platform HTTP IPC contract and handlers", () => {
    const shared = source("electron/shared.ts");
    const preload = source("electron/preload.ts");
    const platform = source("electron/main/platform.ts");
    const rendererPlatform = source("src/services/aura-platform.ts");
    const auraDeclaration = source("src/aura.d.ts");

    expect(shared).not.toContain('http: "platform:http"');
    expect(shared).not.toContain('httpCancel: "platform:http:cancel"');
    expect(shared).not.toContain("HttpRequestDTO");
    expect(shared).not.toContain("HttpResultDTO");
    expect(preload).not.toContain("cancelHttp(requestId: string)");
    expect(preload).not.toContain("http(req:");
    expect(platform).not.toContain("handle(CH.http,");
    expect(platform).not.toContain("handle(CH.httpCancel,");
    expect(platform).not.toContain("httpControllers");
    expect(rendererPlatform).not.toContain("auraHttp");
    expect(auraDeclaration).toContain("_AuraApiExcludesGenericHttp");
    expect(auraDeclaration).toContain("_AuraApiExcludesGenericHttpCancel");
  });

  it("keeps renderer and smoke code off an arbitrary HTTP bridge", () => {
    const forbiddenSurface =
      /(?:window\.)?aura(?:\?\.|\.)http\b|(?:window\.)?aura(?:\?\.|\.)cancelHttp\b|\bauraHttp\b|connector-context/u;

    for (const path of productionTypeScriptFiles(resolve(process.cwd(), "src"))) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(forbiddenSurface);
    }
    for (const path of productionTypeScriptFiles(resolve(process.cwd(), "electron/main/smoke"))) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(forbiddenSurface);
    }
    expect(existsSync(resolve(process.cwd(), "src/services/connector-context.ts"))).toBe(false);
  });
});
