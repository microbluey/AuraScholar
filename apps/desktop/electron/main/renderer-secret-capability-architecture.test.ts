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

function smokeFragmentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return smokeFragmentFiles(path);
    return entry.isFile() && /\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe("renderer secret capability architecture", () => {
  it("keeps every credential outside the preload surface", () => {
    const preload = source("electron/preload.ts");
    const auraDeclaration = source("src/aura.d.ts");

    expect(preload).not.toContain("  secrets:");
    expect(preload).not.toContain("platform:secret:");
    expect(auraDeclaration).toContain("_AuraApiExcludesSecrets");
  });

  it("exposes encrypted storage only to main-process command owners", () => {
    const platform = source("electron/main/platform.ts");

    expect(existsSync(resolve(process.cwd(), "electron/main/platform-secret-policy.ts"))).toBe(
      false,
    );
    expect(platform).toContain("export async function getMainSecret");
    expect(platform).toContain("export function setMainSecret");
    expect(platform).not.toContain("CH.secretGet");
    expect(platform).not.toContain("CH.secretSet");
    expect(platform).not.toContain("CH.secretDelete");
  });

  it("keeps production renderer and smoke sources off the secret surface", () => {
    const rendererRoot = resolve(process.cwd(), "src");
    const genericSecretAccess = /window\.aura(?:\?\.|\.)secrets\b/u;

    for (const path of rendererSourceFiles(rendererRoot)) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(genericSecretAccess);
    }
    const smokeFragments = resolve(process.cwd(), "electron/main/smoke/fragments");
    for (const path of smokeFragmentFiles(smokeFragments)) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(genericSecretAccess);
    }
  });
});
