import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { requireLocalLibraryId } from "../local-first";
import { runMigrations } from "../migrations";
import { AttachmentsRepo } from "./attachments";
import {
  DocumentAssetScopeError,
  DocumentAssetsRepo,
  type DocumentRevisionRow,
} from "./document-assets";
import { WorksRepo } from "./works";

let db: Database;
let libraryId: string;
let assets: DocumentAssetsRepo;
let attachments: AttachmentsRepo;
let works: WorksRepo;

const sha = (character: string): string => character.repeat(64);

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryId = await requireLocalLibraryId(db);
  assets = new DocumentAssetsRepo(db, libraryId);
  attachments = new AttachmentsRepo(db, libraryId);
  works = new WorksRepo(db, libraryId);
});

async function addLibrary(id: string): Promise<void> {
  const now = Date.now();
  await db.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
     VALUES (?, 'Other Library', 'personal', ?, ?, NULL)`,
    [id, now, now],
  );
}

describe("DocumentAssetsRepo", () => {
  it("creates standalone and Work-bound assets inside the owning Library", async () => {
    const work = await works.upsert({ title: "Structured source" });
    const standalone = await assets.create({
      id: "asset:standalone",
      kind: "markdown",
      title: "  Research notebook  ",
    });
    const bound = await assets.create({
      id: "asset:bound",
      workId: work.id,
      kind: "docx",
      title: "  Manuscript draft  ",
    });

    expect(standalone).toMatchObject({
      id: "asset:standalone",
      library_id: libraryId,
      work_id: null,
      kind: "markdown",
      title: "Research notebook",
      current_revision_id: null,
      deleted_at: null,
    });
    expect(bound).toMatchObject({
      id: "asset:bound",
      library_id: libraryId,
      work_id: work.id,
      kind: "docx",
      title: "Manuscript draft",
      current_revision_id: null,
      deleted_at: null,
    });
    expect(await assets.get(bound.id)).toEqual(bound);
  });

  it("numbers revisions monotonically and only switches current when requested", async () => {
    const asset = await assets.create({
      id: "asset:revisions",
      kind: "html",
      title: "Living article",
    });
    const first = await assets.createRevision(asset.id, {
      id: "revision:first",
      mimeType: "text/html",
      blobSha256: sha("1"),
      byteSize: 101,
      sourceUrl: "https://example.test/v1",
      extractorProfile: "readability:v1",
      extractionStatus: "ready",
      availabilityStatus: "available",
    });
    const background = await assets.createRevision(asset.id, {
      id: "revision:background",
      mimeType: "text/html",
      blobSha256: sha("2"),
      byteSize: 202,
      makeCurrent: false,
    });

    expect(first).toMatchObject({
      asset_id: asset.id,
      revision_no: 1,
      source_url: "https://example.test/v1",
      extractor_profile: "readability:v1",
      extraction_status: "ready",
      availability_status: "available",
    });
    expect(background).toMatchObject({
      asset_id: asset.id,
      revision_no: 2,
      extraction_status: "pending",
      availability_status: "unchecked",
    });
    expect((await assets.get(asset.id))?.current_revision_id).toBe(first.id);

    const promoted = await assets.createRevision(asset.id, {
      id: "revision:promoted",
      mimeType: "text/html",
      blobSha256: sha("3"),
      byteSize: 303,
      expectedCurrentRevisionId: first.id,
    });
    expect(promoted.revision_no).toBe(3);
    expect((await assets.get(asset.id))?.current_revision_id).toBe(promoted.id);
  });

  it("preserves offline revision branches that allocated the same display ordinal", async () => {
    const asset = await assets.create({
      id: "asset:offline-branches",
      kind: "markdown",
      title: "Offline manuscript",
    });
    const local = await assets.createRevision(asset.id, {
      id: "revision:offline-local",
      mimeType: "text/markdown",
      blobSha256: sha("a"),
      byteSize: 101,
    });

    await db.run(
      `INSERT INTO document_revisions
         (id, asset_id, attachment_id, revision_no, mime_type, blob_sha256, byte_size,
          extraction_status, availability_status, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'text/markdown', ?, 202,
               'pending', 'relink-required', ?, ?)`,
      [
        "revision:offline-remote",
        asset.id,
        local.revision_no,
        sha("b"),
        local.created_at,
        local.created_at,
      ],
    );

    expect(
      await db.query<{ id: string; revision_no: number }>(
        `SELECT id, revision_no FROM document_revisions
         WHERE asset_id = ?
         ORDER BY revision_no, created_at, id`,
        [asset.id],
      ),
    ).toEqual([
      { id: "revision:offline-local", revision_no: 1 },
      { id: "revision:offline-remote", revision_no: 1 },
    ]);

    const next = await assets.createRevision(asset.id, {
      id: "revision:offline-next",
      mimeType: "text/markdown",
      blobSha256: sha("c"),
      byteSize: 303,
      makeCurrent: false,
    });
    expect(next.revision_no).toBe(2);
  });

  it("rejects a non-SHA-256 hash for a new canonical revision", async () => {
    const asset = await assets.create({
      id: "asset:invalid-hash",
      kind: "markdown",
      title: "Invalid revision",
    });

    await expect(
      assets.createRevision(asset.id, {
        mimeType: "text/markdown",
        blobSha256: "not-a-content-hash",
        byteSize: 12,
      }),
    ).rejects.toThrow("Document revision blob hash must be a lowercase SHA-256 value");
    expect(
      await db.query<{ count: number }>(
        "SELECT COUNT(*) AS count FROM document_revisions WHERE asset_id = ?",
        [asset.id],
      ),
    ).toEqual([{ count: 0 }]);
  });

  it("does not roll current back to the legacy attachment revision during dedupe repair", async () => {
    const work = await works.upsert({ title: "Attachment mapping repair" });
    const attachment = await attachments.create({
      workId: work.id,
      sha256: "sha:legacy-revision",
      byteSize: 128,
    });
    const legacyRevision = await assets.resolveAttachment(attachment.id);
    expect(legacyRevision).not.toBeNull();

    const currentRevision = await assets.createRevision(legacyRevision!.asset_id, {
      id: "revision:current-after-legacy",
      mimeType: "application/pdf",
      blobSha256: sha("4"),
      byteSize: 256,
      expectedCurrentRevisionId: legacyRevision!.id,
    });

    await expect(
      attachments.create({
        workId: work.id,
        sha256: "sha:legacy-revision",
        byteSize: 128,
      }),
    ).resolves.toMatchObject({ id: attachment.id, deduped: true });

    expect((await assets.get(legacyRevision!.asset_id))?.current_revision_id).toBe(
      currentRevision.id,
    );
    expect((await assets.resolveAttachment(attachment.id))?.current_revision_id).toBe(
      currentRevision.id,
    );
  });

  it("orders current document attachments before newer historical bridges", async () => {
    const work = await works.upsert({ title: "Reader attachment priority" });
    const historicalAttachment = await attachments.create({
      byteSize: 128,
      sha256: sha("a"),
      workId: work.id,
    });
    const historicalRevision = await assets.resolveAttachment(historicalAttachment.id);
    expect(historicalRevision).not.toBeNull();
    await assets.createRevision(historicalRevision!.asset_id, {
      blobSha256: sha("b"),
      byteSize: 256,
      expectedCurrentRevisionId: historicalRevision!.id,
      id: "revision:current-without-local-bridge",
      mimeType: "application/pdf",
    });
    const currentAttachment = await attachments.create({
      byteSize: 512,
      sha256: sha("c"),
      workId: work.id,
    });
    await db.run(`UPDATE attachments SET created_at = ? WHERE id = ?`, [
      Date.now() + 60_000,
      historicalAttachment.id,
    ]);
    await db.run(`UPDATE attachments SET created_at = ? WHERE id = ?`, [
      1,
      currentAttachment.id,
    ]);

    expect((await attachments.forWork(work.id)).map((attachment) => attachment.id)).toEqual([
      currentAttachment.id,
      historicalAttachment.id,
    ]);
  });

  it("allows exactly one optimistic current-revision writer to win a race", async () => {
    const asset = await assets.create({
      id: "asset:revision-race",
      kind: "markdown",
      title: "Concurrent draft",
    });
    const initial = await assets.createRevision(asset.id, {
      id: "revision:race-initial",
      mimeType: "text/markdown",
      blobSha256: sha("5"),
      byteSize: 10,
    });

    const results = await Promise.allSettled([
      assets.createRevision(asset.id, {
        id: "revision:race-a",
        mimeType: "text/markdown",
        blobSha256: sha("6"),
        byteSize: 11,
        expectedCurrentRevisionId: initial.id,
      }),
      assets.createRevision(asset.id, {
        id: "revision:race-b",
        mimeType: "text/markdown",
        blobSha256: sha("7"),
        byteSize: 12,
        expectedCurrentRevisionId: initial.id,
      }),
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<DocumentRevisionRow> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toEqual(
      expect.objectContaining({
        message: "Document asset changed; reload it before adding a revision",
      }),
    );
    expect((await assets.get(asset.id))?.current_revision_id).toBe(fulfilled[0]!.value.id);
    expect(
      await db.query<{ id: string; revision_no: number }>(
        `SELECT id, revision_no
         FROM document_revisions WHERE asset_id = ? ORDER BY revision_no`,
        [asset.id],
      ),
    ).toEqual([
      { id: initial.id, revision_no: 1 },
      { id: fulfilled[0]!.value.id, revision_no: 2 },
    ]);
  });

  it("fails closed for assets, revisions, and attachment bridges in another Library", async () => {
    const foreignLibraryId = "library:document-assets-foreign";
    await addLibrary(foreignLibraryId);
    const foreignAssets = new DocumentAssetsRepo(db, foreignLibraryId);
    const foreignWorks = new WorksRepo(db, foreignLibraryId);
    const foreignAttachments = new AttachmentsRepo(db, foreignLibraryId);
    const foreignAsset = await foreignAssets.create({
      id: "asset:foreign",
      kind: "epub",
      title: "Private monograph",
    });
    const foreignRevision = await foreignAssets.createRevision(foreignAsset.id, {
      id: "revision:foreign",
      mimeType: "application/epub+zip",
      blobSha256: sha("8"),
      byteSize: 404,
    });
    const foreignWork = await foreignWorks.upsert({ title: "Private PDF" });
    const foreignAttachment = await foreignAttachments.create({
      workId: foreignWork.id,
      sha256: "sha:foreign-attachment",
      byteSize: 505,
    });

    expect(await assets.get(foreignAsset.id)).toBeNull();
    await expect(
      assets.createRevision(foreignAsset.id, {
        mimeType: "application/epub+zip",
        blobSha256: sha("9"),
        byteSize: 1,
      }),
    ).rejects.toBeInstanceOf(DocumentAssetScopeError);
    await expect(assets.setAvailability(foreignRevision.id, "missing")).rejects.toBeInstanceOf(
      DocumentAssetScopeError,
    );
    await expect(assets.resolveAttachment(foreignAttachment.id)).rejects.toBeInstanceOf(
      DocumentAssetScopeError,
    );
    await expect(
      assets.create({
        workId: foreignWork.id,
        kind: "pdf",
        title: "Cross-scope asset",
      }),
    ).rejects.toThrow(`Work ${foreignWork.id} is missing or removed`);
  });

  it("resolves the legacy attachment bridge and validates its Work, hash, and size", async () => {
    const firstWork = await works.upsert({ title: "Bridge source" });
    const secondWork = await works.upsert({ title: "Different source" });
    const attachment = await attachments.create({
      workId: firstWork.id,
      sha256: "sha:bridge",
      byteSize: 512,
      originalFilename: "bridge.pdf",
      pageCount: 7,
    });
    const resolved = await assets.resolveAttachment(attachment.id);

    expect(resolved).toMatchObject({
      attachment_id: attachment.id,
      work_id: firstWork.id,
      mime_type: "application/pdf",
      blob_sha256: "sha:bridge",
      attachment_sha256: "sha:bridge",
      byte_size: 512,
      page_count: 7,
      revision_no: 1,
      extraction_status: "pending",
      availability_status: "unchecked",
    });
    expect(resolved?.current_revision_id).toBe(resolved?.id);

    const sameWorkAsset = await assets.create({
      id: "asset:bridge-same-work",
      workId: firstWork.id,
      kind: "pdf",
      title: "Same Work",
    });
    await expect(
      assets.createRevision(sameWorkAsset.id, {
        attachmentId: attachment.id,
        mimeType: "application/pdf",
        blobSha256: "sha:wrong",
        byteSize: 512,
      }),
    ).rejects.toThrow(`Attachment ${attachment.id} is not compatible`);
    await expect(
      assets.createRevision(sameWorkAsset.id, {
        attachmentId: attachment.id,
        mimeType: "application/pdf",
        blobSha256: "sha:bridge",
        byteSize: 513,
      }),
    ).rejects.toThrow(`Attachment ${attachment.id} is not compatible`);

    const otherWorkAsset = await assets.create({
      id: "asset:bridge-other-work",
      workId: secondWork.id,
      kind: "pdf",
      title: "Different Work",
    });
    await expect(
      assets.createRevision(otherWorkAsset.id, {
        attachmentId: attachment.id,
        mimeType: "application/pdf",
        blobSha256: "sha:bridge",
        byteSize: 512,
      }),
    ).rejects.toThrow(`Attachment ${attachment.id} is not compatible`);
    expect(await assets.resolveAttachment("attachment:missing")).toBeNull();
  });

  it("keeps asset ownership and revision source identity immutable", async () => {
    const asset = await assets.create({
      id: "asset:immutable",
      kind: "html",
      title: "Immutable source",
    });
    const revision = await assets.createRevision(asset.id, {
      id: "revision:immutable",
      mimeType: "text/html",
      blobSha256: sha("a"),
      byteSize: 606,
      sourceUrl: "https://example.test/immutable",
    });

    await expect(
      db.run(
        `UPDATE document_revisions
         SET mime_type = 'text/plain', blob_sha256 = 'sha:changed', byte_size = 1,
             source_url = 'https://example.test/changed'
         WHERE id = ?`,
        [revision.id],
      ),
    ).rejects.toThrow("document revision source identity is immutable");

    const foreignLibraryId = "library:immutable-target";
    await addLibrary(foreignLibraryId);
    await expect(
      db.run(`UPDATE document_assets SET library_id = ? WHERE id = ?`, [
        foreignLibraryId,
        asset.id,
      ]),
    ).rejects.toThrow("document asset library ownership is immutable");

    expect(
      (
        await db.query<{
          asset_id: string;
          mime_type: string;
          blob_sha256: string;
          byte_size: number;
          source_url: string | null;
        }>(
          `SELECT asset_id, mime_type, blob_sha256, byte_size, source_url
           FROM document_revisions WHERE id = ?`,
          [revision.id],
        )
      )[0],
    ).toEqual({
      asset_id: asset.id,
      mime_type: "text/html",
      blob_sha256: sha("a"),
      byte_size: 606,
      source_url: "https://example.test/immutable",
    });
    expect((await assets.get(asset.id))?.library_id).toBe(libraryId);
  });

  it("tracks every supported availability state without mutating revision identity", async () => {
    const asset = await assets.create({
      id: "asset:availability",
      kind: "notebook",
      title: "Reproducibility notebook",
    });
    const revision = await assets.createRevision(asset.id, {
      id: "revision:availability",
      mimeType: "application/x-ipynb+json",
      blobSha256: sha("b"),
      byteSize: 707,
      availabilityStatus: "missing",
    });
    expect(revision).toMatchObject({
      availability_status: "missing",
      availability_checked_at: null,
    });

    for (const status of ["unchecked", "available", "missing", "relink-required"] as const) {
      const updated = await assets.setAvailability(revision.id, status);
      expect(updated.availability_status).toBe(status);
      expect(updated.availability_checked_at).not.toBeNull();
      expect(updated.updated_at).toBe(revision.updated_at);
      expect(updated).toMatchObject({
        asset_id: asset.id,
        mime_type: revision.mime_type,
        blob_sha256: revision.blob_sha256,
        byte_size: revision.byte_size,
      });
    }

    await expect(assets.setAvailability(revision.id, "offline" as never)).rejects.toThrow(
      "Unsupported availability status: offline",
    );
  });
});
