import { PREVIEW_LIBRARY_WORK_SEEDS } from "./preview-library";
import type {
  ProjectLibraryWorkOption,
  ResearchProjectSource,
  ResearchProjectSummary,
} from "../features/projects/model";
import type {
  ResearchProjectService,
  ResearchProjectServiceOptions,
} from "./research-project-service";

interface PreviewProject extends ResearchProjectSummary {
  memberIds: Set<string>;
}

const PREVIEW_NOW = Date.UTC(2026, 6, 1, 10, 0, 0);
let previewSequence = 0;
const projects: PreviewProject[] = [
  previewProject(
    "project:preview-foundation-models",
    "基础模型阅读地图",
    "围绕架构、规模规律与视觉基础模型组织核心来源。",
    ["preview-attention", "preview-scaling-laws", "preview-sam"],
    PREVIEW_NOW - 1000 * 60 * 32,
  ),
  previewProject(
    "project:preview-scientific-ai",
    "AI for Science",
    "追踪机器学习如何改变结构生物学与科学发现。",
    ["preview-alphafold"],
    PREVIEW_NOW - 1000 * 60 * 90,
  ),
];

function previewProject(
  id: string,
  name: string,
  description: string,
  memberIds: string[],
  updatedAt: number,
): PreviewProject {
  return {
    createdAt: updatedAt - 1000 * 60 * 60 * 24,
    description,
    id,
    memberIds: new Set(memberIds),
    name,
    sourceCount: memberIds.length,
    status: "active",
    updatedAt,
  };
}

function findProject(projectId: string): PreviewProject {
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project || project.status !== "active") throw new Error("研究项目不存在或已归档");
  return project;
}

function publicProject(project: PreviewProject): ResearchProjectSummary {
  return {
    createdAt: project.createdAt,
    description: project.description,
    id: project.id,
    name: project.name,
    sourceCount: project.memberIds.size,
    status: project.status,
    updatedAt: project.updatedAt,
  };
}

function sourceFor(workId: string): ResearchProjectSource | null {
  const index = PREVIEW_LIBRARY_WORK_SEEDS.findIndex((work) => work.id === workId);
  const work = PREVIEW_LIBRARY_WORK_SEEDS[index];
  if (!work) return null;
  return {
    annotationCount: index % 2 === 0 ? index + 1 : 0,
    authorNames: [...work.authors],
    pdfCount: index === 2 ? 0 : 1,
    readingStatus: work.readingStatus,
    title: work.title,
    venue: work.venue,
    workId: work.id,
    year: work.year,
  };
}

function touch(project: PreviewProject): void {
  project.sourceCount = project.memberIds.size;
  project.updatedAt = Math.max(Date.now(), project.updatedAt + 1);
}

async function checkpoint(options?: ResearchProjectServiceOptions): Promise<void> {
  options?.signal?.throwIfAborted();
  await Promise.resolve();
  options?.signal?.throwIfAborted();
}

function nextPreviewProjectId(): string {
  previewSequence += 1;
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${previewSequence}`;
  return `project:preview-${random}`;
}

export const previewResearchProjectService: ResearchProjectService = {
  mode: "preview",
  async addWorks(projectId, workIds, options) {
    await checkpoint(options);
    const project = findProject(projectId);
    let updated = 0;
    for (const workId of new Set(workIds)) {
      if (!PREVIEW_LIBRARY_WORK_SEEDS.some((work) => work.id === workId)) continue;
      if (project.memberIds.has(workId)) continue;
      project.memberIds.add(workId);
      updated += 1;
    }
    touch(project);
    await checkpoint(options);
    return updated;
  },
  async createProject(name, description, options) {
    await checkpoint(options);
    const now = Date.now();
    const project = previewProject(nextPreviewProjectId(), name, description ?? "", [], now);
    projects.push(project);
    await checkpoint(options);
    return publicProject(project);
  },
  async listProjects(options) {
    await checkpoint(options);
    return projects.map(publicProject);
  },
  async loadWorkspace(projectId, options) {
    await checkpoint(options);
    const project = projects.find((candidate) => candidate.id === projectId) ?? null;
    return {
      project: project ? publicProject(project) : null,
      projects: projects.map(publicProject),
      sources:
        project?.status === "active"
          ? [...project.memberIds]
              .map(sourceFor)
              .filter((source): source is ResearchProjectSource => source !== null)
          : [],
    };
  },
  async removeWorks(projectId, workIds, options) {
    await checkpoint(options);
    const project = findProject(projectId);
    let updated = 0;
    for (const workId of new Set(workIds)) {
      if (!project.memberIds.delete(workId)) continue;
      updated += 1;
    }
    touch(project);
    await checkpoint(options);
    return updated;
  },
  async renameProject(projectId, name, expectedUpdatedAt, options) {
    await checkpoint(options);
    const project = findProject(projectId);
    if (expectedUpdatedAt !== project.updatedAt) {
      throw new Error("研究项目已发生变化，请刷新后重试");
    }
    project.name = name;
    touch(project);
    await checkpoint(options);
    return publicProject(project);
  },
  async searchLibraryWorks(projectId, query, options) {
    await checkpoint(options);
    const project = findProject(projectId);
    const normalized = query.trim().toLocaleLowerCase();
    return PREVIEW_LIBRARY_WORK_SEEDS.filter(
      (work) =>
        !normalized ||
        [
          work.title,
          work.venue,
          work.year.toString(),
          work.doi ?? "",
          work.arxivId ?? "",
          ...work.authors,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalized),
    )
      .map((work) => sourceFor(work.id))
      .filter((source): source is ResearchProjectSource => source !== null)
      .map(
        (source): ProjectLibraryWorkOption => ({
          ...source,
          inProject: project.memberIds.has(source.workId),
        }),
      );
  },
};
