import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { runMigrations } from "../migrations";
import { WorksRepo } from "./works";
import { AnnotationsRepo } from "./annotations";
import { AttachmentsRepo } from "./attachments";
import { CollectionsRepo } from "./collections";

let db: Database;
let works: WorksRepo;
let annotations: AnnotationsRepo;
let attachments: AttachmentsRepo;
let collections: CollectionsRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  works = new WorksRepo(db);
  annotations = new AnnotationsRepo(db);
  attachments = new AttachmentsRepo(db);
  collections = new CollectionsRepo(db);
});

const ATTENTION = {
  doi: "10.48550/arxiv.1706.03762",
  title: "Attention Is All You Need",
  year: 2017,
  venueName: "NeurIPS",
  authors: [
    { displayName: "Ashish Vaswani", position: 0 },
    { displayName: "Noam Shazeer", position: 1 },
  ],
};

describe("WorksRepo", () => {
  it("inserts and reads back a work with authors", async () => {
    const { id, deduped } = await works.upsert(ATTENTION);
    expect(deduped).toBe(false);
    const got = await works.get(id);
    expect(got?.title).toBe("Attention Is All You Need");
    expect(got?.authorNames).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
  });

  it("dedups by DOI", async () => {
    const first = await works.upsert(ATTENTION);
    const second = await works.upsert({ ...ATTENTION, abstract: "The dominant models..." });
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    // backfills missing fields on dedup
    const got = await works.get(first.id);
    expect(got?.abstract).toContain("dominant");
  });

  it("dedups concurrent DOI imports", async () => {
    const [first, second] = await Promise.all([
      works.upsert({ ...ATTENTION, abstract: "First import" }),
      works.upsert({ ...ATTENTION, abstract: "Second import" }),
    ]);

    expect(second.id).toBe(first.id);
    expect([first.deduped, second.deduped]).toContain(true);
    expect(await works.list()).toHaveLength(1);
  });

  it("serializes mixed work writes on a shared database connection", async () => {
    const primary = await works.upsert({ title: "Queue Primary", doi: "10.9/queue-primary" });
    const duplicate = await works.upsert({
      title: "Queue Duplicate",
      doi: "10.9/queue-duplicate",
      abstract: "Metadata from duplicate",
      authors: [{ displayName: "Duplicate Author", position: 0 }],
    });

    const [, , imported] = await Promise.all([
      works.mergeInto(primary.id, [duplicate.id]),
      works.update(primary.id, {
        title: "Queue Primary Updated",
        authors: [{ displayName: "Queue Author", position: 0 }],
      }),
      works.upsert({
        title: "Queue Imported",
        doi: "10.9/queue-imported",
        authors: [{ displayName: "Import Author", position: 0 }],
      }),
    ]);

    const activeRows = await works.list();
    expect(activeRows.map((work) => work.id).sort()).toEqual([primary.id, imported.id].sort());
    expect((await works.get(primary.id))?.title).toBe("Queue Primary Updated");
    expect((await works.get(primary.id))?.abstract).toBe("Metadata from duplicate");
    expect((await works.get(duplicate.id))?.deleted_at).not.toBeNull();
    expect(await works.authorsOf(primary.id)).toEqual([
      expect.objectContaining({ displayName: "Queue Author" }),
    ]);
    expect(await works.authorsOf(imported.id)).toEqual([
      expect.objectContaining({ displayName: "Import Author" }),
    ]);
  });

  it("rolls back a new work import when author linking fails", async () => {
    await db.exec(
      `CREATE TEMP TRIGGER fail_author_link
       BEFORE INSERT ON work_authors
       WHEN NEW.raw_name = 'Broken Author'
       BEGIN
         SELECT RAISE(FAIL, 'forced author link failure');
       END;`,
    );

    try {
      await expect(
        works.upsert({
          title: "Atomic Author Import",
          doi: "10.9/atomic-author-import",
          authors: [
            { displayName: "Good Author", position: 0 },
            { displayName: "Broken Author", position: 1 },
          ],
        }),
      ).rejects.toThrow("forced author link failure");
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_author_link");
    }

    const workRows = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM works WHERE doi = ?`,
      ["10.9/atomic-author-import"],
    );
    const authorRows = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM authors WHERE display_name IN (?, ?)`,
      ["Good Author", "Broken Author"],
    );
    expect(workRows[0]!.n).toBe(0);
    expect(authorRows[0]!.n).toBe(0);
  });

  it("rolls back a batch import when a later work fails", async () => {
    await db.exec(
      `CREATE TEMP TRIGGER fail_batch_author_link
       BEFORE INSERT ON work_authors
       WHEN NEW.raw_name = 'Broken Batch Author'
       BEGIN
         SELECT RAISE(FAIL, 'forced batch author failure');
       END;`,
    );

    try {
      await expect(
        works.upsertMany([
          {
            title: "Batch Import Alpha",
            doi: "10.9/batch-import-alpha",
            authors: [{ displayName: "Batch Alpha Author", position: 0 }],
          },
          {
            title: "Batch Import Broken",
            doi: "10.9/batch-import-broken",
            authors: [{ displayName: "Broken Batch Author", position: 0 }],
          },
        ]),
      ).rejects.toThrow("forced batch author failure");
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_batch_author_link");
    }

    const workRows = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM works WHERE doi IN (?, ?)`,
      ["10.9/batch-import-alpha", "10.9/batch-import-broken"],
    );
    const authorRows = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM authors WHERE display_name IN (?, ?)`,
      ["Batch Alpha Author", "Broken Batch Author"],
    );
    expect(workRows[0]!.n).toBe(0);
    expect(authorRows[0]!.n).toBe(0);
  });

  it("restores a soft-deleted work when the same DOI is imported again", async () => {
    const first = await works.upsert(ATTENTION);
    await works.softDelete(first.id);

    const second = await works.upsert({ ...ATTENTION, abstract: "Restored metadata" });

    expect(second).toEqual({ id: first.id, deduped: true });
    const listed = await works.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.abstract).toContain("Restored");
  });

  it("dedups to an active stable-id match before restoring a removed duplicate", async () => {
    const removed = await works.upsert({
      title: "Removed Preprint Copy",
      arxivId: "2401.99999",
    });
    await works.softDelete(removed.id);
    const active = await works.upsert({ title: "Active Library Copy", year: 2025 });
    await db.run(`UPDATE works SET arxiv_id = ?, updated_at = ? WHERE id = ?`, [
      "2401.99999",
      Date.now(),
      active.id,
    ]);

    const imported = await works.upsert({
      title: "Incoming Preprint Metadata",
      arxivId: "2401.99999",
      abstract: "Fresh metadata for the visible work",
    });

    expect(imported).toEqual({ id: active.id, deduped: true });
    expect((await works.get(active.id))?.abstract).toBe("Fresh metadata for the visible work");
    expect((await works.get(removed.id))?.deleted_at).not.toBeNull();
    expect(await works.list()).toHaveLength(1);
  });

  it("restore() makes a soft-deleted work visible again", async () => {
    const first = await works.upsert(ATTENTION);
    await works.softDelete(first.id);
    expect(await works.list()).toHaveLength(0);

    await works.restore(first.id);

    expect(await works.list()).toHaveLength(1);
  });

  it("lists soft-deleted works only in the recycle bin", async () => {
    const first = await works.upsert(ATTENTION);
    await works.upsert({ title: "Visible Paper", year: 2024 });
    await works.softDelete(first.id);

    expect(await works.list()).toHaveLength(1);
    const deleted = await works.listDeleted();
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.id).toBe(first.id);

    await works.restore(first.id);

    expect(await works.list()).toHaveLength(2);
    expect(await works.listDeleted()).toHaveLength(0);
  });

  it("rolls back bulk soft delete when a caller hook fails", async () => {
    const first = await works.upsert({ title: "Bulk Delete Alpha", doi: "10.9/bulk-delete-a" });
    const second = await works.upsert({ title: "Bulk Delete Beta", doi: "10.9/bulk-delete-b" });

    await expect(
      works.softDeleteMany([first.id, second.id], {
        afterEach: (_workId, index) => {
          if (index === 0) throw new Error("forced bulk delete hook failure");
        },
      }),
    ).rejects.toThrow("forced bulk delete hook failure");

    expect(await works.listDeleted()).toHaveLength(0);
    expect((await works.get(first.id))?.deleted_at).toBeNull();
    expect((await works.get(second.id))?.deleted_at).toBeNull();
  });

  it("rolls back bulk restore when a caller hook fails", async () => {
    const first = await works.upsert({ title: "Bulk Restore Alpha", doi: "10.9/bulk-restore-a" });
    const second = await works.upsert({ title: "Bulk Restore Beta", doi: "10.9/bulk-restore-b" });
    await works.softDeleteMany([first.id, second.id]);

    await expect(
      works.restoreMany([first.id, second.id], {
        afterEach: (_workId, index) => {
          if (index === 0) throw new Error("forced bulk restore hook failure");
        },
      }),
    ).rejects.toThrow("forced bulk restore hook failure");

    const deletedIds = (await works.listDeleted()).map((work) => work.id).sort();
    expect(deletedIds).toEqual([first.id, second.id].sort());
    expect((await works.get(first.id))?.deleted_at).not.toBeNull();
    expect((await works.get(second.id))?.deleted_at).not.toBeNull();
  });

  it("purges a deleted work and its direct library artifacts", async () => {
    const { id: workId } = await works.upsert(ATTENTION);
    const attachment = await attachments.create({
      workId,
      sha256: "purge-pdf",
      byteSize: 2048,
      originalFilename: "purge.pdf",
    });
    await annotations.create({
      attachmentId: attachment.id,
      workId,
      type: "note",
      pageIndex: 0,
      contentMd: "remove me",
    });

    await works.softDelete(workId);
    await works.purgeDeleted(workId);

    expect(await works.get(workId)).toBeNull();
    expect(await works.listDeleted()).toHaveLength(0);
    expect(await attachments.forWork(workId)).toHaveLength(0);
  });

  it("rolls back a multi-work purge when one delete fails", async () => {
    const first = await works.upsert({ title: "Purge Rollback Alpha", doi: "10.9/purge-alpha" });
    const second = await works.upsert({ title: "Purge Rollback Beta", doi: "10.9/purge-beta" });
    await works.softDelete(first.id);
    await works.softDelete(second.id);
    await db.exec(
      `CREATE TEMP TRIGGER fail_second_purge BEFORE DELETE ON works
       WHEN OLD.id = '${second.id}'
       BEGIN
         SELECT RAISE(FAIL, 'forced purge failure');
       END;`,
    );

    try {
      await expect(works.purgeDeletedMany([first.id, second.id])).rejects.toThrow(
        "forced purge failure",
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_second_purge");
    }

    const deleted = await works.listDeleted();
    expect(deleted.map((work) => work.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("normalizes DOI input before storing", async () => {
    const { id } = await works.upsert({
      ...ATTENTION,
      doi: "https://doi.org/10.48550/ARXIV.1706.03762",
    });

    expect((await works.get(id))?.doi).toBe("10.48550/arxiv.1706.03762");
  });

  it("merges duplicate works into a primary and moves attachments and annotations", async () => {
    const primary = await works.upsert({ title: "Primary Paper", doi: "10.9/primary" });
    const duplicate = await works.upsert({
      title: "Duplicate Paper",
      doi: "10.9/duplicate",
      abstract: "Metadata to keep",
    });
    const attachment = await attachments.create({
      workId: duplicate.id,
      sha256: "pdf-hash",
      byteSize: 1234,
      originalFilename: "paper.pdf",
    });
    await annotations.create({
      attachmentId: attachment.id,
      workId: duplicate.id,
      type: "note",
      pageIndex: 0,
      contentMd: "Useful note",
    });

    const result = await works.mergeInto(primary.id, [duplicate.id]);

    expect(result).toMatchObject({ primaryId: primary.id, merged: 1, movedAttachments: 1 });
    expect(await works.list()).toHaveLength(1);
    expect((await works.get(primary.id))?.abstract).toBe("Metadata to keep");
    expect(await attachments.forWork(primary.id)).toHaveLength(1);
    const movedNotes = await annotations.listForAttachment(attachment.id);
    expect(movedNotes[0]).toMatchObject({ work_id: primary.id, content_md: "Useful note" });
  });

  it("dedups by fingerprint when no DOI", async () => {
    const a = await works.upsert({
      title: "Some Workshop Paper",
      year: 2024,
      authors: [{ displayName: "Li Wei", position: 0 }],
    });
    const b = await works.upsert({
      title: "some workshop paper!",
      year: 2024,
      authors: [{ displayName: "Li Wei", position: 0 }],
    });
    expect(b.deduped).toBe(true);
    expect(b.id).toBe(a.id);
  });

  it("searches via FTS5 with prefix matching", async () => {
    await works.upsert(ATTENTION);
    await works.upsert({ title: "Deep Residual Learning for Image Recognition", year: 2016 });
    const hits = await works.list({ search: "atten" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.title).toContain("Attention");
  });

  it("keeps list searches stable for punctuation-only and quoted input", async () => {
    const active = await works.upsert(ATTENTION);
    const deleted = await works.upsert({ title: "Deleted Attention Paper", year: 2016 });
    await works.softDelete(deleted.id);

    await expect(works.list({ search: `"" !!! ***` })).resolves.toEqual([]);
    await expect(works.listDeleted({ search: `"" !!! ***` })).resolves.toEqual([]);

    expect((await works.list({ search: `"atten"!!!` })).map((row) => row.id)).toEqual([active.id]);
    expect((await works.listDeleted({ search: `"deleted"!!!` })).map((row) => row.id)).toEqual([
      deleted.id,
    ]);
  });

  it("excludes soft-deleted works from lists", async () => {
    const { id } = await works.upsert(ATTENTION);
    await works.softDelete(id);
    expect(await works.list()).toHaveLength(0);
  });

  it("stores and reads rich bibliographic fields + keywords", async () => {
    const { id } = await works.upsert({
      title: "A Rich Paper",
      doi: "10.9/rich",
      volume: "30",
      issue: "4",
      pages: "100-120",
      publisher: "ACM",
      placePublished: "New York",
      issn: "1234-5678",
      isbn: "978-3-16",
      url: "https://x/y",
      language: "en",
      keywords: ["graphs", "ml"],
    });
    const got = await works.get(id);
    expect(got?.volume).toBe("30");
    expect(got?.issue).toBe("4");
    expect(got?.pages).toBe("100-120");
    expect(got?.publisher).toBe("ACM");
    expect(got?.issn).toBe("1234-5678");
    expect(JSON.parse(got!.keywords_json!)).toEqual(["graphs", "ml"]);
  });

  it("backfills rich fields on dedup without clobbering existing values", async () => {
    const { id } = await works.upsert({ title: "P", doi: "10.9/p", volume: "1" });
    await works.upsert({ title: "P", doi: "10.9/p", volume: "999", issue: "2", publisher: "X" });
    const got = await works.get(id);
    expect(got?.volume).toBe("1"); // existing kept
    expect(got?.issue).toBe("2"); // missing backfilled
    expect(got?.publisher).toBe("X");
  });

  it("stores and backfills Semantic Scholar ids", async () => {
    const { id } = await works.upsert({
      title: "S2 Paper",
      doi: "10.9/s2",
      s2Id: "s2-first",
    });
    expect((await works.get(id))?.s2_id).toBe("s2-first");

    const { id: missingId } = await works.upsert({ title: "Missing S2", doi: "10.9/missing-s2" });
    await works.upsert({ title: "Missing S2", doi: "10.9/missing-s2", s2Id: "s2-backfilled" });
    expect((await works.get(missingId))?.s2_id).toBe("s2-backfilled");
  });

  it("dedups by stable academic ids and backfills later DOI metadata", async () => {
    const first = await works.upsert({
      title: "Preprint Title",
      arxivId: "2401.12345",
      openalexId: "W123",
      s2Id: "S2-123",
      year: 2024,
    });
    const second = await works.upsert({
      title: "Published Title",
      doi: "10.9/published",
      arxivId: "2401.12345",
      year: 2025,
    });

    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    const got = await works.get(first.id);
    expect(got?.doi).toBe("10.9/published");
  });

  it("update() patches fields and replaces authors with roles", async () => {
    const { id } = await works.upsert({
      title: "Editable",
      authors: [{ displayName: "A One", position: 0 }],
    });
    await works.update(id, {
      volume: "12",
      pages: "1-9",
      keywords: ["k1"],
      authors: [
        { displayName: "New Author", position: 0, role: "author" },
        { displayName: "An Editor", position: 1, role: "editor" },
      ],
    });
    const got = await works.get(id);
    expect(got?.volume).toBe("12");
    expect(got?.pages).toBe("1-9");
    expect(JSON.parse(got!.keywords_json!)).toEqual(["k1"]);
    const authors = await works.authorsOf(id);
    expect(authors).toHaveLength(2);
    expect(authors[1]).toMatchObject({ displayName: "An Editor", role: "editor" });
  });

  it("update() refreshes the dedup fingerprint after title/year/author edits", async () => {
    const { id } = await works.upsert({
      title: "Original Title",
      year: 2020,
      authors: [{ displayName: "A One", position: 0 }],
    });

    await works.update(id, {
      title: "Retitled Paper",
      year: 2024,
      authors: [{ displayName: "B Two", position: 0, role: "author" }],
    });

    const rows = await db.query<{ fingerprint: string }>(
      `SELECT fingerprint FROM works WHERE id = ?`,
      [id],
    );
    expect(rows[0]?.fingerprint).toBe("retitled paper|2024|two");
  });

  it("update() leaves untouched fields alone (partial save)", async () => {
    const { id } = await works.upsert({ title: "Keep", volume: "5" });
    await works.update(id, { issue: "3" });
    const got = await works.get(id);
    expect(got?.volume).toBe("5"); // not clobbered
    expect(got?.issue).toBe("3");
  });

  it("fails work edits and state changes when the target is missing or removed", async () => {
    const { id } = await works.upsert({ title: "Stale Target", volume: "5" });
    await works.softDelete(id);

    await expect(works.update(id, { issue: "stale edit" })).rejects.toThrow(
      `Work ${id} is missing or removed`,
    );
    await expect(works.setReadingStatus(id, "read")).rejects.toThrow(
      `Work ${id} is missing or removed`,
    );
    await expect(works.setStarred(id, true)).rejects.toThrow(`Work ${id} is missing or removed`);
    await expect(works.softDelete(id)).rejects.toThrow(`Work ${id} is missing or already removed`);
    await expect(works.update("missing-work", { issue: "missing edit" })).rejects.toThrow(
      "Work missing-work is missing or removed",
    );
    await expect(works.restore("missing-work")).rejects.toThrow(
      "Work missing-work is missing or already active",
    );

    await works.restore(id);
    await expect(works.restore(id)).rejects.toThrow(`Work ${id} is missing or already active`);
    const got = await works.get(id);
    expect(got?.volume).toBe("5");
    expect(got?.issue).toBeNull();
    expect(got?.reading_status).toBe("unread");
    expect(got?.starred).toBe(0);
  });

  it("sets reading status and starred state", async () => {
    const { id } = await works.upsert({ title: "Workflow Paper" });

    await works.setReadingStatus(id, "reading");
    await works.setStarred(id, true);

    const got = await works.get(id);
    expect(got?.reading_status).toBe("reading");
    expect(got?.starred).toBe(1);
  });

  it("promotes unread works when reading starts without downgrading completed works", async () => {
    const { id } = await works.upsert({ title: "Reader Session Paper" });

    await expect(works.markReadingStarted(id)).resolves.toBe(true);
    expect((await works.get(id))?.reading_status).toBe("reading");
    await expect(works.markReadingStarted(id)).resolves.toBe(false);

    await works.setReadingStatus(id, "read");
    await expect(works.markReadingStarted(id)).resolves.toBe(false);
    expect((await works.get(id))?.reading_status).toBe("read");
  });
});

describe("AttachmentsRepo + AnnotationsRepo", () => {
  it("stores attachments content-addressed and dedups by sha", async () => {
    const { id: workId } = await works.upsert(ATTENTION);
    const a1 = await attachments.create({ workId, sha256: "abc123", byteSize: 1000 });
    const a2 = await attachments.create({ workId, sha256: "abc123", byteSize: 1000 });
    expect(a2.deduped).toBe(true);
    expect(a2.id).toBe(a1.id);
  });

  it("only dedups and attaches PDFs against active works", async () => {
    const archived = await works.upsert({ title: "Archived PDF Work" });
    await attachments.create({ workId: archived.id, sha256: "archived-pdf", byteSize: 1000 });
    await works.softDelete(archived.id);

    await expect(
      attachments.create({ workId: archived.id, sha256: "second-pdf", byteSize: 1000 }),
    ).rejects.toThrow(`Work ${archived.id} is missing or removed`);
    await expect(
      attachments.create({ workId: "missing-work", sha256: "missing-pdf", byteSize: 1000 }),
    ).rejects.toThrow("Work missing-work is missing or removed");
    expect(await attachments.bySha("archived-pdf")).toBeNull();
    expect(await attachments.forWork(archived.id)).toHaveLength(0);

    const active = await works.upsert({ title: "Active PDF Work" });
    const attached = await attachments.create({
      workId: active.id,
      sha256: "archived-pdf",
      byteSize: 1000,
    });

    expect(attached.deduped).toBe(false);
    expect(await attachments.forWork(active.id)).toHaveLength(1);
  });

  it("fails annotation creation when the attachment target is stale or mismatched", async () => {
    const first = await works.upsert({ title: "First Annotated Work" });
    const second = await works.upsert({ title: "Second Annotated Work" });
    const firstAttachment = await attachments.create({
      workId: first.id,
      sha256: "first-annotation-pdf",
      byteSize: 1000,
    });

    await expect(
      annotations.create({
        attachmentId: firstAttachment.id,
        workId: second.id,
        type: "note",
        pageIndex: 0,
      }),
    ).rejects.toThrow(
      `Attachment ${firstAttachment.id} is missing, removed, or not active for work ${second.id}`,
    );

    await works.softDelete(first.id);

    await expect(
      annotations.create({
        attachmentId: firstAttachment.id,
        workId: first.id,
        type: "note",
        pageIndex: 0,
      }),
    ).rejects.toThrow(
      `Attachment ${firstAttachment.id} is missing, removed, or not active for work ${first.id}`,
    );
  });

  it("hides and rejects annotation operations when the source work is removed", async () => {
    const { id: workId } = await works.upsert({ title: "Archived Annotated Work" });
    const { id: attachmentId } = await attachments.create({
      workId,
      sha256: "archived-annotations",
      byteSize: 1000,
    });
    const annId = await annotations.create({
      attachmentId,
      workId,
      type: "note",
      pageIndex: 0,
      contentMd: "original",
    });

    await works.softDelete(workId);

    expect(await attachments.forWork(workId)).toHaveLength(0);
    expect(await annotations.listForAttachment(attachmentId)).toHaveLength(0);
    await expect(annotations.updateContent(annId, "stale edit")).rejects.toThrow(
      `Annotation ${annId} is missing or removed`,
    );
    await expect(annotations.setOrphaned(annId, true)).rejects.toThrow(
      `Annotation ${annId} is missing or removed`,
    );
    await expect(annotations.softDelete(annId)).rejects.toThrow(
      `Annotation ${annId} is missing or already removed`,
    );

    await db.run(`UPDATE annotations SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      Date.now(),
      Date.now(),
      annId,
    ]);

    await expect(annotations.restore(annId)).rejects.toThrow(
      `Annotation ${annId} is missing or already active`,
    );
  });

  it("persists annotations with anchors and orders by sort_key", async () => {
    const { id: workId } = await works.upsert(ATTENTION);
    const { id: attachmentId } = await attachments.create({ workId, sha256: "x", byteSize: 1 });

    await annotations.create({
      attachmentId,
      workId,
      type: "highlight",
      color: "#ffd866",
      pageIndex: 2,
      anchor: {
        version: 1,
        pageIndex: 2,
        quote: { exact: "later text", prefix: "", suffix: "" },
        quads: { pageIndex: 2, rects: [{ x1: 0, y1: 700, x2: 10, y2: 710 }] },
      },
    });
    await annotations.create({
      attachmentId,
      workId,
      type: "highlight",
      color: "#a9dc76",
      pageIndex: 0,
      anchor: {
        version: 1,
        pageIndex: 0,
        quote: { exact: "early text", prefix: "", suffix: "" },
        quads: { pageIndex: 0, rects: [{ x1: 0, y1: 100, x2: 10, y2: 110 }] },
      },
    });

    const list = await annotations.listForAttachment(attachmentId);
    expect(list).toHaveLength(2);
    expect(list[0]!.page_index).toBe(0); // page order wins
    const anchor = JSON.parse(list[0]!.anchor_json!);
    expect(anchor.quote.exact).toBe("early text");
  });

  it("soft-deletes annotations", async () => {
    const { id: workId } = await works.upsert(ATTENTION);
    const { id: attachmentId } = await attachments.create({ workId, sha256: "y", byteSize: 1 });
    const annId = await annotations.create({
      attachmentId,
      workId,
      type: "note",
      pageIndex: 0,
      contentMd: "想法",
    });
    await annotations.softDelete(annId);
    expect(await annotations.listForAttachment(attachmentId)).toHaveLength(0);
  });

  it("fails annotation edits and deletes when the target is missing or removed", async () => {
    const { id: workId } = await works.upsert(ATTENTION);
    const { id: attachmentId } = await attachments.create({
      workId,
      sha256: "missing-ann",
      byteSize: 1,
    });
    const annId = await annotations.create({
      attachmentId,
      workId,
      type: "note",
      pageIndex: 0,
      contentMd: "original",
    });

    await annotations.softDelete(annId);

    await expect(annotations.updateContent(annId, "stale edit")).rejects.toThrow(
      `Annotation ${annId} is missing or removed`,
    );
    await expect(annotations.softDelete(annId)).rejects.toThrow(
      `Annotation ${annId} is missing or already removed`,
    );
    await expect(annotations.restore("missing-annotation")).rejects.toThrow(
      "Annotation missing-annotation is missing or already active",
    );
    const rows = await db.query<{ content_md: string | null }>(
      `SELECT content_md FROM annotations WHERE id = ?`,
      [annId],
    );
    expect(rows[0]!.content_md).toBe("original");
  });

  it("restores soft-deleted annotations", async () => {
    const { id: workId } = await works.upsert(ATTENTION);
    const { id: attachmentId } = await attachments.create({ workId, sha256: "z", byteSize: 1 });
    const annId = await annotations.create({
      attachmentId,
      workId,
      type: "note",
      pageIndex: 0,
      contentMd: "可恢复想法",
    });
    await annotations.softDelete(annId);
    await annotations.restore(annId);

    const list = await annotations.listForAttachment(attachmentId);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(annId);
    expect(list[0]!.content_md).toBe("可恢复想法");
    await expect(annotations.restore(annId)).rejects.toThrow(
      `Annotation ${annId} is missing or already active`,
    );
  });
});

describe("CollectionsRepo", () => {
  it("creates nested collections only under an active parent", async () => {
    const parentId = await collections.create("研究项目");
    const childId = await collections.create("Transformer 综述", parentId);

    const rows = await collections.list();
    expect(rows.find((row) => row.id === childId)?.parent_id).toBe(parentId);
    await expect(collections.create("孤立文件夹", "missing-parent")).rejects.toThrow(
      "Collection missing-parent is missing or removed",
    );
    await expect(collections.create("   ")).rejects.toThrow("分组名称不能为空");
  });

  it("persists sibling order and supports moving folders across levels", async () => {
    const first = await collections.create("First");
    const second = await collections.create("Second");
    const third = await collections.create("Third");

    await collections.move(third, null, 0);
    expect(
      (await collections.list()).filter((row) => row.parent_id === null).map((row) => row.id),
    ).toEqual([third, first, second]);

    await collections.move(second, first, 0);
    const nested = await collections.list();
    expect(nested.find((row) => row.id === second)?.parent_id).toBe(first);
    expect(nested.find((row) => row.id === second)?.sort_order).toBe(0);
  });

  it("rejects collection moves that would create a hierarchy cycle", async () => {
    const parent = await collections.create("Parent");
    const child = await collections.create("Child", parent);

    await expect(collections.move(parent, child, 0)).rejects.toThrow(
      "文件夹不能移动到自己的子文件夹中",
    );
    await expect(collections.move(parent, parent, 0)).rejects.toThrow("文件夹不能移动到自身");
  });

  it("restores a deleted collection with its previous works", async () => {
    const { id: workId } = await works.upsert(ATTENTION);
    const collectionId = await collections.create("可恢复文件夹");
    await collections.setWorkCollection(workId, collectionId);

    const workIds = await collections.workIds(collectionId);
    await collections.softDelete(collectionId);
    expect(await collections.list()).toHaveLength(0);
    expect(await collections.collectionOf(workId)).toBeNull();

    await collections.restore(collectionId, workIds);

    const list = await collections.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(collectionId);
    expect(list[0]!.count).toBe(1);
    expect(await collections.collectionOf(workId)).toBe(collectionId);
  });

  it("fails collection edits, moves, and state changes when targets are stale", async () => {
    const { id: workId } = await works.upsert({ title: "Stale Collection Work" });
    const collectionId = await collections.create("过期文件夹");
    await collections.softDelete(collectionId);

    await expect(collections.rename(collectionId, "新名称")).rejects.toThrow(
      `Collection ${collectionId} is missing or removed`,
    );
    await expect(collections.softDelete(collectionId)).rejects.toThrow(
      `Collection ${collectionId} is missing or already removed`,
    );
    await expect(collections.setWorkCollection(workId, collectionId)).rejects.toThrow(
      `Collection ${collectionId} is missing or removed`,
    );
    await expect(collections.rename("missing-collection", "新名称")).rejects.toThrow(
      "Collection missing-collection is missing or removed",
    );
    await expect(collections.restore("missing-collection")).rejects.toThrow(
      "Collection missing-collection is missing or already active",
    );
    await expect(collections.setWorkCollection(workId, "missing-collection")).rejects.toThrow(
      "Collection missing-collection is missing or removed",
    );

    await collections.restore(collectionId);

    await expect(collections.restore(collectionId)).rejects.toThrow(
      `Collection ${collectionId} is missing or already active`,
    );

    await works.softDelete(workId);

    await expect(collections.setWorkCollection(workId, collectionId)).rejects.toThrow(
      `Work ${workId} is missing or removed`,
    );
  });

  it("ignores stale collection links for removed works and removed folders", async () => {
    const active = await works.upsert({ title: "Active Collection Link" });
    const removed = await works.upsert({ title: "Removed Collection Link" });
    const visibleCollectionId = await collections.create("可见文件夹");
    const removedCollectionId = await collections.create("已删除文件夹");
    await collections.setWorkCollection(active.id, visibleCollectionId);
    await collections.setWorkCollection(removed.id, visibleCollectionId);

    await works.softDelete(removed.id);
    await db.run(`UPDATE collections SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      Date.now(),
      Date.now(),
      removedCollectionId,
    ]);
    await db.run(`INSERT INTO collection_items (collection_id, work_id) VALUES (?, ?)`, [
      removedCollectionId,
      active.id,
    ]);

    expect(await collections.workIds(visibleCollectionId)).toEqual([active.id]);
    expect(await collections.workIds(removedCollectionId)).toEqual([]);
    expect(await collections.collectionOf(active.id)).toBe(visibleCollectionId);
    expect(await collections.collectionOf(removed.id)).toBeNull();
    expect(await collections.collectionsOf([active.id, removed.id])).toEqual(
      new Map([[active.id, visibleCollectionId]]),
    );
  });

  it("rolls back collection deletion when marking the folder deleted fails", async () => {
    const { id: workId } = await works.upsert(ATTENTION);
    const collectionId = await collections.create("删除失败文件夹");
    await collections.setWorkCollection(workId, collectionId);
    await db.exec(`
      CREATE TEMP TRIGGER fail_collection_soft_delete
      BEFORE UPDATE OF deleted_at ON collections
      WHEN NEW.deleted_at IS NOT NULL
      BEGIN
        SELECT RAISE(FAIL, 'forced collection delete failure');
      END;
    `);

    try {
      await expect(collections.softDelete(collectionId)).rejects.toThrow(
        "forced collection delete failure",
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_collection_soft_delete");
    }

    const list = await collections.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(collectionId);
    expect(await collections.collectionOf(workId)).toBe(collectionId);
  });

  it("rolls back collection restore when a work reassignment fails", async () => {
    const first = await works.upsert({ title: "Restore Rollback Alpha", doi: "10.9/restore-a" });
    const second = await works.upsert({ title: "Restore Rollback Beta", doi: "10.9/restore-b" });
    const collectionId = await collections.create("恢复失败文件夹");
    await collections.setWorkCollection(first.id, collectionId);
    await collections.setWorkCollection(second.id, collectionId);

    const workIds = await collections.workIds(collectionId);
    await collections.softDelete(collectionId);
    await db.exec(`
      CREATE TEMP TRIGGER fail_collection_restore_item
      BEFORE INSERT ON collection_items
      WHEN NEW.work_id = '${second.id}'
      BEGIN
        SELECT RAISE(FAIL, 'forced collection restore failure');
      END;
    `);

    try {
      await expect(collections.restore(collectionId, workIds)).rejects.toThrow(
        "forced collection restore failure",
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_collection_restore_item");
    }

    const list = await collections.list();
    const itemRows = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM collection_items WHERE collection_id = ?`,
      [collectionId],
    );
    expect(list.some((collection) => collection.id === collectionId)).toBe(false);
    expect(itemRows[0]!.n).toBe(0);
    expect(await collections.collectionOf(first.id)).toBeNull();
    expect(await collections.collectionOf(second.id)).toBeNull();
  });

  it("rolls back a work move when assigning the target folder fails", async () => {
    const { id: workId } = await works.upsert(ATTENTION);
    const currentCollectionId = await collections.create("当前文件夹");
    const targetCollectionId = await collections.create("目标文件夹");
    await collections.setWorkCollection(workId, currentCollectionId);
    await db.exec(`
      CREATE TEMP TRIGGER fail_collection_move_item
      BEFORE INSERT ON collection_items
      WHEN NEW.collection_id = '${targetCollectionId}'
      BEGIN
        SELECT RAISE(FAIL, 'forced collection move failure');
      END;
    `);

    try {
      await expect(collections.setWorkCollection(workId, targetCollectionId)).rejects.toThrow(
        "forced collection move failure",
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_collection_move_item");
    }

    expect(await collections.collectionOf(workId)).toBe(currentCollectionId);
  });

  it("rolls back bulk collection moves when a caller hook fails", async () => {
    const first = await works.upsert({ title: "Bulk Move Alpha", doi: "10.9/bulk-move-a" });
    const second = await works.upsert({ title: "Bulk Move Beta", doi: "10.9/bulk-move-b" });
    const currentCollectionId = await collections.create("批量移动当前文件夹");
    const targetCollectionId = await collections.create("批量移动目标文件夹");
    await collections.setWorksCollection([first.id, second.id], currentCollectionId);

    await expect(
      collections.setWorksCollection([first.id, second.id], targetCollectionId, {
        afterEach: (_workId, index) => {
          if (index === 0) throw new Error("forced bulk collection move hook failure");
        },
      }),
    ).rejects.toThrow("forced bulk collection move hook failure");

    expect(await collections.collectionOf(first.id)).toBe(currentCollectionId);
    expect(await collections.collectionOf(second.id)).toBe(currentCollectionId);
  });

  it("rolls back bulk collection clears when a caller hook fails", async () => {
    const first = await works.upsert({ title: "Bulk Clear Alpha", doi: "10.9/bulk-clear-a" });
    const second = await works.upsert({ title: "Bulk Clear Beta", doi: "10.9/bulk-clear-b" });
    const collectionId = await collections.create("批量移出文件夹");
    await collections.setWorksCollection([first.id, second.id], collectionId);

    await expect(
      collections.setWorksCollection([first.id, second.id], null, {
        afterEach: (_workId, index) => {
          if (index === 0) throw new Error("forced bulk collection clear hook failure");
        },
      }),
    ).rejects.toThrow("forced bulk collection clear hook failure");

    expect(await collections.collectionOf(first.id)).toBe(collectionId);
    expect(await collections.collectionOf(second.id)).toBe(collectionId);
  });

  it("can move a work inside an existing outer transaction", async () => {
    const { id: workId } = await works.upsert(ATTENTION);
    const collectionId = await collections.create("外层事务文件夹");
    let committed = false;
    await db.exec("BEGIN");
    try {
      await collections.setWorkCollection(workId, collectionId);
      await db.exec("COMMIT");
      committed = true;
    } finally {
      if (!committed) {
        try {
          await db.exec("ROLLBACK");
        } catch {
          // Ignore cleanup errors; the assertion should surface the original failure.
        }
      }
    }

    expect(await collections.collectionOf(workId)).toBe(collectionId);
  });
});
