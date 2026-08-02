export interface TextQuoteSelector {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface TextPositionSelector {
  start: number;
  end: number;
}

export interface PdfQuadRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PdfQuadSelector {
  pageIndex: number;
  rects: PdfQuadRect[];
}

interface RevisionBoundAnchor {
  version: 1;
  revisionId: string;
  quote?: TextQuoteSelector;
  position?: TextPositionSelector;
}

export interface PdfSourceAnchor extends RevisionBoundAnchor {
  kind: "pdf";
  pageIndex: number;
  quads?: PdfQuadSelector;
}

export interface StructuralTextSourceAnchor extends RevisionBoundAnchor {
  kind: "html" | "docx" | "markdown";
  headingPath: string[];
  blockPath: string[];
  structuralHint?: string;
}

export interface EpubSourceAnchor extends RevisionBoundAnchor {
  kind: "epub";
  cfi: string;
}

export interface CanvasSourceAnchor {
  version: 1;
  kind: "canvas";
  workspaceId: string;
  nodeId: string;
  nodeRevision: number;
}

export interface ManuscriptSourceAnchor {
  version: 1;
  kind: "manuscript";
  manuscriptId: string;
  blockId: string;
  blockRevision: number;
}

export type SourceAnchor =
  | PdfSourceAnchor
  | StructuralTextSourceAnchor
  | EpubSourceAnchor
  | CanvasSourceAnchor
  | ManuscriptSourceAnchor;

export function parseSourceAnchor(value: unknown): SourceAnchor {
  if (!isRecord(value) || value.version !== 1 || typeof value.kind !== "string") {
    throw new Error("Invalid source anchor");
  }
  switch (value.kind) {
    case "pdf":
      return parsePdfAnchor(value);
    case "html":
    case "docx":
    case "markdown":
      return parseStructuralAnchor(value, value.kind);
    case "epub":
      return {
        version: 1,
        kind: "epub",
        revisionId: requireId(value.revisionId, "Source revision id"),
        cfi: requireString(value.cfi, "EPUB CFI"),
        ...optionalTextSelectors(value),
      };
    case "canvas":
      return {
        version: 1,
        kind: "canvas",
        workspaceId: requireId(value.workspaceId, "Canvas workspace id"),
        nodeId: requireId(value.nodeId, "Canvas node id"),
        nodeRevision: requireNonNegativeInteger(value.nodeRevision, "Canvas node revision"),
      };
    case "manuscript":
      return {
        version: 1,
        kind: "manuscript",
        manuscriptId: requireId(value.manuscriptId, "Manuscript id"),
        blockId: requireId(value.blockId, "Manuscript block id"),
        blockRevision: requireNonNegativeInteger(value.blockRevision, "Manuscript block revision"),
      };
    default:
      throw new Error(`Unsupported source anchor kind: ${value.kind}`);
  }
}

function parsePdfAnchor(value: Record<string, unknown>): PdfSourceAnchor {
  const pageIndex = requireNonNegativeInteger(value.pageIndex, "PDF page index");
  const quads = parseQuads(value.quads, pageIndex);
  return {
    version: 1,
    kind: "pdf",
    revisionId: requireId(value.revisionId, "Source revision id"),
    pageIndex,
    ...(quads ? { quads } : {}),
    ...optionalTextSelectors(value),
  };
}

function parseStructuralAnchor(
  value: Record<string, unknown>,
  kind: StructuralTextSourceAnchor["kind"],
): StructuralTextSourceAnchor {
  const structuralHint = optionalString(value.structuralHint, "Structural hint");
  return {
    version: 1,
    kind,
    revisionId: requireId(value.revisionId, "Source revision id"),
    headingPath: requireStringArray(value.headingPath, "Heading path"),
    blockPath: requireStringArray(value.blockPath, "Block path"),
    ...(structuralHint !== undefined ? { structuralHint } : {}),
    ...optionalTextSelectors(value),
  };
}

function optionalTextSelectors(
  value: Record<string, unknown>,
): Pick<RevisionBoundAnchor, "quote" | "position"> {
  const quote = parseQuote(value.quote);
  const position = parsePosition(value.position);
  return {
    ...(quote ? { quote } : {}),
    ...(position ? { position } : {}),
  };
}

function parseQuote(value: unknown): TextQuoteSelector | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.exact !== "string") {
    throw new Error("Invalid TextQuote selector");
  }
  return {
    exact: value.exact,
    prefix: optionalString(value.prefix, "TextQuote prefix") ?? "",
    suffix: optionalString(value.suffix, "TextQuote suffix") ?? "",
  };
}

function parsePosition(value: unknown): TextPositionSelector | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Invalid TextPosition selector");
  const start = requireNonNegativeInteger(value.start, "Text position start");
  const end = requireNonNegativeInteger(value.end, "Text position end");
  if (end < start) throw new Error("Text position end must not precede start");
  return { start, end };
}

function parseQuads(value: unknown, pageIndex: number): PdfQuadSelector | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || value.pageIndex !== pageIndex || !Array.isArray(value.rects)) {
    throw new Error("Invalid PDF quad selector");
  }
  const rects = value.rects.map((rect) => {
    if (!isRecord(rect)) throw new Error("Invalid PDF quad rectangle");
    const x1 = requireFiniteNumber(rect.x1, "PDF quad x1");
    const y1 = requireFiniteNumber(rect.y1, "PDF quad y1");
    const x2 = requireFiniteNumber(rect.x2, "PDF quad x2");
    const y2 = requireFiniteNumber(rect.y2, "PDF quad y2");
    if (x2 < x1 || y2 < y1) throw new Error("Invalid PDF quad bounds");
    return { x1, y1, x2, y2 };
  });
  if (rects.length === 0 || rects.length > 512) {
    throw new Error("PDF quad selector must contain between 1 and 512 rectangles");
  }
  return { pageIndex, rects };
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label} must be a string array`);
  }
  return [...value];
}

function requireId(value: unknown, label: string): string {
  const result = requireString(value, label).trim();
  if (!result) throw new Error(`${label} must not be empty`);
  return result;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, label);
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
