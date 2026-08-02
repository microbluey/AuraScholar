import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "@aurascholar/db";
import { AttachmentsRepo, WorksRepo } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { DocumentAssetsRepo } from "@aurascholar/db/repos/document-assets";
import { EvidenceRepo } from "@aurascholar/db/repos/evidence";
import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseCoordinator } from "./database-coordinator";
import {
  recoverEvidenceSource,
  type EvidenceSourceRecoveryDependencies,
  writeContentAddressedEvidenceBlob,
} from "./evidence-source-recovery";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nexact historical source\n%%EOF");
const PDF_SHA = createHash("sha256").update(PDF_BYTES).digest("hex");

let database: Database;
let libraryId: string;
let coordinator: DatabaseCoordinator;
let written: Array<{ bytes: Uint8Array; sha: string }>;
let dependencies: EvidenceSourceRecoveryDependencies;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "evidence-recovery-device",
    deviceName: "Evidence recovery",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
  written = [];
  dependencies = {
    inspect: (operation) => coordinator.execute(operation),
    transaction: (operation) => coordinator.transaction("evidence.recoverSource", operation),
    async writeBlob(sha, bytes) {
      written.push({ bytes: new Uint8Array(bytes), sha });
    },
  };
});

async function seedEvidence() {
  const work = await new WorksRepo(database, libraryId).upsert({
    title: "Exact source recovery",
  });
  const attachment = await new AttachmentsRepo(database, libraryId).create({
    byteSize: PDF_BYTES.byteLength,
    originalFilename: "original.pdf",
    pageCount: 4,
    sha256: PDF_SHA,
    workId: work.id,
  });
  const document = await new DocumentAssetsRepo(database, libraryId).resolveAttachment(
    attachment.id,
  );
  if (!document) throw new Error("seed revision missing");
  const saved = await new EvidenceRepo(database, libraryId).createText({
    anchor: {
      kind: "pdf",
      pageIndex: 2,
      position: { end: 29, start: 6 },
      quote: { exact: "historical source" },
      version: 1,
    },
    attachmentId: attachment.id,
    evidenceKind: "method",
    expectedBlobSha256: PDF_SHA,
    id: "evidence:recovery",
    text: "historical source",
    workId: work.id,
  });
  return { attachment, document, evidence: saved.evidence, work };
}

async function detachRevision(revisionId: string) {
  await database.run(
    `UPDATE attachments SET deleted_at = ?, updated_at = MAX(updated_at + 1, ?)
     WHERE id = (SELECT attachment_id FROM document_revisions WHERE id = ?)`,
    [Date.now(), Date.now(), revisionId],
  );
  await database.run(
    `UPDATE document_revisions
     SET attachment_id = NULL, availability_status = 'relink-required',
         availability_checked_at = ?
     WHERE id = ?`,
    [Date.now(), revisionId],
  );
}

