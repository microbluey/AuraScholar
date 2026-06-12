import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { runMigrations } from "../migrations";
import { WorksRepo } from "./works";
import { AnnotationsRepo } from "./annotations";
import { AttachmentsRepo } from "./attachments";

let db: Database;
let works: WorksRepo;
let annotations: AnnotationsRepo;
let attachments: AttachmentsRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  works = new WorksRepo(db);
  annotations = new AnnotationsRepo(db);
  attachments = new AttachmentsRepo(db);
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

  it("dedups by fingerprint when no DOI", async () => {
    const a = await works.upsert({ title: "Some Workshop Paper", year: 2024, authors: [{ displayName: "Li Wei", position: 0 }] });
    const b = await works.upsert({ title: "some workshop paper!", year: 2024, authors: [{ displayName: "Li Wei", position: 0 }] });
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

  it("excludes soft-deleted works from lists", async () => {
    const { id } = await works.upsert(ATTENTION);
    await works.softDelete(id);
    expect(await works.list()).toHaveLength(0);
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

  it("persists annotations with anchors and orders by sort_key", async () => {
    const { id: workId } = await works.upsert(ATTENTION);
    const { id: attachmentId } = await attachments.create({ workId, sha256: "x", byteSize: 1 });

    await annotations.create({
      attachmentId,
      workId,
      type: "highlight",
      color: "#ffd866",
      pageIndex: 2,
      anchor: { version: 1, pageIndex: 2, quote: { exact: "later text", prefix: "", suffix: "" }, quads: { pageIndex: 2, rects: [{ x1: 0, y1: 700, x2: 10, y2: 710 }] } },
    });
    await annotations.create({
      attachmentId,
      workId,
      type: "highlight",
      color: "#a9dc76",
      pageIndex: 0,
      anchor: { version: 1, pageIndex: 0, quote: { exact: "early text", prefix: "", suffix: "" }, quads: { pageIndex: 0, rects: [{ x1: 0, y1: 100, x2: 10, y2: 110 }] } },
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
    const annId = await annotations.create({ attachmentId, workId, type: "note", pageIndex: 0, contentMd: "想法" });
    await annotations.softDelete(annId);
    expect(await annotations.listForAttachment(attachmentId)).toHaveLength(0);
  });
});
