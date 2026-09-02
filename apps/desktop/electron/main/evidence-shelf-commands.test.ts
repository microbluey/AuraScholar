import {
  AttachmentsRepo,
  ContentUnitsRepo,
  ResearchProjectsRepo,
  WorksRepo,
  type ContentUnit,
  type Database,
} from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it } from "vitest";
import type { DataCommandInput, DataCommandOutput } from "../data-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import { type DataCommandDependencies } from "./data-command-runtime";
import { executeDataCommand } from "./data-commands";
import {
  MAX_EVIDENCE_SHELF_OUTPUT_BYTES,
  MAX_EVIDENCE_SHELF_ROWS,
} from "./evidence-shelf-commands";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

interface ShelfFixture {
  contentUnit: ContentUnit;
  database: Database;
  dependencies: DataCommandDependencies;
  libraryId: string;
  projectId: string;
}

let fixture: ShelfFixture;

beforeEach(async () => {
  const database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  const { libraryId } = await ensureLocalFirstState(database, {
    deviceId: "evidence-shelf-command-device",
    deviceName: "Evidence Shelf commands",
    platform: "test",
  });
  const works = new WorksRepo(database, libraryId);
  const work = await works.upsert({ title: "Evidence Shelf command paper" });
  const projects = new ResearchProjectsRepo(database, libraryId);
  const project = await projects.create({ name: "Evidence Shelf project" });
  await projects.addWorks(project.id, [work.id]);

  const attachment = await new AttachmentsRepo(database, libraryId).create({
    byteSize: 128,
    originalFilename: "shelf.pdf",
    sha256: HASH_A,
    workId: work.id,
  });
  const [document] = await database.query<{
    asset_id: string;
    revision_id: string;
  }>(
    `SELECT asset.id AS asset_id, revision.id AS revision_id
       FROM document_assets asset
       JOIN document_revisions revision ON revision.asset_id = asset.id
      WHERE asset.library_id = ? AND asset.work_id = ? AND revision.attachment_id = ?`,
    [libraryId, work.id, attachment.id],
  );
  if (!document) throw new Error("test document mapping was not created");

  const contentUnit: ContentUnit = {
    anchor: {
      kind: "pdf",
      pageIndex: 2,
      position: { end: 72, start: 18 },
      quote: {
        exact: "The command preserves an exact source revision and page anchor.",
        prefix: "Before ",
        suffix: " After",
      },
      revisionId: document.revision_id,
      version: 1,
    },
    assetId: document.asset_id,
    chunkProfile: "test-chunk-v1",
    contentHash: HASH_A,
    extractorProfile: "test-extractor-v1",
    headingPath: ["Methods", "Sampling"],
    id: "content-unit:evidence-shelf-command",
    language: "en",
    libraryId,
    ordinal: 0,
    parentUnitId: null,
    revisionId: document.revision_id,
    sourceId: document.revision_id,
    sourceType: "pdf",
    state: "ready",
    text: "The command preserves an exact source revision and page anchor.",
    tokenCount: 10,
    workId: work.id,
  };
  await new ContentUnitsRepo(database, libraryId).upsertMany([contentUnit]);

  const coordinator = new DatabaseCoordinator(database);
  fixture = {
    contentUnit,
    database,
    dependencies: {
      execute: (_commandName, operation) => coordinator.execute(operation),
      transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
    },
    libraryId,
    projectId: project.id,
  };
});

function previewFor(unit: ContentUnit) {
  return {
    contentUnitId: unit.id,
    excerpt: unit.text,
    headingPath: unit.headingPath,
    language: unit.language,
    ordinal: unit.ordinal,
    sourceId: unit.sourceId,
    sourceType: unit.sourceType,
    text: unit.text,
    tokenCount: unit.tokenCount,
    workTitle: "Evidence Shelf command paper",
  } as const;
}

function stageInput(
  overrides: Partial<DataCommandInput<"evidenceShelf.stage">> = {},
): DataCommandInput<"evidenceShelf.stage"> {
  return {
    anchorSnapshot: fixture.contentUnit.anchor,
    contentUnitId: fixture.contentUnit.id,
    libraryId: fixture.libraryId,
    previewPayload: previewFor(fixture.contentUnit),
    projectId: fixture.projectId,
    ...overrides,
  };
}

