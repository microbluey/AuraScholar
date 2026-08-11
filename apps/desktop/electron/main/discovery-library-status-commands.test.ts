import { AttachmentsRepo, type Database, WorksRepo } from "@aurascholar/db";
import { workFingerprint } from "@aurascholar/db/ids";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand } from "./data-commands";
import { executeDiscoveryLibraryStatusCommand } from "./discovery-library-status-commands";

let coordinator: DatabaseCoordinator;
let database: Database;
let libraryId: string;
let works: WorksRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "discovery-library-status-device",
    deviceName: "Discovery library status commands",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
  works = new WorksRepo(database, libraryId);
});

function command(input: unknown) {
  return executeDataCommand(
    { input, name: "discovery.getLibraryStatus" },
    {
      execute: (_commandName, operation) => coordinator.execute(operation),
      transaction: (_commandName, operation) => coordinator.execute(operation),
    },
  );
}

async function addPdf(workId: string): Promise<void> {
  await new AttachmentsRepo(database, libraryId).create({
    byteSize: 1_024,
    pageCount: 12,
    sha256: crypto.randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
    workId,
  });
}

async function insertFingerprintWork(input: {
  arxivId?: string;
  doi?: string;
  fingerprint: string;
  id: string;
  openalexId?: string;
  pmid?: string;
  s2Id?: string;
}): Promise<void> {
  await database.run(
    `INSERT INTO works
       (id, library_id, doi, title, type, arxiv_id, openalex_id, s2_id, pmid,
        fingerprint, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'article', ?, ?, ?, ?, ?, 1, 1)`,
    [
      input.id,
      libraryId,
      input.doi ?? null,
      input.id,
      input.arxivId ?? null,
      input.openalexId ?? null,
      input.s2Id ?? null,
      input.pmid ?? null,
      input.fingerprint,
    ],
  );
}

describe("Discovery Library status command", () => {
  it("rejects malformed, overbroad, and oversized probes before opening a database lease", async () => {
    let executeCalls = 0;
    const rejectingExecute = async <T>(): Promise<T> => {
      executeCalls += 1;
      throw new Error("database lease reached");
    };
    const invalidInputs = [
      {},
      { probes: "not-an-array" },
      { probes: [{ doi: "10.1000/test", libraryId: "library:foreign" }] },
      { probes: [{ doi: "" }] },
      { probes: [{ fingerprint: "f".repeat(16 * 1024 + 1) }] },
      { probes: Array.from({ length: 201 }, () => ({})) },
      { probes: [{ doi: "d".repeat(2_049) }] },
      { probes: Array.from({ length: 200 }, () => ({ fingerprint: "f".repeat(16 * 1024) })) },
    ];

    for (const input of invalidInputs) {
      await expect(executeDiscoveryLibraryStatusCommand(input, rejectingExecute)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
  });

  it("returns an empty positional mapping without opening a database lease", async () => {
    let executeCalls = 0;

    await expect(
      executeDiscoveryLibraryStatusCommand({ probes: [] }, async () => {
        executeCalls += 1;
        throw new Error("database lease reached");
      }),
    ).resolves.toEqual({ statuses: [] });
    expect(executeCalls).toBe(0);
  });

  it("uses active local direct matches in DOI-first precedence and reports active PDFs only", async () => {
    const doiWork = await works.upsert({
      arxivId: "arxiv:doi-work",
      doi: "10.1000/precedence",
      title: "DOI work",
    });
    await addPdf(doiWork.id);
    const arxivWork = await works.upsert({
      arxivId: "arxiv:incoming",
      title: "ArXiv work",
    });
    const supplementOnly = await works.upsert({
      openalexId: "W-supplement",
      title: "Supplement only",
    });
    await new AttachmentsRepo(database, libraryId).create({
      byteSize: 1_024,
      kind: "supplement",
      sha256: "a".repeat(64),
      workId: supplementOnly.id,
    });
    const removed = await works.upsert({ pmid: "removed-pmid", title: "Removed work" });
    await works.softDelete(removed.id);

    const foreignLibraryId = "library:foreign";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    await new WorksRepo(database, foreignLibraryId).upsert({
      openalexId: "W-foreign",
      title: "Foreign work",
    });

    await expect(
      command({
        probes: [
          { arxivId: "arxiv:incoming", doi: "10.1000/precedence" },
          { openalexId: "W-supplement" },
          { pmid: "removed-pmid" },
          { openalexId: "W-foreign" },
          {},
        ],
      }),
    ).resolves.toEqual({
      statuses: [
        { hasPdf: true, workId: doiWork.id },
        { hasPdf: false, workId: supplementOnly.id },
        { hasPdf: false, workId: null },
        { hasPdf: false, workId: null },
        { hasPdf: false, workId: null },
      ],
    });
    expect(arxivWork.id).not.toBe(doiWork.id);
  });

  it("uses only one non-conflicting fingerprint candidate and rejects ambiguous fallbacks", async () => {
    const fingerprint = workFingerprint("Fingerprint title", 2026, "Ada");
    await insertFingerprintWork({
      doi: "10.1000/stored-conflict",
      fingerprint,
      id: "fingerprint-conflict",
    });
    await insertFingerprintWork({
      fingerprint,
      id: "fingerprint-compatible",
      openalexId: "W-compatible",
    });
    await addPdf("fingerprint-compatible");

    await expect(command({ probes: [{ doi: "10.1000/incoming", fingerprint }] })).resolves.toEqual({
      statuses: [{ hasPdf: true, workId: "fingerprint-compatible" }],
    });

    await insertFingerprintWork({ fingerprint, id: "fingerprint-compatible-second" });
    await expect(command({ probes: [{ doi: "10.1000/incoming", fingerprint }] })).resolves.toEqual({
      statuses: [{ hasPdf: false, workId: null }],
    });
  });
});
