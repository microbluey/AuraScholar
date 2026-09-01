import { Buffer } from "node:buffer";
import type {
  CitationGraph,
  DiscoveryResult,
  DiscoverySearchReport,
  DiscoverySource,
  GraphEdge,
  GraphNode,
  ResolvedWork,
} from "@aurascholar/core";
import type { NormalizedAuthor, NormalizedWork, S2Enrichment } from "@aurascholar/connectors";
import {
  MAX_CITATION_GRAPH_DOI_BYTES,
  MAX_CITATION_GRAPH_EDGES,
  MAX_CITATION_GRAPH_NODE_ID_BYTES,
  MAX_CITATION_GRAPH_NODE_TEXT_BYTES,
  MAX_CITATION_GRAPH_NODES,
} from "../../src/shared/citation-graph-limits";
import {
  MAX_SCHOLARLY_AUTHOR_COUNT as SHARED_MAX_AUTHOR_COUNT,
  MAX_SCHOLARLY_AUTHOR_TEXT_BYTES as SHARED_MAX_AUTHOR_TEXT_BYTES,
  MAX_SCHOLARLY_CANDIDATES,
  MAX_SCHOLARLY_COUNT as SHARED_MAX_SAFE_COUNT,
  MAX_SCHOLARLY_CSL_JSON_BYTES as SHARED_MAX_CSL_JSON_BYTES,
  MAX_SCHOLARLY_CSL_JSON_DEPTH as SHARED_MAX_CSL_JSON_DEPTH,
  MAX_SCHOLARLY_CSL_JSON_ENTRIES as SHARED_MAX_CSL_JSON_ENTRIES,
  MAX_SCHOLARLY_DISCOVERY_ERROR_BYTES as SHARED_MAX_DISCOVERY_ERROR_BYTES,
  MAX_SCHOLARLY_DISCOVERY_PAGE as SHARED_MAX_DISCOVERY_PAGE,
  MAX_SCHOLARLY_DISCOVERY_RESULT_ID_BYTES as SHARED_MAX_DISCOVERY_RESULT_ID_BYTES,
  MAX_SCHOLARLY_DISCOVERY_RESULTS as SHARED_MAX_DISCOVERY_RESULTS,
  MAX_SCHOLARLY_KEYWORDS as SHARED_MAX_KEYWORDS,
  MAX_SCHOLARLY_OUTPUT_BYTES as SHARED_MAX_OUTPUT_BYTES,
  MAX_SCHOLARLY_TITLE_BYTES as SHARED_MAX_TITLE_BYTES,
  MAX_SCHOLARLY_URL_BYTES as SHARED_MAX_URL_BYTES,
  MAX_SCHOLARLY_WORK_LONG_TEXT_BYTES as SHARED_MAX_WORK_LONG_TEXT_BYTES,
  MAX_SCHOLARLY_WORK_SHORT_TEXT_BYTES as SHARED_MAX_WORK_SHORT_TEXT_BYTES,
  MAX_SCHOLARLY_YEAR as SHARED_MAX_YEAR,
} from "../../src/shared/scholarly-command-limits";
export const MAX_SCHOLARLY_OUTPUT_BYTES = SHARED_MAX_OUTPUT_BYTES;
const ALL_DISCOVERY_SOURCES: readonly DiscoverySource[] = ["crossref", "openalex", "s2", "arxiv"];
const MAX_AUTHOR_COUNT = SHARED_MAX_AUTHOR_COUNT;
const MAX_AUTHOR_TEXT_BYTES = SHARED_MAX_AUTHOR_TEXT_BYTES;
const MAX_CSL_JSON_BYTES = SHARED_MAX_CSL_JSON_BYTES;
const MAX_CSL_JSON_DEPTH = SHARED_MAX_CSL_JSON_DEPTH;
const MAX_CSL_JSON_ENTRIES = SHARED_MAX_CSL_JSON_ENTRIES;
const MAX_DISCOVERY_ERROR_BYTES = SHARED_MAX_DISCOVERY_ERROR_BYTES;
const MAX_DISCOVERY_RESULT_ID_BYTES = SHARED_MAX_DISCOVERY_RESULT_ID_BYTES;
const MAX_DISCOVERY_RESULTS = SHARED_MAX_DISCOVERY_RESULTS;
const MAX_GRAPH_EDGES = MAX_CITATION_GRAPH_EDGES;
const MAX_GRAPH_NODE_ID_BYTES = MAX_CITATION_GRAPH_NODE_ID_BYTES;
const MAX_GRAPH_NODES = MAX_CITATION_GRAPH_NODES;
const MAX_GRAPH_NODE_TEXT_BYTES = MAX_CITATION_GRAPH_NODE_TEXT_BYTES;
const MAX_KEYWORDS = SHARED_MAX_KEYWORDS;
const MAX_YEAR = SHARED_MAX_YEAR;
const MAX_SAFE_COUNT = SHARED_MAX_SAFE_COUNT;
const MAX_TITLE_BYTES = SHARED_MAX_TITLE_BYTES;
const MAX_URL_BYTES = SHARED_MAX_URL_BYTES;
const MAX_WORK_LONG_TEXT_BYTES = SHARED_MAX_WORK_LONG_TEXT_BYTES;
const MAX_WORK_SHORT_TEXT_BYTES = SHARED_MAX_WORK_SHORT_TEXT_BYTES;
type NormalizedWorkSource = NormalizedWork["source"];

