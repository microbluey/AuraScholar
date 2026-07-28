import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { runMigrations } from "../migrations";
import { AnnotationsRepo } from "./annotations";
import { AttachmentsRepo } from "./attachments";
import { WorksRepo } from "./works";

let db: Database;
let libraryA: string;
const libraryB = "library:child-scope-b";

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  const libraries = await db.query<{ id: string }>(
    `SELECT id FROM libraries WHERE deleted_at IS NULL LIMIT 1`,
  );
  libraryA = libraries[0]!.id;
  const now = Date.now();
  await db.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, 'Library B', 'personal', ?, ?)`,
    [libraryB, now, now],
  );
});

describe("Library-scoped child repositories", () => {
  it("scopes attachment creation and content-hash lookup through the owning Work", async () => {
    const workB = (await new WorksRepo(db, libraryB).upsert({ title: "Private B" })).id;
    const attachmentsA = new AttachmentsRepo(db, libraryA);
    const attachmentsB = new AttachmentsRepo(db, libraryB);

    await expect(
      attachmentsA.create({
        workId: workB,
        sha256: "sha-private-b",
        byteSize: 42,
      }),
    ).rejects.toThrow(`Work ${workB} is missing or removed`);

    await attachmentsB.create({
      workId: workB,
      sha256: "sha-private-b",
      byteSize: 42,
    });
    expect(await attachmentsA.bySha("sha-private-b")).toBeNull();
    expect((await attachmentsB.bySha("sha-private-b"))?.work_id).toBe(workB);
  });

  it("rejects cross-Library annotation creation and id-based mutation", async () => {
    const workB = (await new WorksRepo(db, libraryB).upsert({ title: "Annotated B" })).id;
    const attachmentB = await new AttachmentsRepo(db, libraryB).create({
      workId: workB,
      sha256: "sha-annotation-b",
      byteSize: 84,
    });
    const annotationsA = new AnnotationsRepo(db, libraryA);
    const annotationsB = new AnnotationsRepo(db, libraryB);

    await expect(
      annotationsA.create({
        attachmentId: attachmentB.id,
        workId: workB,
        type: "highlight",
        pageIndex: 0,
      }),
    ).rejects.toThrow(`Attachment ${attachmentB.id} is missing`);

    const annotationB = await annotationsB.create({
      attachmentId: attachmentB.id,
      workId: workB,
      type: "highlight",
      pageIndex: 0,
      contentMd: "Library B note",
    });
    await expect(annotationsA.updateContent(annotationB, "cross-library edit")).rejects.toThrow(
      `Annotation ${annotationB} is missing or removed`,
    );
    expect(await annotationsA.listForAttachment(attachmentB.id)).toEqual([]);
    expect(await annotationsB.listForAttachment(attachmentB.id)).toHaveLength(1);
  });
});
