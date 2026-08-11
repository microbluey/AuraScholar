import { AttachmentsRepo, type Database, WorksRepo } from "@aurascholar/db";
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
    deviceId: "library-page-command-device",
    deviceName: "Library page commands",
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

async function addWork(
  title: string,
  options: {
    createdAt: number;
    readingStatus?: "unread" | "reading" | "read";
    starred?: boolean;
    venueName?: string;
  },
): Promise<string> {
  const { id } = await works.upsert({ title, type: "article", venueName: options.venueName });
  await database.run(
    `UPDATE works
     SET created_at = ?, updated_at = ?, reading_status = ?, starred = ?
     WHERE id = ?`,
    [
      options.createdAt,
      options.createdAt,
      options.readingStatus ?? "unread",
      options.starred ? 1 : 0,
      id,
    ],
  );
  return id;
}

async function addRuntimeRows(workId: string): Promise<void> {
  const attachmentId = "attachment:target";
  const now = 1_500;
  await database.run(
    `INSERT INTO attachments (
       id, work_id, kind, sha256, byte_size, original_filename, created_at, updated_at
     ) VALUES (?, ?, 'pdf', ?, 123, 'target.pdf', ?, ?)`,
    [attachmentId, workId, "a".repeat(64), now, now],
  );
  await database.run(
    `INSERT INTO annotations (
       id, attachment_id, work_id, type, page_index, content_md, sort_key, created_at, updated_at
     ) VALUES ('annotation:target', ?, ?, 'note', 2, 'A durable note', 1, ?, ?)`,
    [attachmentId, workId, now + 1, now + 1],
  );
  await database.run(
    `INSERT INTO sentinel_tasks (
       id, library_id, work_id, title, current_state, target_flags,
       poll_interval_s, next_poll_at, error_count, status, created_at, updated_at
     ) VALUES
       ('sentinel:older', ?, ?, 'Target work', 'accepted', NULL, 86400, 1, 0, 'paused', ?, ?),
       ('sentinel:newer', ?, ?, 'Target work', 'published', NULL, 86400, 1, 0, 'active', ?, ?)`,
    [libraryId, workId, now, now, libraryId, workId, now + 2, now + 2],
  );
}

