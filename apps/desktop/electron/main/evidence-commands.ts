import type { Database } from "@aurascholar/db";
import {
  DocumentAssetsRepo,
  type AttachmentRevisionSource,
} from "@aurascholar/db/repos/document-assets";
import {
  EvidenceRepo,
  type EvidenceKind,
  type PdfTextEvidenceAnchorInput,
} from "@aurascholar/db/repos/evidence";
import { ResearchProjectsRepo } from "@aurascholar/db/repos/research-projects";
import type {
  DataCommandOutput,
  DataCommandRequest,
  DocumentRevisionCommandInput,
  EvidenceCommandInput,
  ListEvidenceCommandInput,
  ResolveDocumentRevisionCommandInput,
  SaveTextEvidenceCommandInput,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireNullableRecordId,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";

type EvidenceCommandName =
  | "document.resolveAttachmentRevision"
  | "document.resolveRevision"
  | "evidence.get"
  | "evidence.list"
  | "evidence.saveText";

export type EvidenceCommandRequest = Extract<DataCommandRequest, { name: EvidenceCommandName }>;

export async function executeEvidenceCommand(
  request: EvidenceCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<EvidenceCommandName>> {
  switch (request.name) {
    case "document.resolveAttachmentRevision": {
      const input = parseDocumentRevisionInput(request.input);
      return executeQuery(dependencies, request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const source = await new DocumentAssetsRepo(database, input.libraryId).resolveAttachment(
          input.attachmentId,
        );
        if (!source) return { revision: null };
        if (source.work_id !== input.workId) {
          throw new Error("Attachment does not belong to the requested Work");
        }
        if (
          input.expectedBlobSha256 &&
          (source.blob_sha256 !== input.expectedBlobSha256 ||
            source.attachment_sha256 !== input.expectedBlobSha256)
        ) {
          throw new Error("Document revision changed; reopen the source before continuing");
        }
        return {
          revision: toResolvedDocumentRevision(source),
        };
      });
    }
    case "document.resolveRevision": {
      const input = parseResolveDocumentRevisionInput(request.input);
      return executeQuery(dependencies, request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const source = await new DocumentAssetsRepo(database, input.libraryId).resolveRevision(
          input.revisionId,
        );
        if (!source) return { revision: null };
        if (source.work_id !== input.workId) {
          throw new Error("Document revision does not belong to the requested Work");
        }
        return {
          revision: toResolvedDocumentRevision(source),
        };
      });
    }
    case "evidence.get": {
      const input = parseEvidenceInput(request.input, request.name);
      return executeQuery(dependencies, request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        return {
          evidence: await new EvidenceRepo(database, input.libraryId).get(input.evidenceId),
        };
      });
    }
    case "evidence.list": {
      const input = parseListEvidenceInput(request.input);
      return executeQuery(dependencies, request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        return {
          evidence: await new EvidenceRepo(database, input.libraryId).list({
            scope: input.scope,
            limit: input.limit,
            offset: input.offset,
          }),
        };
      });
    }
    case "evidence.saveText": {
      const input = parseSaveTextEvidenceInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        let sourceMembershipAdded = false;
        if (input.projectId) {
          sourceMembershipAdded =
            (await new ResearchProjectsRepo(database, input.libraryId).addWorks(input.projectId, [
              input.workId,
            ])) === 1;
        }
        const repository = new EvidenceRepo(database, input.libraryId);
        const saved = await repository.createText({
          id: input.evidenceId,
          workId: input.workId,
          attachmentId: input.attachmentId,
          expectedBlobSha256: input.expectedBlobSha256,
          anchor: input.anchor,
          text: input.text,
          evidenceKind: input.evidenceKind,
          title: input.title,
          noteMd: input.noteMd,
          tags: input.tags,
          captureMethod: input.captureMethod,
          annotationId: input.annotationId,
        });
        await new DocumentAssetsRepo(database, input.libraryId).setAvailability(
          saved.evidence.revisionId,
          "available",
        );
        const availableEvidence = await repository.get(saved.evidence.id);
        if (!availableEvidence) {
          throw new Error(`Evidence ${saved.evidence.id} disappeared after source verification`);
        }
        const projectMembershipAdded = input.projectId
          ? await repository.addToProject(input.projectId, availableEvidence.id)
          : false;
        return {
          ...saved,
          evidence: availableEvidence,
          projectMembershipAdded,
          sourceMembershipAdded,
        };
      });
    }
  }
}

