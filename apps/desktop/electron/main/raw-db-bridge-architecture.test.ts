import { existsSync, readdirSync, readFileSync } from "node:fs";
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

describe("raw database bridge architecture", () => {
  it("registers raw SQL IPC only for the smoke process", () => {
    const main = source("electron/main.ts");
    const database = source("electron/main/db.ts");

    expect(main.match(/registerSmokeDbHandlers\(\);/g)).toHaveLength(1);
    expect(main).toMatch(/if \(SMOKE_MODE\) \{\s+registerSmokeDbHandlers\(\);\s+\}/);
    expect(main).toContain("isMainSmokeMode(process.env.AURASCHOLAR_SMOKE, app.isPackaged)");
    expect(main).toContain("additionalArguments: SMOKE_MODE ? [SMOKE_PRELOAD_ARGUMENT] : []");
    expect(database).toContain("export function registerSmokeDbHandlers(): void");
    expect(database).not.toContain("registerDbHandlers");
  });

  it("keeps the production renderer free of raw database access", () => {
    const rendererRoot = resolve(process.cwd(), "src");
    const legacyAdapter = resolve(rendererRoot, "services/aura-db.ts");

    expect(existsSync(legacyAdapter)).toBe(false);
    for (const path of rendererSourceFiles(rendererRoot)) {
      const contents = readFileSync(path, "utf8");
      expect(contents, path).not.toContain("window.aura.db");
      expect(contents, path).not.toContain("aura-db");
    }
  });

  it("does not add the smoke bridge to the production AuraApi type", () => {
    const preload = source("electron/preload.ts");
    const auraDeclaration = source("src/aura.d.ts");

    expect(preload).toContain("const SMOKE_MODE = hasPreloadSmokeBridge(process.argv)");
    expect(preload).toMatch(/if \(SMOKE_MODE\) \{\s+Object\.assign\(api, \{\s+db:/);
    expect(auraDeclaration).toContain("_AuraApiExcludesRawDatabase");
  });

  it("fails smoke quickly if its intentionally privileged bridge is missing", () => {
    const rendererSmoke = source("electron/main/smoke/renderer-script.ts");

    expect(rendererSmoke).toContain("Smoke raw database bridge is unavailable.");
  });
});