function command<K extends keyof import("../data-command-contract").DataCommandMap>(
  name: K,
  input: DataCommandInput<K>,
): Promise<DataCommandOutput<K>> {
  return executeDataCommand({ name, input }, fixture.dependencies) as Promise<DataCommandOutput<K>>;
}

describe("Evidence Shelf main-process commands", () => {
  it("rejects malformed and preview-drifting inputs before acquiring a lease", async () => {
    let executeCalls = 0;
    let transactionCalls = 0;
    const rejecting: DataCommandDependencies = {
      execute: async () => {
        executeCalls += 1;
        throw new Error("query lease acquired");
      },
      transaction: async () => {
        transactionCalls += 1;
        throw new Error("transaction lease acquired");
      },
    };
    const invalidInputs: unknown[] = [
      { libraryId: " ", projectId: fixture.projectId },
      { ...stageInput(), extra: true },
      {
        ...stageInput(),
        previewPayload: { ...previewFor(fixture.contentUnit), contentUnitId: "content-unit:other" },
      },
      {
        ...stageInput(),
        previewPayload: { ...previewFor(fixture.contentUnit), extra: "renderer-only" },
      },
      { ...stageInput(), anchorSnapshot: [] },
      { ...stageInput(), previewPayload: { ...previewFor(fixture.contentUnit), text: "" } },
      {
        expectedRevisionId: fixture.contentUnit.revisionId,
        expectedSourceContentHash: "short",
        itemId: "shelf:item",
        libraryId: fixture.libraryId,
        projectId: fixture.projectId,
      },
    ];
    const names = [
      "evidenceShelf.list",
      "evidenceShelf.stage",
      "evidenceShelf.stage",
      "evidenceShelf.stage",
      "evidenceShelf.stage",
      "evidenceShelf.stage",
      "evidenceShelf.resolveForSave",
    ] as const;
    for (let index = 0; index < invalidInputs.length; index += 1) {
      await expect(
        executeDataCommand(
          { name: names[index]!, input: invalidInputs[index] } as never,
          rejecting,
        ),
      ).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("stages by canonical ContentUnit, deduplicates, lists, resolves, and removes", async () => {
    const first = await command(
      "evidenceShelf.stage",
      stageInput({
        previewPayload: {
          ...previewFor(fixture.contentUnit),
          sourceId: "evidence:spoofed",
          sourceType: "evidence",
          text: fixture.contentUnit.text,
          workTitle: "Spoofed title",
        },
      }),
    );
    expect(first).toMatchObject({
      created: true,
      item: {
        id: expect.any(String),
        projectId: fixture.projectId,
        revisionId: fixture.contentUnit.revisionId,
        sourceContentHash: HASH_A,
        status: "staged",
        currentRevisionId: fixture.contentUnit.revisionId,
        currentSourceContentHash: HASH_A,
        isStale: false,
      },
    });
    expect(first.item.previewPayload).toMatchObject({
      contentUnitId: fixture.contentUnit.id,
      sourceId: fixture.contentUnit.sourceId,
      sourceType: fixture.contentUnit.sourceType,
      text: fixture.contentUnit.text,
      workTitle: "Evidence Shelf command paper",
    });

    const duplicate = await command("evidenceShelf.stage", stageInput());
    expect(duplicate).toMatchObject({ created: false, item: { id: first.item.id } });

    const listed = await command("evidenceShelf.list", {
      libraryId: fixture.libraryId,
      projectId: fixture.projectId,
    });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ id: first.item.id, sourceContentHash: HASH_A });

    const resolved = await command("evidenceShelf.resolveForSave", {
      expectedRevisionId: fixture.contentUnit.revisionId,
      expectedSourceContentHash: HASH_A,
      itemId: first.item.id,
      libraryId: fixture.libraryId,
      projectId: fixture.projectId,
    });
    expect(resolved).toMatchObject({ stale: false, item: { id: first.item.id, isStale: false } });

    const stale = await command("evidenceShelf.resolveForSave", {
      expectedRevisionId: fixture.contentUnit.revisionId,
      expectedSourceContentHash: HASH_B,
      itemId: first.item.id,
      libraryId: fixture.libraryId,
      projectId: fixture.projectId,
    });
    expect(stale).toMatchObject({ stale: true, item: { id: first.item.id, status: "stale" } });

    const afterStale = await command("evidenceShelf.list", {
      libraryId: fixture.libraryId,
      projectId: fixture.projectId,
    });
    expect(afterStale.items[0]).toMatchObject({ status: "stale" });

    const removed = await command("evidenceShelf.remove", {
      expectedUpdatedAt: afterStale.items[0]!.updatedAt,
      itemId: first.item.id,
      libraryId: fixture.libraryId,
      projectId: fixture.projectId,
    });
    expect(removed).toEqual({ removed: true });
    await expect(
      command("evidenceShelf.list", {
        libraryId: fixture.libraryId,
        projectId: fixture.projectId,
      }),
    ).resolves.toEqual({ items: [] });
  });

  it("rejects a source that is not a member of the target project", async () => {
    const projects = new ResearchProjectsRepo(fixture.database, fixture.libraryId);
    const foreignProject = await projects.create({ name: "Other project" });
    await expect(
      command("evidenceShelf.stage", stageInput({ projectId: foreignProject.id })),
    ).rejects.toThrow("not a member");
  });

  it("surfaces canonical revision drift and refuses to resolve it for save", async () => {
    const staged = await command("evidenceShelf.stage", stageInput());
    await fixture.database.run(
      `UPDATE document_assets SET current_revision_id = NULL WHERE id = ?`,
      [fixture.contentUnit.assetId],
    );

    const listed = await command("evidenceShelf.list", {
      libraryId: fixture.libraryId,
      projectId: fixture.projectId,
    });
    expect(listed.items).toMatchObject([
      {
        currentRevisionId: null,
        currentSourceContentHash: null,
        id: staged.item.id,
        isStale: true,
        revisionId: fixture.contentUnit.revisionId,
        status: "stale",
      },
    ]);

    await expect(
      command("evidenceShelf.resolveForSave", {
        expectedRevisionId: fixture.contentUnit.revisionId,
        expectedSourceContentHash: HASH_A,
        itemId: staged.item.id,
        libraryId: fixture.libraryId,
        projectId: fixture.projectId,
      }),
    ).resolves.toMatchObject({ stale: true, item: { id: staged.item.id, isStale: true } });
  });

  it("uses effective Work language when a ContentUnit leaves language unset", async () => {
    await fixture.database.run(`UPDATE works SET language = 'en-US' WHERE id = ?`, [
      fixture.contentUnit.workId,
    ]);
    await fixture.database.run(`UPDATE content_units SET language = NULL WHERE id = ?`, [
      fixture.contentUnit.id,
    ]);

    const staged = await command(
      "evidenceShelf.stage",
      stageInput({
        previewPayload: { ...previewFor(fixture.contentUnit), language: null },
      }),
    );
    expect(staged.item.previewPayload).toMatchObject({ language: "en-US" });
  });

  it("normalizes legacy preview aliases and ignores additive metadata on reads", async () => {
    await fixture.database.run(
      `INSERT INTO evidence_shelf_items
         (id, library_id, project_id, work_id, asset_id, revision_id,
          anchor_snapshot_json, preview_payload_json, source_content_hash,
          status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'staged', 10, 10)`,
      [
        "shelf-legacy-alias",
        fixture.libraryId,
        fixture.projectId,
        fixture.contentUnit.workId,
        fixture.contentUnit.assetId,
        fixture.contentUnit.revisionId,
        JSON.stringify({
          kind: "pdf",
          pageIndex: 3,
          revisionId: fixture.contentUnit.revisionId,
          version: 1,
        }),
        JSON.stringify({
          content_unit_id: fixture.contentUnit.id,
          excerpt: fixture.contentUnit.text,
          heading_path: fixture.contentUnit.headingPath,
          language: fixture.contentUnit.language,
          ordinal: fixture.contentUnit.ordinal,
          source_id: fixture.contentUnit.sourceId,
          source_type: fixture.contentUnit.sourceType,
          text: fixture.contentUnit.text,
          token_count: fixture.contentUnit.tokenCount,
          work_title: "Evidence Shelf command paper",
          imported_metadata: "ignored by the IPC contract",
        }),
        HASH_A,
      ],
    );

    const listed = await command("evidenceShelf.list", {
      libraryId: fixture.libraryId,
      projectId: fixture.projectId,
    });
    const item = listed.items.find((candidate) => candidate.id === "shelf-legacy-alias");
    expect(item?.previewPayload).toEqual(previewFor(fixture.contentUnit));
  });

  it("preflights row and byte budgets before materializing Shelf rows", async () => {
    const base = fixture.database;
    let shelfSelectCalls = 0;
    const boundedDatabase: Database = {
      async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
        if (sql.includes("TOTAL(") && sql.includes("FROM evidence_shelf_items")) {
          return [{ row_count: MAX_EVIDENCE_SHELF_ROWS + 1, payload_bytes: 0 }] as T[];
        }
        if (sql.includes("FROM evidence_shelf_items shelf")) shelfSelectCalls += 1;
        return base.query<T>(sql, params);
      },
      run: base.run.bind(base),
      exec: base.exec.bind(base),
      queryScalar: base.queryScalar.bind(base),
    };
    const dependencies: DataCommandDependencies = {
      execute: async (_commandName, operation) => await operation(boundedDatabase),
      transaction: fixture.dependencies.transaction,
    };

    await expect(
      executeDataCommand(
        {
          name: "evidenceShelf.list",
          input: { libraryId: fixture.libraryId, projectId: fixture.projectId },
        },
        dependencies,
      ),
    ).rejects.toThrow(`Evidence shelf items are limited to ${MAX_EVIDENCE_SHELF_ROWS}`);
    expect(shelfSelectCalls).toBe(0);

    const byteBudgetDatabase: Database = {
      ...boundedDatabase,
      async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
        if (sql.includes("TOTAL(") && sql.includes("FROM evidence_shelf_items")) {
          return [{ row_count: 1, payload_bytes: MAX_EVIDENCE_SHELF_OUTPUT_BYTES + 1 }] as T[];
        }
        if (sql.includes("FROM evidence_shelf_items shelf")) shelfSelectCalls += 1;
        return base.query<T>(sql, params);
      },
    };
    await expect(
      executeDataCommand(
        {
          name: "evidenceShelf.list",
          input: { libraryId: fixture.libraryId, projectId: fixture.projectId },
        },
        {
          execute: async (_commandName, operation) => await operation(byteBudgetDatabase),
          transaction: fixture.dependencies.transaction,
        },
      ),
    ).rejects.toThrow(
      `Evidence shelf output is limited to ${MAX_EVIDENCE_SHELF_OUTPUT_BYTES} bytes`,
    );
    expect(shelfSelectCalls).toBe(0);
  });

  it("promotes a staged PDF through the typed command and consumes it", async () => {
    const staged = await command("evidenceShelf.stage", stageInput());
    const promoted = await command("evidenceShelf.promote", {
      expectedUpdatedAt: staged.item.updatedAt,
      evidenceKind: "method",
      itemId: staged.item.id,
      libraryId: fixture.libraryId,
      noteMd: "保留这条方法证据。",
      projectId: fixture.projectId,
      tags: ["方法", "核验"],
      title: "命令边界测试",
    });

    expect(promoted).toMatchObject({
      created: true,
      projectMembershipAdded: true,
      removedFromShelf: true,
      evidence: {
        evidenceKind: "method",
        noteMd: "保留这条方法证据。",
        sourceKind: "document",
        text: fixture.contentUnit.text,
        title: "命令边界测试",
      },
    });
    await expect(
      command("evidenceShelf.list", {
        libraryId: fixture.libraryId,
        projectId: fixture.projectId,
      }),
    ).resolves.toEqual({ items: [] });
  });

  it("rejects an optimistic version mismatch before creating Evidence", async () => {
    const staged = await command("evidenceShelf.stage", stageInput());
    await expect(
      command("evidenceShelf.promote", {
        expectedUpdatedAt: staged.item.updatedAt - 1,
        evidenceKind: "context",
        itemId: staged.item.id,
        libraryId: fixture.libraryId,
        projectId: fixture.projectId,
      }),
    ).rejects.toThrow("changed; reload");
    expect(
      await fixture.database.query("SELECT id FROM evidence_items WHERE library_id = ?", [
        fixture.libraryId,
      ]),
    ).toEqual([]);
    await expect(
      command("evidenceShelf.list", {
        libraryId: fixture.libraryId,
        projectId: fixture.projectId,
      }),
    ).resolves.toMatchObject({ items: [{ id: staged.item.id, status: "staged" }] });
  });
});
