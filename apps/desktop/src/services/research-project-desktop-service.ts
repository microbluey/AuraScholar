import type {
  ProjectLibraryWorkOption,
  ResearchProjectSource,
  ResearchProjectSummary,
} from "../features/projects/model";
import type { ResearchProjectService } from "./research-project-service";
import {
  addWorksToResearchProject,
  createResearchProject,
  listResearchProjects,
  loadResearchProjectWorkspace,
  removeWorksFromResearchProject,
  renameResearchProject,
  searchResearchProjectLibraryWorks,
  type ResearchProjectWorkSummary,
  type ResearchProjectSummary as GatewayProjectSummary,
} from "./research-projects";

function toProjectSummary(project: GatewayProjectSummary): ResearchProjectSummary {
  return {
    createdAt: project.createdAt,
    description: project.description ?? undefined,
    id: project.id,
    name: project.name,
    sourceCount: project.sourceCount,
    status: project.status,
    updatedAt: project.updatedAt,
  };
}

function toProjectSource(work: ResearchProjectWorkSummary): ResearchProjectSource {
  return {
    annotationCount: work.annotationCount,
    authorNames: [...work.authorNames],
    pdfCount: work.pdfCount,
    readingStatus: work.readingStatus,
    title: work.title,
    venue: work.venueName,
    workId: work.id,
    year: work.year,
  };
}

export function createDesktopResearchProjectService(): ResearchProjectService {
  return {
    mode: "desktop",
    addWorks: addWorksToResearchProject,
    createProject: async (name, description, options) =>
      toProjectSummary(await createResearchProject(name, description, options)),
    listProjects: async (options) => (await listResearchProjects(options)).map(toProjectSummary),
    async loadWorkspace(projectId, options) {
      const workspace = await loadResearchProjectWorkspace(projectId, options);
      return {
        project: workspace.project ? toProjectSummary(workspace.project) : null,
        projects: workspace.projects.map(toProjectSummary),
        sources: workspace.sources.map(toProjectSource),
      };
    },
    removeWorks: removeWorksFromResearchProject,
    async renameProject(projectId, name, expectedUpdatedAt, options) {
      return toProjectSummary(
        await renameResearchProject(projectId, name, expectedUpdatedAt, options),
      );
    },
    async searchLibraryWorks(projectId, query, options) {
      return (await searchResearchProjectLibraryWorks(projectId, query, 100, options)).map(
        (work): ProjectLibraryWorkOption => ({
          ...toProjectSource(work),
          inProject: work.inProject,
        }),
      );
    },
  };
}