const WORK_SOURCES: readonly NormalizedWorkSource[] = [
  "crossref",
  "openalex",
  "s2",
  "arxiv",
  "unpaywall",
  "datacite",
];

export function sanitizeDiscoverySearchReport(
  value: DiscoverySearchReport,
  requestedSources: readonly DiscoverySource[] | undefined,
): DiscoverySearchReport {
  if (!isRecord(value)) throw new Error("Discovery search report is invalid");
  const sources = requestedSources ?? ALL_DISCOVERY_SOURCES;
  const requested = new Set(sources);
  const resultIds = new Set<string>();
  const results = Array.isArray(value.results)
    ? value.results
        .slice(0, MAX_DISCOVERY_RESULTS)
        .map((result) => sanitizeDiscoveryResult(result))
        .filter((result): result is DiscoveryResult => {
          if (
            result === null ||
            !requested.has(result.source) ||
            result.work.source !== result.source ||
            resultIds.has(result.id)
          ) {
            return false;
          }
          resultIds.add(result.id);
          return true;
        })
    : [];
  const reportSources = {} as DiscoverySearchReport["sources"];
  const cursors = {} as DiscoverySearchReport["cursors"];
  for (const source of sources) {
    const report = value.sources?.[source];
    const cursor = value.cursors?.[source];
    reportSources[source] = {
      count: boundedCount(report?.count),
      ...(safeText(report?.error, MAX_DISCOVERY_ERROR_BYTES) === undefined
        ? {}
        : { error: safeText(report?.error, MAX_DISCOVERY_ERROR_BYTES) }),
      source,
      status: safeDiscoveryStatus(report?.status),
    };
    cursors[source] = {
      hasMore: cursor?.hasMore === true,
      page: boundedPage(cursor?.page),
    };
  }
  return { cursors, results, sources: reportSources };
}

export function sanitizeScholarEnrichment(value: S2Enrichment | null): S2Enrichment | null {
  if (value === null || !isRecord(value)) return null;
  return {
    ...(safeCount(value.citationCount) === undefined
      ? {}
      : { citationCount: safeCount(value.citationCount) }),
    ...(safeCount(value.influentialCitationCount) === undefined
      ? {}
      : { influentialCitationCount: safeCount(value.influentialCitationCount) }),
    ...(safeUrl(value.openAccessPdfUrl) === undefined
      ? {}
      : { openAccessPdfUrl: safeUrl(value.openAccessPdfUrl) }),
    ...(safeCount(value.referenceCount) === undefined
      ? {}
      : { referenceCount: safeCount(value.referenceCount) }),
    ...(safeText(value.s2Id, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { s2Id: safeText(value.s2Id, MAX_WORK_SHORT_TEXT_BYTES) }),
    ...(safeText(value.tldr, MAX_WORK_LONG_TEXT_BYTES) === undefined
      ? {}
      : { tldr: safeText(value.tldr, MAX_WORK_LONG_TEXT_BYTES) }),
    ...(safeUrl(value.url) === undefined ? {} : { url: safeUrl(value.url) }),
  };
}

export function sanitizeCitationGraph(value: CitationGraph | null): CitationGraph | null {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges)
  ) {
    return null;
  }
  const nodes = value.nodes
    .slice(0, MAX_GRAPH_NODES)
    .map(sanitizeGraphNode)
    .filter((node): node is GraphNode => node !== null);
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length || nodes.length === 0) return null;
  const centerId = safeText(value.centerId, MAX_GRAPH_NODE_ID_BYTES);
  const centers = nodes.filter((node) => node.relation === "center");
  if (!centerId || centers.length !== 1 || centers[0]?.id !== centerId) return null;

  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const valueEdge of value.edges.slice(0, MAX_GRAPH_EDGES)) {
    const edge = sanitizeGraphEdge(valueEdge, nodeIds);
    if (!edge) continue;
    const key = JSON.stringify([edge.source, edge.target]);
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push(edge);
  }
  return { centerId, edges, nodes, truncated: value.truncated === true };
}

