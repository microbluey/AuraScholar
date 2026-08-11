import type { AnnotationRow } from "@aurascholar/db/repos/annotations";
import type { WorkWithAuthors } from "@aurascholar/db/repos/works";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadCanvasActiveWork,
  loadCanvasAnnotationIngressSource,
  type CanvasAnnotationIngressSource,
  type CanvasPageDataSource,
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

function ingressSource(
  overrides: Partial<CanvasAnnotationIngressSource> = {},
): CanvasAnnotationIngressSource {
  return {
    annotation: annotation(),
    work: work(),
    ...overrides,
  };
}

function dataSource(overrides: Partial<CanvasPageDataSource> = {}): CanvasPageDataSource {
  return {
    getActiveWork: vi.fn(async () => work()),
    getAnnotationIngressSource: vi.fn(async () => ingressSource()),
    ...overrides,
  };
}

describe("canvas page data gateway", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
  });

  it("loads an active work through the scoped Canvas command", async () => {
    const sourceWork = work();
    command.mockResolvedValueOnce({ work: sourceWork });

    await expect(loadCanvasActiveWork(sourceWork.id)).resolves.toBe(sourceWork);
    expect(command).toHaveBeenCalledWith("canvas.getActiveWork", { workId: sourceWork.id });
  });

  it("loads a Canvas annotation ingress source through one scoped command", async () => {
    const source = ingressSource();
    command.mockResolvedValueOnce({ source });

    await expect(
      loadCanvasAnnotationIngressSource(source.annotation.id, source.work.id),
    ).resolves.toBe(source);
    expect(command).toHaveBeenCalledWith("canvas.getAnnotationIngressSource", {
      annotationId: source.annotation.id,
      workId: source.work.id,
    });
  });

  it("retains an injectable data source for Canvas ingress lifecycle tests", async () => {
    const source = ingressSource();
    const injected = dataSource({
      getAnnotationIngressSource: vi.fn(async () => source),
    });

    await expect(
      loadCanvasAnnotationIngressSource(source.annotation.id, source.work.id, undefined, injected),
    ).resolves.toBe(source);
    expect(injected.getAnnotationIngressSource).toHaveBeenCalledWith(
      source.annotation.id,
      source.work.id,
    );
  });

  it("fails closed when the ingress source is missing", async () => {
    const injected = dataSource({
      getAnnotationIngressSource: vi.fn(async () => null),
    });

    await expect(
      loadCanvasAnnotationIngressSource("foreign-annotation", "work-1", undefined, injected),
    ).rejects.toThrow("没有找到属于这篇文献的批注");
  });

  it("rejects a mismatched annotation returned by a faulty data source", async () => {
    const injected = dataSource({
      getAnnotationIngressSource: vi.fn(async () =>
        ingressSource({ annotation: annotation({ work_id: "work-2" }) }),
      ),
    });

    await expect(
      loadCanvasAnnotationIngressSource("annotation-1", "work-1", undefined, injected),
    ).rejects.toThrow("这条批注不属于请求加入的文献");
  });

  it("rejects an ingress source whose work is no longer active", async () => {
    const injected = dataSource({
      getAnnotationIngressSource: vi.fn(async () =>
        ingressSource({ work: work({ deleted_at: 123 }) }),
      ),
    });

    await expect(
      loadCanvasAnnotationIngressSource("annotation-1", "work-1", undefined, injected),
    ).rejects.toThrow("批注的来源文献已不存在或位于回收站");
  });

  it("does not request data when already aborted", async () => {
    const injected = dataSource();
    const controller = new AbortController();
    controller.abort();

    await expect(loadCanvasActiveWork("work-1", controller.signal, injected)).rejects.toMatchObject(
      {
        name: "AbortError",
      },
    );
    expect(injected.getActiveWork).not.toHaveBeenCalled();
  });

  it("does not project a work returned after cancellation", async () => {
    const controller = new AbortController();
    const injected = dataSource({
      getActiveWork: vi.fn(async () => {
        controller.abort();
        return work();
      }),
    });

    await expect(loadCanvasActiveWork("work-1", controller.signal, injected)).rejects.toMatchObject(
      { name: "AbortError" },
    );
  });

  it("does not project an ingress source returned after cancellation", async () => {
    const controller = new AbortController();
    const injected = dataSource({
      getAnnotationIngressSource: vi.fn(async () => {
        controller.abort();
        return ingressSource();
      }),
    });

    await expect(
      loadCanvasAnnotationIngressSource("annotation-1", "work-1", controller.signal, injected),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
