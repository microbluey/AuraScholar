import type { Database } from "../database.js";
import type {
  CreateTextEvidenceInput,
  EvidenceKind,
  PdfTextEvidenceAnchorInput,
} from "./evidence.js";

export interface NormalizedCreateTextEvidenceInput extends CreateTextEvidenceInput {
  annotationId: string | null;
  captureMethod: "reader-selection" | "annotation";
  noteMd: string | null;
  tags: string[];
  title: string | null;
}

interface AnnotationEvidenceSourceRow {
  anchor_json: string | null;
  orphaned: number;
  page_index: number;
}

const EVIDENCE_KINDS = new Set<EvidenceKind>([
  "method",
  "data",
  "limitation",
  "definition",
  "context",
]);

export function normalizeCreateInput(
  input: CreateTextEvidenceInput,
): NormalizedCreateTextEvidenceInput {
  assertId(input.workId, "Work id");
  assertId(input.attachmentId, "Attachment id");
  if (input.id !== undefined) assertId(input.id, "Evidence id");
  if (!/^[0-9a-f]{64}$/.test(input.expectedBlobSha256)) {
    throw new Error("Expected document hash must be a lowercase SHA-256 value");
  }
  if (!EVIDENCE_KINDS.has(input.evidenceKind)) throw new Error("Unsupported evidence kind");
  const text = input.text;
  if (!text.trim() || text.length > 256 * 1024)
    throw new Error("Evidence text is empty or too long");
  validateAnchor(input.anchor, text);
  const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  if (tags.length > 64 || tags.some((tag) => tag.length > 128))
    throw new Error("Evidence tags exceed the limit");
  const title = input.title?.trim() || null;
  const noteMd = input.noteMd?.trim() || null;
  if ((title?.length ?? 0) > 512 || (noteMd?.length ?? 0) > 64 * 1024) {
    throw new Error("Evidence title or note exceeds the limit");
  }
  const captureMethod = input.captureMethod ?? "reader-selection";
  const annotationId = input.annotationId?.trim() || null;
  if (captureMethod === "annotation" && !annotationId) {
    throw new Error("Annotation evidence requires an annotation id");
  }
  if (captureMethod !== "annotation" && annotationId) {
    throw new Error("Annotation id requires annotation capture method");
  }
  return {
    ...input,
    text,
    tags,
    title,
    noteMd,
    captureMethod,
    annotationId,
  };
}

export async function assertAnnotationEvidenceSource(
  db: Database,
  libraryId: string,
  input: NormalizedCreateTextEvidenceInput,
): Promise<void> {
  if (input.captureMethod !== "annotation") return;
  const rows = await db.query<AnnotationEvidenceSourceRow>(
    `SELECT annotation.page_index, annotation.anchor_json, annotation.orphaned
     FROM annotations annotation
     JOIN attachments attachment
       ON attachment.id = annotation.attachment_id
      AND attachment.id = ?
      AND attachment.work_id = annotation.work_id
      AND attachment.deleted_at IS NULL
     JOIN works work
       ON work.id = annotation.work_id
      AND work.id = ?
      AND work.library_id = ?
      AND work.deleted_at IS NULL
     WHERE annotation.id = ? AND annotation.deleted_at IS NULL
     LIMIT 1`,
    [input.attachmentId, input.workId, libraryId, input.annotationId],
  );
  const annotation = rows[0];
  if (!annotation || annotation.orphaned !== 0 || !annotation.anchor_json) {
    throw new Error("Annotation Evidence source is missing, removed, or unresolved");
  }
  let anchor: unknown;
  try {
    anchor = JSON.parse(annotation.anchor_json) as unknown;
  } catch {
    throw new Error("Annotation Evidence source has an invalid anchor");
  }
  if (!matchesAnnotationAnchor(anchor, annotation.page_index, input.anchor)) {
    throw new Error("Annotation Evidence source does not match the captured text and anchor");
  }
}

