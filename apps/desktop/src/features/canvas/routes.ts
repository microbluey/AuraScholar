export function canvasWorkspacePath(workspaceId: string): string {
  return `/canvas/${encodeURIComponent(workspaceId)}`;
}

export function canvasWorkspaceRedirectPath(workspaceId: string, search: string): string {
  const normalizedSearch = search.trim();
  if (!normalizedSearch) return canvasWorkspacePath(workspaceId);
  return `${canvasWorkspacePath(workspaceId)}${normalizedSearch.startsWith("?") ? normalizedSearch : `?${normalizedSearch}`}`;
}

export function canvasWorkspaceIngressPath(
  workspaceId: string,
  params: { annotationId?: string; workId?: string },
): string {
  const search = new URLSearchParams();
  if (params.workId) search.set("workId", params.workId);
  if (params.annotationId) search.set("annotationId", params.annotationId);
  const query = search.toString();
  return `${canvasWorkspacePath(workspaceId)}${query ? `?${query}` : ""}`;
}
