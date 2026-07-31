import type { ProjectTargetOption } from "./project-ingress-gateway";

export interface ProjectIngressRequest {
  sourceLabel?: string;
  workIds: readonly string[];
}

export interface NormalizedProjectIngressRequest {
  sourceLabel?: string;
  workIds: string[];
}

export function normalizeProjectIngressRequest(
  request: ProjectIngressRequest,
): NormalizedProjectIngressRequest {
  if (!Array.isArray(request.workIds) || request.workIds.length === 0) {
    throw new Error("请至少选择一篇文献。");
  }
  const workIds: string[] = [];
  const seen = new Set<string>();
  for (const value of request.workIds) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("文献标识无效，请刷新后重试。");
    }
    const id = value.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    workIds.push(id);
  }
  const sourceLabel =
    typeof request.sourceLabel === "string" ? request.sourceLabel.trim() || undefined : undefined;
  return { sourceLabel, workIds };
}

export function normalizeProjectTargets(
  projects: readonly ProjectTargetOption[],
): ProjectTargetOption[] {
  const normalized: ProjectTargetOption[] = [];
  const ids = new Set<string>();
  for (const project of projects) {
    const id = typeof project.id === "string" ? project.id.trim() : "";
    const name = typeof project.name === "string" ? project.name.trim() : "";
    if (!id || !name) throw new Error("研究项目列表包含无效条目，请刷新后重试。");
    if (ids.has(id)) throw new Error("研究项目列表包含重复条目，请刷新后重试。");
    ids.add(id);
    normalized.push({
      ...project,
      id,
      name,
      description:
        typeof project.description === "string"
          ? project.description.trim() || null
          : (project.description ?? null),
    });
  }
  return normalized;
}

export function resolveDefaultProjectTargetId(
  projects: readonly ProjectTargetOption[],
  activeProjectId?: string | null,
  recentProjectId?: string | null,
): string {
  const has = (id?: string | null) => Boolean(id && projects.some((project) => project.id === id));
  if (has(activeProjectId)) return activeProjectId!;
  if (has(recentProjectId)) return recentProjectId!;
  return projects[0]?.id ?? "";
}

export function normalizeNewProjectName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("请输入研究项目名称。");
  if (name.length > 80) throw new Error("研究项目名称不能超过 80 个字符。");
  return name;
}

export function projectIngressDescription(
  sourceLabel: string | undefined,
  workCount: number,
): string {
  if (sourceLabel && workCount === 1) return `将「${sourceLabel}」加入所选研究项目。`;
  return `将所选 ${workCount} 篇文献加入研究项目。`;
}
