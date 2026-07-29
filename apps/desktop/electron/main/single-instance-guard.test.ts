import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(resolve(process.cwd(), "electron/main.ts"), "utf8");

describe("desktop single-instance guard", () => {
  it("keeps smoke runs isolated while guarding normal launches", () => {
    expect(mainSource).toContain(
      "const hasSingleInstanceLock = SMOKE_MODE || app.requestSingleInstanceLock();",
    );
    expect(mainSource).toMatch(/if \(!hasSingleInstanceLock\) \{\s+app\.quit\(\);/);
    expect(mainSource).toContain('app.on("second-instance", focusPrimaryWindow)');
  });

  it("restores and focuses the primary window on a second launch", () => {
    expect(mainSource).toContain("if (win.isMinimized()) win.restore();");
    expect(mainSource).toContain("win.show();");
    expect(mainSource).toContain("win.focus();");
  });
});