function executeQuery<K extends Exclude<EvidenceCommandName, "evidence.saveText">>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute)
    throw new Error("Main-process database query execution is unavailable");
  return dependencies.execute(commandName, operation);
}

function parseDocumentRevisionInput(value: unknown): DocumentRevisionCommandInput {
  if (!isRecord(value)) throw new Error("Invalid document.resolveAttachmentRevision input");
  const expectedBlobSha256 = optionalSha256(value.expectedBlobSha256);
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    workId: requireRecordId(value.workId, "Work id"),
    attachmentId: requireRecordId(value.attachmentId, "Attachment id"),
    ...(expectedBlobSha256 ? { expectedBlobSha256 } : {}),
  };
}

function parseResolveDocumentRevisionInput(value: unknown): ResolveDocumentRevisionCommandInput {
  if (!isRecord(value)) throw new Error("Invalid document.resolveRevision input");
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    revisionId: requireRecordId(value.revisionId, "Document revision id"),
    workId: requireRecordId(value.workId, "Work id"),
  };
}

function toResolvedDocumentRevision(source: AttachmentRevisionSource) {
  return {
    assetId: source.asset_id,
    attachmentId: source.attachment_id,
    availabilityStatus: source.availability_status,
    blobSha256: source.blob_sha256,
    currentRevisionId: source.current_revision_id,
    pageCount: source.page_count,
    revisionId: source.id,
    revisionNo: source.revision_no,
    workId: source.work_id,
  };
}

function parseEvidenceInput(value: unknown, commandName: string): EvidenceCommandInput {
  if (!isRecord(value)) throw new Error(`Invalid ${commandName} input`);
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    evidenceId: requireRecordId(value.evidenceId, "Evidence id"),
  };
}

function parseListEvidenceInput(value: unknown): ListEvidenceCommandInput {
  if (!isRecord(value) || !isRecord(value.scope)) throw new Error("Invalid evidence.list input");
  const kind = value.scope.kind;
  if (kind !== "library" && kind !== "inbox" && kind !== "project") {
    throw new Error("Invalid Evidence list scope");
  }
  let scope: ListEvidenceCommandInput["scope"];
  if (kind === "project") {
    scope = {
      kind: "project",
      projectId: requireRecordId(value.scope.projectId, "Research project id"),
    };
  } else {
    scope = { kind };
  }
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    scope,
    limit: optionalBoundedInteger(value.limit, "Evidence page size", 1, 200),
    offset: optionalBoundedInteger(value.offset, "Evidence page offset", 0, 1_000_000),
  };
}

function parseSaveTextEvidenceInput(value: unknown): SaveTextEvidenceCommandInput {
  if (!isRecord(value)) throw new Error("Invalid evidence.saveText input");
  const evidenceKind = value.evidenceKind;
  if (!EVIDENCE_KINDS.has(evidenceKind as EvidenceKind)) throw new Error("Invalid Evidence kind");
  const captureMethod = value.captureMethod;
  if (
    captureMethod !== undefined &&
    captureMethod !== "reader-selection" &&
    captureMethod !== "annotation"
  ) {
    throw new Error("Invalid Evidence capture method");
  }
  const tags = value.tags === undefined ? undefined : parseTags(value.tags);
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    evidenceId: requireRecordId(value.evidenceId, "Evidence id"),
    workId: requireRecordId(value.workId, "Work id"),
    attachmentId: requireRecordId(value.attachmentId, "Attachment id"),
    expectedBlobSha256: requireSha256(value.expectedBlobSha256),
    projectId: requireNullableRecordId(value.projectId, "Research project id"),
    anchor: parsePdfAnchor(value.anchor),
    text: requireNonBlankText(value.text, "Evidence text", 256 * 1024),
    evidenceKind: evidenceKind as EvidenceKind,
    title: optionalText(value.title, "Evidence title", 512),
    noteMd: optionalText(value.noteMd, "Evidence note", 64 * 1024),
    ...(tags ? { tags } : {}),
    ...(captureMethod ? { captureMethod } : {}),
    annotationId: requireNullableRecordId(value.annotationId, "Annotation id"),
  };
}

