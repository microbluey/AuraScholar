import type { Database } from "@aurascholar/db";
import type { AnnotationRow } from "@aurascholar/db/repos/annotations";
import type { WorkWithAuthors } from "@aurascholar/db/repos/works";
import { describe, expect, it, vi } from "vitest";
import {
  createCanvasPageRepository,
  loadCanvasActiveWork,
  loadCanvasAnnotationIngressSource,
  type CanvasPageDataSource,
  type CanvasPageRepository,
} from "./canvas-page-data";

function annotation(overrides: Partial<AnnotationRow> = {}): AnnotationRow {
  return {
    id: "annotation-1",
    attachment_id: "attachment-1",
    work_id: "work-1",
    type: "highlight",
    color: "#ffd866",
    page_index: 0,
    anchor_json: null,
    content_md: null,
    ink_paths_json: null,
    sort_key: 0,
    orphaned: 0,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function work(overrides: Partial<WorkWithAuthors> = {}): WorkWithAuthors {
  return {
    id: "work-1",
    library_id: "library-1",
    title: "Scoped paper",
    deleted_at: null,
    authorNames: ["Researcher"],
    ...overrides,
  } as WorkWithAuthors;
}

function repository(overrides: Partial<CanvasPageRepository> = {}): CanvasPageRepository {
  return {
    findActiveAnnotation: vi.fn(async () => annotation()),
    findActiveWork: vi.fn(async () => work()),
    ...overrides,
  };
}

function dataSource(repo: CanvasPageRepository): CanvasPageDataSource {
  return { open: vi.fn(async () => repo) };
}

describe("canvas page data gateway", () => {
  it("builds the production annotation query with Library, work, and soft-delete scope", async () => {
    const query = vi.fn(async (_sql: string, _params: unknown[] = []) => [annotation()]);
    const repo = createCanvasPageRepository({
      db: { query } as unknown as Database,
      libraryId: "library-1",
    });

    await expect(repo.findActiveAnnotation("annotation-1", "work-1")).resolves.toEqual(
      annotation(),
    );
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(sql).toEqual(expect.stringContaining("w.library_id = ?"));
    expect(sql).toEqual(expect.stringContaining("w.deleted_at IS NULL"));
    expect(sql).toEqual(expect.stringContaining("at.work_id = an.work_id"));
    expect(sql).toEqual(expect.stringContaining("at.deleted_at IS NULL"));
    expect(sql).toEqual(expect.stringContaining("an.deleted_at IS NULL"));
    expect(params).toEqual(["annotation-1", "work-1", "library-1"]);
  });

  it("filters a soft-deleted work returned by the production repository", async () => {
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("SELECT * FROM works")) {
        expect(params).toEqual(["work-1", "library-1"]);
        return [work({ deleted_at: 123 })];
      }
      return [];
    });
    const repo = createCanvasPageRepository({
      db: { query } as unknown as Database,
      libraryId: "library-1",
    });

    await expect(repo.findActiveWork("work-1")).resolves.toBeNull();
  });

  it("loads an active annotation and its source work from one scoped repository", async () => {
    const row = annotation();
    const sourceWork = work();
    const repo = repository({
      findActiveAnnotation: vi.fn(async () => row),
      findActiveWork: vi.fn(async () => sourceWork),
    });
    const source = dataSource(repo);

    await expect(
      loadCanvasAnnotationIngressSource(row.id, row.work_id, undefined, source),
    ).resolves.toEqual({ annotation: row, work: sourceWork });
    expect(source.open).toHaveBeenCalledTimes(1);
    expect(repo.findActiveAnnotation).toHaveBeenCalledWith(row.id, row.work_id);
    expect(repo.findActiveWork).toHaveBeenCalledWith(row.work_id);
  });

  it("fails closed when the annotation is missing or outside the requested work", async () => {
    const repo = repository({
      findActiveAnnotation: vi.fn(async () => null),
    });

    await expect(
      loadCanvasAnnotationIngressSource(
        "foreign-annotation",
        "work-1",
        undefined,
        dataSource(repo),
      ),
    ).rejects.toThrow("没有找到属于这篇文献的批注");
    expect(repo.findActiveWork).not.toHaveBeenCalled();
  });

  it("rejects a mismatched annotation returned by a faulty data source", async () => {
    const repo = repository({
      findActiveAnnotation: vi.fn(async () => annotation({ work_id: "work-2" })),
    });

    await expect(
      loadCanvasAnnotationIngressSource("annotation-1", "work-1", undefined, dataSource(repo)),
    ).rejects.toThrow("这条批注不属于请求加入的文献");
    expect(repo.findActiveWork).not.toHaveBeenCalled();
  });

  it("rejects an annotation whose source work is no longer active", async () => {
    const repo = repository({
      findActiveWork: vi.fn(async () => null),
    });

    await expect(
      loadCanvasAnnotationIngressSource("annotation-1", "work-1", undefined, dataSource(repo)),
    ).rejects.toThrow("批注的来源文献已不存在或位于回收站");
  });

  it("does not open a repository when already aborted", async () => {
    const source = dataSource(repository());
    const controller = new AbortController();
    controller.abort();

    await expect(loadCanvasActiveWork("work-1", controller.signal, source)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(source.open).not.toHaveBeenCalled();
  });

  it("does not project a work returned after cancellation", async () => {
    const controller = new AbortController();
    const repo = repository({
      findActiveWork: vi.fn(async () => {
        controller.abort();
        return work();
      }),
    });

    await expect(
      loadCanvasActiveWork("work-1", controller.signal, dataSource(repo)),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("stops annotation ingress before resolving its work when cancelled", async () => {
    const controller = new AbortController();
    const repo = repository({
      findActiveAnnotation: vi.fn(async () => {
        controller.abort();
        return annotation();
      }),
    });

    await expect(
      loadCanvasAnnotationIngressSource(
        "annotation-1",
        "work-1",
        controller.signal,
        dataSource(repo),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(repo.findActiveWork).not.toHaveBeenCalled();
  });
});
