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
  "publisher-place"?: string;
  edition?: string;
  ISSN?: string;
  ISBN?: string;
  language?: string;
  DOI?: string;
  URL?: string;
  abstract?: string;
}

/**
 * Library-row shape used to build a CSL item. Structured columns (volume,
 * publisher, …) are preferred over the raw csl_json blob when present, so
 * manual edits flow into exports. authorsDetail (with roles) takes precedence
 * over authorNames when available.
 */
export interface WorkLike {
  id: string;
  title: string;
  doi?: string | null;
  year?: number | null;
  publicationDate?: string | null;
  venueName?: string | null;
  type?: string | null;
  authorNames?: string[];
  authorsDetail?: Array<{ displayName: string; role?: string }>;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  publisher?: string | null;
  placePublished?: string | null;
  issn?: string | null;
  isbn?: string | null;
  url?: string | null;
  edition?: string | null;
  language?: string | null;
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
  const base =
    raw && typeof raw === "object" && (raw.title || raw.author)
      ? fromRawCsl(raw, work)
      : synthesize(work);
  // Structured columns (manual edits, connector-extracted fields) win over the
  // raw blob — they're the editable source of truth.
  return overlayColumns(base, work);
}

function fromRawCsl(raw: Record<string, unknown>, work: WorkLike): CslItem {
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

/** Overlays structured library columns onto a base item where they're set. */
function overlayColumns(base: CslItem, work: WorkLike): CslItem {
  const out = { ...base };
  // Author/editor split from the detailed list, when available.
  if (work.authorsDetail?.length) {
    out.author = work.authorsDetail
      .filter((a) => (a.role ?? "author") === "author")
      .map((a) => splitName(a.displayName));
    const editors = work.authorsDetail
      .filter((a) => a.role === "editor")
      .map((a) => splitName(a.displayName));
    if (editors.length) out.editor = editors;
  }
  const set = <K extends keyof CslItem>(key: K, val: CslItem[K] | null | undefined) => {
    if (val != null && val !== "") out[key] = val;
  };
  set("volume", work.volume ?? undefined);
  set("issue", work.issue ?? undefined);
  set("page", work.pages ?? undefined);
  set("publisher", work.publisher ?? undefined);
  set("publisher-place", work.placePublished ?? undefined);
  set("edition", work.edition ?? undefined);
  set("ISSN", work.issn ?? undefined);
  set("ISBN", work.isbn ?? undefined);
  set("language", work.language ?? undefined);
  set("URL", work.url ?? undefined);
  if (work.doi) out.DOI = work.doi;
  return out;
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