function parsePdfAnchor(value: unknown): PdfTextEvidenceAnchorInput {
  if (!isRecord(value) || value.version !== 1 || value.kind !== "pdf" || !isRecord(value.quote)) {
    throw new Error("Invalid PDF Evidence anchor");
  }
  const pageIndex = requireInteger(value.pageIndex, "PDF page index", 0);
  const anchor: PdfTextEvidenceAnchorInput = {
    version: 1,
    kind: "pdf",
    pageIndex,
    quote: {
      exact: requireText(value.quote.exact, "TextQuote exact text", 256 * 1024),
      prefix: optionalText(value.quote.prefix, "TextQuote prefix", 4_096) ?? "",
      suffix: optionalText(value.quote.suffix, "TextQuote suffix", 4_096) ?? "",
    },
  };
  if (value.position !== undefined) {
    if (!isRecord(value.position)) throw new Error("Invalid TextPosition selector");
    const start = requireInteger(value.position.start, "TextPosition start", 0);
    const end = requireInteger(value.position.end, "TextPosition end", 0);
    if (end < start) throw new Error("TextPosition end must not precede start");
    anchor.position = {
      start,
      end,
    };
  }
  if (value.quads !== undefined) {
    if (!isRecord(value.quads) || !Array.isArray(value.quads.rects)) {
      throw new Error("Invalid PDF quad selector");
    }
    if (value.quads.rects.length === 0 || value.quads.rects.length > 512) {
      throw new Error("PDF quad selector must contain between 1 and 512 rectangles");
    }
    anchor.quads = {
      pageIndex: requireInteger(value.quads.pageIndex, "PDF quad page index", 0),
      rects: value.quads.rects.map((rect) => parseQuadRect(rect)),
    };
  }
  return anchor;
}

function parseQuadRect(value: unknown) {
  if (!isRecord(value)) throw new Error("Invalid PDF quad rectangle");
  const rect = {
    x1: requireFinite(value.x1, "PDF quad x1"),
    y1: requireFinite(value.y1, "PDF quad y1"),
    x2: requireFinite(value.x2, "PDF quad x2"),
    y2: requireFinite(value.y2, "PDF quad y2"),
  };
  if (rect.x2 < rect.x1 || rect.y2 < rect.y1) {
    throw new Error("PDF quad rectangle coordinates are inverted");
  }
  return rect;
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error("Evidence tags are invalid");
  return value.map((tag, index) => requireText(tag, `Evidence tag ${index}`, 128));
}

function optionalSha256(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : requireSha256(value);
}

function requireSha256(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("Document hash must be a lowercase SHA-256 value");
  }
  return value;
}

function optionalText(value: unknown, label: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireText(value, label, max);
}

function requireText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Error(`${label} is required and must not exceed ${max} characters`);
  }
  return value;
}

function requireNonBlankText(value: unknown, label: string, max: number): string {
  const text = requireText(value, label, max);
  if (!text.trim()) throw new Error(`${label} must contain non-whitespace characters`);
  return text;
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

function requireFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is invalid`);
  return value;
}

const EVIDENCE_KINDS = new Set<EvidenceKind>([
  "method",
  "data",
  "limitation",
  "definition",
  "context",
]);
