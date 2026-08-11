import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLibraryPdfStagingJournal,
  LibraryPdfStagingJournalError,
  libraryPdfStagingJournalPath,
} from "./library-pdf-staging-journal";

const SHA = "a".repeat(64);
const roots: string[] = [];

async function root(): Promise<string> {
  const directory = await fs.mkdtemp(join(tmpdir(), "aurascholar-pdf-journal-"));
  roots.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe("library PDF staging journal", () => {
  it("durably records only SHA lifecycle state and survives a rebuilt journal", async () => {
    const userDataRoot = await root();
    const journal = createLibraryPdfStagingJournal(userDataRoot);

    await journal.recordStage(SHA);
    await journal.recordStage(SHA);
    await journal.markOrphaned(SHA);

    const serialized = JSON.parse(
      await fs.readFile(libraryPdfStagingJournalPath(userDataRoot), "utf8"),
    ) as Record<string, unknown>;
    expect(serialized).toEqual({
      orphaned: [SHA],
      staged: { [SHA]: 1 },
      version: 1,
    });
    expect(JSON.stringify(serialized)).not.toContain("stageId");
    await expect(
      createLibraryPdfStagingJournal(userDataRoot).recoveryCandidates(),
    ).resolves.toEqual([SHA]);
  });

  it("removes the journal only after all staged and orphan lifecycle state settles", async () => {
    const userDataRoot = await root();
    const journal = createLibraryPdfStagingJournal(userDataRoot);

    await journal.recordStage(SHA);
    await journal.markOrphaned(SHA);
    await journal.clearOrphanCandidate(SHA);
    await expect(fs.access(libraryPdfStagingJournalPath(userDataRoot))).rejects.toThrow();
  });

  it("treats malformed journal content as fail-safe and never overwrites it", async () => {
    const userDataRoot = await root();
    const path = libraryPdfStagingJournalPath(userDataRoot);
    await fs.mkdir(join(userDataRoot, ".ingest-staging"), { recursive: true });
    await fs.writeFile(path, "{not-json", { mode: 0o600 });
    const journal = createLibraryPdfStagingJournal(userDataRoot);

    await expect(journal.recoveryCandidates()).rejects.toBeInstanceOf(
      LibraryPdfStagingJournalError,
    );
    await expect(journal.recordStage(SHA)).rejects.toBeInstanceOf(LibraryPdfStagingJournalError);
    await expect(fs.readFile(path, "utf8")).resolves.toBe("{not-json");
  });
});
