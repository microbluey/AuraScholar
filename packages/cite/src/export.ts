// Engine-independent exporters: CSL-JSON, BibTeX, RIS. These are the formats
// every reference manager (Zotero, EndNote, Mendeley) and LaTeX/pandoc workflow
// consume, so they cover the "write" handoff without needing a CSL processor.
import { cslYear, type CslItem, type CslName } from "./csl.js";
import { normalizeDoi } from "./doi.js";

export function toCslJson(items: CslItem[]): string {
  return JSON.stringify(items.map(normalizeExportItem), null, 2);
}

function normalizeExportItem(item: CslItem): CslItem {
  const doi = item.DOI ? normalizeDoi(item.DOI) : null;
  return doi ? { ...item, DOI: doi } : omitDoi(item);
}

function omitDoi(item: CslItem): CslItem {
  const { DOI: _doi, ...rest } = item;
  return rest;
}

// --- BibTeX -----------------------------------------------------------------

const BIBTEX_TYPE: Record<string, string> = {
  "article-journal": "article",
  "paper-conference": "inproceedings",
  book: "book",
  chapter: "incollection",
};

export function toBibTeX(items: CslItem[]): string {
  if (items.length === 0) return "";
  const keys = uniqueBibtexKeys(items);
  return items.map((item, index) => bibtexEntry(item, keys[index]!)).join("\n\n") + "\n";
}

function bibtexEntry(item: CslItem, key: string): string {
  const type = BIBTEX_TYPE[item.type] ?? "misc";
  const fields: Array<[string, string]> = [];
  if (item.title) fields.push(["title", `{${item.title}}`]);
  if (item.author?.length) fields.push(["author", item.author.map(bibName).join(" and ")]);
  if (item.editor?.length) fields.push(["editor", item.editor.map(bibName).join(" and ")]);
  const container = item["container-title"];
  if (container) {
    fields.push([type === "inproceedings" ? "booktitle" : "journal", `{${container}}`]);
  }
  const year = cslYear(item);
  if (year) fields.push(["year", String(year)]);
  if (item.volume) fields.push(["volume", item.volume]);
  if (item.issue) fields.push(["number", item.issue]);
  if (item.page) fields.push(["pages", item.page.replace(/-(?!-)/, "--")]);
  if (item.publisher) fields.push(["publisher", `{${item.publisher}}`]);
  if (item["publisher-place"]) fields.push(["address", `{${item["publisher-place"]}}`]);
  if (item.edition) fields.push(["edition", `{${item.edition}}`]);
  if (item.ISSN) fields.push(["issn", item.ISSN]);
  if (item.ISBN) fields.push(["isbn", item.ISBN]);
  if (item.language) fields.push(["language", `{${item.language}}`]);
  const doi = item.DOI ? normalizeDoi(item.DOI) : null;
  if (doi) fields.push(["doi", doi]);
  if (item.PMID) fields.push(["pmid", item.PMID]);
  if (item.URL) fields.push(["url", item.URL]);

  const body = fields
    .map(([k, v]) => [k, bibFieldValue(v)] as const)
    .filter((field): field is readonly [string, string] => field[1].length > 0)
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(",\n");
  return `@${type}{${key},\n${body}\n}`;
}

function bibFieldValue(value: string): string {
  // bibName/year are already plain; titles arrive pre-wrapped in {} — unwrap one
  // layer so we don't double-brace, while keeping inner braces intact.
  const unwrapped = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  return collapseFieldWhitespace(collapseFieldWhitespace(unwrapped).replace(/[{}]/g, " "));
}

function collapseFieldWhitespace(value: string): string {
  return replaceAsciiControls(value, " ").replace(/\s+/g, " ").trim();
}

function replaceAsciiControls(value: string, replacement: string): string {
  return Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? replacement : char;
  }).join("");
}

function bibName(n: CslName): string {
  if (n.literal) return `{${n.literal}}`;
  return [n.family, n.given].filter(Boolean).join(", ");
}

function bibtexKey(item: CslItem): string {
  const first = item.author?.[0];
  const surname = (first?.family ?? first?.literal ?? "anon")
    .split(/\s+/)
    .pop()!
    .replace(/[^A-Za-z0-9]/g, "");
  const year = cslYear(item) ?? "";
  const word = (item.title ?? "")
    .split(/\s+/)
    .find((w) => w.length > 3)
    ?.replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();
  const semanticKey = `${surname.toLowerCase()}${year}${word ? word : ""}`;
  return sanitizeBibtexKey(semanticKey) || sanitizeBibtexKey(item.id) || "ref";
}

function uniqueBibtexKeys(items: CslItem[]): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = bibtexKey(item);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  });
}

function sanitizeBibtexKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_:-]/g, "");
}

// --- RIS ---------------------------------------------------------------------

const RIS_TYPE: Record<string, string> = {
  "article-journal": "JOUR",
  "paper-conference": "CPAPER",
  book: "BOOK",
  chapter: "CHAP",
};

export function toRIS(items: CslItem[]): string {
  if (items.length === 0) return "";
  return items.map(risEntry).join("\n") + "\n";
}

function risEntry(item: CslItem): string {
  const lines: string[] = [];
  lines.push(`TY  - ${RIS_TYPE[item.type] ?? "GEN"}`);
  for (const a of item.author ?? []) pushRisLine(lines, "AU", risName(a));
  for (const e of item.editor ?? []) pushRisLine(lines, "ED", risName(e));
  if (item.title) pushRisLine(lines, "TI", item.title);
  if (item["container-title"]) pushRisLine(lines, "T2", item["container-title"]);
  const year = cslYear(item);
  if (year) pushRisLine(lines, "PY", String(year));
  if (item.volume) pushRisLine(lines, "VL", item.volume);
  if (item.issue) pushRisLine(lines, "IS", item.issue);
  if (item.page) {
    const [sp, ep] = risPageRange(item.page);
    if (sp) pushRisLine(lines, "SP", sp);
    if (ep) pushRisLine(lines, "EP", ep);
  }
  if (item.publisher) pushRisLine(lines, "PB", item.publisher);
  if (item["publisher-place"]) pushRisLine(lines, "CY", item["publisher-place"]);
  if (item.edition) pushRisLine(lines, "ET", item.edition);
  if (item.ISSN) pushRisLine(lines, "SN", item.ISSN);
  else if (item.ISBN) pushRisLine(lines, "SN", item.ISBN);
  if (item.language) pushRisLine(lines, "LA", item.language);
  const doi = item.DOI ? normalizeDoi(item.DOI) : null;
  if (doi) pushRisLine(lines, "DO", doi);
  if (item.PMID) pushRisLine(lines, "AN", `PMID:${item.PMID}`);
  if (item.URL) pushRisLine(lines, "UR", item.URL);
  if (item.abstract) pushRisLine(lines, "AB", item.abstract);
  lines.push("ER  - ");
  return lines.join("\n");
}

function pushRisLine(lines: string[], tag: string, value: string): void {
  const clean = collapseFieldWhitespace(value);
  if (clean) lines.push(`${tag}  - ${clean}`);
}

function risPageRange(page: string): [string, string | undefined] {
  const parts = page
    .split(/[-–]+/)
    .map((part) => collapseFieldWhitespace(part))
    .filter(Boolean);
  if (parts.length === 0) return ["", undefined];
  if (parts.length === 1) return [parts[0]!, undefined];
  return [parts[0]!, parts[parts.length - 1]!];
}

function risName(n: CslName): string {
  if (n.literal) return n.literal;
  return [n.family, n.given].filter(Boolean).join(", ");
}
