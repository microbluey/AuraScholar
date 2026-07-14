// Bibliography/citation formatter for the common styles young researchers use.
// This is a focused, dependency-free implementation — NOT a full CSL processor.
// It is deliberately kept behind formatBibliography()/formatCitation() so a
// citeproc-js engine (with the thousands of upstream CSL styles) can be slotted
// in later without changing call sites. Styles covered: APA 7th, GB/T 7714,
// IEEE, Vancouver, MLA, Nature, Chicago.
import { cslYear, type CslItem, type CslName } from "./csl.js";
import { normalizedDoiUrl } from "./doi.js";

export interface CitationStyle {
  id: string;
  label: string;
}

export const STYLES: CitationStyle[] = [
  { id: "apa", label: "APA 7th" },
  { id: "gb7714", label: "GB/T 7714-2015" },
  { id: "ieee", label: "IEEE" },
  { id: "vancouver", label: "Vancouver" },
  { id: "mla", label: "MLA 9th" },
  { id: "nature", label: "Nature" },
  { id: "chicago", label: "Chicago (note)" },
];

/** Numbered reference list for a set of items (order = input order). */
export function formatBibliography(items: CslItem[], styleId: string): string[] {
  const numbered = styleId === "ieee" || styleId === "vancouver" || styleId === "nature";
  return items.map((it, i) => {
    const entry = formatEntry(it, styleId);
    return numbered ? `[${i + 1}] ${entry}` : entry;
  });
}

/** A single formatted reference (for "copy as reference"). */
export function formatEntry(item: CslItem, styleId: string): string {
  switch (styleId) {
    case "apa":
      return apa(item);
    case "gb7714":
      return gb7714(item);
    case "ieee":
      return ieee(item);
    case "vancouver":
      return vancouver(item);
    case "mla":
      return mla(item);
    case "nature":
      return nature(item);
    case "chicago":
      return chicago(item);
    default:
      return apa(item);
  }
}

/** In-text citation marker, e.g. "(Vaswani et al., 2017)" or "[1]". */
export function formatCitation(item: CslItem, styleId: string, index?: number): string {
  if (styleId === "ieee" || styleId === "vancouver" || styleId === "nature") {
    return index != null ? `[${index}]` : "[#]";
  }
  const first = item.author?.[0];
  const sur = surname(first) || "Anon";
  const y = cslYear(item) ?? "n.d.";
  const etal = (item.author?.length ?? 0) > 1 ? " et al." : "";
  return `(${sur}${etal}, ${y})`;
}

// --- per-style entry formatters ---------------------------------------------

function apa(it: CslItem): string {
  const authors = apaAuthors(it.author ?? []);
  const y = cslYear(it);
  const year = y ? ` (${y}).` : " (n.d.).";
  const title = it.title ? ` ${it.title}.` : "";
  const venue = it["container-title"] ? ` *${it["container-title"]}*` : "";
  const vol = it.volume ? `, ${it.volume}` : "";
  const issue = it.issue ? `(${it.issue})` : "";
  const pages = it.page ? `, ${it.page}` : "";
  const doi = it.DOI ? normalizedDoiUrl(it.DOI) : null;
  const doiText = doi ? ` ${doi}` : "";
  return `${authors}${year}${title}${venue}${vol}${issue}${pages}.${doiText}`.trim();
}

function gb7714(it: CslItem): string {
  const authors = authorList(it.author ?? [], 3, "等", (n) => surname(n) + initials(n, ""));
  const marker = gbTypeMarker(it.type);
  const title = it.title ? `${it.title}${marker}` : "";
  const venue = it["container-title"] ? ` ${it["container-title"]}` : "";
  const y = cslYear(it);
  const year = y ? `, ${y}` : "";
  const vol = it.volume ? `, ${it.volume}` : "";
  const issue = it.issue ? `(${it.issue})` : "";
  const pages = it.page ? `: ${it.page}` : "";
  return `${authors}. ${title}.${venue}${year}${vol}${issue}${pages}.`.trim();
}

function ieee(it: CslItem): string {
  const authors = ieeeAuthors(it.author ?? []);
  const title = it.title ? ` "${it.title},"` : "";
  const venue = it["container-title"] ? ` *${it["container-title"]}*,` : "";
  const vol = it.volume ? ` vol. ${it.volume},` : "";
  const issue = it.issue ? ` no. ${it.issue},` : "";
  const pages = it.page ? ` pp. ${it.page},` : "";
  const y = cslYear(it);
  const year = y ? ` ${y}.` : "";
  return `${authors}${title}${venue}${vol}${issue}${pages}${year}`.trim();
}

