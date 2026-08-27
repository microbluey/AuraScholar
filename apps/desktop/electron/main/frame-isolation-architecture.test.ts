import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("renderer frame isolation boundary", () => {
  it("requires privileged invokes to originate from the trusted main frame", () => {
    const ipc = source("electron/main/ipc.ts");

    expect(ipc).toContain("event.senderFrame");
    expect(ipc).toContain("sender.mainFrame");
    expect(ipc).toContain("event.senderFrame !== sender.mainFrame");
  });

  it("keeps the static homepage preview in an opaque sandbox", () => {
    const homepage = source("src/pages/HomepagePage.tsx");
    const iframe = homepage.match(/<iframe[\s\S]*?\/>/u)?.[0];

    expect(iframe).toBeDefined();
    expect(iframe).toContain('sandbox="allow-popups allow-popups-to-escape-sandbox"');
    expect(iframe).not.toContain("allow-scripts");
    expect(iframe).not.toContain("allow-same-origin");
  });
});
