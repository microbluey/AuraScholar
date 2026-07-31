import type { ResearchProjectStatus } from "@aurascholar/core";

export interface ResearchProjectSummary {
  createdAt: number;
  description?: string;
  id: string;
  name: string;
  sourceCount: number;
  status: ResearchProjectStatus;
  updatedAt: number;
}

export interface ResearchProjectSource {
  annotationCount: number;
  authorNames: string[];
  pdfCount: number;
  readingStatus: string;
  title: string;
  venue: string | null;
  workId: string;
  year: number | null;
}

export interface ProjectLibraryWorkOption extends ResearchProjectSource {
  inProject: boolean;
}

export interface ResearchProjectWorkspaceData {
  project: ResearchProjectSummary | null;
  projects: ResearchProjectSummary[];
  sources: ResearchProjectSource[];
}

export type ResearchProjectBusyAction = "add-sources" | "create" | "remove-source" | "rename";

export interface ResearchProjectControllerSnapshot extends ResearchProjectWorkspaceData {
  busyAction: ResearchProjectBusyAction | null;
  error: string | null;
  loading: boolean;
  message: string | null;
  requestedProjectId: string | null;
}

export interface ProjectSourceSearchSnapshot {
  error: string | null;
  loading: boolean;
  projectId: string;
  query: string;
  results: ProjectLibraryWorkOption[];
  selectedIds: ReadonlySet<string>;
}

export interface ResearchProjectOperationResult {
  status: "completed" | "failed" | "stale";
  error?: Error;
  project?: ResearchProjectSummary;
}

export function normalizeResearchProjectName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function activeResearchProjects(
  projects: readonly ResearchProjectSummary[],
): ResearchProjectSummary[] {
  return projects.filter((project) => project.status === "active");
}

export function resolveResearchProjectIndexTarget(
  projects: readonly ResearchProjectSummary[],
  rememberedProjectId: string | null,
): ResearchProjectSummary | null {
  const active = activeResearchProjects(projects);
  return active.find((project) => project.id === rememberedProjectId) ?? active[0] ?? null;
}

export function reconcileProjectSourceSelection(
  selectedIds: ReadonlySet<string>,
  results: readonly ProjectLibraryWorkOption[],
): Set<string> {
  const unavailable = new Set(
    results.filter((result) => result.inProject).map((result) => result.workId),
  );
  return new Set([...selectedIds].filter((workId) => !unavailable.has(workId)));
}

export function toggleProjectSourceSelection(
  selectedIds: ReadonlySet<string>,
  workId: string,
  selected: boolean,
): Set<string> {
  const next = new Set(selectedIds);
  if (selected) next.add(workId);
  else next.delete(workId);
  return next;
}

export function describeProjectError(error: unknown): string {
  return error instanceof Error ? error.message : "研究项目操作失败，请重试";
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}
