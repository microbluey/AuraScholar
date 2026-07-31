import { describe, expect, it, vi } from "vitest";
import type { ResearchProjectService } from "../../services/research-project-service";
import { createProjectIngressGateway } from "./project-ingress-adapter";

function service(overrides: Partial<ResearchProjectService> = {}): ResearchProjectService {
  const createProject: ResearchProjectService["createProject"] = vi.fn(async (name) => ({
    createdAt: 1,
    id: "project-created",
    name,
    sourceCount: 0,
    status: "active" as const,
    updatedAt: 2,
  }));
  const renameProject: ResearchProjectService["renameProject"] = vi.fn(async (_id, name) => ({
    createdAt: 1,
    id: "project-renamed",
    name,
    sourceCount: 0,
    status: "active" as const,
    updatedAt: 2,
  }));
  return {
    addWorks: vi.fn(async () => 0),
    createProject,
    listProjects: vi.fn(async () => []),
    loadWorkspace: vi.fn(async () => ({ project: null, projects: [], sources: [] })),
    removeWorks: vi.fn(async () => 0),
    renameProject,
    searchLibraryWorks: vi.fn(async () => []),
    ...overrides,
  };
}

describe("project ingress adapter", () => {
  it("filters archived projects and forwards the exact durable target", async () => {
    const addWorks = vi.fn(async () => 2);
    const listProjects = vi.fn(async () => [
      {
        createdAt: 1,
        id: "active",
        name: "Active",
        sourceCount: 0,
        status: "active" as const,
        updatedAt: 3,
      },
      {
        createdAt: 1,
        id: "archived",
        name: "Archived",
        sourceCount: 0,
        status: "archived" as const,
        updatedAt: 2,
      },
    ]);
    const gateway = createProjectIngressGateway(service({ addWorks, listProjects }));
    const signal = new AbortController().signal;

    await expect(gateway.listActiveProjects({ signal })).resolves.toEqual([
      { description: null, id: "active", name: "Active", updatedAt: 3 },
    ]);
    await expect(
      gateway.addWorks(
        { projectId: "active", requestId: "request-a", workIds: ["work-a", "work-b"] },
        { signal },
      ),
    ).resolves.toEqual({ updated: 2 });
    expect(addWorks).toHaveBeenCalledWith("active", ["work-a", "work-b"], { signal });
  });

  it("honors cancellation before entering the service", async () => {
    const listProjects = vi.fn(async () => []);
    const gateway = createProjectIngressGateway(service({ listProjects }));
    const controller = new AbortController();
    controller.abort();

    await expect(gateway.listActiveProjects({ signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(listProjects).not.toHaveBeenCalled();
  });
});
