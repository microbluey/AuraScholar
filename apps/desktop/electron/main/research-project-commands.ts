import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import {
  ResearchProjectsRepo,
  type ResearchProjectRow,
} from "@aurascholar/db/repos/research-projects";
import type {
  CreateResearchProjectCommandInput,
  DataCommandOutput,
  DataCommandRequest,
  ListResearchProjectSourcesCommandInput,
  RenameResearchProjectCommandInput,
  ResearchProjectCommandInput,
  ResearchProjectScopeCommandInput,
  ResearchProjectWorksCommandInput,
  SearchResearchProjectLibraryWorksCommandInput,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS,
  requireRecordId,
  requireUniqueRecordIds,
  type DataCommandDependencies,
} from "./data-command-runtime";
import {
  loadWorkSummaries,
  projectSummaries,
  searchLibraryWorkSummaries,
  toProjectSummary,
} from "./research-project-query-data";

const MAX_PROJECT_DESCRIPTION_LENGTH = 16_384;
const MAX_PROJECT_NAME_LENGTH = 256;
const MAX_PROJECT_SOURCE_PAGE_SIZE = 200;
const MAX_PROJECT_WORK_SEARCH_RESULTS = 100;
const MAX_PROJECT_WORK_SEARCH_LENGTH = 512;

type ResearchProjectCommandName =
  | "project.addWorks"
  | "project.create"
  | "project.get"
  | "project.getScope"
  | "project.list"
  | "project.listSources"
  | "project.removeWorks"
  | "project.rename"
  | "project.searchLibraryWorks";

type ResearchProjectQueryCommandName =
  | "project.get"
  | "project.getScope"
  | "project.listSources"
  | "project.searchLibraryWorks";

export type ResearchProjectCommandRequest = Extract<
  DataCommandRequest,
  { name: ResearchProjectCommandName }
>;

export async function executeResearchProjectCommand(
  request: ResearchProjectCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<ResearchProjectCommandName>> {
  switch (request.name) {
    case "project.getScope": {
      parseProjectScopeDiscoveryInput(request.input);
      return executeProjectQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireLocalLibraryId(database);
        await assertActiveLocalLibrary(database, libraryId);
        return { libraryId };
      });
    }
    case "project.list": {
      const input = parseLibraryScope(request.input, request.name);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const repository = new ResearchProjectsRepo(database, input.libraryId);
        await repository.ensureDefault();
        return {
          projects: await projectSummaries(database, input.libraryId, await repository.list()),
        };
      });
    }
    case "project.get": {
      const input = parseProjectScope(request.input, request.name);
      return executeProjectQuery(dependencies, request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const project = await new ResearchProjectsRepo(database, input.libraryId).get(
          input.projectId,
        );
        return {
          project:
            project && project.deleted_at === null
              ? ((await projectSummaries(database, input.libraryId, [project]))[0] ?? null)
              : null,
        };
      });
    }
    case "project.create": {
      const input = parseCreateProjectInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const project = await new ResearchProjectsRepo(database, input.libraryId).create({
          description: input.description,
          name: input.name,
        });
        return {
          project: toProjectSummary(project, { canvasCount: 0, sourceCount: 0 }),
        };
      });
    }
    case "project.rename": {
      const input = parseRenameProjectInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const repository = new ResearchProjectsRepo(database, input.libraryId);
        const current = await requireProject(repository, input.projectId);
        if (current.updated_at !== input.expectedUpdatedAt) {
          throw new Error("Research project changed; reload it before renaming");
        }
        await repository.rename(input.projectId, input.name);
        const renamed = await requireProject(repository, input.projectId);
        return {
          project: (await projectSummaries(database, input.libraryId, [renamed]))[0]!,
        };
      });
    }
    case "project.addWorks": {
      const input = parseProjectWorksInput(request.input, request.name);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const updated = await new ResearchProjectsRepo(database, input.libraryId).addWorks(
          input.projectId,
          input.workIds,
        );
        return { updated };
      });
    }
    case "project.removeWorks": {
      const input = parseProjectWorksInput(request.input, request.name);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const updated = await new ResearchProjectsRepo(database, input.libraryId).removeWorks(
          input.projectId,
          input.workIds,
        );
        return { updated };
      });
    }
    case "project.listSources": {
      const input = parseListSourcesInput(request.input);
      return executeProjectQuery(dependencies, request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const repository = new ResearchProjectsRepo(database, input.libraryId);
        await requireActiveProject(repository, input.projectId);
        const workIds = await repository.listWorkIds(input.projectId);
        const pageIds = workIds.slice(input.offset, input.offset + input.limit);
        return {
          sources: await loadWorkSummaries(database, input.libraryId, pageIds, {
            inProject: true,
          }),
          total: workIds.length,
        };
      });
    }
    case "project.searchLibraryWorks": {
      const input = parseSearchLibraryWorksInput(request.input);
      return executeProjectQuery(dependencies, request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const repository = new ResearchProjectsRepo(database, input.libraryId);
        await requireActiveProject(repository, input.projectId);
        const membership = new Set(await repository.listWorkIds(input.projectId));
        const works = await searchLibraryWorkSummaries(
          database,
          input.libraryId,
          input.query,
          input.limit,
          membership,
        );
        return { works };
      });
    }
  }
}

