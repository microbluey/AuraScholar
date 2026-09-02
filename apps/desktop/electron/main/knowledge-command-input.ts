import {
  CONTENT_UNIT_SOURCE_TYPES,
  type ContentUnitSourceType,
} from "@aurascholar/db/repos/knowledge";
import type { KnowledgeCorpusScope } from "../knowledge-command-contract";
import { isRecord, requireRecordId } from "./data-command-runtime";

export const MAX_KNOWLEDGE_SEARCH_LIMIT = 100;
export const MAX_KNOWLEDGE_SCOPE_WORKS = 500;
const MAX_KNOWLEDGE_SEARCH_QUERY_LENGTH = 1_024;

export interface ParsedSearchKnowledgeContentInput {
  libraryId: string;
  query: string;
  scope: KnowledgeCorpusScope;
  limit: number;
  sourceTypes: ContentUnitSourceType[] | undefined;
  sourceId: string | undefined;
  workId: string | undefined;
  assetId: string | undefined;
  revisionId: string | undefined;
  includeContextOnly: boolean;
}

export interface ParsedKnowledgeContentStatsInput {
  libraryId: string;
}

export function parseContentStatsInput(value: unknown): ParsedKnowledgeContentStatsInput {
  if (!isRecord(value)) throw new Error("Invalid knowledge.getContentStats input");
  return { libraryId: requireRecordId(value.libraryId, "Library id") };
}

export function parseLibraryInput(
  value: unknown,
  commandName: string,
): ParsedKnowledgeContentStatsInput {
  if (!isRecord(value)) throw new Error(`Invalid ${commandName} input`);
  return { libraryId: requireRecordId(value.libraryId, "Library id") };
}

export function parseSearchContentInput(value: unknown): ParsedSearchKnowledgeContentInput {
  if (!isRecord(value)) throw new Error("Invalid knowledge.searchContent input");
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    query: requireSearchQuery(value.query),
    scope: requireKnowledgeCorpusScope(value.scope),
    limit: requireOptionalInteger(
      value.limit,
      "Knowledge search limit",
      1,
      MAX_KNOWLEDGE_SEARCH_LIMIT,
      20,
    ),
    sourceTypes: requireSourceTypes(value.sourceTypes),
    sourceId: requireOptionalRecordId(value.sourceId, "ContentUnit source id"),
    workId: requireOptionalRecordId(value.workId, "Work id"),
    assetId: requireOptionalRecordId(value.assetId, "Document asset id"),
    revisionId: requireOptionalRecordId(value.revisionId, "Document revision id"),
    includeContextOnly: requireOptionalBoolean(value.includeContextOnly, "includeContextOnly"),
  };
}

function requireKnowledgeCorpusScope(value: unknown): KnowledgeCorpusScope {
  if (value === undefined) return { kind: "library" };
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("Knowledge corpus scope is invalid");
  }
  switch (value.kind) {
    case "library":
      assertExactKeys(value, ["kind"]);
      return { kind: "library" };
    case "project":
      assertExactKeys(value, ["kind", "projectId"]);
      return {
        kind: "project",
        projectId: requireKnowledgeScopeId(value.projectId, "Research project id"),
      };
    case "asset":
      assertExactKeys(value, ["kind", "assetId"]);
      return {
        kind: "asset",
        assetId: requireKnowledgeScopeId(value.assetId, "Document asset id"),
      };
    case "works": {
      assertExactKeys(value, ["kind", "workIds"]);
      if (!Array.isArray(value.workIds) || value.workIds.length > MAX_KNOWLEDGE_SCOPE_WORKS) {
        throw new Error(
          `Knowledge corpus Work scope is limited to ${MAX_KNOWLEDGE_SCOPE_WORKS} ids`,
        );
      }
      const workIds = value.workIds.map((workId, index) =>
        requireKnowledgeScopeId(workId, `Knowledge corpus Work id at index ${index}`),
      );
      if (new Set(workIds).size !== workIds.length) {
        throw new Error("Knowledge corpus Work scope ids must be unique");
      }
      return { kind: "works", workIds };
    }
    default:
      throw new Error(`Unsupported Knowledge corpus scope: ${value.kind}`);
  }
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw new Error("Knowledge corpus scope contains unsupported fields");
  }
}

function requireSearchQuery(value: unknown): string {
  if (typeof value !== "string") throw new Error("Knowledge search query must be a string");
  const query = value.trim();
  if (query.length > MAX_KNOWLEDGE_SEARCH_QUERY_LENGTH) {
    throw new Error(
      `Knowledge search query is limited to ${MAX_KNOWLEDGE_SEARCH_QUERY_LENGTH} characters`,
    );
  }
  return query;
}

function requireOptionalInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value)) throw new Error(`${label} is invalid`);
  const integer = value as number;
  if (integer < minimum || integer > maximum) throw new Error(`${label} is invalid`);
  return integer;
}

function requireSourceTypes(value: unknown): ContentUnitSourceType[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > CONTENT_UNIT_SOURCE_TYPES.length) {
    throw new Error("Knowledge search sourceTypes are invalid");
  }
  if (value.length === 0) return undefined;
  const sourceTypes = value.map((sourceType) => {
    if (!CONTENT_UNIT_SOURCE_TYPES.includes(sourceType as ContentUnitSourceType)) {
      throw new Error(`Unsupported ContentUnit source type: ${String(sourceType)}`);
    }
    return sourceType as ContentUnitSourceType;
  });
  if (new Set(sourceTypes).size !== sourceTypes.length) {
    throw new Error("Knowledge search sourceTypes must be unique");
  }
  return sourceTypes;
}

function requireOptionalRecordId(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requireRecordId(value, label);
}

function requireKnowledgeScopeId(value: unknown, label: string): string {
  const id = requireRecordId(value, label);
  if (containsControlCharacter(id)) throw new Error(`${label} is invalid`);
  return id;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function requireOptionalBoolean(value: unknown, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}