function matchesAnnotationAnchor(
  value: unknown,
  annotationPageIndex: number,
  expected: PdfTextEvidenceAnchorInput,
): boolean {
  if (
    !isRecord(value) ||
    value.version !== expected.version ||
    annotationPageIndex !== expected.pageIndex ||
    value.pageIndex !== expected.pageIndex ||
    !isRecord(value.quote) ||
    value.quote.exact !== expected.quote.exact ||
    optionalString(value.quote.prefix) !== (expected.quote.prefix ?? "") ||
    optionalString(value.quote.suffix) !== (expected.quote.suffix ?? "")
  ) {
    return false;
  }
  if (!matchesPosition(value.position, expected.position)) return false;
  return matchesQuads(value.quads, expected.quads);
}

function matchesPosition(
  value: unknown,
  expected: PdfTextEvidenceAnchorInput["position"],
): boolean {
  if (!expected) return value === undefined;
  return isRecord(value) && value.start === expected.start && value.end === expected.end;
}

function matchesQuads(value: unknown, expected: PdfTextEvidenceAnchorInput["quads"]): boolean {
  if (!expected) return value === undefined;
  if (!isRecord(value) || value.pageIndex !== expected.pageIndex || !Array.isArray(value.rects)) {
    return false;
  }
  return (
    value.rects.length === expected.rects.length &&
    value.rects.every((rect, index) => {
      const expectedRect = expected.rects[index];
      if (!expectedRect || !isRecord(rect)) return false;
      return (
        rect.x1 === expectedRect.x1 &&
        rect.y1 === expectedRect.y1 &&
        rect.x2 === expectedRect.x2 &&
        rect.y2 === expectedRect.y2
      );
    })
  );
}

function optionalString(value: unknown): string | null {
  return value === undefined ? "" : typeof value === "string" ? value : null;
}

export function matchesProvenance(
  value: string,
  input: NormalizedCreateTextEvidenceInput,
): boolean {
  let provenance: unknown;
  try {
    provenance = JSON.parse(value) as unknown;
  } catch {
    return false;
  }
  return (
    isRecord(provenance) &&
    provenance.capturedBy === "user" &&
    provenance.sourceAuthority === sourceAuthorityFor(input) &&
    provenance.captureMethod === input.captureMethod &&
    (typeof provenance.annotationId === "string" ? provenance.annotationId : null) ===
      input.annotationId
  );
}

export function sourceAuthorityFor(
  input: NormalizedCreateTextEvidenceInput,
): "captured-source" | "user-annotation" {
  return input.captureMethod === "annotation" ? "user-annotation" : "captured-source";
}

export async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateAnchor(anchor: PdfTextEvidenceAnchorInput, text: string): void {
  if (
    anchor.version !== 1 ||
    anchor.kind !== "pdf" ||
    !Number.isInteger(anchor.pageIndex) ||
    anchor.pageIndex < 0
  ) {
    throw new Error("Invalid PDF Evidence anchor");
  }
  if (anchor.quote.exact !== text)
    throw new Error("Evidence text must exactly match its TextQuote selector");
  if (anchor.position) {
    if (
      !Number.isInteger(anchor.position.start) ||
      !Number.isInteger(anchor.position.end) ||
      anchor.position.start < 0 ||
      anchor.position.end < anchor.position.start
    ) {
      throw new Error("Invalid Evidence TextPosition selector");
    }
  }
  if (anchor.quads) {
    if (
      anchor.quads.pageIndex !== anchor.pageIndex ||
      anchor.quads.rects.length === 0 ||
      anchor.quads.rects.length > 512
    ) {
      throw new Error("Invalid Evidence PDF quad selector");
    }
    for (const rect of anchor.quads.rects) {
      const values = [rect.x1, rect.y1, rect.x2, rect.y2];
      if (
        values.some((value) => !Number.isFinite(value)) ||
        rect.x2 < rect.x1 ||
        rect.y2 < rect.y1
      ) {
        throw new Error("Invalid Evidence PDF quad rectangle");
      }
    }
  }
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must be a non-empty string`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
