import { describe, expect, it, vi } from "vitest";
import type { ResearchProjectService } from "../../services/research-project-service";
import type { ProjectLibraryWorkOption } from "./model";
import { ProjectSourceSearchController } from "./project-source-search";

function option(workId: string): ProjectLibraryWorkOption {
  return {
    annotationCount: 0,
    authorNames: [],
    inProject: false,
    pdfCount: 0,
    readingStatus: "unread",
    title: workId,
    venue: null,
    workId,
    year: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((next) => {
      resolve = next;
    }),
    resolve,
  };
}

function service(
  searchLibraryWorks: ResearchProjectService["searchLibraryWorks"],
): ResearchProjectService {
  return {
    addWorks: vi.fn(async () => 0),
    createProject: vi.fn(async () => {
      throw new Error("unused");
    }),
    listProjects: vi.fn(async () => []),
    loadWorkspace: vi.fn(async () => ({ project: null, projects: [], sources: [] })),
    removeWorks: vi.fn(async () => 0),
    renameProject: vi.fn(async () => {
      throw new Error("unused");
    }),
    searchLibraryWorks,
  };
}

describe("ProjectSourceSearchController", () => {
  it("rejects a late search completion even when the provider ignores abort", async () => {
    const first = deferred<ProjectLibraryWorkOption[]>();
    const second = deferred<ProjectLibraryWorkOption[]>();
    const signals: AbortSignal[] = [];
    const controller = new ProjectSourceSearchController(
      service(
        vi.fn((_projectId, query, options) => {
          if (options?.signal) signals.push(options.signal);
          return query === "old" ? first.promise : second.promise;
        }),
      ),
    );
    controller.start("project-a");

    const oldSearch = controller.search("old");
    const newSearch = controller.search("new");
    expect(signals[0]?.aborted).toBe(true);
    second.resolve([option("new")]);
    await newSearch;
    first.resolve([option("old")]);
    await oldSearch;

    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      projectId: "project-a",
      query: "new",
      results: [{ workId: "new" }],
    });
  });

  it("never carries results across project identity changes", async () => {
    const old = deferred<ProjectLibraryWorkOption[]>();
    const controller = new ProjectSourceSearchController(service(vi.fn(() => old.promise)));
    controller.start("project-a");
    const search = controller.search("");
    controller.start("project-b");
    old.resolve([option("work-a")]);
    await search;

    expect(controller.getSnapshot()).toMatchObject({
      projectId: "project-b",
      results: [],
    });
  });
});
