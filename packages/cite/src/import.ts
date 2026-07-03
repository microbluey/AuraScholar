// Importers: parse the formats reference managers export (BibTeX, RIS,
// PubMed NBIB, EndNote tagged ENW, CSL-JSON) into CslItems. Parsers are
// intentionally lenient — real-world reference files are messy.
import type { CslItem, CslName } from "./csl";
import { splitName } from "./csl";

export type ImportFormat = "bibtex" | "ris" | "nbib" | "enw" | "csljson";

/** Sniffs the format from content; falls back to bibtex. */
export function detectFormat(text: string): ImportFormat {
  const t = text.trimStart();
  if (t.startsWith("[") || t.startsWith("{")) return "csljson";
  if (/^TY {2}- /m.test(t)) return "ris";
  if (/^PMID- /m.test(t)) return "nbib";
  if (/^%0\s+/m.test(t)) return "enw";
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
    case "nbib":
      return parseNbib(text);
    case "enw":
      return parseEnw(text);
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
    PMID: pickStr(raw.PMID),
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
    const name = body
      .slice(i, eq)
      .replace(/\\r\\n|\\n|\\r/g, "")
      .replace(/[\s,]/g, "")
      .toLowerCase();
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
    "publisher-place": f.address,
    edition: f.edition,
    ISSN: f.issn,
    ISBN: f.isbn,
    language: f.language,
    DOI: f.doi,
    PMID: f.pmid,
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
    const m = line.match(/^([A-Z][A-Z0-9]) {2}- ?(.*)$/);
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
    "publisher-place": first("CY"),
    edition: first("ET"),
    // SN holds ISSN or ISBN depending on type; route by what looks like an ISBN.
    ISSN: snAs(first("SN"), "issn"),
    ISBN: snAs(first("SN"), "isbn"),
    language: first("LA"),
    DOI: first("DO"),
    PMID: risPmid(f),
    URL: first("UR"),
    abstract: first("AB") ?? first("N2"),
  };
}

function risPmid(f: Record<string, string[]>): string | undefined {
  const raw = f.AN?.find((value) => /(?:^|\b)PMID[:\s]/i.test(value)) ?? f.ID?.[0];
  return raw?.replace(/^PMID[:\s]*/i, "").trim() || undefined;
}

/** RIS SN is overloaded (ISSN or ISBN); classify by shape. */
function snAs(sn: string | undefined, want: "issn" | "isbn"): string | undefined {
  if (!sn) return undefined;
  const isIsbn = /^(97[89][\d-]{10,}|[\d-]{10,13}[\dxX])$/.test(sn.replace(/\s/g, ""));
  return (want === "isbn") === isIsbn ? sn : undefined;
}

function risName(raw: string): CslName {
  if (raw.includes(",")) {
    const [family, given] = raw.split(",");
    return { family: family!.trim(), given: given?.trim() || undefined };
  }
  return splitName(raw);
}

// --- PubMed NBIB / MEDLINE ----------------------------------------------------

export function parseNbib(text: string): CslItem[] {
  const records: Array<Record<string, string[]>> = [];
  let cur: Record<string, string[]> | null = null;
  let lastTag: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      if (cur) records.push(cur);
      cur = null;
      lastTag = null;
      continue;
    }

    const m = line.match(/^([A-Z0-9]{2,4})\s*-\s?(.*)$/);
    if (m) {
      const tag = m[1]!;
      const value = m[2]!.trim();
      cur ??= {};
      (cur[tag] ??= []).push(value);
      lastTag = tag;
      continue;
    }

    if (cur && lastTag && /^\s+/.test(line)) {
      const values = cur[lastTag]!;
      values[values.length - 1] = `${values[values.length - 1]} ${line.trim()}`.trim();
    }
  }
  if (cur) records.push(cur);

  return records.map(nbibToCsl);
}

