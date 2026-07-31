import { describe, expect, it, vi } from "vitest";
import type { ResearchProjectService } from "../../services/research-project-service";
import type {
  ProjectLibraryWorkOption,
  ResearchProjectSource,
  ResearchProjectSummary,
  ResearchProjectWorkspaceData,
} from "./model";
import { ResearchProjectController } from "./research-project-controller";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function project(id: string, name = id): ResearchProjectSummary {
  return {
    createdAt: 1,
    id,
    name,
    sourceCount: 0,
    status: "active",
    updatedAt: 1,
  };
}

function workspace(id: string, name = id): ResearchProjectWorkspaceData {
  const current = project(id, name);
  return { project: current, projects: [current], sources: [] };
}

function service(overrides: Partial<ResearchProjectService> = {}): ResearchProjectService {
  return {
    addWorks: vi.fn(async () => 0),
    createProject: vi.fn(async (name) => project(`created:${name}`, name)),
    listProjects: vi.fn(async () => []),
    loadWorkspace: vi.fn(async (projectId) => workspace(projectId)),
    removeWorks: vi.fn(async () => 0),
    renameProject: vi.fn(async (projectId, name) => project(projectId, name)),
    searchLibraryWorks: vi.fn(async () => [] as ProjectLibraryWorkOption[]),
    ...overrides,
  };
}

describe("ResearchProjectController", () => {
  it("aborts the previous route load and rejects its late completion", async () => {
    const loadA = deferred<ResearchProjectWorkspaceData>();
    const loadB = deferred<ResearchProjectWorkspaceData>();
    const signals: AbortSignal[] = [];
    const port = service({
      loadWorkspace: vi.fn((projectId, options) => {
        if (options?.signal) signals.push(options.signal);
        return projectId === "project-a" ? loadA.promise : loadB.promise;
      }),
    });
    const controller = new ResearchProjectController(port);
    controller.start();

    const first = controller.loadProject("project-a");
    const second = controller.loadProject("project-b");
    expect(signals[0]?.aborted).toBe(true);

    loadB.resolve(workspace("project-b", "B"));
    await second;
    loadA.resolve(workspace("project-a", "A"));
    await first;

    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      project: { id: "project-b", name: "B" },
      requestedProjectId: "project-b",
    });
  });

  it("does not project a late rename onto the newly active project", async () => {
    const renameA = deferred<ResearchProjectSummary>();
    const renameProject = vi.fn(() => renameA.promise);
    const port = service({
      renameProject,
    });
    const controller = new ResearchProjectController(port);
    controller.start();
    await controller.loadProject("project-a");

    const rename = controller.renameProject("A renamed");
    expect(renameProject).toHaveBeenCalledWith(
      "project-a",
      "A renamed",
      1,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await controller.loadProject("project-b");
    renameA.resolve(project("project-a", "A renamed"));

    expect(await rename).toMatchObject({ status: "stale" });
    expect(controller.getSnapshot()).toMatchObject({
      busyAction: null,
      project: { id: "project-b", name: "project-b" },
      requestedProjectId: "project-b",
    });
  });

  it("refreshes source membership only inside the mutation project", async () => {
    const source: ResearchProjectSource = {
      annotationCount: 0,
      authorNames: ["Ada"],
      pdfCount: 1,
      readingStatus: "reading",
      title: "Evidence",
      venue: "Aura",
      workId: "work-a",
      year: 2026,
    };
    let member = false;
    const port = service({
      addWorks: vi.fn(async () => {
        member = true;
        return 1;
      }),
      loadWorkspace: vi.fn(async (projectId) => ({
        ...workspace(projectId),
        sources: projectId === "project-a" && member ? [source] : [],
      })),
    });
    const controller = new ResearchProjectController(port);
    controller.start();
    await controller.loadProject("project-a");

    expect(await controller.addWorks(["work-a", "work-a"])).toMatchObject({
      status: "completed",
    });
    expect(port.addWorks).toHaveBeenCalledWith(
      "project-a",
      ["work-a"],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(controller.getSnapshot().sources).toEqual([source]);
  });

  it("stops without allowing an ignored request to publish", async () => {
    const pending = deferred<ResearchProjectWorkspaceData>();
    const controller = new ResearchProjectController(
      service({ loadWorkspace: vi.fn(() => pending.promise) }),
    );
    controller.start();
    const load = controller.loadProject("project-a");
    controller.stop();
    pending.resolve(workspace("project-a"));

    expect(await load).toMatchObject({ status: "stale" });
    expect(controller.getSnapshot().project).toBeNull();
  });
});
