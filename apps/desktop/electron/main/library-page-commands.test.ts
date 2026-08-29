import { Buffer } from "node:buffer";
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
  it("keeps opaque work payloads out of the page DTO", async () => {
    const target = await addWork("Narrow command target", { createdAt: 1_000 });
    const opaque = "x".repeat(256 * 1024);
    await database.run(
      `UPDATE works
       SET abstract = ?, csl_json = ?, keywords_json = ?, notes_md = ?, fingerprint = ?
       WHERE id = ?`,
      [opaque, opaque, opaque, opaque, opaque, target],
    );

    const page = await command("library.getPage", { limit: 30 });
    const work = page.works.find((candidate) => candidate.id === target);
    expect(work).toEqual(expect.objectContaining({ id: target, title: "Narrow command target" }));
    for (const field of [
      "abstract",
      "csl_json",
      "fingerprint",
      "keywords_json",
      "library_id",
      "notes_md",
    ]) {
      expect(Object.hasOwn(work!, field)).toBe(false);
    }
  });

  it("bounds sidebar labels before materializing the page envelope", async () => {
    await database.run(
      `INSERT INTO collections (id, library_id, name, parent_id, sort_order, created_at, updated_at)
       VALUES ('collection:oversized', ?, ?, NULL, 0, 1, 1)`,
      [libraryId, "x".repeat(8 * 1024 * 1024)],
    );

    const page = await command("library.getPage", { limit: 30 });
    expect(page.collections).toEqual([
      expect.objectContaining({ name: `${"x".repeat(32)}…` }),
    ]);
    expect(Buffer.byteLength(JSON.stringify(page), "utf8")).toBeLessThan(8 * 1024 * 1024);
  });

  it("bounds each table tag and reads selected details through an explicit projection", async () => {
    const target = await addWork("Inspector detail target", { createdAt: 1_000 });
    const opaque = "x".repeat(256 * 1024);
    await database.run(
      `UPDATE works
       SET abstract = ?, csl_json = ?, fingerprint = ?, keywords_json = ?, notes_md = ?,
           publisher = ?, volume = ?
       WHERE id = ?`,
      [opaque, opaque, opaque, opaque, opaque, "Publisher", "42", target],
    );
    for (let index = 0; index < 5; index += 1) {
      const tagId = `tag:detail-${index}`;
      await database.run(
        `INSERT INTO tags (id, library_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?)`,
        [tagId, libraryId, index === 0 ? "x".repeat(1_025) : `Detail ${index}`, index, index],
      );
      await database.run(`INSERT INTO work_tags (work_id, tag_id) VALUES (?, ?)`, [target, tagId]);
    }

    const page = await command("library.getPage", { limit: 30 });
    expect(page.workMeta[target]?.tags).toHaveLength(4);
    expect(page.workMeta[target]?.tags).not.toContain("x".repeat(1_025));
    expect(page.workMeta[target]?.tags.every((tag) => Buffer.byteLength(tag, "utf8") <= 1_024)).toBe(
      true,
    );

    const inspector = await command("library.getWorkInspectorDetail", { workId: target });
    expect(inspector.detail).toMatchObject({ publisher: "Publisher", volume: "42" });
    expect(inspector.detail?.abstract).toHaveLength(512);
    for (const field of ["csl_json", "fingerprint", "keywords_json", "library_id", "notes_md"]) {
      expect(Object.hasOwn(inspector.detail!, field)).toBe(false);
    }
    expect(Buffer.byteLength(JSON.stringify(inspector), "utf8")).toBeLessThan(256 * 1024);

    await database.run(`UPDATE works SET deleted_at = ? WHERE id = ?`, [2_000, target]);
    await expect(
      command("library.getWorkInspectorDetail", { workId: target }),
    ).resolves.toMatchObject({ detail: { publisher: "Publisher" } });
  });

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
      { input: { limit: 30, source: "😀".repeat(257) }, name: "library.getPage" },
      { input: { limit: 30, tag: "😀".repeat(257) }, name: "library.getPage" },
      { input: { workId: " ", extra: true }, name: "library.getWorkInspectorDetail" },
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

  it("uses one deterministic Sentinel row per page work while preserving its task count", async () => {
    const target = await addWork("Sentinel ranking target", { createdAt: 1_000 });
    await database.run(
      `INSERT INTO sentinel_tasks (
         id, library_id, work_id, title, current_state, target_flags,
         poll_interval_s, next_poll_at, error_count, status, created_at, updated_at
       ) VALUES
         ('sentinel:older', ?, ?, 'Target work', 'older', NULL, 86400, 1, 0, 'paused', 99, 9999),
         ('sentinel:tied-a', ?, ?, 'Target work', 'first tie', NULL, 86400, 1, 0, 'paused', 100, 100),
         ('sentinel:tied-b', ?, ?, 'Target work', 'selected tie', NULL, 86400, 1, 0, 'active', 100, 101)`,
      [libraryId, target, libraryId, target, libraryId, target],
    );

    const page = await command("library.getPage", { limit: 30 });
    expect(page.workMeta[target]).toMatchObject({
      sentinelState: "selected tie",
      sentinelStatus: "active",
      sentinelTaskCount: 3,
    });
    await expect(
      command("library.getWorkRuntimeMeta", { annotationCount: 0, workId: target }),
    ).resolves.toMatchObject({
      sentinelState: "selected tie",
      sentinelStatus: "active",
      sentinelTaskCount: 3,
    });
  });

  it("bounds selected runtime metadata to its narrow inspector DTO", async () => {
    const target = await addWork("Bounded runtime target", { createdAt: 1_000 });
    const attachmentId = "attachment:runtime-bounded";
    const oversized = "x".repeat(512 * 1024);
    await database.run(
      `INSERT INTO attachments (
         id, work_id, kind, sha256, byte_size, original_filename, source_url,
         fetched_via, page_count, created_at, updated_at
      ) VALUES (?, ?, 'pdf', ?, 456, ?, ?, ?, 12, 2_000, 2_000)`,
      [attachmentId, target, "c".repeat(64), oversized, oversized, oversized],
    );
    for (let index = 0; index < 4; index += 1) {
      await database.run(
        `INSERT INTO attachments (
           id, work_id, kind, sha256, byte_size, original_filename, created_at, updated_at
         ) VALUES (?, ?, 'pdf', ?, ?, 'older.pdf', ?, ?)`,
        [`attachment:runtime-older-${index}`, target, "d".repeat(63) + index, index, index, index],
      );
    }
    for (let index = 0; index < 4; index += 1) {
      await database.run(
        `INSERT INTO annotations (
           id, attachment_id, work_id, type, page_index, content_md, sort_key, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `annotation:runtime-${index}`,
          attachmentId,
          target,
          oversized,
          index,
          oversized,
          index,
          2_000 + index,
          2_000 + index,
        ],
      );
    }
    await database.run(
      `INSERT INTO sentinel_tasks (
         id, library_id, work_id, title, current_state, target_flags,
         poll_interval_s, next_poll_at, error_count, status, created_at, updated_at
       ) VALUES ('sentinel:runtime-bounded', ?, ?, ?, ?, ?, 86400, 1, 0, ?, 2_000, 2_000)`,
      [libraryId, target, oversized, oversized, oversized, oversized],
    );

    const runtime = await command("library.getWorkRuntimeMeta", {
      annotationCount: 4,
      workId: target,
    });

    expect(runtime).toMatchObject({
      annotationCount: 4,
      pdfCount: 5,
      pdfPreview: {
        byte_size: 456,
        fetched_via: null,
        original_filename: null,
        page_count: 12,
      },
      sentinelState: null,
      sentinelStatus: null,
      sentinelTaskCount: 1,
    });
    expect(runtime.notePreviews).toHaveLength(3);
    expect(runtime.notePreviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content_md: null, type: "note" }),
      ]),
    );
    expect(runtime.pdfPreview).not.toHaveProperty("sha256");
    expect(runtime.pdfPreview).not.toHaveProperty("source_url");
    expect(runtime.notePreviews[0]).not.toHaveProperty("attachment_id");
    expect(Buffer.byteLength(JSON.stringify(runtime), "utf8")).toBeLessThan(256 * 1024);
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
      command("library.getWorkInspectorDetail", { workId: foreign.id }),
    ).resolves.toEqual({ detail: null });
    await expect(
      command("library.getWorkRuntimeMeta", { annotationCount: 99, workId: foreign.id }),
    ).rejects.toThrow("outside the active Library");
  });
});
