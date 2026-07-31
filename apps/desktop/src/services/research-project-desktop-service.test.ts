import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesktopResearchProjectService } from "./research-project-desktop-service";
import { loadResearchProjectWorkspace } from "./research-projects";

vi.mock("./research-projects", () => ({
  addWorksToResearchProject: vi.fn(),
  createResearchProject: vi.fn(),
  listResearchProjects: vi.fn(),
  loadResearchProjectWorkspace: vi.fn(),
  removeWorksFromResearchProject: vi.fn(),
  renameResearchProject: vi.fn(),
  searchResearchProjectLibraryWorks: vi.fn(),
}));

const project = {
  canvasCount: 0,
  createdAt: 1,
  deletedAt: null,
  description: "Evidence scope",
  id: "project-1",
  libraryId: "library-1",
  name: "Project",
  sourceCount: 201,
  status: "active" as const,
  updatedAt: 2,
};

describe("desktop Research Project service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps every source returned by the paged command gateway", async () => {
    const sources = Array.from({ length: 201 }, (_, index) => ({
      annotationCount: index,
      authorNames: [`Author ${index + 1}`],
      doi: null,
      id: `work-${index + 1}`,
      inProject: true,
      pdfCount: index % 2,
      readingStatus: "unread" as const,
      starred: false,
      tagNames: [],
      title: `Work ${index + 1}`,
      updatedAt: index + 1,
      venueName: null,
      year: 2026,
    }));
    vi.mocked(loadResearchProjectWorkspace).mockResolvedValue({
      project,
      projects: [project],
      sources,
      totalSources: 201,
    });

    const workspace = await createDesktopResearchProjectService().loadWorkspace("project-1");

    expect(workspace.project).toMatchObject({ id: "project-1", sourceCount: 201 });
    expect(workspace.sources).toHaveLength(201);
    expect(workspace.sources.at(-1)).toMatchObject({
      title: "Work 201",
      workId: "work-201",
    });
  });
});
