import type {
  ResearchProjectSummary,
  ResearchProjectWorkSummary,
} from "../../electron/data-command-contract";

export type { ResearchProjectSummary, ResearchProjectWorkSummary };

export interface ResearchProjectRequestOptions {
  signal?: AbortSignal;
}

export interface ResearchProjectWorkspaceResult {
  project: ResearchProjectSummary | null;
  projects: ResearchProjectSummary[];
  sources: ResearchProjectWorkSummary[];
  totalSources: number;
}

const PROJECT_SOURCE_PAGE_SIZE = 200;

export async function getActiveResearchProjectLibraryId(
  options: ResearchProjectRequestOptions = {},
): Promise<string> {
  throwIfAborted(options.signal);
  const result = await window.aura.data.command("project.getScope", {});
  throwIfAborted(options.signal);
  return result.libraryId;
}

export async function listResearchProjects(
  options: ResearchProjectRequestOptions = {},
): Promise<ResearchProjectSummary[]> {
  const libraryId = await getActiveResearchProjectLibraryId(options);
  const result = await window.aura.data.command("project.list", { libraryId });
  throwIfAborted(options.signal);
  return result.projects;
}

export async function getResearchProject(
  projectId: string,
  options: ResearchProjectRequestOptions = {},
): Promise<ResearchProjectSummary | null> {
  const libraryId = await getActiveResearchProjectLibraryId(options);
  const result = await window.aura.data.command("project.get", { libraryId, projectId });
  throwIfAborted(options.signal);
  return result.project;
}

export async function loadResearchProjectWorkspace(
  projectId: string,
  options: ResearchProjectRequestOptions = {},
): Promise<ResearchProjectWorkspaceResult> {
  const libraryId = await getActiveResearchProjectLibraryId(options);
  const [projectResult, projectsResult] = await Promise.all([
    window.aura.data.command("project.get", { libraryId, projectId }),
    window.aura.data.command("project.list", { libraryId }),
  ]);
  throwIfAborted(options.signal);
  if (!projectResult.project || projectResult.project.status !== "active") {
    return {
      project: projectResult.project,
      projects: projectsResult.projects,
      sources: [],
      totalSources: 0,
    };
  }
  const sourcesResult = await loadAllResearchProjectSources(libraryId, projectId, options);
  return {
    project: projectResult.project,
    projects: projectsResult.projects,
    sources: sourcesResult.sources,
    totalSources: sourcesResult.total,
  };
}

export async function createResearchProject(
  name: string,
  description?: string | null,
  options: ResearchProjectRequestOptions = {},
): Promise<ResearchProjectSummary> {
  const libraryId = await getActiveResearchProjectLibraryId(options);
  throwIfAborted(options.signal);
  const result = await window.aura.data.command("project.create", {
    description,
    libraryId,
    name,
  });
  return result.project;
}

export async function renameResearchProject(
  projectId: string,
  name: string,
  expectedUpdatedAt: number,
  options: ResearchProjectRequestOptions = {},
): Promise<ResearchProjectSummary> {
  const libraryId = await getActiveResearchProjectLibraryId(options);
  throwIfAborted(options.signal);
  const result = await window.aura.data.command("project.rename", {
    expectedUpdatedAt,
    libraryId,
    name,
    projectId,
  });
  return result.project;
}

export async function addWorksToResearchProject(
  projectId: string,
  workIds: readonly string[],
  options: ResearchProjectRequestOptions = {},
): Promise<number> {
  const libraryId = await getActiveResearchProjectLibraryId(options);
  throwIfAborted(options.signal);
  const result = await window.aura.data.command("project.addWorks", {
    libraryId,
    projectId,
    workIds: [...workIds],
  });
  return result.updated;
}

export async function removeWorksFromResearchProject(
  projectId: string,
  workIds: readonly string[],
  options: ResearchProjectRequestOptions = {},
): Promise<number> {
  const libraryId = await getActiveResearchProjectLibraryId(options);
  throwIfAborted(options.signal);
  const result = await window.aura.data.command("project.removeWorks", {
    libraryId,
    projectId,
    workIds: [...workIds],
  });
  return result.updated;
}

export async function listResearchProjectSources(
  projectId: string,
  pagination: { limit?: number; offset?: number } = {},
  options: ResearchProjectRequestOptions = {},
): Promise<{ sources: ResearchProjectWorkSummary[]; total: number }> {
  const libraryId = await getActiveResearchProjectLibraryId(options);
  const result = await window.aura.data.command("project.listSources", {
    ...pagination,
    libraryId,
    projectId,
  });
  throwIfAborted(options.signal);
  return result;
}

export async function searchResearchProjectLibraryWorks(
  projectId: string,
  query: string,
  limit = 40,
  options: ResearchProjectRequestOptions = {},
): Promise<ResearchProjectWorkSummary[]> {
  const libraryId = await getActiveResearchProjectLibraryId(options);
  const result = await window.aura.data.command("project.searchLibraryWorks", {
    libraryId,
    limit,
    projectId,
    query,
  });
  throwIfAborted(options.signal);
  return result.works;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

async function loadAllResearchProjectSources(
  libraryId: string,
  projectId: string,
  options: ResearchProjectRequestOptions,
): Promise<{ sources: ResearchProjectWorkSummary[]; total: number }> {
  const sources: ResearchProjectWorkSummary[] = [];
  const seenWorkIds = new Set<string>();
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    throwIfAborted(options.signal);
    const page = await window.aura.data.command("project.listSources", {
      libraryId,
      limit: PROJECT_SOURCE_PAGE_SIZE,
      offset,
      projectId,
    });
    throwIfAborted(options.signal);
    total = page.total;
    for (const source of page.sources) {
      if (seenWorkIds.has(source.id)) continue;
      seenWorkIds.add(source.id);
      sources.push(source);
    }
    if (page.sources.length === 0) break;
    offset += page.sources.length;
  }

  return { sources, total: Number.isFinite(total) ? total : 0 };
}
