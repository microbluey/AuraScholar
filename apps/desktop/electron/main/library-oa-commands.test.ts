import type { Database } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { AttachmentsRepo } from "@aurascholar/db/repos/attachments";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryStagePdfCommandResult } from "../library-ingest-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import {
  executeLibraryOaCommand,
  parseLibraryEnsureOaPdfAttachmentInput,
} from "./library-oa-commands";
import type { LibraryOaPdfDependencies } from "./library-oa-pdf";

const SHA = "a".repeat(64);
const STAGE_ID = "s".repeat(43);

let database: Database;
let coordinator: DatabaseCoordinator;
let libraryId: string;
let workId: string;
let dependencies: LibraryOaPdfDependencies;
let releaseStagedPdf: ReturnType<typeof vi.fn>;
let findCandidates: ReturnType<typeof vi.fn>;
let fetchCandidate: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "library-oa-command-device",
    deviceName: "Library OA command tests",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
  workId = (
    await new WorksRepo(database, libraryId).upsert({
      arxivId: "2601.01234",
      doi: "10.1000/oa-command",
      title: "Main-owned OA attachment",
    })
  ).id;

  const receipts = new Map<string, LibraryStagePdfCommandResult>();
  releaseStagedPdf = vi.fn(async (stageId: string) => receipts.delete(stageId));
  findCandidates = vi.fn(async () => [
    { url: "https://publisher.example/download?token=kept-main-only", via: "openalex" as const },
  ]);
  fetchCandidate = vi.fn(async () => ({
    bytes: pdfBytes(),
    sourceUrl: "https://publisher.example/download?token=kept-main-only",
  }));
  dependencies = {
    claimStagedPdf: async (stageId) => {
      const receipt = receipts.get(stageId);
      if (!receipt) throw new Error("staged receipt is unavailable");
      let settled = false;
      return {
        receipt,
        consume() {
          if (settled) return;
          settled = true;
          receipts.delete(stageId);
        },
        release() {
          if (settled) return;
          settled = true;
        },
      };
    },
    fetchCandidate,
    findCandidates,
    inspect: (operation) => coordinator.execute(operation),
    isReadableAttachment: vi.fn(async () => false),
    pageCount: vi.fn(async () => 4),
    releaseStagedPdf,
    stagePdf: async (bytes) => {
      expect(bytes).toEqual(pdfBytes());
      const receipt = { byteSize: bytes.byteLength, sha: SHA, stageId: STAGE_ID };
      receipts.set(receipt.stageId, receipt);
      return receipt;
    },
    transaction: (operation) => coordinator.transaction("library.ensureOaPdfAttachment", operation),
    verifyStagedPdf: vi.fn(async () => {}),
  };
});

describe("library.ensureOaPdfAttachment", () => {
  it("accepts only a work identity before opening a database lease", async () => {
    for (const input of [
      null,
      {},
      { workId: "" },
      { workId: "work-1", url: "https://127.0.0.1/private.pdf" },
      { headers: { authorization: "secret" }, workId: "work-1" },
      { body: new Uint8Array([1]), workId: "work-1" },
    ]) {
      expect(() => parseLibraryEnsureOaPdfAttachmentInput(input)).toThrow();
    }
    expect(parseLibraryEnsureOaPdfAttachmentInput({ workId: " work-1 " })).toEqual({
      workId: "work-1",
    });
  });

  it("stages and attaches a main-downloaded PDF without returning its URL or bytes", async () => {
    await expect(
      executeLibraryOaCommand(
        { input: { workId }, name: "library.ensureOaPdfAttachment" },
        dependencies,
      ),
    ).resolves.toEqual({ attached: true });

    const rows = await database.query<{
      byte_size: number;
      fetched_via: string | null;
      source_url: string | null;
      work_id: string;
    }>(
      `SELECT byte_size, fetched_via, source_url, work_id
       FROM attachments
       WHERE work_id = ?`,
      [workId],
    );
    expect(rows).toEqual([
      {
        byte_size: 1_024,
        fetched_via: "openalex",
        source_url: "https://publisher.example/download?token=kept-main-only",
        work_id: workId,
      },
    ]);
    expect(fetchCandidate).toHaveBeenCalledWith({
      url: "https://publisher.example/download?token=kept-main-only",
      via: "openalex",
    });
    expect(releaseStagedPdf).not.toHaveBeenCalled();
  });

  it("preserves false semantics when every OA candidate is unavailable", async () => {
    fetchCandidate.mockResolvedValue(null);
    await expect(
      executeLibraryOaCommand(
        { input: { workId }, name: "library.ensureOaPdfAttachment" },
        dependencies,
      ),
    ).resolves.toEqual({ attached: false });
    expect(releaseStagedPdf).not.toHaveBeenCalled();
    await expect(
      database.query<{ count: number }>("SELECT COUNT(*) AS count FROM attachments"),
    ).resolves.toEqual([{ count: 0 }]);
  });

  it("does not fetch again when an existing main-validated PDF is readable", async () => {
    await new AttachmentsRepo(database, libraryId).create({
      byteSize: 1_024,
      sha256: "b".repeat(64),
      workId,
    });
    dependencies.isReadableAttachment = vi.fn(async () => true);

    await expect(
      executeLibraryOaCommand(
        { input: { workId }, name: "library.ensureOaPdfAttachment" },
        dependencies,
      ),
    ).resolves.toEqual({ attached: true });
    expect(findCandidates).not.toHaveBeenCalled();
    expect(fetchCandidate).not.toHaveBeenCalled();
  });

  it("releases a staged receipt if the active work disappears before durable attach", async () => {
    dependencies.transaction = async (operation) => {
      await new WorksRepo(database, libraryId).softDelete(workId);
      return coordinator.transaction("library.ensureOaPdfAttachment", operation);
    };
    await expect(
      executeLibraryOaCommand(
        { input: { workId }, name: "library.ensureOaPdfAttachment" },
        dependencies,
      ),
    ).resolves.toEqual({ attached: false });
    expect(releaseStagedPdf).toHaveBeenCalledWith(STAGE_ID);
  });
});

function pdfBytes(): Uint8Array {
  const bytes = new Uint8Array(1_024);
  bytes.set(new TextEncoder().encode("%PDF-1.7"));
  return bytes;
}
