import { AnnotationsRepo, AttachmentsRepo, type Database, WorksRepo } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DataCommandInput,
  DataCommandName,
  DataCommandOutput,
} from "../data-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand } from "./data-commands";
import type { DataCommandDependencies } from "./data-command-runtime";
import {
  MAX_CANVAS_INGRESS_AUTHOR_ROWS,
  MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
  MAX_CANVAS_INGRESS_OUTPUT_BYTES,
} from "./canvas-ingress-queries";

let database: Database;
let dependencies: DataCommandDependencies;
let libraryId: string;
let works: WorksRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "canvas-ingress-query-device",
    deviceName: "Canvas ingress queries",
    platform: "test",
  }));
  const coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
  works = new WorksRepo(database, libraryId);
});

function command<K extends DataCommandName>(
  name: K,
  input: DataCommandInput<K>,
): Promise<DataCommandOutput<K>> {
  return executeDataCommand({ input, name }, dependencies) as Promise<DataCommandOutput<K>>;
}

async function addAttachment(workId: string, sha256: string): Promise<{ id: string }> {
  return new AttachmentsRepo(database, libraryId).create({
    byteSize: 42,
    sha256,
    workId,
  });
}

describe("Canvas ingress query boundaries", () => {
  it("returns only command-owned Canvas ingress fields", async () => {
    const work = await works.upsert({
      abstract: "A private Canvas abstract",
      authors: [{ displayName: "Canvas Metadata Author", position: 0 }],
      cslJson: { privateFixture: "work-csl-secret" },
      doi: "10.1000/canvas-projection",
      title: "Canvas metadata projection",
      venueName: "Canvas Journal",
      year: 2026,
    });
    const attachment = await addAttachment(work.id, "canvas-projection-pdf");
    const annotationId = await new AnnotationsRepo(database, libraryId).create({
      anchor: {
        pageIndex: 0,
        quote: { exact: "projection quote", prefix: "", suffix: "" },
        version: 1,
      },
      attachmentId: attachment.id,
      contentMd: "Canvas projection note",
      inkPaths: [{ points: [0, 1, 2] }],
      pageIndex: 0,
      type: "highlight",
      workId: work.id,
    });
    await database.exec(`ALTER TABLE works ADD COLUMN canvas_runtime_secret TEXT`);
    await database.exec(`ALTER TABLE annotations ADD COLUMN canvas_runtime_secret TEXT`);
    await database.run(
      `UPDATE works
       SET notes_md = ?, canvas_runtime_secret = ?
       WHERE id = ?`,
      ["work-notes-secret", "work-runtime-secret", work.id],
    );
    await database.run(`UPDATE annotations SET canvas_runtime_secret = ? WHERE id = ?`, [
      "annotation-runtime-secret",
      annotationId,
    ]);

    const active = await command("canvas.getActiveWork", { workId: work.id });
    const ingress = await command("canvas.getAnnotationIngressSource", {
      annotationId,
      workId: work.id,
    });

    expect(Object.keys(active.work ?? {}).sort()).toEqual([
      "abstract",
      "authorNames",
      "doi",
      "id",
      "reading_status",
      "title",
      "venue_name",
      "year",
    ]);
    expect(Object.keys(ingress.source?.work ?? {}).sort()).toEqual([
      "abstract",
      "authorNames",
      "deleted_at",
      "doi",
      "id",
      "reading_status",
      "title",
      "venue_name",
      "year",
    ]);
    expect(Object.keys(ingress.source?.annotation ?? {}).sort()).toEqual([
      "anchor_json",
      "attachment_id",
      "color",
      "content_md",
      "id",
      "orphaned",
      "page_index",
      "type",
      "work_id",
    ]);
    const serialized = JSON.stringify({ active, ingress });
    expect(serialized).not.toContain("runtime-secret");
    expect(serialized).not.toContain("work-csl-secret");
    expect(serialized).not.toContain("work-notes-secret");
    expect(serialized).not.toContain("ink_paths_json");
  });

  it("rejects an oversized Canvas ingress author list before it crosses IPC", async () => {
    const work = await works.upsert({
      authors: Array.from({ length: MAX_CANVAS_INGRESS_AUTHOR_ROWS + 1 }, (_, index) => ({
        displayName: `Canvas bound author ${index}`,
        position: index,
      })),
      title: "Canvas ingress author row bound",
    });

    await expect(command("canvas.getActiveWork", { workId: work.id })).rejects.toThrow(
      `Canvas ingress work authors are limited to ${MAX_CANVAS_INGRESS_AUTHOR_ROWS}`,
    );
  });

  it("omits oversized Canvas ingress metadata before it is serialized", async () => {
    const oversizedMetadata = "m".repeat(MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES + 1);
    const oversizedAnnotation = "a".repeat(64 * 1024 + 1);
    const work = await works.upsert({
      abstract: oversizedMetadata,
      authors: [{ displayName: oversizedMetadata, position: 0 }],
      doi: oversizedMetadata,
      title: oversizedMetadata,
      venueName: oversizedMetadata,
    });
    const attachment = await addAttachment(work.id, "canvas-oversized-metadata-pdf");
    const annotationId = await new AnnotationsRepo(database, libraryId).create({
      attachmentId: attachment.id,
      pageIndex: 0,
      type: "note",
      workId: work.id,
    });
    await database.run(`UPDATE works SET reading_status = ? WHERE id = ?`, [
      oversizedMetadata,
      work.id,
    ]);
    await database.run(
      `UPDATE annotations
       SET type = ?, color = ?, page_index = ?, anchor_json = ?, content_md = ?
       WHERE id = ?`,
      [
        oversizedMetadata,
        oversizedMetadata,
        -1,
        JSON.stringify({
          pageIndex: 0,
          quote: { exact: oversizedAnnotation, prefix: "", suffix: "" },
          version: 1,
        }),
        oversizedAnnotation,
        annotationId,
      ],
    );

    await expect(command("canvas.getActiveWork", { workId: work.id })).resolves.toEqual({
      work: expect.objectContaining({
        abstract: null,
        authorNames: ["Unknown author"],
        doi: null,
        id: work.id,
        reading_status: "unread",
        title: "Untitled work",
        venue_name: null,
      }),
    });
    await expect(
      command("canvas.getAnnotationIngressSource", { annotationId, workId: work.id }),
    ).resolves.toEqual({
      source: expect.objectContaining({
        annotation: expect.objectContaining({
          anchor_json: null,
          color: null,
          content_md: null,
          id: annotationId,
          orphaned: 1,
          page_index: 0,
          type: "note",
        }),
      }),
    });
  });

  it("rejects Canvas ingress envelopes that exceed the serialized output budget", async () => {
    const work = await works.upsert({
      authors: Array.from({ length: MAX_CANVAS_INGRESS_AUTHOR_ROWS }, (_, index) => {
        const prefix = `Canvas output author ${index}:`;
        return {
          displayName: `${prefix}${"o".repeat(MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES - prefix.length)}`,
          position: index,
        };
      }),
      title: "Canvas ingress output bound",
    });
    const attachment = await addAttachment(work.id, "canvas-output-bound-pdf");
    const annotationId = await new AnnotationsRepo(database, libraryId).create({
      attachmentId: attachment.id,
      pageIndex: 0,
      type: "note",
      workId: work.id,
    });

    await expect(command("canvas.getActiveWork", { workId: work.id })).rejects.toThrow(
      `Canvas ingress output is limited to ${MAX_CANVAS_INGRESS_OUTPUT_BYTES} bytes`,
    );
    await expect(
      command("canvas.getAnnotationIngressSource", { annotationId, workId: work.id }),
    ).rejects.toThrow(`Canvas ingress output is limited to ${MAX_CANVAS_INGRESS_OUTPUT_BYTES} bytes`);
  });
});
