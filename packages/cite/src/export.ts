// Engine-independent exporters: CSL-JSON, BibTeX, RIS. These are the formats
// every reference manager (Zotero, EndNote, Mendeley) and LaTeX/pandoc workflow
// consume, so they cover the "write" handoff without needing a CSL processor.
import { cslYear, type CslItem, type CslName } from "./csl";

export function toCslJson(items: CslItem[]): string {
  return JSON.stringify(items, null, 2);
}

// --- BibTeX -----------------------------------------------------------------

const BIBTEX_TYPE: Record<string, string> = {
  "article-journal": "article",
  "paper-conference": "inproceedings",
  book: "book",
  chapter: "incollection",
};

export function toBibTeX(items: CslItem[]): string {
  return items.map(bibtexEntry).join("\n\n") + "\n";
}

function bibtexEntry(item: CslItem): string {
  const type = BIBTEX_TYPE[item.type] ?? "misc";
  const key = bibtexKey(item);
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
  if (item.DOI) fields.push(["doi", item.DOI]);
  if (item.URL) fields.push(["url", item.URL]);

  const body = fields.map(([k, v]) => `  ${k} = {${stripBraces(v)}}`).join(",\n");
  return `@${type}{${key},\n${body}\n}`;
}

function stripBraces(v: string): string {
  // bibName/year are already plain; titles arrive pre-wrapped in {} — unwrap one
  // layer so we don't double-brace, while keeping inner braces intact.
  if (v.startsWith("{") && v.endsWith("}")) return v.slice(1, -1);
  return v;
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
  return `${surname.toLowerCase()}${year}${word ? word : ""}` || item.id;
}

// --- RIS ---------------------------------------------------------------------

const RIS_TYPE: Record<string, string> = {
  "article-journal": "JOUR",
  "paper-conference": "CPAPER",
  book: "BOOK",
  chapter: "CHAP",
};

export function toRIS(items: CslItem[]): string {
  return items.map(risEntry).join("\n") + "\n";
}

function risEntry(item: CslItem): string {
  const lines: string[] = [];
  lines.push(`TY  - ${RIS_TYPE[item.type] ?? "GEN"}`);
  for (const a of item.author ?? []) lines.push(`AU  - ${risName(a)}`);
  for (const e of item.editor ?? []) lines.push(`ED  - ${risName(e)}`);
  if (item.title) lines.push(`TI  - ${item.title}`);
  if (item["container-title"]) lines.push(`T2  - ${item["container-title"]}`);
  const year = cslYear(item);
  if (year) lines.push(`PY  - ${year}`);
  if (item.volume) lines.push(`VL  - ${item.volume}`);
  if (item.issue) lines.push(`IS  - ${item.issue}`);
  if (item.page) {
    const [sp, ep] = item.page.split(/[-–]/);
    if (sp) lines.push(`SP  - ${sp.trim()}`);
    if (ep) lines.push(`EP  - ${ep.trim()}`);
  }
  if (item.publisher) lines.push(`PB  - ${item.publisher}`);
  if (item["publisher-place"]) lines.push(`CY  - ${item["publisher-place"]}`);
  if (item.edition) lines.push(`ET  - ${item.edition}`);
  if (item.ISSN) lines.push(`SN  - ${item.ISSN}`);
  else if (item.ISBN) lines.push(`SN  - ${item.ISBN}`);
  if (item.language) lines.push(`LA  - ${item.language}`);
  if (item.DOI) lines.push(`DO  - ${item.DOI}`);
  if (item.URL) lines.push(`UR  - ${item.URL}`);
  if (item.abstract) lines.push(`AB  - ${item.abstract}`);
  lines.push("ER  - ");
  return lines.join("\n");
}

function risName(n: CslName): string {
  if (n.literal) return n.literal;
  return [n.family, n.given].filter(Boolean).join(", ");
}
