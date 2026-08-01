import { AttachmentsRepo, ResearchProjectsRepo, WorksRepo, type Database } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { DocumentAssetsRepo } from "@aurascholar/db/repos/document-assets";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DataCommandInput,
  DataCommandName,
  DataCommandOutput,
  SaveTextEvidenceCommandInput,
} from "../data-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand, type DataCommandDependencies } from "./data-commands";

const BLOB_SHA256 = "a".repeat(64);
const NEXT_BLOB_SHA256 = "b".repeat(64);
const EVIDENCE_TEXT = "Random assignment identifies the causal effect.";

let database: Database;
let libraryId: string;
let coordinator: DatabaseCoordinator;
let dependencies: DataCommandDependencies;
let works: WorksRepo;
let attachments: AttachmentsRepo;
let documents: DocumentAssetsRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "evidence-command-device",
    deviceName: "Evidence commands",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
  works = new WorksRepo(database, libraryId);
  attachments = new AttachmentsRepo(database, libraryId);
  documents = new DocumentAssetsRepo(database, libraryId);
});

function command<K extends DataCommandName>(
  name: K,
  input: DataCommandInput<K>,
): Promise<DataCommandOutput<K>> {
  return executeDataCommand({ input, name }, dependencies) as Promise<DataCommandOutput<K>>;
}

async function seedPdfSource(label = "Evidence source") {
  const work = await works.upsert({ title: label });
  const attachment = await attachments.create({
    byteSize: 4_096,
    originalFilename: `${label}.pdf`,
    pageCount: 3,
    sha256: BLOB_SHA256,
    workId: work.id,
  });
  const revision = await documents.resolveAttachment(attachment.id);
  if (!revision) throw new Error("Seeded attachment did not resolve to a Document revision");
  return {
    assetId: revision.asset_id,
    attachmentId: attachment.id,
    revisionId: revision.id,
    workId: work.id,
  };
}

function saveInput(
  source: Awaited<ReturnType<typeof seedPdfSource>>,
  overrides: Partial<SaveTextEvidenceCommandInput> = {},
): SaveTextEvidenceCommandInput {
  return {
    anchor: {
      kind: "pdf",
      pageIndex: 1,
      position: { end: 146, start: 100 },
      quads: {
        pageIndex: 1,
        rects: [{ x1: 10, x2: 160, y1: 20, y2: 36 }],
      },
      quote: { exact: EVIDENCE_TEXT, prefix: "Before. ", suffix: " After." },
      version: 1,
    },
    attachmentId: source.attachmentId,
    evidenceId: "evidence:command",
    evidenceKind: "method",
    expectedBlobSha256: BLOB_SHA256,
    libraryId,
    noteMd: "Compare with the observational estimate.",
    tags: ["causal", "identification"],
    text: EVIDENCE_TEXT,
    title: "Identification strategy",
    workId: source.workId,
    ...overrides,
  };
}

async function rowCount(table: "evidence_items" | "project_evidence" | "project_works") {
  return Number(await database.queryScalar(`SELECT COUNT(*) FROM ${table}`));
}

