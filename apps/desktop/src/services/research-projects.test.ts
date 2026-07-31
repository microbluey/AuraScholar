import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addWorksToResearchProject,
  createResearchProject,
  getActiveResearchProjectLibraryId,
  listResearchProjects,
  loadResearchProjectWorkspace,
  removeWorksFromResearchProject,
  renameResearchProject,
  searchResearchProjectLibraryWorks,
} from "./research-projects";

const project = {
  canvasCount: 1,
  createdAt: 1,
  deletedAt: null,
  description: null,
  id: "project-1",
  libraryId: "library-1",
  name: "Project",
  sourceCount: 1,
  status: "active" as const,
  updatedAt: 2,
};

const source = {
  annotationCount: 2,
  authorNames: ["Ada"],
  doi: null,
  id: "work-1",
  inProject: true,
  pdfCount: 1,
  readingStatus: "reading" as const,
  starred: false,
  tagNames: ["Evidence"],
  title: "Grounded Work",
  updatedAt: 3,
  venueName: "Aura",
  year: 2026,
};

describe("Research Project desktop command gateway", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
  });

  it("discovers scope without renderer DB access and forwards mutation revisions", async () => {
    command
      .mockResolvedValueOnce({ libraryId: "library-1" })
      .mockResolvedValueOnce({ project })
      .mockResolvedValueOnce({ libraryId: "library-1" })
      .mockResolvedValueOnce({ project: { ...project, name: "Renamed", updatedAt: 3 } })
      .mockResolvedValueOnce({ libraryId: "library-1" })
      .mockResolvedValueOnce({ updated: 2 })
      .mockResolvedValueOnce({ libraryId: "library-1" })
      .mockResolvedValueOnce({ updated: 1 });

    await expect(createResearchProject("Project", null)).resolves.toEqual(project);
    await expect(renameResearchProject("project-1", "Renamed", 2)).resolves.toMatchObject({
      name: "Renamed",
      updatedAt: 3,
    });
    await expect(addWorksToResearchProject("project-1", ["work-1", "work-2"])).resolves.toBe(2);
    await expect(removeWorksFromResearchProject("project-1", ["work-2"])).resolves.toBe(1);

    expect(command.mock.calls).toEqual([
      ["project.getScope", {}],
      ["project.create", { description: null, libraryId: "library-1", name: "Project" }],
      ["project.getScope", {}],
      [
        "project.rename",
        {
          expectedUpdatedAt: 2,
          libraryId: "library-1",
          name: "Renamed",
          projectId: "project-1",
        },
      ],
      ["project.getScope", {}],
      [
        "project.addWorks",
        {
          libraryId: "library-1",
          projectId: "project-1",
          workIds: ["work-1", "work-2"],
        },
      ],
      ["project.getScope", {}],
      [
        "project.removeWorks",
        { libraryId: "library-1", projectId: "project-1", workIds: ["work-2"] },
      ],
    ]);
  });

  it("loads and searches through typed queries only", async () => {
    command
      .mockResolvedValueOnce({ libraryId: "library-1" })
      .mockResolvedValueOnce({ project })
      .mockResolvedValueOnce({ projects: [project] })
      .mockResolvedValueOnce({ sources: [source], total: 1 })
      .mockResolvedValueOnce({ libraryId: "library-1" })
      .mockResolvedValueOnce({ projects: [project] })
      .mockResolvedValueOnce({ libraryId: "library-1" })
      .mockResolvedValueOnce({ works: [source] });

    await expect(loadResearchProjectWorkspace("project-1")).resolves.toEqual({
      project,
      projects: [project],
      sources: [source],
      totalSources: 1,
    });
    await expect(listResearchProjects()).resolves.toEqual([project]);
    await expect(searchResearchProjectLibraryWorks("project-1", "Grounded", 25)).resolves.toEqual([
      source,
    ]);

    expect(command.mock.calls).toEqual([
      ["project.getScope", {}],
      ["project.get", { libraryId: "library-1", projectId: "project-1" }],
      ["project.list", { libraryId: "library-1" }],
      [
        "project.listSources",
        { libraryId: "library-1", limit: 200, offset: 0, projectId: "project-1" },
      ],
      ["project.getScope", {}],
      ["project.list", { libraryId: "library-1" }],
      ["project.getScope", {}],
      [
        "project.searchLibraryWorks",
        { libraryId: "library-1", limit: 25, projectId: "project-1", query: "Grounded" },
      ],
    ]);
  });

  it("loads every project source page without duplicating work ids", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      ...source,
      id: `work-${index + 1}`,
      title: `Grounded Work ${index + 1}`,
    }));
    const finalSource = {
      ...source,
      id: "work-201",
      title: "Grounded Work 201",
    };
    command
      .mockResolvedValueOnce({ libraryId: "library-1" })
      .mockResolvedValueOnce({ project: { ...project, sourceCount: 201 } })
      .mockResolvedValueOnce({ projects: [{ ...project, sourceCount: 201 }] })
      .mockResolvedValueOnce({ sources: firstPage, total: 201 })
      .mockResolvedValueOnce({ sources: [finalSource], total: 201 });

    const workspace = await loadResearchProjectWorkspace("project-1");

    expect(workspace.sources).toHaveLength(201);
    expect(workspace.sources.at(-1)).toEqual(finalSource);
    expect(workspace.totalSources).toBe(201);
    expect(command.mock.calls.slice(-2)).toEqual([
      [
        "project.listSources",
        { libraryId: "library-1", limit: 200, offset: 0, projectId: "project-1" },
      ],
      [
        "project.listSources",
        { libraryId: "library-1", limit: 200, offset: 200, projectId: "project-1" },
      ],
    ]);
  });

  it("does not query sources for a missing Project route", async () => {
    command
      .mockResolvedValueOnce({ libraryId: "library-1" })
      .mockResolvedValueOnce({ project: null })
      .mockResolvedValueOnce({ projects: [project] });

    await expect(loadResearchProjectWorkspace("missing-project")).resolves.toEqual({
      project: null,
      projects: [project],
      sources: [],
      totalSources: 0,
    });
    expect(command.mock.calls).toEqual([
      ["project.getScope", {}],
      ["project.get", { libraryId: "library-1", projectId: "missing-project" }],
      ["project.list", { libraryId: "library-1" }],
    ]);
  });

  it("honors cancellation before crossing a durable command boundary", async () => {
    const beforeScope = new AbortController();
    beforeScope.abort();
    await expect(
      getActiveResearchProjectLibraryId({ signal: beforeScope.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(command).not.toHaveBeenCalled();

    const duringScope = new AbortController();
    command.mockImplementationOnce(async () => {
      duringScope.abort();
      return { libraryId: "library-1" };
    });
    await expect(
      createResearchProject("Cancelled", undefined, { signal: duringScope.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(command).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledWith("project.getScope", {});
  });

  it("stops paged source loading immediately after cancellation", async () => {
    const controller = new AbortController();
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      ...source,
      id: `work-${index + 1}`,
    }));
    command
      .mockResolvedValueOnce({ libraryId: "library-1" })
      .mockResolvedValueOnce({ project: { ...project, sourceCount: 201 } })
      .mockResolvedValueOnce({ projects: [{ ...project, sourceCount: 201 }] })
      .mockImplementationOnce(async () => {
        controller.abort();
        return { sources: firstPage, total: 201 };
      });

    await expect(
      loadResearchProjectWorkspace("project-1", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(command).toHaveBeenCalledTimes(4);
  });
});