function nbibToCsl(f: Record<string, string[]>): CslItem {
  const first = (t: string) => f[t]?.[0];
  const year = (first("DP") ?? first("DEP") ?? first("DA"))?.match(/\d{4}/)?.[0];
  const doi = nbibDoi(f);
  const pages = first("PG")?.replace(/--/g, "-");
  return {
    id: first("PMID") ?? doi ?? `nbib-${Math.abs(hash(JSON.stringify(f)))}`,
    type: "article-journal",
    title: cleanNbibTitle(first("TI") ?? first("BTI")),
    author: (f.FAU ?? f.AU ?? []).map(risName),
    editor: (f.ED ?? []).map(risName),
    "container-title": first("JT") ?? first("TA") ?? first("JID"),
    issued: year ? { "date-parts": [[Number(year)]] } : undefined,
    volume: first("VI"),
    issue: first("IP"),
    page: pages,
    publisher: first("PB"),
    "publisher-place": first("PL"),
    ISSN: first("IS"),
    language: first("LA"),
    DOI: doi,
    PMID: first("PMID"),
    URL: first("URL") ?? (first("PMID") ? `https://pubmed.ncbi.nlm.nih.gov/${first("PMID")}/` : undefined),
    abstract: joinSentences(f.AB),
  };
}

function nbibDoi(f: Record<string, string[]>): string | undefined {
  for (const value of [...(f.LID ?? []), ...(f.AID ?? [])]) {
    const doi = value.match(/10\.\d{4,9}\/\S+/)?.[0]?.replace(/[).,;]+$/, "");
    if (doi && /\[doi\]/i.test(value)) return doi;
  }
  return undefined;
}

function cleanNbibTitle(value: string | undefined): string | undefined {
  return value?.replace(/\s*\[[^\]]+\]\s*\.?$/, "").replace(/\.$/, "").trim() || undefined;
}

function joinSentences(values: string[] | undefined): string | undefined {
  return values?.map((value) => value.trim()).filter(Boolean).join(" ") || undefined;
}

// --- EndNote tagged ENW -------------------------------------------------------

const ENW_TO_CSL: Record<string, string> = {
  "Book": "book",
  "Book Section": "chapter",
  "Conference Paper": "paper-conference",
  "Journal Article": "article-journal",
  "Thesis": "thesis",
};

export function parseEnw(text: string): CslItem[] {
  const records: Array<Record<string, string[]>> = [];
  let cur: Record<string, string[]> | null = null;
  let lastTag: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^%([A-Z0-9@])\s?(.*)$/);
    if (m) {
      const tag = m[1]!;
      const value = m[2]!.trim();
      if (tag === "0") {
        if (cur) records.push(cur);
        cur = { "0": [value] };
      } else {
        cur ??= {};
        (cur[tag] ??= []).push(value);
      }
      lastTag = tag;
      continue;
    }

    if (cur && lastTag && line.trim()) {
      const values = cur[lastTag]!;
      values[values.length - 1] = `${values[values.length - 1]} ${line.trim()}`.trim();
    }
  }
  if (cur) records.push(cur);

  return records.map(enwToCsl);
}

function enwToCsl(f: Record<string, string[]>): CslItem {
  const first = (t: string) => f[t]?.[0];
  const refType = first("0");
  const year = first("D")?.match(/\d{4}/)?.[0];
  const pages = first("P")?.replace(/--/g, "-");
  const serial = first("@");
  return {
    id: first("R") ?? first("U") ?? `enw-${Math.abs(hash(JSON.stringify(f)))}`,
    type: ENW_TO_CSL[refType ?? ""] ?? "article-journal",
    title: first("T"),
    author: (f.A ?? []).map(risName),
    editor: (f.E ?? []).map(risName),
    "container-title": first("J") ?? first("B"),
    issued: year ? { "date-parts": [[Number(year)]] } : undefined,
    volume: first("V"),
    issue: first("N"),
    page: pages,
    publisher: first("I"),
    "publisher-place": first("C"),
    ISBN: snAs(serial, "isbn"),
    ISSN: snAs(serial, "issn"),
    DOI: first("R"),
    URL: first("U"),
    abstract: joinSentences(f.X),
  };
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
