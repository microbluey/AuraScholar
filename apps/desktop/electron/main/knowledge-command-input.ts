import {
  CONTENT_UNIT_SOURCE_TYPES,
  type ContentUnitSourceType,
} from "@aurascholar/db/repos/knowledge";
import { isRecord, requireRecordId } from "./data-command-runtime";

export const MAX_KNOWLEDGE_SEARCH_LIMIT = 100;
const MAX_KNOWLEDGE_SEARCH_QUERY_LENGTH = 1_024;

export interface ParsedSearchKnowledgeContentInput {
  libraryId: string;
  query: string;
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

function requireOptionalBoolean(value: unknown, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}
