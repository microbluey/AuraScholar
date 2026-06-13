// Reference-import service: parse a .bib/.ris/.json file into CSL items, map
// them to WorkInput, and upsert through WorksRepo (which dedups by DOI and by
// title+year+first-author fingerprint — same path as DOI ingestion). This is
// the Zotero/EndNote migration on-ramp.
import { parseReferences, cslYear, type CslItem, type ImportFormat } from "@aurascholar/cite";
import { WorksRepo } from "@aurascholar/db";
import { getDb } from "./tauri-db";

export interface ImportSummary {
  total: number;
  imported: number;
  deduped: number;
}

export function previewReferences(text: string, format?: ImportFormat): CslItem[] {
  return parseReferences(text, format);
}

export async function importReferences(
  text: string,
  format?: ImportFormat,
): Promise<ImportSummary> {
  const items = parseReferences(text, format);
  const db = await getDb();
  const works = new WorksRepo(db);
  let imported = 0;
  let deduped = 0;
  for (const item of items) {
    const { deduped: dup } = await works.upsert(toWorkInput(item));
    if (dup) deduped++;
    else imported++;
  }
  return { total: items.length, imported, deduped };
}

function toWorkInput(item: CslItem) {
  const year = cslYear(item);
  return {
    doi: item.DOI?.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "") || undefined,
    title: item.title ?? "(无标题)",
    abstract: item.abstract,
    year,
    venueName: item["container-title"],
    type: cslTypeToWorkType(item.type),
    cslJson: item,
    authors: (item.author ?? []).map((a, position) => ({
      displayName: [a.given, a.family].filter(Boolean).join(" ") || a.literal || "",
      orcid: undefined,
      position,
    })),
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