function executeProjectQuery<K extends ResearchProjectQueryCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

function parseLibraryScope(value: unknown, commandName: "project.list"): { libraryId: string } {
  if (!isRecord(value)) throw new Error(`Invalid ${commandName} input`);
  return { libraryId: requireRecordId(value.libraryId, "Library id") };
}

function parseProjectScopeDiscoveryInput(value: unknown): ResearchProjectScopeCommandInput {
  if (!isRecord(value) || Object.keys(value).length > 0) {
    throw new Error("Invalid project.getScope input");
  }
  return value as ResearchProjectScopeCommandInput;
}

function parseProjectScope(value: unknown, commandName: string): ResearchProjectCommandInput {
  if (!isRecord(value)) throw new Error(`Invalid ${commandName} input`);
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    projectId: requireRecordId(value.projectId, "Research project id"),
  };
}

function parseCreateProjectInput(value: unknown): CreateResearchProjectCommandInput {
  if (!isRecord(value)) throw new Error("Invalid project.create input");
  return {
    description: requireProjectDescription(value.description),
    libraryId: requireRecordId(value.libraryId, "Library id"),
    name: requireProjectName(value.name),
  };
}

function parseRenameProjectInput(value: unknown): RenameResearchProjectCommandInput {
  const input = parseProjectScope(value, "project.rename");
  const record = value as Record<string, unknown>;
  return {
    ...input,
    expectedUpdatedAt: requireRevision(record.expectedUpdatedAt),
    name: requireProjectName(record.name),
  };
}

function parseProjectWorksInput(
  value: unknown,
  commandName: "project.addWorks" | "project.removeWorks",
): ResearchProjectWorksCommandInput {
  const input = parseProjectScope(value, commandName);
  return {
    ...input,
    workIds: requireUniqueRecordIds((value as Record<string, unknown>).workIds, "Work id", {
      max: MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS,
    }),
  };
}

function parseListSourcesInput(value: unknown): Required<ListResearchProjectSourcesCommandInput> {
  const input = parseProjectScope(value, "project.listSources");
  const record = value as Record<string, unknown>;
  return {
    ...input,
    limit: requireOptionalInteger(
      record.limit,
      "Project source page size",
      1,
      MAX_PROJECT_SOURCE_PAGE_SIZE,
      100,
    ),
    offset: requireOptionalInteger(
      record.offset,
      "Project source page offset",
      0,
      Number.MAX_SAFE_INTEGER,
      0,
    ),
  };
}

function parseSearchLibraryWorksInput(
  value: unknown,
): Required<SearchResearchProjectLibraryWorksCommandInput> {
  const input = parseProjectScope(value, "project.searchLibraryWorks");
  const record = value as Record<string, unknown>;
  return {
    ...input,
    limit: requireOptionalInteger(
      record.limit,
      "Project Library search limit",
      1,
      MAX_PROJECT_WORK_SEARCH_RESULTS,
      40,
    ),
    query: requireBoundedText(
      record.query,
      "Project Library search query",
      MAX_PROJECT_WORK_SEARCH_LENGTH,
      { allowEmpty: true },
    ),
  };
}

function requireProjectName(value: unknown): string {
  return requireBoundedText(value, "Research project name", MAX_PROJECT_NAME_LENGTH);
}

function requireProjectDescription(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return (
    requireBoundedText(value, "Research project description", MAX_PROJECT_DESCRIPTION_LENGTH, {
      allowEmpty: true,
    }) || null
  );
}

function requireBoundedText(
  value: unknown,
  label: string,
  maxLength: number,
  options: { allowEmpty?: boolean } = {},
): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const text = value.trim();
  if (!options.allowEmpty && !text) throw new Error(`${label} is required`);
  if (text.length > maxLength) throw new Error(`${label} is too long`);
  return text;
}

function requireRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Expected research project revision is invalid");
  }
  return value as number;
}

function requireOptionalInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

async function requireProject(
  repository: ResearchProjectsRepo,
  projectId: string,
): Promise<ResearchProjectRow> {
  const project = await repository.get(projectId);
  if (!project || project.deleted_at !== null) {
    throw new Error("Research project does not exist in the target Library");
  }
  return project;
}

async function requireActiveProject(
  repository: ResearchProjectsRepo,
  projectId: string,
): Promise<ResearchProjectRow> {
  const project = await requireProject(repository, projectId);
  if (project.status !== "active") throw new Error("Research project is archived");
  return project;
}
