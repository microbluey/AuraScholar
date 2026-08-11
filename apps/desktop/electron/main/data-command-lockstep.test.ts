import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("typed data command lockstep", () => {
  it("keeps the contract, runtime dispatcher, envelope, and main registration in lockstep", () => {
    const contract = source("electron/data-command-contract.ts");
    const aiContract = source("electron/ai-command-contract.ts");
    const annotationRecoveryContract = source("electron/annotation-recovery-command-contract.ts");
    const canvasContract = source("electron/canvas-command-contract.ts");
    const citationGraphContract = source("electron/citation-graph-command-contract.ts");
    const discoveryLibraryStatusContract = source(
      "electron/discovery-library-status-command-contract.ts",
    );
    const discoverySiteContract = source("electron/discovery-site-command-contract.ts");
    const envelope = source("electron/main/data-command-envelope.ts");
    const evidenceContract = source("electron/evidence-command-contract.ts");
    const libraryIngestContract = source("electron/library-ingest-command-contract.ts");
    const libraryOaContract = source("electron/library-oa-command-contract.ts");
    const libraryReadContract = source("electron/library-read-command-contract.ts");
    const referenceImportContract = source("electron/reference-import-command-contract.ts");
    const readerContract = source("electron/reader-command-contract.ts");
    const savedSearchContract = source("electron/saved-search-command-contract.ts");
    const scholarlyContract = source("electron/scholarly-command-contract.ts");
    const sentinelReadContract = source("electron/sentinel-read-command-contract.ts");
    const sentinelRunContract = source("electron/sentinel-run-command-contract.ts");
    const snippetContract = source("electron/snippet-command-contract.ts");
    const syncContract = source("electron/sync-command-contract.ts");
    const translationCacheContract = source("electron/translation-cache-command-contract.ts");
    const translationProviderContract = source("electron/translation-provider-command-contract.ts");
    const workMetadataContract = source("electron/work-metadata-command-contract.ts");
    const dispatcher = source("electron/main/data-commands.ts");
    const main = source("electron/main.ts");

    const contractNames = [
      contract,
      aiContract,
      annotationRecoveryContract,
      canvasContract,
      citationGraphContract,
      discoveryLibraryStatusContract,
      discoverySiteContract,
      evidenceContract,
      libraryIngestContract,
      libraryOaContract,
      libraryReadContract,
      referenceImportContract,
      readerContract,
      savedSearchContract,
      scholarlyContract,
      sentinelReadContract,
      sentinelRunContract,
      snippetContract,
      syncContract,
      translationCacheContract,
      translationProviderContract,
      workMetadataContract,
    ]
      .flatMap((contractSource) =>
        [...contractSource.matchAll(/^\s*"([^"]+)":\s*\{/gm)].map((match) => match[1]),
      )
      .sort();
    const dispatchedNames = [...dispatcher.matchAll(/^\s*case "([^"]+)":/gm)]
      .map((match) => match[1])
      .sort();
    const envelopeNames = [...envelope.matchAll(/^\s+"([^"]+)",$/gm)]
      .map((match) => match[1])
      .sort();

    expect(new Set(contractNames).size).toBe(contractNames.length);
    expect(contract).toMatch(
      /extends\s+AiDataCommandMap,\s+AnnotationRecoveryDataCommandMap,\s+CanvasDataCommandMap,\s+CitationGraphDataCommandMap,\s+DiscoveryLibraryStatusDataCommandMap,\s+DiscoverySiteDataCommandMap,\s+EvidenceDataCommandMap,\s+LibraryIngestDataCommandMap,\s+LibraryOaDataCommandMap,\s+LibraryReadDataCommandMap,\s+ReferenceImportDataCommandMap,\s+ReaderDataCommandMap,\s+SavedSearchDataCommandMap,\s+ScholarlyDataCommandMap,\s+SentinelReadDataCommandMap,\s+SentinelRunDataCommandMap,\s+SnippetDataCommandMap,\s+SyncDataCommandMap,\s+TranslationCacheDataCommandMap,\s+TranslationProviderDataCommandMap,\s+WorkMetadataDataCommandMap/,
    );
    expect(dispatchedNames).toEqual(contractNames);
    expect(envelopeNames).toEqual(contractNames);
    expect(main.match(/registerDataCommandHandlers\(\);/g)).toHaveLength(1);
  });
});