describe("Evidence data commands", () => {
  it("rejects malformed input for all four commands before acquiring a database lease", async () => {
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
    const source = {
      assetId: "asset:test",
      attachmentId: "attachment:test",
      revisionId: "revision:test",
      workId: "work:test",
    };
    const invalidRequests = [
      {
        name: "document.resolveAttachmentRevision",
        input: {
          attachmentId: "attachment:test",
          expectedBlobSha256: "not-a-sha",
          libraryId,
          workId: "work:test",
        },
      },
      { name: "evidence.get", input: { evidenceId: "evidence:test", libraryId: " " } },
      {
        name: "evidence.list",
        input: { libraryId, scope: { kind: "project" } },
      },
      {
        name: "evidence.saveText",
        input: {
          ...saveInput(source, { evidenceKind: "unsupported" as "method" }),
        },
      },
      {
        name: "evidence.saveText",
        input: saveInput(source, {
          anchor: {
            kind: "pdf",
            pageIndex: 1,
            quote: { exact: "   \n\t" },
            version: 1,
          },
          text: "   \n\t",
        }),
      },
      {
        name: "evidence.saveText",
        input: saveInput(source, {
          anchor: {
            kind: "pdf",
            pageIndex: 1,
            position: { end: 8, start: 12 },
            quote: { exact: EVIDENCE_TEXT },
            version: 1,
          },
        }),
      },
      {
        name: "evidence.saveText",
        input: saveInput(source, {
          anchor: {
            kind: "pdf",
            pageIndex: 1,
            quads: { pageIndex: 1, rects: [] },
            quote: { exact: EVIDENCE_TEXT },
            version: 1,
          },
        }),
      },
      {
        name: "evidence.saveText",
        input: saveInput(source, {
          anchor: {
            kind: "pdf",
            pageIndex: 1,
            quads: {
              pageIndex: 1,
              rects: Array.from({ length: 513 }, () => ({ x1: 0, x2: 1, y1: 0, y2: 1 })),
            },
            quote: { exact: EVIDENCE_TEXT },
            version: 1,
          },
        }),
      },
      {
        name: "evidence.saveText",
        input: saveInput(source, {
          anchor: {
            kind: "pdf",
            pageIndex: 1,
            quads: { pageIndex: 1, rects: [{ x1: 20, x2: 10, y1: 0, y2: 1 }] },
            quote: { exact: EVIDENCE_TEXT },
            version: 1,
          },
        }),
      },
      {
        name: "evidence.saveText",
        input: saveInput(source, {
          anchor: {
            kind: "pdf",
            pageIndex: 1,
            quads: { pageIndex: 1, rects: [{ x1: 0, x2: 1, y1: 0, y2: Number.NaN }] },
            quote: { exact: EVIDENCE_TEXT },
            version: 1,
          },
        }),
      },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("routes reads through execute, saves through transaction, and returns structured DTOs", async () => {
    const source = await seedPdfSource();
    const executeNames: DataCommandName[] = [];
    const transactionNames: DataCommandName[] = [];
    dependencies = {
      execute: (commandName, operation) => {
        executeNames.push(commandName);
        return coordinator.execute(operation);
      },
      transaction: (commandName, operation) => {
        transactionNames.push(commandName);
        return coordinator.transaction(commandName, operation);
      },
    };

    const resolved = await command("document.resolveAttachmentRevision", {
      attachmentId: source.attachmentId,
      expectedBlobSha256: BLOB_SHA256,
      libraryId,
      workId: source.workId,
    });
    expect(resolved.revision).toMatchObject({
      assetId: source.assetId,
      attachmentId: source.attachmentId,
      blobSha256: BLOB_SHA256,
      currentRevisionId: source.revisionId,
      revisionId: source.revisionId,
      workId: source.workId,
    });

    const saved = await command("evidence.saveText", saveInput(source));
    const fetched = await command("evidence.get", {
      evidenceId: saved.evidence.id,
      libraryId,
    });
    const listed = await command("evidence.list", {
      libraryId,
      scope: { kind: "library" },
    });

    expect(executeNames).toEqual([
      "document.resolveAttachmentRevision",
      "evidence.get",
      "evidence.list",
    ]);
    expect(transactionNames).toEqual(["evidence.saveText"]);
    expect(fetched.evidence).toEqual(saved.evidence);
    expect(listed.evidence).toEqual([saved.evidence]);
    expect(saved.evidence).toMatchObject({
      anchor: {
        kind: "pdf",
        quote: { exact: EVIDENCE_TEXT },
        revisionId: source.revisionId,
        version: 1,
      },
      provenance: {
        captureMethod: "reader-selection",
        sourceAuthority: "captured-source",
      },
      tags: ["causal", "identification"],
      text: EVIDENCE_TEXT,
    });
    for (const rawStorageField of ["anchor_json", "payload_json", "provenance_json", "tags_json"]) {
      expect(saved.evidence).not.toHaveProperty(rawStorageField);
    }
    expect(resolved.revision).not.toHaveProperty("blob_sha256");
    expect(resolved.revision).not.toHaveProperty("current_revision_id");
  });

  it("requires the active explicit Library scope for reads and writes", async () => {
    const source = await seedPdfSource();
    const foreignLibraryId = "library:evidence-command-foreign";
    const requests = [
      {
        name: "document.resolveAttachmentRevision",
        input: {
          attachmentId: source.attachmentId,
          libraryId: foreignLibraryId,
          workId: source.workId,
        },
      },
      {
        name: "evidence.get",
        input: { evidenceId: "evidence:missing", libraryId: foreignLibraryId },
      },
      {
        name: "evidence.list",
        input: { libraryId: foreignLibraryId, scope: { kind: "library" } },
      },
      {
        name: "evidence.saveText",
        input: saveInput(source, {
          evidenceId: "evidence:foreign-scope",
          libraryId: foreignLibraryId,
        }),
      },
    ];

    for (const request of requests) {
      await expect(executeDataCommand(request, dependencies)).rejects.toThrow(
        "Rejected stale or foreign Library scope",
      );
    }
    expect(await rowCount("evidence_items")).toBe(0);
  });

  it("atomically adds Project source and Evidence memberships and is idempotent by explicit id", async () => {
    const source = await seedPdfSource();
    const project = await new ResearchProjectsRepo(database, libraryId).create({
      name: "Evidence synthesis",
    });
    const input = saveInput(source, {
      evidenceId: "evidence:project-command",
      projectId: project.id,
    });

    const first = await command("evidence.saveText", input);
    expect(first).toMatchObject({
      created: true,
      projectMembershipAdded: true,
      sourceMembershipAdded: true,
    });
    expect(await rowCount("evidence_items")).toBe(1);
    expect(await rowCount("project_works")).toBe(1);
    expect(await rowCount("project_evidence")).toBe(1);
    await expect(
      command("evidence.list", {
        libraryId,
        scope: { kind: "project", projectId: project.id },
      }),
    ).resolves.toEqual({ evidence: [first.evidence] });

    const repeated = await command("evidence.saveText", input);
    expect(repeated).toEqual({
      created: false,
      evidence: first.evidence,
      projectMembershipAdded: false,
      sourceMembershipAdded: false,
    });
    expect(await rowCount("evidence_items")).toBe(1);
    expect(await rowCount("project_works")).toBe(1);
    expect(await rowCount("project_evidence")).toBe(1);
  });

  it("rolls back the source and Evidence when Project Evidence membership fails", async () => {
    const source = await seedPdfSource();
    const project = await new ResearchProjectsRepo(database, libraryId).create({
      name: "Atomic Evidence",
    });
    await coordinator.exec(`
      CREATE TEMP TRIGGER fail_evidence_membership
      BEFORE INSERT ON project_evidence
      BEGIN
        SELECT RAISE(FAIL, 'injected project Evidence membership failure');
      END
    `);

    await expect(
      command(
        "evidence.saveText",
        saveInput(source, {
          evidenceId: "evidence:atomic-failure",
          projectId: project.id,
        }),
      ),
    ).rejects.toThrow("injected project Evidence membership failure");
    expect(await rowCount("evidence_items")).toBe(0);
    expect(await rowCount("project_works")).toBe(0);
    expect(await rowCount("project_evidence")).toBe(0);
  });

  it("leaves no writes for stale hashes, non-current revisions, or cross-Library sources", async () => {
    const projects = new ResearchProjectsRepo(database, libraryId);

    const staleHashSource = await seedPdfSource("Stale hash source");
    const staleHashProject = await projects.create({ name: "Stale hash" });
    await expect(
      command(
        "evidence.saveText",
        saveInput(staleHashSource, {
          evidenceId: "evidence:stale-hash",
          expectedBlobSha256: NEXT_BLOB_SHA256,
          projectId: staleHashProject.id,
        }),
      ),
    ).rejects.toThrow("Evidence source revision changed");

    const historicalSource = await seedPdfSource("Historical source");
    const historicalProject = await projects.create({ name: "Historical revision" });
    await documents.createRevision(historicalSource.assetId, {
      blobSha256: NEXT_BLOB_SHA256,
      byteSize: 8_192,
      expectedCurrentRevisionId: historicalSource.revisionId,
      extractionStatus: "ready",
      mimeType: "application/pdf",
    });
    await expect(
      command(
        "evidence.saveText",
        saveInput(historicalSource, {
          evidenceId: "evidence:historical",
          projectId: historicalProject.id,
        }),
      ),
    ).rejects.toThrow("Evidence source is no longer the current document revision");

    const foreignLibraryId = "library:evidence-source-foreign";
    const now = Date.now();
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES (?, 'Foreign Evidence Source', 'personal', ?, ?, NULL)`,
      [foreignLibraryId, now, now],
    );
    const foreignWorks = new WorksRepo(database, foreignLibraryId);
    const foreignWork = await foreignWorks.upsert({ title: "Foreign source" });
    const foreignAttachment = await new AttachmentsRepo(database, foreignLibraryId).create({
      byteSize: 1_024,
      pageCount: 1,
      sha256: BLOB_SHA256,
      workId: foreignWork.id,
    });
    const crossLibraryProject = await projects.create({ name: "Cross Library" });
    await expect(
      command(
        "evidence.saveText",
        saveInput(
          {
            assetId: "unused",
            attachmentId: foreignAttachment.id,
            revisionId: "unused",
            workId: foreignWork.id,
          },
          {
            evidenceId: "evidence:cross-library",
            projectId: crossLibraryProject.id,
          },
        ),
      ),
    ).rejects.toThrow(/outside library/i);

    expect(await rowCount("evidence_items")).toBe(0);
    expect(await rowCount("project_works")).toBe(0);
    expect(await rowCount("project_evidence")).toBe(0);
  });
});