describe("Library page data commands", () => {
  it("rejects malformed page and runtime payloads before obtaining a database lease", async () => {
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
    const invalidRequests = [
      { input: { limit: 0 }, name: "library.getPage" },
      { input: { limit: 201 }, name: "library.getPage" },
      { input: { filter: "anything", limit: 30 }, name: "library.getPage" },
      { input: { focusWorkId: " ", limit: 30 }, name: "library.getPage" },
      { input: { annotationCount: -1, workId: "work-1" }, name: "library.getWorkRuntimeMeta" },
      { input: { annotationCount: 0, workId: " " }, name: "library.getWorkRuntimeMeta" },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
  });

  it("loads a deep-linked page with its sidebar, facets, and table metadata in one scoped read", async () => {
    const target = await addWork("Oldest target", {
      createdAt: 1_000,
      readingStatus: "reading",
      starred: true,
      venueName: "Journal of Methods",
    });
    const companion = await addWork("Middle companion", { createdAt: 2_000, venueName: "arXiv" });
    await addWork("Newest work", { createdAt: 3_000, readingStatus: "read" });
    const trashed = await addWork("Trashed work", { createdAt: 4_000 });
    await database.run(`UPDATE works SET deleted_at = ? WHERE id = ?`, [5_000, trashed]);

    await database.run(
      `INSERT INTO collections (
         id, library_id, name, parent_id, sort_order, created_at, updated_at
       ) VALUES ('collection:methods', ?, 'Methods', NULL, 0, 1, 1)`,
      [libraryId],
    );
    await database.run(
      `INSERT INTO collection_items (collection_id, work_id) VALUES ('collection:methods', ?)`,
      [target],
    );
    await database.run(
      `INSERT INTO tags (id, library_id, name, color, created_at, updated_at)
       VALUES ('tag:methods', ?, 'Methods', NULL, 1, 1)`,
      [libraryId],
    );
    await database.run(`INSERT INTO work_tags (work_id, tag_id) VALUES (?, 'tag:methods')`, [
      target,
    ]);
    await addRuntimeRows(target);
    await database.run(
      `INSERT INTO citations (citing_work_id, cited_work_id, source) VALUES (?, ?, 'test')`,
      [target, companion],
    );
    await database.run(
      `INSERT INTO citations (citing_work_id, cited_work_id, source) VALUES (?, ?, 'test')`,
      [companion, target],
    );

    const deepLinked = await command("library.getPage", {
      focusWorkId: target,
      limit: 2,
      offset: 0,
      sort: "added",
    });

    expect(deepLinked).toMatchObject({
      limit: 2,
      offset: 2,
      total: 3,
      trashCount: 1,
      works: [expect.objectContaining({ id: target, title: "Oldest target" })],
    });
    expect(deepLinked.collections).toEqual([
      expect.objectContaining({ count: 1, id: "collection:methods", name: "Methods" }),
    ]);
    expect(deepLinked.browseSummary).toMatchObject({
      baseTotal: 3,
      notedTotal: 1,
      readingTotal: 1,
      starredTotal: 1,
      unreadTotal: 1,
      withPdfTotal: 1,
      withoutPdfTotal: 2,
    });
    expect(deepLinked.browseSummary.availableTags).toEqual(["Methods"]);
    expect(deepLinked.workMeta[target]).toEqual({
      annotations: 1,
      citedBy: 1,
      pdfs: 1,
      references: 1,
      sentinelState: "published",
      sentinelStatus: "active",
      sentinelTaskCount: 2,
      tags: ["Methods"],
    });

    await expect(
      command("library.getPage", {
        collectionId: "collection:methods",
        limit: 30,
        tag: "Methods",
      }),
    ).resolves.toMatchObject({ total: 1, works: [expect.objectContaining({ id: target })] });
    await expect(
      command("library.getPage", { filter: "trash", limit: 30, tag: "Methods" }),
    ).resolves.toMatchObject({ total: 1, works: [expect.objectContaining({ id: trashed })] });
  });

  it("falls back to the final valid page after a mutation makes the requested page stale", async () => {
    for (let index = 0; index < 31; index += 1) {
      await addWork(`Page work ${index}`, { createdAt: 1_000 + index });
    }

    await expect(command("library.getPage", { limit: 30, offset: 60 })).resolves.toMatchObject({
      limit: 30,
      offset: 30,
      total: 31,
      works: [expect.objectContaining({ title: "Page work 0" })],
    });
  });

  it("loads selected-work runtime metadata without exposing a foreign Library work", async () => {
    const target = await addWork("Runtime target", { createdAt: 1_000 });
    await addRuntimeRows(target);

    await expect(
      command("library.getWorkRuntimeMeta", { annotationCount: 1, workId: target }),
    ).resolves.toMatchObject({
      annotationCount: 1,
      notePreviews: [expect.objectContaining({ content_md: "A durable note", page_index: 2 })],
      pdfCount: 1,
      pdfPreview: expect.objectContaining({ original_filename: "target.pdf" }),
      sentinelState: "published",
      sentinelStatus: "active",
      sentinelTaskCount: 2,
    });

    const foreignLibraryId = "library:foreign";
    const now = 10_000;
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES (?, 'Foreign', 'personal', ?, ?, NULL)`,
      [foreignLibraryId, now, now],
    );
    const foreignWorks = new WorksRepo(database, foreignLibraryId);
    const foreign = await foreignWorks.upsert({ title: "Foreign runtime target" });
    const foreignAttachments = new AttachmentsRepo(database, foreignLibraryId);
    await foreignAttachments.create({ byteSize: 1, sha256: "b".repeat(64), workId: foreign.id });

    const foreignScopeAttempt = (await executeDataCommand(
      {
        input: { libraryId: foreignLibraryId, limit: 30 },
        name: "library.getPage",
      },
      dependencies,
    )) as DataCommandOutput<"library.getPage">;
    expect(foreignScopeAttempt.works).toEqual([expect.objectContaining({ id: target })]);
    expect(foreignScopeAttempt.works).not.toEqual([expect.objectContaining({ id: foreign.id })]);

    await expect(
      command("library.getWorkRuntimeMeta", { annotationCount: 99, workId: foreign.id }),
    ).rejects.toThrow("outside the active Library");
  });
});