export function sanitizeResolvedWork(value: ResolvedWork | null): ResolvedWork | null {
  if (!value || typeof value !== "object") return null;
  const work = sanitizeNormalizedWork(value.work);
  if (!work) return null;
  const candidates = Array.isArray(value.candidates)
    ? value.candidates
        .slice(0, MAX_SCHOLARLY_CANDIDATES)
        .map(sanitizeNormalizedWork)
        .filter((candidate): candidate is NormalizedWork => candidate !== null)
    : [];
  const confidence =
    typeof value.confidence === "number" && Number.isFinite(value.confidence)
      ? Math.max(0, Math.min(1, value.confidence))
      : 0;
  return {
    ...(candidates.length === 0 ? {} : { candidates }),
    confidence,
    work,
  };
}

export function requireBoundedScholarlyOutput<T>(output: T, label: string): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error(`${label} cannot be serialized`);
  }
  if (typeof serialized !== "string") throw new Error(`${label} cannot be serialized`);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SCHOLARLY_OUTPUT_BYTES) {
    throw new Error(`${label} is limited to ${MAX_SCHOLARLY_OUTPUT_BYTES} bytes`);
  }
  return output;
}

function sanitizeDiscoveryResult(value: unknown): DiscoveryResult | null {
  if (!isRecord(value)) return null;
  const source = safeDiscoverySource(value.source);
  const id = safeText(value.id, MAX_DISCOVERY_RESULT_ID_BYTES);
  const work = sanitizeNormalizedWork(value.work);
  if (!source || !id || !work) return null;
  return {
    id,
    score: safeScore(value.score),
    source,
    work,
  };
}

