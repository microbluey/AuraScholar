export const DEFAULT_RESEARCH_PROJECT_ID = "project:default";
export const DEFAULT_RESEARCH_PROJECT_NAME = "研究空间";

export function scopedDefaultResearchProjectId(libraryId: string): string {
  if (!libraryId.trim()) throw new Error("libraryId must be a non-empty string");
  return `${DEFAULT_RESEARCH_PROJECT_ID}:${libraryId}`;
}
