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

let database: Database;
let dependencies: DataCommandDependencies;
let libraryId: string;
let works: WorksRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "canvas-page-command-device",
    deviceName: "Canvas page commands",
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

async function addWork(title: string): Promise<string> {
  return (await works.upsert({ title, type: "article" })).id;
}

async function addAttachment(workId: string, sha256: string): Promise<{ id: string }> {
  return new AttachmentsRepo(database, libraryId).create({
    byteSize: 42,
    sha256,
    workId,
  });
}

function quoteSqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

describe("Canvas ingress data commands", () => {
  it("rejects malformed and scope-injected payloads before obtaining a database lease", async () => {
    let executeCalls = 0;
    let transactionCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async execute() {
        executeCalls += 1;
        throw new Error("execute reached");
      },
      async transaction() {
        transactionCalls += 1;
        throw new Error("transaction reached");
      },
    };
    const invalidRequests = [
      { input: {}, name: "canvas.getActiveWork" },
      { input: { workId: " " }, name: "canvas.getActiveWork" },
      {
        input: { libraryId: "library:foreign", workId: "work-1" },
        name: "canvas.getActiveWork",
      },
      { input: { annotationId: "annotation-1" }, name: "canvas.getAnnotationIngressSource" },
      {
        input: { annotationId: "annotation-1", extra: true, workId: "work-1" },
        name: "canvas.getAnnotationIngressSource",
      },
      {
        input: {
          annotationId: "annotation-1",
          libraryId: "library:foreign",
          workId: "work-1",
        },
        name: "canvas.getAnnotationIngressSource",
      },
      {
        input: { libraryId: "library:foreign", workIds: ["work-1"] },
        name: "canvas.getCitationRelations",
      },
      { input: { workIds: ["work-1", "work-1"] }, name: "canvas.getCitationRelations" },
      {
        input: { workIds: Array.from({ length: 401 }, (_, index) => `work-${index}`) },
        name: "canvas.getCitationRelations",
      },
      {
        input: {
          relations: [{ citedWorkId: "work-2", citingWorkId: "work-1", source: "openalex" }],
        },
        name: "canvas.persistCitationRelations",
      },
      {
        input: { relations: [{ citedWorkId: "work-1", citingWorkId: "work-1" }] },
        name: "canvas.persistCitationRelations",
      },
      {
        input: {
          relations: [
            { citedWorkId: "work-2", citingWorkId: "work-1" },
            { citedWorkId: "work-2", citingWorkId: "work-1" },
          ],
        },
        name: "canvas.persistCitationRelations",
      },
      {
        input: {
          libraryId: "library:foreign",
          relations: [{ citedWorkId: "work-2", citingWorkId: "work-1" }],
        },
        name: "canvas.persistCitationRelations",
      },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("returns one active local work and its active annotation ingress source", async () => {
    const workId = await addWork("Canvas ingress source");
    const attachment = await addAttachment(workId, "a".repeat(64));
    const annotationId = await new AnnotationsRepo(database, libraryId).create({
      anchor: { pageIndex: 1, version: 1 },
      attachmentId: attachment.id,
      contentMd: "Canvas ingress annotation",
      pageIndex: 1,
      type: "highlight",
      workId,
    });

    await expect(command("canvas.getActiveWork", { workId })).resolves.toEqual({
      work: expect.objectContaining({ deleted_at: null, id: workId }),
    });
    await expect(
      command("canvas.getAnnotationIngressSource", { annotationId, workId }),
    ).resolves.toEqual({
      source: {
        annotation: expect.objectContaining({
          attachment_id: attachment.id,
          id: annotationId,
          work_id: workId,
        }),
        work: expect.objectContaining({ deleted_at: null, id: workId }),
      },
    });
  });

  it("lists only active local citation relations among the requested works", async () => {
    const citingWorkId = await addWork("Local citing work");
    const citedWorkId = await addWork("Local cited work");
    const archivedWorkId = await addWork("Archived cited work");
    await database.run(
      `INSERT INTO citations (citing_work_id, cited_work_id, source) VALUES (?, ?, 'openalex')`,
      [citingWorkId, citedWorkId],
    );
    await database.run(
      `INSERT INTO citations (citing_work_id, cited_work_id, source) VALUES (?, ?, 'openalex')`,
      [citingWorkId, archivedWorkId],
    );
    await works.softDelete(archivedWorkId);

    const foreignLibraryId = "library:canvas-citation-foreign";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign Canvas Citation', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    const foreignWork = await new WorksRepo(database, foreignLibraryId).upsert({
      title: "Foreign cited work",
    });

    await expect(command("canvas.getCitationRelations", { workIds: [] })).resolves.toEqual({
      relations: [],
    });
    await expect(
      command("canvas.getCitationRelations", {
        workIds: [citingWorkId, citedWorkId, archivedWorkId, foreignWork.id, "missing-work"],
      }),
    ).resolves.toEqual({
      relations: [{ citedWorkId, citingWorkId }],
    });
  });

  it("rejects a dense citation result instead of returning more than the command limit", async () => {
    const workIds: string[] = [];
    for (let index = 0; index < 33; index += 1) {
      workIds.push(await addWork(`Dense citation work ${index}`));
    }
    const relationValues: string[] = [];
    for (const citingWorkId of workIds) {
      for (const citedWorkId of workIds) {
        if (citingWorkId === citedWorkId) continue;
        relationValues.push(
          `(${quoteSqlText(citingWorkId)}, ${quoteSqlText(citedWorkId)}, 'openalex')`,
        );
      }
    }
    await database.exec(
      `INSERT INTO citations (citing_work_id, cited_work_id, source)
       VALUES ${relationValues.slice(0, 1_001).join(",")}`,
    );

    await expect(command("canvas.getCitationRelations", { workIds })).rejects.toThrow(
      "Canvas citation relations are limited to 1000",
    );
  });

  it("persists a citation batch once, preserves existing sources, and reports actual inserts", async () => {
    const firstWorkId = await addWork("Citation first work");
    const secondWorkId = await addWork("Citation second work");
    const thirdWorkId = await addWork("Citation third work");
    await database.run(
      `INSERT INTO citations (citing_work_id, cited_work_id, source) VALUES (?, ?, 'semantic-scholar')`,
      [firstWorkId, secondWorkId],
    );

    await expect(
      command("canvas.persistCitationRelations", {
        relations: [
          { citedWorkId: secondWorkId, citingWorkId: firstWorkId },
          { citedWorkId: thirdWorkId, citingWorkId: secondWorkId },
        ],
      }),
    ).resolves.toEqual({ persisted: 1 });
    await expect(
      command("canvas.persistCitationRelations", {
        relations: [{ citedWorkId: thirdWorkId, citingWorkId: secondWorkId }],
      }),
    ).resolves.toEqual({ persisted: 0 });

    const persisted = await database.query<{
      cited_work_id: string;
      citing_work_id: string;
      source: string;
    }>(
      `SELECT citing_work_id, cited_work_id, source
       FROM citations
       ORDER BY citing_work_id, cited_work_id`,
    );
    expect(persisted).toEqual(
      expect.arrayContaining([
        {
          cited_work_id: secondWorkId,
          citing_work_id: firstWorkId,
          source: "semantic-scholar",
        },
        {
          cited_work_id: thirdWorkId,
          citing_work_id: secondWorkId,
          source: "openalex",
        },
      ]),
    );
    expect(persisted).toHaveLength(2);
  });

  it("safely skips foreign, missing, and archived citation endpoints in one batch", async () => {
    const activeCitingWorkId = await addWork("Active citation source");
    const activeCitedWorkId = await addWork("Active citation target");
    const archivedWorkId = await addWork("Archived citation target");
    await works.softDelete(archivedWorkId);
    const foreignLibraryId = "library:canvas-citation-write-foreign";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign Citation Write', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    const foreignWork = await new WorksRepo(database, foreignLibraryId).upsert({
      title: "Foreign citation target",
    });

    await expect(
      command("canvas.persistCitationRelations", {
        relations: [
          { citedWorkId: activeCitedWorkId, citingWorkId: activeCitingWorkId },
          { citedWorkId: archivedWorkId, citingWorkId: activeCitingWorkId },
          { citedWorkId: foreignWork.id, citingWorkId: activeCitingWorkId },
          { citedWorkId: "missing-work", citingWorkId: activeCitingWorkId },
        ],
      }),
    ).resolves.toEqual({ persisted: 1 });
    await expect(
      command("canvas.getCitationRelations", {
        workIds: [activeCitingWorkId, activeCitedWorkId, archivedWorkId, foreignWork.id],
      }),
    ).resolves.toEqual({
      relations: [{ citedWorkId: activeCitedWorkId, citingWorkId: activeCitingWorkId }],
    });
  });

  it("rolls back the complete citation batch after a later database failure", async () => {
    const citingWorkId = await addWork("Rollback citation source");
    const firstCitedWorkId = await addWork("Rollback first target");
    const failingCitedWorkId = await addWork("Rollback failing target");
    await database.exec(`
      CREATE TRIGGER canvas_citation_batch_failure
      BEFORE INSERT ON citations
      WHEN NEW.cited_work_id = ${quoteSqlText(failingCitedWorkId)}
      BEGIN
        SELECT RAISE(ABORT, 'forced citation batch failure');
      END;
    `);

    await expect(
      command("canvas.persistCitationRelations", {
        relations: [
          { citedWorkId: firstCitedWorkId, citingWorkId },
          { citedWorkId: failingCitedWorkId, citingWorkId },
        ],
      }),
    ).rejects.toThrow("forced citation batch failure");
    await expect(
      database.query<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM citations
         WHERE citing_work_id = ?`,
        [citingWorkId],
      ),
    ).resolves.toEqual([{ count: 0 }]);
  });

  it("fails closed for foreign, mismatched, archived, and removed ingress records", async () => {
    const sourceWorkId = await addWork("Canvas source work");
    const sourceAttachment = await addAttachment(sourceWorkId, "b".repeat(64));
    const sourceAnnotationId = await new AnnotationsRepo(database, libraryId).create({
      attachmentId: sourceAttachment.id,
      pageIndex: 0,
      type: "note",
      workId: sourceWorkId,
    });
    const otherWorkId = await addWork("Canvas other work");

    await expect(
      command("canvas.getAnnotationIngressSource", {
        annotationId: sourceAnnotationId,
        workId: otherWorkId,
      }),
    ).resolves.toEqual({ source: null });
    await expect(
      command("canvas.getAnnotationIngressSource", {
        annotationId: "' OR 1 = 1 --",
        workId: sourceWorkId,
      }),
    ).resolves.toEqual({ source: null });

    await database.run(`UPDATE attachments SET deleted_at = ? WHERE id = ?`, [
      20_000,
      sourceAttachment.id,
    ]);
    await expect(
      command("canvas.getAnnotationIngressSource", {
        annotationId: sourceAnnotationId,
        workId: sourceWorkId,
      }),
    ).resolves.toEqual({ source: null });

    await database.run(`UPDATE works SET deleted_at = ? WHERE id = ?`, [21_000, sourceWorkId]);
    await expect(command("canvas.getActiveWork", { workId: sourceWorkId })).resolves.toEqual({
      work: null,
    });
    await expect(
      command("canvas.getAnnotationIngressSource", {
        annotationId: sourceAnnotationId,
        workId: sourceWorkId,
      }),
    ).resolves.toEqual({ source: null });

    const foreignLibraryId = "library:canvas-foreign";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign Canvas', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    const foreignWork = await new WorksRepo(database, foreignLibraryId).upsert({
      title: "Foreign Canvas Work",
    });
    const foreignAttachment = await new AttachmentsRepo(database, foreignLibraryId).create({
      byteSize: 42,
      sha256: "c".repeat(64),
      workId: foreignWork.id,
    });
    const foreignAnnotationId = await new AnnotationsRepo(database, foreignLibraryId).create({
      attachmentId: foreignAttachment.id,
      pageIndex: 0,
      type: "note",
      workId: foreignWork.id,
    });

    await expect(command("canvas.getActiveWork", { workId: foreignWork.id })).resolves.toEqual({
      work: null,
    });
    await expect(
      command("canvas.getAnnotationIngressSource", {
        annotationId: foreignAnnotationId,
        workId: foreignWork.id,
      }),
    ).resolves.toEqual({ source: null });
  });
});
