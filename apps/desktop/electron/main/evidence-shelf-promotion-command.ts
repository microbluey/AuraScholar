import { Buffer } from "node:buffer";
import { MAX_EVIDENCE_SHELF_LIST_BYTES } from "@aurascholar/db";
import {
  promoteEvidenceShelfItem,
  type PromoteEvidenceShelfInput,
} from "@aurascholar/db/repos/evidence-shelf-promotion";
import type {
  DataCommandOutput,
  DataCommandRequest,
  PromoteEvidenceShelfCommandInput,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";

export type EvidenceShelfPromotionCommandRequest = Extract<
  DataCommandRequest,
  { name: "evidenceShelf.promote" }
>;

const EVIDENCE_KINDS = new Set<PromoteEvidenceShelfCommandInput["evidenceKind"]>([
  "method",
  "data",
  "limitation",
  "definition",
  "context",
]);

const REQUIRED_FIELDS = [
  "expectedUpdatedAt",
  "evidenceKind",
  "itemId",
  "libraryId",
  "projectId",
] as const;
const OPTIONAL_FIELDS = ["noteMd", "tags", "title"] as const;
const ALLOWED_FIELDS = new Set<string>([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);

export async function executeEvidenceShelfPromotionCommand(
  request: EvidenceShelfPromotionCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<"evidenceShelf.promote">> {
  const input = parsePromotionInput(request.input);
  return dependencies.transaction(request.name, async (database) => {
    await assertActiveLocalLibrary(database, input.libraryId);
    const { libraryId, ...promotionInput } = input;
    const promoted = await promoteEvidenceShelfItem(
      database,
      libraryId,
      promotionInput satisfies PromoteEvidenceShelfInput,
    );
    return requireBoundedPromotionOutput(promoted);
  });
}

function parsePromotionInput(value: unknown): PromoteEvidenceShelfCommandInput {
  if (!isRecord(value)) throw new Error("Invalid evidenceShelf.promote input");
  const keys = Object.keys(value);
  if (
    keys.some((key) => !ALLOWED_FIELDS.has(key)) ||
    REQUIRED_FIELDS.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error("Invalid evidenceShelf.promote input");
  }
  const evidenceKind = value.evidenceKind;
  if (
    typeof evidenceKind !== "string" ||
    !EVIDENCE_KINDS.has(evidenceKind as PromoteEvidenceShelfCommandInput["evidenceKind"])
  ) {
    throw new Error("Invalid Evidence kind");
  }
  const input: PromoteEvidenceShelfCommandInput = {
    expectedUpdatedAt: requireInteger(value.expectedUpdatedAt, "Shelf item version"),
    evidenceKind: evidenceKind as PromoteEvidenceShelfCommandInput["evidenceKind"],
    itemId: requireRecordId(value.itemId, "Evidence shelf item id"),
    libraryId: requireRecordId(value.libraryId, "Library id"),
    projectId: requireRecordId(value.projectId, "Research project id"),
  };
  if (Object.hasOwn(value, "title")) input.title = optionalText(value.title, "Evidence title", 512);
  if (Object.hasOwn(value, "noteMd"))
    input.noteMd = optionalText(value.noteMd, "Evidence note", 64 * 1024);
  if (Object.hasOwn(value, "tags")) input.tags = parseTags(value.tags);
  return input;
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error("Evidence tags are invalid");
  // Array.from visits sparse slots too; Array#map would silently skip holes.
  return Array.from(value, (tag, index) => {
    if (typeof tag !== "string" || tag.length > 128) {
      throw new Error(`Evidence tag at index ${index} is invalid`);
    }
    return tag;
  });
}

function requireInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

function requireBoundedPromotionOutput<T>(output: T): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error("Evidence Shelf promotion output cannot be serialized");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_EVIDENCE_SHELF_LIST_BYTES) {
    throw new Error(`Evidence Shelf output is limited to ${MAX_EVIDENCE_SHELF_LIST_BYTES} bytes`);
  }
  return output;
}
