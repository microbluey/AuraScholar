import { describe, expect, it } from "vitest";
import { buildLibraryCoreSmokeChecks } from "./checks/library-core";
import type { SmokeRendererResult } from "./contracts";
import { smokeLibrarySeedStart } from "./fragments/library-seed-start";
import { buildRendererSmokeScript } from "./renderer-script";

describe("typed PDF ingest smoke coverage", () => {
  it("commits a staged PDF through the main-owned finalize command before raw fixture seeding", () => {
    const script = buildRendererSmokeScript();
    const stagePdf = 'window.aura.data.command("library.stagePdf"';
    const finalizeIngest = 'window.aura.data.command("library.finalizeIngest"';
    const rawSeedTransaction = 'await window.aura.db.exec("BEGIN")';

    expect(smokeLibrarySeedStart).toContain("libraryTypedPdfIngestCommitted =");
    expect(script.indexOf(stagePdf)).toBeGreaterThanOrEqual(0);
    expect(script.indexOf(finalizeIngest)).toBeGreaterThan(script.indexOf(stagePdf));
    expect(script.indexOf(rawSeedTransaction)).toBeGreaterThan(script.indexOf(finalizeIngest));
  });

  it("covers both initial creation and the consumed-receipt duplicate path", () => {
    expect(smokeLibrarySeedStart).toContain("typedIngestInitial.deduped === false");
    expect(smokeLibrarySeedStart).toContain("typedIngestDuplicate.deduped === true");
    expect(smokeLibrarySeedStart).toContain("typedIngestDuplicate.attachment?.deduped === true");
  });

  it("fails the final smoke result when the typed path did not commit", () => {
    const checks = buildLibraryCoreSmokeChecks({
      libraryTypedPdfIngestCommitted: false,
      libraryTypedPdfIngestDetail: "stage receipt expired",
    } as SmokeRendererResult);

    expect(checks).toContainEqual({
      name: "library-typed-pdf-ingest-main-owned",
      pass: false,
      detail: "stage receipt expired",
    });
  });
});
