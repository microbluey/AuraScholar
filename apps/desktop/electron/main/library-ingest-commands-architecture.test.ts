import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataCommandDependencies } from "./data-command-runtime";

function assertFinalizeIngestOutputContract(dependencies: DataCommandDependencies): void {
  void dependencies.transaction("library.finalizeIngest", async () => ({
    attachment: null,
    deduped: false,
    pdfFetched: false,
    title: "Work title",
    workId: "work-id",
  }));
  // @ts-expect-error finalizeIngest must preserve the attachment result envelope.
  void dependencies.transaction("library.finalizeIngest", async () => ({
    deduped: false,
    pdfFetched: false,
    title: "Work title",
    workId: "work-id",
  }));
}

function assertIngestDedupOutputContract(dependencies: DataCommandDependencies): void {
  void dependencies.execute?.("library.findIngestDedup", async () => ({
    hit: { pageCount: 12, reason: "exact-file", title: "Work title", workId: "work-id" },
  }));
  // @ts-expect-error Exact-file dedup hits must include a page count.
  void dependencies.execute?.("library.findIngestDedup", async () => ({
    hit: { reason: "exact-file", title: "Work title", workId: "work-id" },
  }));
}

void assertFinalizeIngestOutputContract;
void assertIngestDedupOutputContract;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Library finalize-ingest command architecture", () => {
  it("keeps staged ingest writes behind one typed, scoped main-process transaction", () => {
    const contract = source("electron/library-ingest-command-contract.ts");
    const commands = source("electron/main/library-ingest-commands.ts");
    const dedupCommands = source("electron/main/library-ingest-dedup-commands.ts");
    const dataCommands = source("electron/main/data-commands.ts");
    const claim = source("electron/main/library-staged-pdf-claim.ts");
    const staging = source("electron/main/library-pdf-staging.ts");
    const blobGc = source("electron/main/library-pdf-blob-gc.ts");
    const journal = source("electron/main/library-pdf-staging-journal.ts");
    const main = source("electron/main.ts");
    const platform = source("electron/main/platform.ts");
    const platformPolicy = source("electron/main/platform-fs-policy.ts");

    expect(contract).toContain('"library.finalizeIngest"');
    expect(contract).toContain('"library.findIngestDedup"');
    expect(contract).toContain('"library.releaseStagedPdf"');
    expect(contract).toContain('"library.stagePdf"');
    expect(contract).not.toMatch(/^\s*relPath\s*:/m);
    expect(commands).toContain("DataCommandRequest");
    expect(commands).toContain("DataCommandOutput");
    expect(commands).toContain("DataCommandDependencies");
    expect(commands).toContain("requireLocalLibraryId");
    expect(commands).toContain("assertActiveLocalLibrary");
    expect(commands).toContain("dependencies.transaction");
    expect(commands).toContain("claimVerifiedStagedPdfBeforeTransaction");
    expect(commands).toContain("stagedPdf?.consume()");
    expect(commands).toContain("stagedPdf?.release()");
    expect(commands).toContain("new WorksRepo");
    expect(commands).toContain("new AttachmentsRepo");
    expect(commands).not.toContain("WorksRepo.restore");
    expect(dedupCommands).toContain("requireLocalLibraryId");
    expect(dedupCommands).toContain("assertActiveLocalLibrary");
    expect(dedupCommands).toContain("dependencies.execute");
    expect(dedupCommands).toContain("a.kind = 'pdf'");
    expect(dedupCommands).toContain("a.deleted_at IS NULL");
    expect(dedupCommands).toContain("w.deleted_at IS NULL");
    expect(staging).toContain('app.getPath("userData")');
    expect(staging).toContain('join(userDataRoot, "blobs")');
    expect(staging).toContain("randomBytes(STAGE_ID_BYTES)");
    expect(staging).toContain("handle.writeFile");
    expect(staging).toContain("handle.sync()");
    expect(staging).toContain("fs.link(temporary, target)");
    expect(staging).toContain("verifyStagedPdfAtUserDataRoot");
    expect(staging).toContain("MAX_PENDING_STAGED_BYTES");
    expect(staging).toContain("STAGED_PDF_TTL_MS");
    expect(staging).toContain("removeUnreferencedCanonicalPdfBlobAtUserDataRoot");
    expect(staging).toContain("journal.recordStage(sha)");
    expect(staging).toContain("journal.markOrphaned");
    expect(staging).toContain("recoverLibraryPdfStaging");
    expect(staging).not.toContain("relPath");
    expect(blobGc).toContain('dependencies.transaction("library.collectStagedPdfBlob"');
    expect(blobGc).toContain("attachments WHERE sha256 = ?");
    expect(blobGc).toContain("document_revisions WHERE blob_sha256 = ?");
    expect(blobGc).not.toContain("deleted_at IS NULL");
    expect(journal).toContain('join(userDataRoot, ".ingest-staging"');
    expect(journal).toContain("handle.sync()");
    expect(journal).toContain("fs.rename(temporary, path)");
    expect(journal).not.toContain("stageId");
    expect(main.indexOf("await recoverLibraryPdfStaging()")).toBeGreaterThan(-1);
    expect(main.indexOf("await recoverLibraryPdfStaging()")).toBeLessThan(
      main.indexOf("registerDataCommandHandlers()"),
    );
    expect(main.indexOf("await recoverLibraryPdfStaging()")).toBeLessThan(
      main.indexOf("void createWindow()"),
    );
    expect(claim).toContain("dependencies.claimStagedPdf");
    expect(claim).toContain("dependencies.verifyStagedPdf");
    expect(claim).toContain("claim.release()");
    expect(dataCommands).toContain("verifyStagedPdf,");
    expect(platformPolicy).toContain("MAIN_OWNED_MUTATION_DIRECTORIES");
    expect(platform).toContain("resolveRendererMutableRel");
  });

  it("keeps renderer callers on the facade and removes active-dedup restore calls", () => {
    const actions = source("src/services/library-actions.ts");
    const library = source("src/services/library.ts");
    const libraryOa = source("src/services/library-oa.ts");
    const libraryPage = source("src/pages/LibraryPage.tsx");
    const discoveryPage = source("src/pages/DiscoveryPage.tsx");
    const browserImport = source("src/features/discovery/useBrowserDownloadImport.ts");

    expect(actions).toContain('data.command("library.finalizeIngest"');
    expect(actions).toContain('data.command("library.findIngestDedup"');
    expect(actions).toContain('data.command("library.stagePdf"');
    expect(actions).toContain('data.command("library.releaseStagedPdf"');
    expect(actions).not.toContain("getLibraryDb");
    expect(actions).not.toContain("aura-db");
    expect(actions).not.toContain("libraryRepos");
    expect(actions).not.toContain("WorksRepo");
    expect(actions).not.toContain("AttachmentsRepo");
    expect(actions).toContain("discardStagedPdf");
    expect(actions).toContain("pdf.relPath");
    expect(library).toContain("stagePdf as stagePdfBytes");
    expect(library).toContain("findIngestDedup");
    expect(library).toContain("searchWorksByMetadata");
    expect(library).toContain("const finalized = await finalizeIngest");
    expect(library).toContain("workInput: toWorkInput(work)");
    expect(library).not.toContain("auraFs.writeFile");
    expect(library).not.toContain("attachments.create");
    expect(library).not.toContain("works.upsert");
    expect(library).not.toContain("getLibraryDb");
    expect(library).not.toContain("library-repos");
    expect(library).not.toContain("AttachmentsRepo");
    expect(library).not.toContain("WorksRepo");
    expect(existsSync(resolve(process.cwd(), "src/services/library-repos.ts"))).toBe(false);
    expect(libraryOa).toContain('data.command("library.ensureOaPdfAttachment"');
    expect(libraryOa).not.toContain("loadReaderWorkPdfCandidates");
    expect(libraryOa).not.toContain("finalizeIngest");
    expect(libraryOa).not.toContain("auraHttp");
    expect(libraryOa).not.toContain("connectorContext");
    expect(libraryOa).not.toContain("AttachmentsRepo");
    expect(libraryOa).not.toContain("getLibraryDb");
    expect(libraryOa).not.toContain("auraFs.writeFile");
    expect(libraryPage).toContain("stagePdf");
    expect(libraryPage).not.toContain("auraFs.writeFile");

    for (const caller of [discoveryPage, browserImport]) {
      expect(caller).toContain("finalizeIngest");
    }
    for (const caller of [libraryPage, discoveryPage, browserImport]) {
      expect(caller).not.toContain("restoreDedup");
      expect(caller).not.toContain("attachStagedPdf");
      expect(caller).not.toContain("commitIngest");
    }
    expect(libraryPage).toContain("finalizeDedupIngest");
  });
});
