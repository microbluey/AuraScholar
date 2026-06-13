// CSL-JSON is the lingua franca: Crossref stores it on works.csl_json, and it's
// the source of truth for every exporter and formatter here. This file defines
// the subset we rely on plus a normalizer that (a) accepts a raw stored object
// and (b) backfills from the library's own columns when CSL is absent.

export interface CslName {
  family?: string;
  given?: string;
  /** Single-field name (institutions, "et al." fallbacks). */
  literal?: string;
}

export interface CslDate {
  /** [[year, month, day], ...] — CSL "date-parts". */
  "date-parts"?: number[][];
  raw?: string;
}

export interface CslItem {
  id: string;
  type: string; // "article-journal" | "paper-conference" | "book" | ...
  title?: string;
  author?: CslName[];
  editor?: CslName[];
  "container-title"?: string;
  issued?: CslDate;
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  DOI?: string;
  URL?: string;
  abstract?: string;
}

/** Minimal library-row shape used to backfill a CSL item when csl_json is null. */
export interface WorkLike {
  id: string;
  title: string;
  doi?: string | null;
  year?: number | null;
  publicationDate?: string | null;
  venueName?: string | null;
  type?: string | null;
  authorNames?: string[];
  cslJson?: unknown;
}

const TYPE_MAP: Record<string, string> = {
  article: "article-journal",
  "journal-article": "article-journal",
  preprint: "article-journal",
  "posted-content": "article-journal",
  "proceedings-article": "paper-conference",
  conference: "paper-conference",
  book: "book",
  "book-chapter": "chapter",
};

/**
 * Produces a clean CslItem for a library work. Prefers the stored CSL-JSON
 * (Crossref's payload is already CSL-shaped); otherwise synthesizes one from the
 * normalized columns so every work is always exportable.
 */
export function toCslItem(work: WorkLike): CslItem {
  const raw = (work.cslJson ?? null) as Record<string, unknown> | null;
  if (raw && typeof raw === "object" && (raw.title || raw.author)) {
    return normalizeRawCsl(raw, work);
  }
  return synthesize(work);
}

function normalizeRawCsl(raw: Record<string, unknown>, work: WorkLike): CslItem {
  const title = pickString(raw.title) ?? work.title;
  const container = pickString(raw["container-title"]) ?? work.venueName ?? undefined;
  return {
    id: work.id,
    type: mapType((raw.type as string) ?? work.type ?? "article"),
    title,
    author: normalizeNames(raw.author),
    editor: normalizeNames(raw.editor),
    "container-title": container,
    issued: normalizeDate(raw.issued) ?? yearDate(work.year),
    volume: pickString(raw.volume),
    issue: pickString(raw.issue),
    page: pickString(raw.page),
    publisher: pickString(raw.publisher),
    DOI: pickString(raw.DOI) ?? work.doi ?? undefined,
    URL: pickString(raw.URL),
    abstract: pickString(raw.abstract),
  };
}

function synthesize(work: WorkLike): CslItem {
  return {
    id: work.id,
    type: mapType(work.type ?? "article"),
    title: work.title,
    author: (work.authorNames ?? []).map(splitName),
    "container-title": work.venueName ?? undefined,
    issued: yearDate(work.year) ?? rawDate(work.publicationDate),
    DOI: work.doi ?? undefined,
  };
}

function mapType(t: string): string {
  return TYPE_MAP[t] ?? t ?? "article-journal";
}

/** "Ashish Vaswani" → { family: "Vaswani", given: "Ashish" }. */
export function splitName(displayName: string): CslName {
  const name = displayName.trim();
  if (!name) return { literal: "" };
  const parts = name.split(/\s+/);
  if (parts.length === 1) return { family: parts[0] };
  return { given: parts.slice(0, -1).join(" "), family: parts[parts.length - 1] };
}

function normalizeNames(value: unknown): CslName[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .map((n): CslName | null => {
      if (typeof n !== "object" || n === null) return null;
      const o = n as Record<string, unknown>;
      const family = pickString(o.family);
      const given = pickString(o.given);
      const literal = pickString(o.literal);
      if (!family && !given && !literal) return null;
      return { family, given, literal };
    })
    .filter((n): n is CslName => n !== null);
  return names.length ? names : undefined;
}

function normalizeDate(value: unknown): CslDate | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const o = value as Record<string, unknown>;
  const dp = o["date-parts"];
  if (Array.isArray(dp) && Array.isArray(dp[0])) {
    return { "date-parts": dp as number[][] };
  }
  const raw = pickString(o.raw);
  return raw ? { raw } : undefined;
}

function yearDate(year?: number | null): CslDate | undefined {
  return year ? { "date-parts": [[year]] } : undefined;
}

function rawDate(iso?: string | null): CslDate | undefined {
  return iso ? { raw: iso } : undefined;
}

/** CSL titles/containers are sometimes arrays (Crossref) — take the first. */
function pickString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

/** Year extracted from a CSL date, when present. */
export function cslYear(item: CslItem): number | undefined {
  const dp = item.issued?.["date-parts"]?.[0]?.[0];
  if (typeof dp === "number") return dp;
  const raw = item.issued?.raw;
  const m = raw?.match(/\b(\d{4})\b/);
  return m ? Number(m[1]) : undefined;
}
