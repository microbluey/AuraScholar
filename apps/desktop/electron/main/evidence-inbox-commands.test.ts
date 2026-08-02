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

const HASH = "c".repeat(64);
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
    deviceId: "evidence-inbox-command-device",
    deviceName: "Evidence Inbox commands",
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

async function seedSource() {
  const work = await works.upsert({
    title: "Reliable Evidence Pipelines",
    year: 2025,
    authors: [{ displayName: "Katherine Johnson", position: 0 }],
  });
  const attachment = await attachments.create({
    workId: work.id,
    sha256: HASH,
    byteSize: 2_048,
    originalFilename: "reliable-evidence.pdf",
    pageCount: 4,
  });
  const revision = await documents.resolveAttachment(attachment.id);
  if (!revision) throw new Error("Seeded revision is missing");
  return { attachment, revision, work };
}

function saveInput(
  source: Awaited<ReturnType<typeof seedSource>>,
  evidenceId = "evidence:inbox-command",
): SaveTextEvidenceCommandInput {
  return {
    anchor: {
      kind: "pdf",
      pageIndex: 2,
      quote: { exact: "A trustworthy anchor always names its source revision." },
      version: 1,
    },
    attachmentId: source.attachment.id,
    evidenceId,
    evidenceKind: "definition",
    expectedBlobSha256: HASH,
    libraryId,
    tags: ["anchor"],
    text: "A trustworthy anchor always names its source revision.",
    title: "Source identity",
    workId: source.work.id,
  };
}

describe("Evidence Inbox data commands", () => {
  it("rejects malformed new-command inputs before opening a database lease", async () => {
    let leaseCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async execute() {
        leaseCalls += 1;
        throw new Error("execute reached");
      },
      async transaction() {
        leaseCalls += 1;
        throw new Error("transaction reached");
      },
    };
    const invalid = [
      {
        name: "evidence.search",
        input: { libraryId, scope: { kind: "library" }, evidenceKinds: ["invalid"] },
      },
      {
        name: "evidence.search",
        input: { libraryId, scope: { kind: "project" } },
      },
      {
        name: "evidence.addToProject",
        input: { evidenceId: "evidence:test", libraryId, projectId: " " },
      },
      {
        name: "evidence.removeFromProject",
        input: { evidenceId: " ", libraryId, projectId: "project:test" },
      },
      {
        name: "evidence.softDelete",
        input: { evidenceId: "evidence:test", expectedUpdatedAt: -1, libraryId },
      },
      {
        name: "evidence.restore",
        input: { evidenceId: "evidence:test", expectedUpdatedAt: 1.5, libraryId },
      },
    ];
    for (const request of invalid) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(leaseCalls).toBe(0);
  });

  it("searches server-side and returns exact source metadata", async () => {
    const source = await seedSource();
    const saved = await command("evidence.saveText", saveInput(source));
    expect(saved.evidence.availabilityStatus).toBe("available");
    const result = await command("evidence.search", {
      libraryId,
      scope: { kind: "library" },
      query: "Johnson",
      evidenceKinds: ["definition"],
      limit: 20,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.evidence[0]).toMatchObject({
      attachmentId: source.attachment.id,
      authorNames: ["Katherine Johnson"],
      pageIndex: 2,
      revisionNo: source.revision.revision_no,
      workTitle: "Reliable Evidence Pipelines",
      year: 2025,
      evidence: { id: saved.evidence.id, revisionId: source.revision.id },
    });
  });

  it("atomically adds source before Evidence membership, then removes only Evidence membership", async () => {
    const source = await seedSource();
    const saved = await command("evidence.saveText", saveInput(source));
    const project = await new ResearchProjectsRepo(database, libraryId).create({
      name: "Inbox triage",
    });

    await expect(
      command("evidence.addToProject", {
        evidenceId: saved.evidence.id,
        libraryId,
        projectId: project.id,
      }),
    ).resolves.toEqual({ projectMembershipAdded: true, sourceMembershipAdded: true });
    expect(
      await command("evidence.search", {
        libraryId,
        scope: { kind: "project", projectId: project.id },
      }),
    ).toMatchObject({ total: 1 });

    await expect(
      command("evidence.removeFromProject", {
        evidenceId: saved.evidence.id,
        libraryId,
        projectId: project.id,
      }),
    ).resolves.toEqual({ projectMembershipRemoved: true });
    expect(
      await command("evidence.search", {
        libraryId,
        scope: { kind: "project", projectId: project.id },
      }),
    ).toMatchObject({ total: 0 });
    expect(
      (
        await database.query<{ total: number }>(
          `SELECT COUNT(*) AS total FROM project_works
         WHERE project_id = ? AND work_id = ? AND deleted_at IS NULL`,
          [project.id, source.work.id],
        )
      )[0]?.total,
    ).toBe(1);
  });

  it("rolls back source membership when Evidence membership insertion fails", async () => {
    const source = await seedSource();
    const saved = await command("evidence.saveText", saveInput(source));
    const project = await new ResearchProjectsRepo(database, libraryId).create({ name: "Atomic" });
    await coordinator.exec(`
      CREATE TEMP TRIGGER fail_inbox_membership
      BEFORE INSERT ON project_evidence
      BEGIN
        SELECT RAISE(FAIL, 'injected inbox membership failure');
      END
    `);

    await expect(
      command("evidence.addToProject", {
        evidenceId: saved.evidence.id,
        libraryId,
        projectId: project.id,
      }),
    ).rejects.toThrow("injected inbox membership failure");
    expect(
      (
        await database.query<{ total: number }>(
          `SELECT COUNT(*) AS total FROM project_works WHERE project_id = ?`,
          [project.id],
        )
      )[0]?.total,
    ).toBe(0);
  });

  it("soft-deletes and restores with optimistic versions", async () => {
    const source = await seedSource();
    const saved = await command("evidence.saveText", saveInput(source));
    const removed = await command("evidence.softDelete", {
      evidenceId: saved.evidence.id,
      expectedUpdatedAt: saved.evidence.updatedAt,
      libraryId,
    });
    expect(removed.evidence.deletedAt).not.toBeNull();
    await expect(
      command("evidence.search", { libraryId, scope: { kind: "library" } }),
    ).resolves.toMatchObject({ total: 0 });

    const restored = await command("evidence.restore", {
      evidenceId: saved.evidence.id,
      expectedUpdatedAt: removed.evidence.updatedAt,
      libraryId,
    });
    expect(restored.evidence.deletedAt).toBeNull();
    expect(restored.evidence.updatedAt).toBeGreaterThan(removed.evidence.updatedAt);
  });

  it("rejects stale or foreign Library scope for all new command families", async () => {
    const foreignLibraryId = "library:evidence-inbox-command-foreign";
    const requests = [
      {
        name: "evidence.search",
        input: { libraryId: foreignLibraryId, scope: { kind: "library" } },
      },
      {
        name: "evidence.addToProject",
        input: {
          evidenceId: "evidence:missing",
          libraryId: foreignLibraryId,
          projectId: "project:missing",
        },
      },
      {
        name: "evidence.softDelete",
        input: {
          evidenceId: "evidence:missing",
          expectedUpdatedAt: 0,
          libraryId: foreignLibraryId,
        },
      },
    ];
    for (const request of requests) {
      await expect(executeDataCommand(request, dependencies)).rejects.toThrow(
        "Rejected stale or foreign Library scope",
      );
    }
  });
});
