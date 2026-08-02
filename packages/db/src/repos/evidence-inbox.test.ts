import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { requireLocalLibraryId } from "../local-first";
import { runMigrations } from "../migrations";
import { AttachmentsRepo } from "./attachments";
import { DocumentAssetsRepo } from "./document-assets";
import { EvidenceRepo } from "./evidence";
import { EvidenceInboxRepo } from "./evidence-inbox";
import { ResearchProjectsRepo } from "./research-projects";
import { WorksRepo } from "./works";

const HASH = "a".repeat(64);
const NEXT_HASH = "b".repeat(64);

let db: Database;
let libraryId: string;
let works: WorksRepo;
let attachments: AttachmentsRepo;
let documents: DocumentAssetsRepo;
let evidence: EvidenceRepo;
let inbox: EvidenceInboxRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryId = await requireLocalLibraryId(db);
  works = new WorksRepo(db, libraryId);
  attachments = new AttachmentsRepo(db, libraryId);
  documents = new DocumentAssetsRepo(db, libraryId);
  evidence = new EvidenceRepo(db, libraryId);
  inbox = new EvidenceInboxRepo(db, libraryId);
});

async function seedEvidence(id = "evidence:inbox") {
  const work = await works.upsert({
    title: "Causal Forests in Practice",
    year: 2024,
    authors: [
      { displayName: "Ada Lovelace", position: 0 },
      { displayName: "Grace Hopper", position: 1 },
    ],
  });
  const attachment = await attachments.create({
    workId: work.id,
    sha256: HASH,
    byteSize: 4_096,
    originalFilename: "causal-forests.pdf",
    pageCount: 8,
  });
  const revision = await documents.resolveAttachment(attachment.id);
  if (!revision) throw new Error("Seeded revision is missing");
  const created = await evidence.createText({
    id,
    workId: work.id,
    attachmentId: attachment.id,
    expectedBlobSha256: HASH,
    anchor: {
      version: 1,
      kind: "pdf",
      pageIndex: 3,
      quote: { exact: "The estimator is asymptotically normal." },
    },
    text: "The estimator is asymptotically normal.",
    evidenceKind: "method",
    title: "Asymptotic result",
    noteMd: "Compare this with the bootstrap result.",
    tags: ["inference", "forest"],
  });
  return { attachment, revision, work, created: created.evidence };
}

