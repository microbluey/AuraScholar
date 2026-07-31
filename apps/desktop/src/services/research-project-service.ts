import type {
  ProjectLibraryWorkOption,
  ResearchProjectSummary,
  ResearchProjectWorkspaceData,
} from "../features/projects/model";
import { createDesktopResearchProjectService } from "./research-project-desktop-service";
import { previewResearchProjectService } from "./research-project-preview-service";
import { isDesktopRuntime } from "./aura-platform";

export interface ResearchProjectServiceOptions {
  signal?: AbortSignal;
}

export interface ResearchProjectService {
  readonly mode?: "desktop" | "preview";
  addWorks(
    projectId: string,
    workIds: readonly string[],
    options?: ResearchProjectServiceOptions,
  ): Promise<number>;
  createProject(
    name: string,
    description?: string,
    options?: ResearchProjectServiceOptions,
  ): Promise<ResearchProjectSummary>;
  listProjects(options?: ResearchProjectServiceOptions): Promise<ResearchProjectSummary[]>;
  loadWorkspace(
    projectId: string,
    options?: ResearchProjectServiceOptions,
  ): Promise<ResearchProjectWorkspaceData>;
  removeWorks(
    projectId: string,
    workIds: readonly string[],
    options?: ResearchProjectServiceOptions,
  ): Promise<number>;
  renameProject(
    projectId: string,
    name: string,
    expectedUpdatedAt: number,
    options?: ResearchProjectServiceOptions,
  ): Promise<ResearchProjectSummary>;
  searchLibraryWorks(
    projectId: string,
    query: string,
    options?: ResearchProjectServiceOptions,
  ): Promise<ProjectLibraryWorkOption[]>;
}

/**
 * Desktop builds cross the typed project.* command boundary. Browser builds
 * use a session-local preview store so product flows remain fully testable
 * without implying that preview changes were persisted to the real library.
 */
export const researchProjectService: ResearchProjectService =
  typeof window !== "undefined" && isDesktopRuntime()
    ? createDesktopResearchProjectService()
    : previewResearchProjectService;
