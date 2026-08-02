import { EvidenceRepo, type EvidenceKind } from "@aurascholar/db/repos/evidence";
import { EvidenceInboxRepo } from "@aurascholar/db/repos/evidence-inbox";
import { ResearchProjectsRepo } from "@aurascholar/db/repos/research-projects";
import type {
  DataCommandOutput,
  DataCommandRequest,
  EvidenceCommandInput,
  EvidenceProjectCommandInput,
  EvidenceTombstoneCommandInput,
  SearchEvidenceCommandInput,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";

export type EvidenceInboxCommandName =
  | "evidence.search"
  | "evidence.addToProject"
  | "evidence.removeFromProject"
  | "evidence.softDelete"
  | "evidence.restore";

type EvidenceInboxCommandRequest = Extract<DataCommandRequest, { name: EvidenceInboxCommandName }>;

export async function executeEvidenceInboxCommand(
  request: EvidenceInboxCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<EvidenceInboxCommandName>> {
  switch (request.name) {
    case "evidence.search": {
      const input = parseSearchInput(request.input);
      if (!dependencies.execute)
        throw new Error("Main-process database query execution is unavailable");
      return dependencies.execute(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        return new EvidenceInboxRepo(database, input.libraryId).search(input);
      });
    }
    case "evidence.addToProject": {
      const input = parseProjectInput(request.input, request.name);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const repository = new EvidenceRepo(database, input.libraryId);
        const evidence = await repository.get(input.evidenceId);
        if (!evidence) throw new Error(`Evidence ${input.evidenceId} is missing or removed`);
        const sourceMembershipAdded =
          (await new ResearchProjectsRepo(database, input.libraryId).addWorks(input.projectId, [
            evidence.workId,
          ])) === 1;
        const projectMembershipAdded = await repository.addToProject(
          input.projectId,
          input.evidenceId,
        );
        return { projectMembershipAdded, sourceMembershipAdded };
      });
    }
    case "evidence.removeFromProject": {
      const input = parseProjectInput(request.input, request.name);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const projectMembershipRemoved = await new EvidenceRepo(
          database,
          input.libraryId,
        ).removeFromProject(input.projectId, input.evidenceId);
        return { projectMembershipRemoved };
      });
    }
    case "evidence.softDelete":
    case "evidence.restore": {
      const input = parseTombstoneInput(request.input, request.name);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const repository = new EvidenceRepo(database, input.libraryId);
        if (request.name === "evidence.softDelete") {
          await repository.softDelete(input.evidenceId, input.expectedUpdatedAt);
        } else {
          await repository.restore(input.evidenceId, input.expectedUpdatedAt);
        }
        const evidence = await repository.get(input.evidenceId, { includeDeleted: true });
        if (!evidence) throw new Error(`Evidence ${input.evidenceId} disappeared after updating`);
        return { evidence };
      });
    }
  }
}

function parseSearchInput(value: unknown): SearchEvidenceCommandInput {
  if (!isRecord(value) || !isRecord(value.scope)) throw new Error("Invalid evidence.search input");
  const kind = value.scope.kind;
  if (kind !== "library" && kind !== "inbox" && kind !== "project") {
    throw new Error("Invalid Evidence search scope");
  }
  const scope: SearchEvidenceCommandInput["scope"] =
    kind === "project"
      ? { kind, projectId: requireRecordId(value.scope.projectId, "Research project id") }
      : { kind };
  const query = value.query === undefined ? undefined : optionalSearchQuery(value.query);
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    scope,
    ...(query ? { query } : {}),
    evidenceKinds: optionalEnumList(value.evidenceKinds, EVIDENCE_KINDS, "Evidence kinds"),
    revisionStatuses: optionalEnumList(
      value.revisionStatuses,
      REVISION_STATUSES,
      "Evidence revision statuses",
    ),
    canonicalStatuses: optionalEnumList(
      value.canonicalStatuses,
      CANONICAL_STATUSES,
      "Evidence canonical statuses",
    ),
    availabilityStatuses: optionalEnumList(
      value.availabilityStatuses,
      AVAILABILITY_STATUSES,
      "Evidence availability statuses",
    ),
    limit: optionalBoundedInteger(value.limit, "Evidence page size", 1, 200),
    offset: optionalBoundedInteger(value.offset, "Evidence page offset", 0, 1_000_000),
  };
}

function parseProjectInput(value: unknown, commandName: string): EvidenceProjectCommandInput {
  const evidence = parseEvidenceInput(value, commandName);
  if (!isRecord(value)) throw new Error(`Invalid ${commandName} input`);
  return { ...evidence, projectId: requireRecordId(value.projectId, "Research project id") };
}

function parseTombstoneInput(value: unknown, commandName: string): EvidenceTombstoneCommandInput {
  const evidence = parseEvidenceInput(value, commandName);
  if (!isRecord(value)) throw new Error(`Invalid ${commandName} input`);
  return {
    ...evidence,
    expectedUpdatedAt: requireInteger(value.expectedUpdatedAt, "Evidence version", 0),
  };
}

function parseEvidenceInput(value: unknown, commandName: string): EvidenceCommandInput {
  if (!isRecord(value)) throw new Error(`Invalid ${commandName} input`);
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    evidenceId: requireRecordId(value.evidenceId, "Evidence id"),
  };
}

function optionalSearchQuery(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 1_024) {
    throw new Error("Evidence search query must not exceed 1024 characters");
  }
  return value.trim() || undefined;
}

function optionalEnumList<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string,
): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > allowed.size) throw new Error(`${label} are invalid`);
  const unique = Array.from(new Set(value));
  if (unique.some((item) => typeof item !== "string" || !allowed.has(item as T))) {
    throw new Error(`${label} are invalid`);
  }
  return unique as T[];
}

function optionalBoundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  return value === undefined ? undefined : requireInteger(value, label, minimum, maximum);
}

function requireInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

const EVIDENCE_KINDS = new Set<EvidenceKind>([
  "method",
  "data",
  "limitation",
  "definition",
  "context",
]);
const REVISION_STATUSES = new Set(["current", "historical"] as const);
const CANONICAL_STATUSES = new Set([
  "active",
  "work-removed",
  "asset-removed",
  "revision-removed",
] as const);
const AVAILABILITY_STATUSES = new Set([
  "unchecked",
  "available",
  "missing",
  "relink-required",
] as const);
