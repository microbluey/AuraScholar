import { Buffer } from "node:buffer";
import { TagsRepo, WorksRepo, type Database } from "@aurascholar/db";
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
    deviceId: "library-list-command-device",
    deviceName: "Library list commands",
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
    abstract?: string;
    authors?: string[];
    createdAt?: number;
    doi?: string;
    readingStatus?: "unread" | "reading" | "read";
    starred?: boolean;
    venueName?: string;
    year?: number;
  } = {},
): Promise<string> {
  const { id } = await works.upsert({
    abstract: options.abstract,
    authors: options.authors?.map((displayName, position) => ({ displayName, position })),
    doi: options.doi,
    title,
    type: "article",
    venueName: options.venueName,
    year: options.year,
  });
  const timestamp = options.createdAt ?? Date.now();
  await database.run(
    `UPDATE works
     SET created_at = ?, updated_at = ?, reading_status = ?, starred = ?
     WHERE id = ?`,
    [timestamp, timestamp, options.readingStatus ?? "unread", options.starred ? 1 : 0, id],
  );
  return id;
}

describe("Library list data commands", () => {
  it("rejects malformed and scope-injecting input before obtaining a database lease", async () => {
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
      { input: { libraryId: "library:foreign" }, name: "library.listWorks" },
      { input: { limit: 0 }, name: "library.listWorks" },
      { input: { limit: 501 }, name: "library.listWorks" },
      { input: { collectionId: "collection:foreign" }, name: "library.listWorks" },
      { input: {}, name: "library.searchWorksByMetadata" },
      {
        input: { libraryId: "library:foreign", search: "methods" },
        name: "library.searchWorksByMetadata",
      },
      { input: { limit: 101, search: "methods" }, name: "library.searchWorksByMetadata" },
      { input: { search: "m".repeat(513) }, name: "library.searchWorksByMetadata" },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
  });

  it("lists bounded active local-Library works through a camelCase DTO", async () => {
    const target = await addWork("Scoped methods", {
      abstract: "A local abstract",
      authors: ["Ada Lovelace", "Grace Hopper"],
      createdAt: 2_000,
      doi: "10.1000/scoped",
      readingStatus: "reading",
      starred: true,
      venueName: "Journal of Methods",
      year: 2026,
    });
    const removed = await addWork("Removed local work", { createdAt: 3_000 });
    await works.softDelete(removed);

    const foreignLibraryId = "library:foreign";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    await new WorksRepo(database, foreignLibraryId).upsert({
      title: "Foreign work",
      type: "article",
    });

    await expect(command("library.listWorks", { limit: 500 })).resolves.toEqual({
      works: [
        {
          abstract: "A local abstract",
          authorNames: ["Ada Lovelace", "Grace Hopper"],
          createdAt: 2_000,
          doi: "10.1000/scoped",
          id: target,
          readingStatus: "reading",
          starred: true,
          title: "Scoped methods",
          venueName: "Journal of Methods",
          year: 2026,
        },
      ],
    });
  });

  it("preserves metadata search matching and exposes active tags only", async () => {
    const target = await addWork("Causal methods", {
      abstract: "Research workflow",
      authors: ["Katherine Johnson"],
      createdAt: 2_000,
      venueName: "Methods Quarterly",
      year: 2025,
    });
    const tags = new TagsRepo(database, libraryId);
    await tags.addToWorks([target], "Reproducibility");

    const result = await command("library.searchWorksByMetadata", {
      limit: 100,
      search: "Katherine Reproducibility",
    });
    expect(result.works).toEqual([
      {
        abstract: "Research workflow",
        authorNames: ["Katherine Johnson"],
        createdAt: 2_000,
        doi: null,
        id: target,
        readingStatus: "unread",
        starred: false,
        tagNames: ["Reproducibility"],
        title: "Causal methods",
        venueName: "Methods Quarterly",
        year: 2025,
      },
    ]);

    await expect(
      command("library.searchWorksByMetadata", { search: "Methods Quarterly" }),
    ).resolves.toMatchObject({ works: [expect.objectContaining({ id: target })] });
  });

  it("rejects oversized serialized list envelopes without truncating stored work data", async () => {
    const target = await addWork("Oversized work", { createdAt: 2_000 });
    const oversizedAbstract = "文".repeat(Math.ceil((8 * 1024 * 1024) / Buffer.byteLength("文")));
    await database.run(`UPDATE works SET abstract = ? WHERE id = ?`, [oversizedAbstract, target]);

    await expect(command("library.listWorks", { limit: 1 })).rejects.toThrow(
      "Library list output is limited to 8388608 bytes",
    );
    await expect(
      command("library.searchWorksByMetadata", { limit: 1, search: "" }),
    ).rejects.toThrow("Library list output is limited to 8388608 bytes");
    await expect(
      database.query<{ abstract: string }>(`SELECT abstract FROM works WHERE id = ?`, [target]),
    ).resolves.toEqual([{ abstract: oversizedAbstract }]);
  });
});