function vancouver(it: CslItem): string {
  const authors = authorList(it.author ?? [], 6, "et al.", (n) => surname(n) + initials(n, ""));
  const title = it.title ? ` ${it.title}.` : "";
  const venue = it["container-title"] ? ` ${it["container-title"]}.` : "";
  const y = cslYear(it);
  const year = y ? ` ${y}` : "";
  const vol = it.volume ? `;${it.volume}` : "";
  const issue = it.issue ? `(${it.issue})` : "";
  const pages = it.page ? `:${it.page}` : "";
  return `${authors}.${title}${venue}${year}${vol}${issue}${pages}.`.trim();
}

function mla(it: CslItem): string {
  const a = it.author ?? [];
  const lead =
    a.length === 0
      ? ""
      : a.length === 1
        ? `${surname(a[0]!)}, ${given(a[0]!)}.`
        : `${surname(a[0]!)}, ${given(a[0]!)}, et al.`;
  const title = it.title ? ` "${it.title}."` : "";
  const venue = it["container-title"] ? ` *${it["container-title"]}*,` : "";
  const vol = it.volume ? ` vol. ${it.volume},` : "";
  const issue = it.issue ? ` no. ${it.issue},` : "";
  const y = cslYear(it);
  const year = y ? ` ${y},` : "";
  const pages = it.page ? ` pp. ${it.page}.` : "";
  return `${lead}${title}${venue}${vol}${issue}${year}${pages}`.trim();
}

function nature(it: CslItem): string {
  const authors = authorList(it.author ?? [], 5, "et al.", (n) => surname(n) + initials(n, "."));
  const title = it.title ? ` ${it.title}.` : "";
  const venue = it["container-title"] ? ` *${it["container-title"]}*` : "";
  const vol = it.volume ? ` **${it.volume}**,` : "";
  const pages = it.page ? ` ${it.page}` : "";
  const y = cslYear(it);
  const year = y ? ` (${y}).` : ".";
  return `${authors}${title}${venue}${vol}${pages}${year}`.trim();
}

function chicago(it: CslItem): string {
  const a = it.author ?? [];
  const lead =
    a.length === 0
      ? ""
      : `${surname(a[0]!)}, ${given(a[0]!)}${a.length > 1 ? ", et al." : ""}.`;
  const title = it.title ? ` "${it.title}."` : "";
  const venue = it["container-title"] ? ` *${it["container-title"]}*` : "";
  const vol = it.volume ? ` ${it.volume}` : "";
  const issue = it.issue ? `, no. ${it.issue}` : "";
  const y = cslYear(it);
  const year = y ? ` (${y})` : "";
  const pages = it.page ? `: ${it.page}` : "";
  return `${lead}${title}${venue}${vol}${issue}${year}${pages}.`.trim();
}

// --- author helpers ----------------------------------------------------------

function apaAuthors(names: CslName[]): string {
  if (names.length === 0) return "";
  const fmt = (n: CslName) => `${surname(n)},${initials(n, ".")}`;
  if (names.length === 1) return fmt(names[0]!);
  if (names.length <= 20) {
    return names.slice(0, -1).map(fmt).join(", ") + ", & " + fmt(names[names.length - 1]!);
  }
  return names.slice(0, 19).map(fmt).join(", ") + ", ... " + fmt(names[names.length - 1]!);
}

function ieeeAuthors(names: CslName[]): string {
  if (names.length === 0) return "";
  const fmt = (n: CslName) => `${initials(n, ".").trim()} ${surname(n)}`.trim();
  if (names.length === 1) return fmt(names[0]!);
  if (names.length <= 6) {
    return names.slice(0, -1).map(fmt).join(", ") + " and " + fmt(names[names.length - 1]!);
  }
  return fmt(names[0]!) + " et al.";
}

function authorList(
  names: CslName[],
  max: number,
  etal: string,
  fmt: (n: CslName) => string,
): string {
  if (names.length === 0) return "";
  if (names.length <= max) return names.map(fmt).join(", ");
  return names.slice(0, max).map(fmt).join(", ") + ", " + etal;
}

function surname(n?: CslName): string {
  if (!n) return "";
  return (n.family ?? n.literal ?? "").trim();
}

function given(n: CslName): string {
  return (n.given ?? "").trim();
}

/** Initials from given names, joined with `sep` ("." → "A.B.", "" → "AB"). */
function initials(n: CslName, sep: string): string {
  const g = (n.given ?? "").trim();
  if (!g) return "";
  const parts = g
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase());
  if (parts.length === 0) return "";
  return " " + parts.join(sep) + (sep ? "" : "");
}

function gbTypeMarker(type: string): string {
  switch (type) {
    case "article-journal":
      return "[J]";
    case "paper-conference":
      return "[C]";
    case "book":
      return "[M]";
    case "chapter":
      return "[M]";
    default:
      return "[J]";
  }
}