function sanitizeNormalizedWork(value: unknown): NormalizedWork | null {
  if (!isRecord(value)) return null;
  const source = safeWorkSource(value.source);
  const title = safeText(value.title, MAX_TITLE_BYTES);
  if (!source || !title) return null;
  const authors = Array.isArray(value.authors)
    ? value.authors
        .slice(0, MAX_AUTHOR_COUNT)
        .map((author, index) => sanitizeAuthor(author, index))
        .filter((author): author is NormalizedAuthor => author !== null)
    : [];
  const keywords = Array.isArray(value.keywords)
    ? value.keywords
        .slice(0, MAX_KEYWORDS)
        .map((keyword) => safeText(keyword, MAX_WORK_SHORT_TEXT_BYTES))
        .filter((keyword): keyword is string => keyword !== undefined)
    : undefined;
  const cslJson = sanitizeCslJson(value.cslJson);
  return {
    ...(safeText(value.abstract, MAX_WORK_LONG_TEXT_BYTES) === undefined
      ? {}
      : { abstract: safeText(value.abstract, MAX_WORK_LONG_TEXT_BYTES) }),
    ...(safeText(value.arxivId, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { arxivId: safeText(value.arxivId, MAX_WORK_SHORT_TEXT_BYTES) }),
    authors,
    ...(safeCount(value.citedByCount) === undefined
      ? {}
      : { citedByCount: safeCount(value.citedByCount) }),
    ...(cslJson === undefined ? {} : { cslJson }),
    ...(safeText(value.doi, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { doi: safeText(value.doi, MAX_WORK_SHORT_TEXT_BYTES) }),
    ...(safeText(value.isbn, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { isbn: safeText(value.isbn, MAX_WORK_SHORT_TEXT_BYTES) }),
    ...(safeText(value.issn, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { issn: safeText(value.issn, MAX_WORK_SHORT_TEXT_BYTES) }),
    ...(keywords === undefined || keywords.length === 0 ? {} : { keywords }),
    ...(safeText(value.issue, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { issue: safeText(value.issue, MAX_WORK_SHORT_TEXT_BYTES) }),
    ...(safeText(value.language, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { language: safeText(value.language, MAX_WORK_SHORT_TEXT_BYTES) }),
    ...(safeUrl(value.oaPdfUrl) === undefined ? {} : { oaPdfUrl: safeUrl(value.oaPdfUrl) }),
    ...(safeText(value.openalexId, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { openalexId: safeText(value.openalexId, MAX_WORK_SHORT_TEXT_BYTES) }),
    ...(safeText(value.pages, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { pages: safeText(value.pages, MAX_WORK_SHORT_TEXT_BYTES) }),
    ...(safeText(value.placePublished, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { placePublished: safeText(value.placePublished, MAX_WORK_SHORT_TEXT_BYTES) }),
    ...(safeText(value.pmid, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { pmid: safeText(value.pmid, MAX_WORK_SHORT_TEXT_BYTES) }),
    ...(safeText(value.publicationDate, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { publicationDate: safeText(value.publicationDate, MAX_WORK_SHORT_TEXT_BYTES) }),
    ...(safeText(value.publisher, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { publisher: safeText(value.publisher, MAX_WORK_SHORT_TEXT_BYTES) }),
    ...(safeText(value.s2Id, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { s2Id: safeText(value.s2Id, MAX_WORK_SHORT_TEXT_BYTES) }),
    source,
    title,
    ...(safeText(value.type, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { type: safeText(value.type, MAX_WORK_SHORT_TEXT_BYTES) }),
    ...(safeUrl(value.url) === undefined ? {} : { url: safeUrl(value.url) }),
    ...(safeText(value.venueName, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { venueName: safeText(value.venueName, MAX_WORK_SHORT_TEXT_BYTES) }),
    ...(value.venueType === "journal" ||
    value.venueType === "conference" ||
    value.venueType === "repository" ||
    value.venueType === "book"
      ? { venueType: value.venueType }
      : {}),
    ...(safeText(value.volume, MAX_WORK_SHORT_TEXT_BYTES) === undefined
      ? {}
      : { volume: safeText(value.volume, MAX_WORK_SHORT_TEXT_BYTES) }),
    ...(safeYear(value.year) === undefined ? {} : { year: safeYear(value.year) }),
  };
}

function sanitizeAuthor(value: unknown, index: number): NormalizedAuthor | null {
  if (!isRecord(value)) return null;
  const displayName = safeText(value.displayName, MAX_AUTHOR_TEXT_BYTES);
  if (!displayName) return null;
  const position = safeCount(value.position);
  return {
    displayName,
    ...(safeText(value.family, MAX_AUTHOR_TEXT_BYTES) === undefined
      ? {}
      : { family: safeText(value.family, MAX_AUTHOR_TEXT_BYTES) }),
    ...(safeText(value.given, MAX_AUTHOR_TEXT_BYTES) === undefined
      ? {}
      : { given: safeText(value.given, MAX_AUTHOR_TEXT_BYTES) }),
    ...(value.isCorresponding === true ? { isCorresponding: true } : {}),
    ...(safeText(value.orcid, MAX_AUTHOR_TEXT_BYTES) === undefined
      ? {}
      : { orcid: safeText(value.orcid, MAX_AUTHOR_TEXT_BYTES) }),
    position: position ?? index,
    ...(value.role === "author" || value.role === "editor" || value.role === "translator"
      ? { role: value.role }
      : {}),
  };
}

function sanitizeGraphNode(value: unknown): GraphNode | null {
  if (!isRecord(value)) return null;
  const id = safeText(value.id, MAX_GRAPH_NODE_ID_BYTES);
  const title = safeText(value.title, MAX_GRAPH_NODE_TEXT_BYTES);
  if (!id || !title || !isGraphRelation(value.relation)) return null;
  return {
    citedByCount: safeCount(value.citedByCount) ?? 0,
    ...(safeText(value.doi, MAX_CITATION_GRAPH_DOI_BYTES) === undefined
      ? {}
      : { doi: safeText(value.doi, MAX_CITATION_GRAPH_DOI_BYTES) }),
    ...(safeText(value.firstAuthor, MAX_GRAPH_NODE_TEXT_BYTES) === undefined
      ? {}
      : { firstAuthor: safeText(value.firstAuthor, MAX_GRAPH_NODE_TEXT_BYTES) }),
    id,
    relation: value.relation,
    title,
    ...(safeText(value.venue, MAX_GRAPH_NODE_TEXT_BYTES) === undefined
      ? {}
      : { venue: safeText(value.venue, MAX_GRAPH_NODE_TEXT_BYTES) }),
    ...(safeYear(value.year) === undefined ? {} : { year: safeYear(value.year) }),
  };
}

function sanitizeGraphEdge(value: unknown, nodeIds: ReadonlySet<string>): GraphEdge | null {
  if (!isRecord(value)) return null;
  const source = safeText(value.source, MAX_GRAPH_NODE_ID_BYTES);
  const target = safeText(value.target, MAX_GRAPH_NODE_ID_BYTES);
  if (!source || !target || source === target || !nodeIds.has(source) || !nodeIds.has(target)) {
    return null;
  }
  return { source, target };
}

function sanitizeCslJson(value: unknown): Record<string, unknown> | undefined {
  const sanitized = sanitizeJson(value, 0);
  if (!isRecord(sanitized)) return undefined;
  try {
    return Buffer.byteLength(JSON.stringify(sanitized), "utf8") <= MAX_CSL_JSON_BYTES
      ? sanitized
      : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeJson(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return safeText(value, MAX_WORK_SHORT_TEXT_BYTES);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (depth >= MAX_CSL_JSON_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_CSL_JSON_ENTRIES)
      .map((entry) => sanitizeJson(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (!isRecord(value)) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, MAX_CSL_JSON_ENTRIES)) {
    const safeKey = safeText(key, 256);
    const safeEntry = sanitizeJson(entry, depth + 1);
    const unsafeKey =
      safeKey === "__proto__" || safeKey === "prototype" || safeKey === "constructor";
    if (!safeKey || safeEntry === undefined || unsafeKey) continue;
    output[safeKey] = safeEntry;
  }
  return output;
}

function safeDiscoverySource(value: unknown): DiscoverySource | undefined {
  return typeof value === "string" && ALL_DISCOVERY_SOURCES.includes(value as DiscoverySource)
    ? (value as DiscoverySource)
    : undefined;
}

function safeWorkSource(value: unknown): NormalizedWorkSource | undefined {
  return typeof value === "string" && WORK_SOURCES.includes(value as NormalizedWorkSource)
    ? (value as NormalizedWorkSource)
    : undefined;
}

function safeDiscoveryStatus(
  value: unknown,
): DiscoverySearchReport["sources"][DiscoverySource]["status"] {
  return value === "done" ||
    value === "empty" ||
    value === "timeout" ||
    value === "error" ||
    value === "rate_limited" ||
    value === "aborted"
    ? value
    : "error";
}

function isGraphRelation(value: unknown): value is GraphNode["relation"] {
  return value === "center" || value === "reference" || value === "citer";
}

function safeText(value: unknown, maximumBytes: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    // eslint-disable-next-line no-control-regex -- external metadata can contain control bytes.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, " ")
    .trim();
  if (!normalized) return undefined;
  return truncateUtf8(normalized, maximumBytes);
}

function safeUrl(value: unknown): string | undefined {
  const text = safeText(value, MAX_URL_BYTES);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return undefined;
    }
    const canonical = url.toString();
    return Buffer.byteLength(canonical, "utf8") <= MAX_URL_BYTES ? canonical : undefined;
  } catch {
    return undefined;
  }
}

function boundedCount(value: unknown): number {
  return Math.min(MAX_DISCOVERY_RESULTS, safeCount(value) ?? 0);
}

function safeCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= MAX_SAFE_COUNT
    ? (value as number)
    : undefined;
}

function safeScore(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(MAX_SAFE_COUNT, value))
    : 0;
}

function safeYear(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_YEAR
    ? (value as number)
    : undefined;
}

function boundedPage(value: unknown): number {
  return Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= SHARED_MAX_DISCOVERY_PAGE
    ? (value as number)
    : 1;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) return value;
  const truncated = Buffer.from(value, "utf8").subarray(0, maximumBytes).toString("utf8");
  return truncated.endsWith("�") ? truncated.slice(0, -1) : truncated;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
