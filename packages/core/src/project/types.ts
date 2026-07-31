export const RESEARCH_PROJECT_STATUSES = ["active", "archived"] as const;
export type ResearchProjectStatus = (typeof RESEARCH_PROJECT_STATUSES)[number];

export interface ResearchProject {
  id: string;
  libraryId: string;
  name: string;
  description?: string;
  status: ResearchProjectStatus;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface ProjectWorkMembership {
  id: string;
  projectId: string;
  workId: string;
  role: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export function isActiveResearchProject(
  project: Pick<ResearchProject, "deletedAt" | "status">,
): boolean {
  return project.status === "active" && project.deletedAt === undefined;
}
