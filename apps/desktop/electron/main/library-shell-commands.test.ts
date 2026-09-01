import {
  AnnotationsRepo,
  AttachmentsRepo,
  ResearchProjectsRepo,
  SnippetsRepo,
  WorksRepo,
  type Database,
} from "@aurascholar/db";
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
import { executeDataCommand, type DataCommandDependencies } from "./data-commands";

let database: Database;
let dependencies: DataCommandDependencies;
let libraryId: string;
let works: WorksRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "library-shell-command-device",
    deviceName: "Library shell commands",
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

async function addCanvasWorkspaceAndNodes(
  targetLibraryId: string,
  workId: string | null,
  nodeCount: number,
): Promise<void> {
  const project = await new ResearchProjectsRepo(database, targetLibraryId).ensureDefault();
  const workspaceId = `canvas:${targetLibraryId}`;
  const now = 2_000;
  await database.run(
    `INSERT INTO canvas_workspaces (
       id, library_id, project_id, name, viewport_json, created_at, updated_at
     ) VALUES (?, ?, ?, 'Shell canvas', '{}', ?, ?)`,
    [workspaceId, targetLibraryId, project.id, now, now],
  );
  for (let index = 0; index < nodeCount; index += 1) {
    await database.run(
      `INSERT INTO canvas_nodes (
         id, workspace_id, work_id, type, pos_x, pos_y, width, height,
         data_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'paper', ?, 0, 320, 180, '{}', ?, ?)`,
      [`${workspaceId}:node:${index}`, workspaceId, workId, index * 20, now + index, now + index],
    );
  }
}

describe("Library shell data commands", () => {
  it("returns zero defaults for a newly initialized local Library", async () => {
    await expect(command("library.getShellStats", {})).resolves.toEqual({
      annotations: 0,
      canvasNodes: 0,
      collections: [],
      snippets: 0,
      total: 0,
      trash: 0,
    });
  });

  it("discovers local scope and returns one isolated App Shell snapshot", async () => {
    const includedWork = await addWork("Included work");
    await addWork("Second active work");
    const trashedWork = await addWork("Trashed work");

    const attachments = new AttachmentsRepo(database, libraryId);
    const annotations = new AnnotationsRepo(database, libraryId);
    const snippets = new SnippetsRepo(database, libraryId);
    const includedAttachment = await attachments.create({
      byteSize: 1,
      sha256: "a".repeat(64),
      workId: includedWork,
    });
    const trashedAttachment = await attachments.create({
      byteSize: 1,
      sha256: "b".repeat(64),
      workId: trashedWork,
    });
    await annotations.create({
      attachmentId: includedAttachment.id,
      pageIndex: 0,
      type: "highlight",
      workId: includedWork,
    });
    const deletedAnnotation = await annotations.create({
      attachmentId: includedAttachment.id,
      pageIndex: 1,
      type: "note",
      workId: includedWork,
    });
    await annotations.create({
      attachmentId: trashedAttachment.id,
      pageIndex: 0,
      type: "highlight",
      workId: trashedWork,
    });
    await annotations.softDelete(deletedAnnotation);
    await snippets.create({ quote: "Included quote", workId: includedWork });
    const deletedSnippet = await snippets.create({ quote: "Deleted quote", workId: includedWork });
    await snippets.create({ quote: "Trashed quote", workId: trashedWork });
    await snippets.softDelete(deletedSnippet);
    await database.run(`UPDATE works SET deleted_at = ? WHERE id = ?`, [3_000, trashedWork]);

    await database.run(
      `INSERT INTO collections (
         id, library_id, name, parent_id, sort_order, created_at, updated_at
       ) VALUES
         ('collection:methods', ?, 'Methods', NULL, 2, 1, 1),
         ('collection:causal', ?, 'Causal', 'collection:methods', 1, 1, 1),
         ('collection:deleted', ?, 'Deleted', NULL, 0, 1, 1)`,
      [libraryId, libraryId, libraryId],
    );
    await database.run(`UPDATE collections SET deleted_at = 3_000 WHERE id = 'collection:deleted'`);
    await database.run(
      `INSERT INTO collection_items (collection_id, work_id) VALUES
         ('collection:causal', ?),
         ('collection:methods', ?)`,
      [includedWork, trashedWork],
    );
    await addCanvasWorkspaceAndNodes(libraryId, includedWork, 2);

    const foreignLibraryId = "library:foreign";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    const foreignWork = await new WorksRepo(database, foreignLibraryId).upsert({
      title: "Foreign work",
      type: "article",
    });
    await database.run(
      `INSERT INTO collections (
         id, library_id, name, parent_id, sort_order, created_at, updated_at
       ) VALUES ('collection:foreign', ?, 'Foreign', NULL, 0, 1, 1)`,
      [foreignLibraryId],
    );
    await database.run(
      `INSERT INTO collection_items (collection_id, work_id) VALUES ('collection:foreign', ?)`,
      [foreignWork.id],
    );
    await addCanvasWorkspaceAndNodes(foreignLibraryId, foreignWork.id, 1);

    await expect(command("library.getScope", {})).resolves.toMatchObject({
      libraryId,
      scopeToken: expect.any(String),
    });
    await expect(command("library.getShellStats", {})).resolves.toEqual({
      annotations: 1,
      canvasNodes: 2,
      collections: [
        {
          count: 1,
          id: "collection:causal",
          name: "Causal",
          parentId: "collection:methods",
          sortOrder: 1,
        },
        {
          count: 0,
          id: "collection:methods",
          name: "Methods",
          parentId: null,
          sortOrder: 2,
        },
      ],
      snippets: 1,
      total: 2,
      trash: 1,
    });
  });

  it("rejects scope injection before obtaining a database lease", async () => {
    let executeCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async execute() {
        executeCalls += 1;
        throw new Error("execute reached");
      },
      async transaction() {
        throw new Error("transaction reached");
      },
    };

    for (const request of [
      { input: { unexpected: true }, name: "library.getScope" },
      { input: { libraryId: "library:foreign" }, name: "library.getShellStats" },
    ]) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
  });
});
