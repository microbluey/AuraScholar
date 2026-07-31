import type { ResearchProjectSummary } from "./model";
import { resolveResearchProjectIndexTarget } from "./model";

export const LAST_RESEARCH_PROJECT_ID_KEY = "aurascholar:research-project:last-active:v1";

export function researchProjectPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function resolveResearchProjectIndexPath(
  projects: readonly ResearchProjectSummary[],
  rememberedProjectId: string | null,
): string | null {
  const target = resolveResearchProjectIndexTarget(projects, rememberedProjectId);
  return target ? researchProjectPath(target.id) : null;
}

export function readLastResearchProjectId(): string | null {
  try {
    return window.localStorage.getItem(LAST_RESEARCH_PROJECT_ID_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function rememberLastResearchProjectId(projectId: string): void {
  const normalized = projectId.trim();
  if (!normalized) return;
  try {
    window.localStorage.setItem(LAST_RESEARCH_PROJECT_ID_KEY, normalized);
  } catch {
    // The RESTful route remains authoritative when storage is unavailable.
  }
}
