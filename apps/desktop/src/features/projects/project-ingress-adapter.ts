import {
  researchProjectService,
  type ResearchProjectService,
} from "../../services/research-project-service";
import { readLastResearchProjectId, rememberLastResearchProjectId } from "./routes";
import type { ProjectIngressGateway, ProjectTargetOption } from "./project-ingress-gateway";

function toTarget(
  project: Awaited<ReturnType<ResearchProjectService["createProject"]>>,
): ProjectTargetOption {
  return {
    description: project.description ?? null,
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
  };
}

/**
 * Adapts the Project feature service to the narrower Library-ingress port.
 * The service owns Electron/browser transport; this adapter keeps the picker
 * independent from preload APIs and persistence details.
 */
export function createProjectIngressGateway(
  service: ResearchProjectService = researchProjectService,
): ProjectIngressGateway {
  return {
    async addWorks(input, { signal }) {
      signal.throwIfAborted();
      const updated = await service.addWorks(input.projectId, input.workIds, { signal });
      signal.throwIfAborted();
      return { updated };
    },
    async createProject(input, { signal }) {
      signal.throwIfAborted();
      const project = await service.createProject(input.name, undefined, { signal });
      signal.throwIfAborted();
      return toTarget(project);
    },
    async listActiveProjects({ signal }) {
      signal.throwIfAborted();
      const projects = await service.listProjects({ signal });
      signal.throwIfAborted();
      return projects.filter((project) => project.status === "active").map(toTarget);
    },
    readRecentProjectId: readLastResearchProjectId,
    rememberRecentProjectId: rememberLastResearchProjectId,
  };
}

export const projectIngressGateway = createProjectIngressGateway();
