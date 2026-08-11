import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("annotation recovery renderer architecture", () => {
  it("keeps attachment-time annotation recovery behind the typed command facade", () => {
    const library = source("src/services/library.ts");
    const facade = source("src/services/library-annotation-recovery.ts");
    const handler = source("electron/main/annotation-recovery-commands.ts");
    const commandName = "library.restoreAnnotationsForAttachment";

    expect(library).toMatch(
      /restoreAnnotationsForAttachment\(\s*workId,\s*result\.attachment\.id,\s*\)/,
    );
    expect(library).not.toContain("getLibraryDb");
    expect(library).not.toContain("aura-db");
    expect(library).not.toMatch(/\b(?:db|database)\s*\.\s*(?:query|run|exec|queryScalar)\s*\(/);
    expect(library).not.toContain("UPDATE annotations");

    expect(facade).toContain(`data.command(\n    "${commandName}"`);
    expect(facade).toContain(`DataCommandMap["${commandName}"]`);
    expect(facade).not.toContain("getLibraryDb");
    expect(facade).not.toContain("aura-db");
    expect(facade).not.toContain("window.aura.db");
    expect(facade).not.toMatch(/\b(?:db|database)\s*\.\s*(?:query|run|exec|queryScalar)\s*\(/);

    expect(handler).toContain("dependencies.transaction");
    expect(handler).toContain("requireLocalLibraryId");
    expect(handler).toContain("assertActiveLocalLibrary");
    expect(handler).toContain("kind = 'pdf' AND deleted_at IS NULL");
    expect(handler).toContain("kind = 'pdf' AND deleted_at IS NOT NULL");
  });
});
