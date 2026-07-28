import type { AttachmentRow, CollectionRow, Database, WorkWithAuthors } from "@aurascholar/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  citationCountsForWorks: vi.fn(),
  getLibraryDb: vi.fn(),
  listDeletedWorks: vi.fn(),
  listWorks: vi.fn(),
}));

vi.mock("./aura-db", () => ({
  getLibraryDb: mocks.getLibraryDb,
}));

vi.mock("@aurascholar/db/work-list", () => ({
  citationCountsForWorks: mocks.citationCountsForWorks,
  listDeletedWorks: mocks.listDeletedWorks,
  listWorks: mocks.listWorks,
}));

import { loadLibraryPageData, loadLibraryWorkRuntimeMeta } from "./library-page-data";

const LIBRARY_ID = "library-1";

function work(id: string, title: string): WorkWithAuthors {
  return { id, title, authorNames: [] } as unknown as WorkWithAuthors;
}

function databaseWithQuery(query: unknown): Database {
  return {
    exec: vi.fn(),
    query: query as Database["query"],
    queryScalar: vi.fn(),
    run: vi.fn(),
  };
}

describe("library page data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates collections, trash, tags, citations, annotations, PDFs, and sentinel data", async () => {
    const collections: CollectionRow[] = [
      {
        count: 2,
        id: "collection-1",
        library_id: LIBRARY_ID,
        name: "Core papers",
        parent_id: null,
        sort_order: 0,
      },
    ];
    const works = [work("work-1", "First"), work("work-2", "Second")];
    const query = vi.fn(async <T>(sql: string): Promise<T[]> => {
      if (sql.includes("FROM collections c")) return collections as T[];
      if (sql.includes("FROM works") && sql.includes("deleted_at IS NOT NULL")) {
        return [{ n: 3 }] as T[];
      }
      if (sql.includes("FROM work_tags")) {
        return [
          { name: "causal", work_id: "work-1" },
          { name: "methods", work_id: "work-1" },
        ] as T[];
      }
      if (sql.includes("FROM annotations")) {
        return [{ count: "4", work_id: "work-1" }] as T[];
      }
      if (sql.includes("FROM attachments")) {
        return [
          { count: "2", work_id: "work-1" },
          { count: 1, work_id: "work-2" },
        ] as T[];
      }
      if (sql.includes("FROM sentinel_tasks")) {
        return [
          {
            current_state: "published",
            status: "active",
            task_count: "2",
            work_id: "work-1",
          },
        ] as T[];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const db = databaseWithQuery(query);
    mocks.getLibraryDb.mockResolvedValue({ db, libraryId: LIBRARY_ID });
    mocks.listWorks.mockResolvedValue(works);
    mocks.citationCountsForWorks.mockResolvedValue(
      new Map([
        ["work-1", { citedBy: 8, references: 5 }],
        ["work-2", { citedBy: 1, references: 2 }],
      ]),
    );

    await expect(
      loadLibraryPageData({
        collectionId: "collection-1",
        limit: 25,
        search: "graph",
        showTrash: false,
      }),
    ).resolves.toEqual({
      collections,
      trashCount: 3,
      works,
      workMeta: {
        "work-1": {
          annotations: 4,
          citedBy: 8,
          pdfs: 2,
          references: 5,
          sentinelState: "published",
          sentinelStatus: "active",
          sentinelTaskCount: 2,
          tags: ["causal", "methods"],
        },
        "work-2": {
          annotations: 0,
          citedBy: 1,
          pdfs: 1,
          references: 2,
          sentinelState: null,
          sentinelStatus: null,
          sentinelTaskCount: 0,
          tags: [],
        },
      },
    });

    expect(mocks.listWorks).toHaveBeenCalledWith(db, LIBRARY_ID, {
      collectionId: "collection-1",
      limit: 25,
      search: "graph",
    });
    expect(mocks.listDeletedWorks).not.toHaveBeenCalled();
    expect(mocks.citationCountsForWorks).toHaveBeenCalledWith(db, LIBRARY_ID, ["work-1", "work-2"]);
    const queryCalls = query.mock.calls as unknown as Array<
      [sql: string, params: unknown[] | undefined]
    >;
    expect(queryCalls.find(([sql]) => sql.includes("FROM collections c"))?.[1]).toEqual([
      LIBRARY_ID,
    ]);
    expect(
      queryCalls.find(
        ([sql]) => sql.includes("FROM works") && sql.includes("deleted_at IS NOT NULL"),
      )?.[1],
    ).toEqual([LIBRARY_ID]);
    expect(queryCalls.find(([sql]) => sql.includes("FROM work_tags"))?.[1]).toEqual([
      "work-1",
      "work-2",
      LIBRARY_ID,
    ]);
    expect(queryCalls.find(([sql]) => sql.includes("FROM annotations"))?.[1]).toEqual([
      "work-1",
      "work-2",
    ]);
    expect(queryCalls.find(([sql]) => sql.includes("FROM attachments"))?.[1]).toEqual([
      "work-1",
      "work-2",
    ]);
    expect(queryCalls.find(([sql]) => sql.includes("FROM sentinel_tasks"))?.[1]).toEqual([
      "work-1",
      "work-2",
      LIBRARY_ID,
      LIBRARY_ID,
    ]);
  });

  it("returns empty work metadata without issuing metadata queries", async () => {
    const query = vi.fn(async <T>(sql: string): Promise<T[]> => {
      if (sql.includes("FROM collections c")) return [] as T[];
      if (sql.includes("FROM works") && sql.includes("deleted_at IS NOT NULL")) {
        return [{ n: 0 }] as T[];
      }
      throw new Error(`Unexpected metadata query: ${sql}`);
    });
    const db = databaseWithQuery(query);
    mocks.getLibraryDb.mockResolvedValue({ db, libraryId: LIBRARY_ID });
    mocks.listWorks.mockResolvedValue([]);

    await expect(loadLibraryPageData({ limit: 50, showTrash: false })).resolves.toMatchObject({
      works: [],
      workMeta: {},
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(mocks.citationCountsForWorks).not.toHaveBeenCalled();
  });

  it("uses the deleted-work listing when trash is selected", async () => {
    const deletedWorks = [work("deleted-1", "Removed paper")];
    const query = vi.fn(async <T>(sql: string): Promise<T[]> => {
      if (sql.includes("FROM collections c")) return [] as T[];
      if (sql.includes("FROM works") && sql.includes("deleted_at IS NOT NULL")) {
        return [{ n: 1 }] as T[];
      }
      if (
        sql.includes("FROM work_tags") ||
        sql.includes("FROM annotations") ||
        sql.includes("FROM attachments") ||
        sql.includes("FROM sentinel_tasks")
      ) {
        return [] as T[];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const db = databaseWithQuery(query);
    mocks.getLibraryDb.mockResolvedValue({ db, libraryId: LIBRARY_ID });
    mocks.listDeletedWorks.mockResolvedValue(deletedWorks);
    mocks.citationCountsForWorks.mockResolvedValue(new Map());

    const result = await loadLibraryPageData({
      limit: 10,
      search: "removed",
      showTrash: true,
    });

    expect(result.works).toEqual(deletedWorks);
    expect(mocks.listDeletedWorks).toHaveBeenCalledWith(db, LIBRARY_ID, {
      limit: 10,
      search: "removed",
    });
    expect(mocks.listWorks).not.toHaveBeenCalled();
  });
});

describe("library work runtime metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects PDF attachments, note previews, and the latest sentinel state", async () => {
    const attachments = [
      {
        created_at: 30,
        id: "pdf-new",
        kind: "pdf",
        work_id: "work-1",
      },
      {
        created_at: 20,
        id: "supplement",
        kind: "supplement",
        work_id: "work-1",
      },
      {
        created_at: 10,
        id: "pdf-old",
        kind: "pdf",
        work_id: "work-1",
      },
    ] as AttachmentRow[];
    const notes = [
      {
        content_md: "Important result",
        id: "note-1",
        page_index: 2,
        type: "note",
        updated_at: 40,
      },
    ];
    const sentinelTasks = [
      { current_state: "online", status: "active" },
      { current_state: "accepted", status: "completed" },
    ];
    const query = vi.fn(async <T>(sql: string): Promise<T[]> => {
      if (sql.includes("FROM attachments")) return attachments as T[];
      if (sql.includes("FROM annotations")) return notes as T[];
      if (sql.includes("FROM sentinel_tasks")) return sentinelTasks as T[];
      throw new Error(`Unexpected query: ${sql}`);
    });
    const db = databaseWithQuery(query);
    mocks.getLibraryDb.mockResolvedValue({ db, libraryId: LIBRARY_ID });

    await expect(loadLibraryWorkRuntimeMeta("work-1", 7)).resolves.toEqual({
      annotationCount: 7,
      notePreviews: notes,
      pdfCount: 2,
      pdfPreview: attachments[0],
      sentinelState: "online",
      sentinelStatus: "active",
      sentinelTaskCount: 2,
    });

    expect(query).toHaveBeenCalledTimes(3);
    const queryCalls = query.mock.calls as unknown as Array<
      [sql: string, params: unknown[] | undefined]
    >;
    expect(queryCalls.find(([sql]) => sql.includes("FROM attachments"))?.[1]).toEqual([
      "work-1",
      "work-1",
      LIBRARY_ID,
    ]);
    expect(queryCalls.find(([sql]) => sql.includes("FROM annotations"))?.[1]).toEqual([
      "work-1",
      "work-1",
      LIBRARY_ID,
    ]);
    expect(queryCalls.find(([sql]) => sql.includes("FROM sentinel_tasks"))?.[1]).toEqual([
      "work-1",
      LIBRARY_ID,
    ]);
  });
});
