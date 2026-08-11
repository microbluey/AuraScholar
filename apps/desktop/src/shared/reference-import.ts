// Pure reference-import transformation shared by the renderer preview and the
// main-process persistence command. It intentionally has no database or
// Electron dependencies, so previewing never opens a persistence capability.
import { cslYear, parseReferences, type CslItem, type ImportFormat } from "@aurascholar/cite";
import type { WorkInput } from "@aurascholar/db/repos/works";

export function parseImportableReferences(text: string, format?: ImportFormat): CslItem[] {
  return parseReferences(text, format).filter(hasImportableReferenceContent);
}

export function referenceItemsToWorkInputs(items: readonly CslItem[]): WorkInput[] {
  return items.map(toWorkInput);
}

/** Parse once, then expose both preview records and persistence-ready inputs. */
export function parseReferenceImport(
  text: string,
  format?: ImportFormat,
): { items: CslItem[]; workInputs: WorkInput[] } {
  const items = parseImportableReferences(text, format);
  return { items, workInputs: referenceItemsToWorkInputs(items) };
}

function hasImportableReferenceContent(item: CslItem): boolean {
  return Boolean(
    textValue(item.title) ||
    cslDoi(item) ||
    cslPmid(item) ||
    textValue(item.URL) ||
    textValue(item.ISBN) ||
    textValue(item.ISSN),
  );
}

function textValue(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function cslDoi(item: CslItem): string | undefined {
  return textValue(item.DOI)
    ?.toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
}

function cslPmid(item: CslItem): string | undefined {
  return textValue(item.PMID);
}

function cslTitle(item: CslItem): string {
  const doi = cslDoi(item);
  const pmid = cslPmid(item);
  const url = textValue(item.URL);
  const isbn = textValue(item.ISBN);
  const issn = textValue(item.ISSN);
  return (
    textValue(item.title) ??
    (doi ? `DOI ${doi}` : undefined) ??
    (pmid ? `PMID ${pmid}` : undefined) ??
    (url ? `URL ${url}` : undefined) ??
    (isbn ? `ISBN ${isbn}` : undefined) ??
    (issn ? `ISSN ${issn}` : undefined) ??
    "(无标题)"
  );
}

function toWorkInput(item: CslItem): WorkInput {
  const year = cslYear(item);
  const authors = (item.author ?? []).map((author, position) => ({
    displayName: [author.given, author.family].filter(Boolean).join(" ") || author.literal || "",
    orcid: undefined,
    position,
    role: "author" as const,
  }));
  const editors = (item.editor ?? []).map((author, index) => ({
    displayName: [author.given, author.family].filter(Boolean).join(" ") || author.literal || "",
    orcid: undefined,
    position: authors.length + index,
    role: "editor" as const,
  }));
  return {
    doi: cslDoi(item),
    pmid: cslPmid(item),
    title: cslTitle(item),
    abstract: item.abstract,
    year,
    venueName: item["container-title"],
    type: cslTypeToWorkType(item.type),
    volume: item.volume,
    issue: item.issue,
    pages: item.page,
    publisher: item.publisher,
    placePublished: item["publisher-place"],
    edition: item.edition,
    issn: item.ISSN,
    isbn: item.ISBN,
    language: item.language,
    url: item.URL,
    cslJson: item,
    authors: [...authors, ...editors],
  };
}

function cslTypeToWorkType(type: string): string {
  switch (type) {
    case "paper-conference":
      return "conference";
    case "book":
      return "book";
    case "chapter":
      return "book-chapter";
    default:
      return "article";
  }
}