describe("EvidenceInboxRepo", () => {
  it("returns exact historical revision metadata, source authors, page, and memberships", async () => {
    const source = await seedEvidence();
    const project = await new ResearchProjectsRepo(db, libraryId).create({ name: "Causal work" });
    await new ResearchProjectsRepo(db, libraryId).addWorks(project.id, [source.work.id]);
    await evidence.addToProject(project.id, source.created.id);
    await documents.createRevision(source.revision.asset_id, {
      mimeType: "application/pdf",
      blobSha256: NEXT_HASH,
      byteSize: 8_192,
      expectedCurrentRevisionId: source.revision.id,
    });

    const result = await inbox.search({
      scope: { kind: "project", projectId: project.id },
      revisionStatuses: ["historical"],
      query: "Lovelace",
    });

    expect(result.total).toBe(1);
    expect(result.evidence[0]).toMatchObject({
      attachmentId: source.attachment.id,
      authorNames: ["Ada Lovelace", "Grace Hopper"],
      pageIndex: 3,
      revisionNo: source.revision.revision_no,
      workTitle: "Causal Forests in Practice",
      year: 2024,
      projectMemberships: [{ projectId: project.id, projectName: "Causal work" }],
      evidence: {
        id: source.created.id,
        revisionId: source.revision.id,
        revisionStatus: "historical",
      },
    });
  });

  it("searches before pagination and treats LIKE metacharacters literally", async () => {
    const source = await seedEvidence("evidence:template");
    for (let index = 0; index < 205; index += 1) {
      const title =
        index === 204
          ? "Needle after two hundred"
          : index === 203
            ? "Literal 100% confidence"
            : index === 202
              ? "Literal a_b"
              : `Bulk Evidence ${index}`;
      await cloneEvidence(db, source.created.id, `evidence:bulk:${index}`, title, index);
    }

    const needle = await inbox.search({
      scope: { kind: "library" },
      query: "Needle after two hundred",
      limit: 10,
    });
    expect(needle.total).toBe(1);
    expect(needle.evidence[0]?.evidence.id).toBe("evidence:bulk:204");

    const percent = await inbox.search({ scope: { kind: "library" }, query: "100%" });
    expect(percent.evidence.map((item) => item.evidence.id)).toEqual(["evidence:bulk:203"]);
    const underscore = await inbox.search({ scope: { kind: "library" }, query: "a_b" });
    expect(underscore.evidence.map((item) => item.evidence.id)).toEqual(["evidence:bulk:202"]);

    await cloneEvidence(db, source.created.id, "evidence:tie:a", "Tie pagination", 500);
    await cloneEvidence(db, source.created.id, "evidence:tie:b", "Tie pagination", 500);
    const firstPage = await inbox.search({
      scope: { kind: "library" },
      query: "Tie pagination",
      limit: 1,
      offset: 0,
    });
    const secondPage = await inbox.search({
      scope: { kind: "library" },
      query: "Tie pagination",
      limit: 1,
      offset: 1,
    });
    expect(firstPage.total).toBe(2);
    expect(firstPage.evidence[0]?.evidence.id).toBe("evidence:tie:b");
    expect(secondPage.evidence[0]?.evidence.id).toBe("evidence:tie:a");
  });

  it("supports Inbox, kind, availability, and canonical source filters", async () => {
    const source = await seedEvidence();
    await db.run(`UPDATE document_revisions SET availability_status = 'missing' WHERE id = ?`, [
      source.revision.id,
    ]);
    expect(
      await inbox.search({
        scope: { kind: "inbox" },
        evidenceKinds: ["method"],
        availabilityStatuses: ["missing"],
      }),
    ).toMatchObject({ total: 1 });

    await db.run(`UPDATE document_revisions SET deleted_at = ? WHERE id = ?`, [
      Date.now(),
      source.revision.id,
    ]);
    const removed = await inbox.search({
      scope: { kind: "library" },
      canonicalStatuses: ["revision-removed"],
    });
    expect(removed.evidence[0]?.evidence.canonicalStatus).toBe("revision-removed");
    expect(
      await inbox.search({ scope: { kind: "library" }, canonicalStatuses: ["active"] }),
    ).toMatchObject({ total: 0 });
  });

  it("returns Evidence to Inbox when its only Project membership is archived", async () => {
    const source = await seedEvidence();
    const projects = new ResearchProjectsRepo(db, libraryId);
    const archived = await projects.create({ name: "Archived synthesis" });
    await projects.create({ name: "Active destination" });
    await projects.addWorks(archived.id, [source.work.id]);
    await evidence.addToProject(archived.id, source.created.id);
    await projects.archive(archived.id);

    const result = await inbox.search({ scope: { kind: "inbox" } });
    expect(result.total).toBe(1);
    expect(result.evidence[0]).toMatchObject({
      evidence: { id: source.created.id },
      projectMemberships: [],
    });
    await expect(
      inbox.search({ scope: { kind: "project", projectId: archived.id } }),
    ).rejects.toThrow("missing, archived, or removed");
  });

  it("fails closed for a Project in another Library", async () => {
    await seedEvidence();
    const foreignLibraryId = "library:evidence-inbox-foreign";
    const now = Date.now();
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES (?, 'Foreign', 'personal', ?, ?, NULL)`,
      [foreignLibraryId, now, now],
    );
    const foreignProject = await new ResearchProjectsRepo(db, foreignLibraryId).ensureDefault();

    await expect(
      inbox.search({ scope: { kind: "project", projectId: foreignProject.id } }),
    ).rejects.toThrow("missing, archived, or removed");
    expect(await inbox.search({ scope: { kind: "library" } })).toMatchObject({ total: 1 });
  });
});

async function cloneEvidence(
  database: Database,
  templateId: string,
  id: string,
  title: string,
  ordinal: number,
): Promise<void> {
  await database.run(
    `INSERT INTO evidence_items
       (id, library_id, work_id, asset_id, revision_id, source_kind, evidence_kind,
        anchor_json, payload_kind, payload_json, title, note_md, tags_json,
        source_content_hash, provenance_json, created_at, updated_at, deleted_at)
     SELECT ?, library_id, work_id, asset_id, revision_id, source_kind, evidence_kind,
            anchor_json, payload_kind, payload_json, ?, note_md, tags_json,
            source_content_hash, provenance_json, created_at + ?, updated_at + ?, NULL
     FROM evidence_items WHERE id = ?`,
    [id, title, ordinal + 1, ordinal + 1, templateId],
  );
}
