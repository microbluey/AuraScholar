// Importers: parse the formats reference managers export (BibTeX, RIS, CSL-JSON)
// into CslItems. Zotero/EndNote/Mendeley all export at least one of these, so
// these three cover library migration. Parsers are intentionally lenient —
// real-world .bib/.ris files are messy.
import type { CslItem, CslName } from "./csl";
import { splitName } from "./csl";

export type ImportFormat = "bibtex" | "ris" | "csljson";

/** Sniffs the format from content; falls back to bibtex. */
export function detectFormat(text: string): ImportFormat {
  const t = text.trimStart();
  if (t.startsWith("[") || t.startsWith("{")) return "csljson";
  if (/^TY {2}- /m.test(t)) return "ris";
  if (/^@\w+\s*\{/m.test(t)) return "bibtex";
  return "bibtex";
}

export function parseReferences(text: string, format?: ImportFormat): CslItem[] {
  const fmt = format ?? detectFormat(text);
  switch (fmt) {
    case "csljson":
      return parseCslJson(text);
    case "ris":
      return parseRis(text);
    default:
      return parseBibTeX(text);
  }
}

// --- CSL-JSON ----------------------------------------------------------------

function parseCslJson(text: string): CslItem[] {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : [data];
  return arr.map((raw, i) => ({
    id: String(raw.id ?? `import-${i}`),
    type: String(raw.type ?? "article-journal"),
    title: pickStr(raw.title),
    author: Array.isArray(raw.author) ? (raw.author as CslName[]) : undefined,
    editor: Array.isArray(raw.editor) ? (raw.editor as CslName[]) : undefined,
    "container-title": pickStr(raw["container-title"]),
    issued: raw.issued,
    volume: pickStr(raw.volume),
    issue: pickStr(raw.issue),
    page: pickStr(raw.page),
    publisher: pickStr(raw.publisher),
    DOI: pickStr(raw.DOI),
    URL: pickStr(raw.URL),
    abstract: pickStr(raw.abstract),
  }));
}

// --- BibTeX ------------------------------------------------------------------

const BIBTEX_TO_CSL: Record<string, string> = {
  article: "article-journal",
  inproceedings: "paper-conference",
  conference: "paper-conference",
  book: "book",
  incollection: "chapter",
  inbook: "chapter",
};

export function parseBibTeX(text: string): CslItem[] {
  const items: CslItem[] = [];
  // Match @type{key, ...fields...} blocks by balancing braces.
  const re = /@(\w+)\s*\{\s*([^,]*),/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const type = m[1]!.toLowerCase();
    if (type === "comment" || type === "preamble" || type === "string") continue;
    const key = m[2]!.trim();
    const bodyStart = re.lastIndex;
    const bodyEnd = matchBrace(text, m.index + m[0].lastIndexOf("{"));
    if (bodyEnd < 0) continue;
    const body = text.slice(bodyStart, bodyEnd);
    re.lastIndex = bodyEnd + 1;
    items.push(bibEntryToCsl(type, key, parseBibFields(body)));
  }
  return items;
}

function parseBibFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    const eq = body.indexOf("=", i);
    if (eq < 0) break;
    const name = body.slice(i, eq).replace(/[\s,]/g, "").toLowerCase();
    i = eq + 1;
    while (i < body.length && /\s/.test(body[i]!)) i++;
    let value: string;
    if (body[i] === "{") {
      const end = matchBrace(body, i);
      value = body.slice(i + 1, end);
      i = end + 1;
    } else if (body[i] === '"') {
      const end = body.indexOf('"', i + 1);
      value = body.slice(i + 1, end);
      i = end + 1;
    } else {
      let end = i;
      while (end < body.length && body[end] !== "," && body[end] !== "\n") end++;
      value = body.slice(i, end);
      i = end;
    }
    if (name) fields[name] = cleanBibValue(value);
    // skip trailing comma/whitespace
    while (i < body.length && /[\s,]/.test(body[i]!)) i++;
  }
  return fields;
}

function bibEntryToCsl(type: string, key: string, f: Record<string, string>): CslItem {
  const year = f.year ? Number(f.year.match(/\d{4}/)?.[0]) : undefined;
  return {
    id: key || `bib-${Math.abs(hash(JSON.stringify(f)))}`,
    type: BIBTEX_TO_CSL[type] ?? "article-journal",
    title: f.title,
    author: f.author ? parseBibNames(f.author) : undefined,
    editor: f.editor ? parseBibNames(f.editor) : undefined,
    "container-title": f.journal ?? f.booktitle ?? undefined,
    issued: year ? { "date-parts": [[year]] } : undefined,
    volume: f.volume,
    issue: f.number,
    page: f.pages?.replace(/--/g, "-"),
    publisher: f.publisher,
    DOI: f.doi,
    URL: f.url,
    abstract: f.abstract,
  };
}

/** BibTeX author field: "Family, Given and Family, Given and ...". */
function parseBibNames(value: string): CslName[] {
  return value
    .split(/\s+and\s+/i)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      if (raw.includes(",")) {
        const [family, given] = raw.split(",");
        return { family: family!.trim(), given: given?.trim() || undefined };
      }
      return splitName(raw);
    });
}

function cleanBibValue(v: string): string {
  return v
    .replace(/[{}]/g, "")
    .replace(/\\&/g, "&")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- RIS ---------------------------------------------------------------------

const RIS_TO_CSL: Record<string, string> = {
  JOUR: "article-journal",
  CPAPER: "paper-conference",
  CONF: "paper-conference",
  BOOK: "book",
  CHAP: "chapter",
};

export function parseRis(text: string): CslItem[] {
  const items: CslItem[] = [];
  let cur: Record<string, string[]> | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9])  - ?(.*)$/);
    if (!m) continue;
    const tag = m[1]!;
    const val = m[2]!.trim();
    if (tag === "TY") {
      cur = { TY: [val] };
      continue;
    }
    if (!cur) continue;
    if (tag === "ER") {
      items.push(risToCsl(cur));
      cur = null;
      continue;
    }
    (cur[tag] ??= []).push(val);
  }
  if (cur) items.push(risToCsl(cur));
  return items;
}

function risToCsl(f: Record<string, string[]>): CslItem {
  const first = (t: string) => f[t]?.[0];
  const year = (first("PY") ?? first("Y1"))?.match(/\d{4}/)?.[0];
  const sp = first("SP");
  const ep = first("EP");
  const page = sp && ep ? `${sp}-${ep}` : sp ?? undefined;
  return {
    id: first("DO") ?? first("ID") ?? `ris-${Math.abs(hash(JSON.stringify(f)))}`,
    type: RIS_TO_CSL[first("TY") ?? ""] ?? "article-journal",
    title: first("TI") ?? first("T1"),
    author: (f.AU ?? f.A1 ?? []).map(risName),
    editor: (f.ED ?? f.A2 ?? []).map(risName),
    "container-title": first("T2") ?? first("JO") ?? first("JF"),
    issued: year ? { "date-parts": [[Number(year)]] } : undefined,
    volume: first("VL"),
    issue: first("IS"),
    page,
    publisher: first("PB"),
    DOI: first("DO"),
    URL: first("UR"),
    abstract: first("AB") ?? first("N2"),
  };
}

function risName(raw: string): CslName {
  if (raw.includes(",")) {
    const [family, given] = raw.split(",");
    return { family: family!.trim(), given: given?.trim() || undefined };
  }
  return splitName(raw);
}

// --- helpers -----------------------------------------------------------------

/** Returns the index of the matching `}` for the `{` at `open`, or -1. */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function pickStr(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