describe("Evidence source recovery", () => {
  it("rebinds a local bridge to the exact original revision without changing canonical clocks", async () => {
    const seeded = await seedEvidence();
    await detachRevision(seeded.document.id);
    const revisionBefore = await revisionRow(seeded.document.id);
    const assetBefore = await assetRow(seeded.document.asset_id);
    const evidenceBefore = await evidenceRow(seeded.evidence.id);

    const result = await recoverEvidenceSource(
      {
        bytes: PDF_BYTES,
        evidenceId: seeded.evidence.id,
        fileName: "recovered.pdf",
        libraryId,
      },
      dependencies,
    );

    expect(written).toEqual([{ bytes: PDF_BYTES, sha: PDF_SHA }]);
    expect(result).toMatchObject({
      evidenceId: seeded.evidence.id,
      pageIndex: 2,
      reusedAttachment: false,
      revisionId: seeded.document.id,
      workId: seeded.work.id,
    });
    expect(result.attachmentId).not.toBe(seeded.attachment.id);
    const revisionAfter = await revisionRow(seeded.document.id);
    expect(revisionAfter).toMatchObject({
      attachment_id: result.attachmentId,
      availability_status: "available",
      blob_sha256: PDF_SHA,
      created_at: revisionBefore.created_at,
      updated_at: revisionBefore.updated_at,
    });
    const recoveredAttachment = await attachmentRow(result.attachmentId);
    expect(recoveredAttachment.created_at).toBe(revisionBefore.created_at);
    expect(await assetRow(seeded.document.asset_id)).toEqual(assetBefore);
    expect(await evidenceRow(seeded.evidence.id)).toEqual(evidenceBefore);

    await expect(
      new AttachmentsRepo(database, libraryId).create({
        byteSize: PDF_BYTES.byteLength,
        originalFilename: "same-file.pdf",
        sha256: PDF_SHA,
        workId: seeded.work.id,
      }),
    ).resolves.toEqual({ id: result.attachmentId, deduped: true });
    const revisionCount = await database.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM document_revisions WHERE asset_id = ?`,
      [seeded.document.asset_id],
    );
    expect(Number(revisionCount[0]?.count)).toBe(1);
  });

  it("rejects a different file before writing a blob or mutating the revision", async () => {
    const seeded = await seedEvidence();
    await detachRevision(seeded.document.id);
    const before = await revisionRow(seeded.document.id);
    const wrong = new Uint8Array(PDF_BYTES);
    wrong[wrong.length - 1] = (wrong.at(-1) ?? 0) ^ 1;

    await expect(
      recoverEvidenceSource(
        {
          bytes: wrong,
          evidenceId: seeded.evidence.id,
          fileName: "wrong.pdf",
          libraryId,
        },
        dependencies,
      ),
    ).rejects.toThrow("不是该 Evidence 对应的原始修订");
    expect(written).toEqual([]);
    expect(await revisionRow(seeded.document.id)).toEqual(before);
  });

  it("fails closed when the Evidence belongs to another Library", async () => {
    const seeded = await seedEvidence();
    const foreign = await new WorksRepo(database, libraryId).upsert({ title: "second seed" });
    void foreign;
    const foreignLibrary = "library:foreign";
    await database.run(
      `INSERT INTO libraries (id, name, created_at, updated_at, deleted_at)
       VALUES (?, 'Foreign', ?, ?, NULL)`,
      [foreignLibrary, Date.now(), Date.now()],
    );

    let inspectCalls = 0;
    const foreignDependencies: EvidenceSourceRecoveryDependencies = {
      ...dependencies,
      async inspect(operation) {
        inspectCalls += 1;
        return dependencies.inspect(operation);
      },
    };
    await expect(
      recoverEvidenceSource(
        {
          bytes: PDF_BYTES,
          evidenceId: seeded.evidence.id,
          fileName: "original.pdf",
          libraryId: foreignLibrary,
        },
        foreignDependencies,
      ),
    ).rejects.toThrow();
    expect(inspectCalls).toBe(1);
    expect(written).toEqual([]);
  });

  it("rechecks the Evidence-to-revision lease after hashing and leaves the bridge untouched", async () => {
    const seeded = await seedEvidence();
    await detachRevision(seeded.document.id);
    const revisionBefore = await revisionRow(seeded.document.id);
    const racingDependencies: EvidenceSourceRecoveryDependencies = {
      ...dependencies,
      async transaction(operation) {
        await database.run(
          `UPDATE evidence_items SET updated_at = updated_at + 1 WHERE id = ?`,
          [seeded.evidence.id],
        );
        return coordinator.transaction("evidence.recoverSource", operation);
      },
    };

    await expect(
      recoverEvidenceSource(
        {
          bytes: PDF_BYTES,
          evidenceId: seeded.evidence.id,
          fileName: "original.pdf",
          libraryId,
        },
        racingDependencies,
      ),
    ).rejects.toThrow("发生变化");
    expect(written).toHaveLength(1);
    expect(await revisionRow(seeded.document.id)).toEqual(revisionBefore);
  });

  it("reuses an existing verified content-addressed blob without rewriting it", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "aurascholar-evidence-blob-"));
    const target = join(directory, `${PDF_SHA}.pdf`);
    try {
      await fs.writeFile(target, PDF_BYTES);
      const before = await fs.stat(target);
      await writeContentAddressedEvidenceBlob(target, PDF_SHA, PDF_BYTES);
      const after = await fs.stat(target);

      expect(new Uint8Array(await fs.readFile(target))).toEqual(PDF_BYTES);
      expect(after.ino).toBe(before.ino);
    } finally {
      await fs.rm(directory, { force: true, recursive: true });
    }
  });

  it("repairs a corrupt blob already occupying the content-addressed target", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "aurascholar-evidence-corrupt-"));
    const target = join(directory, `${PDF_SHA}.pdf`);
    const corrupt = new Uint8Array(PDF_BYTES);
    corrupt[0] = 0;
    try {
      await fs.writeFile(target, corrupt);
      await writeContentAddressedEvidenceBlob(target, PDF_SHA, PDF_BYTES);
      expect(new Uint8Array(await fs.readFile(target))).toEqual(PDF_BYTES);
    } finally {
      await fs.rm(directory, { force: true, recursive: true });
    }
  });
});

async function revisionRow(id: string) {
  const rows = await database.query<{
    attachment_id: string | null;
    availability_status: string;
    blob_sha256: string;
    created_at: number;
    updated_at: number;
  }>(
    `SELECT attachment_id, availability_status, blob_sha256, created_at, updated_at
     FROM document_revisions WHERE id = ?`,
    [id],
  );
  return rows[0]!;
}

async function attachmentRow(id: string) {
  const rows = await database.query<{ created_at: number }>(
    `SELECT created_at FROM attachments WHERE id = ?`,
    [id],
  );
  return rows[0]!;
}

async function assetRow(id: string) {
  const rows = await database.query<Record<string, unknown>>(
    `SELECT * FROM document_assets WHERE id = ?`,
    [id],
  );
  return rows[0]!;
}

async function evidenceRow(id: string) {
  const rows = await database.query<Record<string, unknown>>(
    `SELECT * FROM evidence_items WHERE id = ?`,
    [id],
  );
  return rows[0]!;
}
