// Citation service: asks main for scoped CSL items, then formats or exports
// them entirely in the renderer. No raw work rows cross into this service.
import {
  toBibTeX,
  toRIS,
  toCslJson,
  formatBibliography,
  formatEntry,
  type CslItem,
} from "@aurascholar/cite";
import { downloadBlob } from "../download";

/** Loads CSL items for the given work ids, preserving the requested order. */
export async function cslItemsForWorks(workIds: string[]): Promise<CslItem[]> {
  if (workIds.length === 0) return [];
  return (await window.aura.data.command("library.getCslItems", { workIds })).items;
}

export type ExportFormat = "bibtex" | "ris" | "csljson";

const EXT: Record<ExportFormat, string> = { bibtex: "bib", ris: "ris", csljson: "json" };

export async function exportWorks(workIds: string[], format: ExportFormat): Promise<void> {
  const items = await cslItemsForWorks(workIds);
  const content =
    format === "bibtex" ? toBibTeX(items) : format === "ris" ? toRIS(items) : toCslJson(items);
  const mime = format === "csljson" ? "application/json" : "text/plain;charset=utf-8";
  const blob = new Blob([content], { type: mime });
  downloadBlob(blob, `aurascholar-references.${EXT[format]}`);
}

/** Returns a numbered reference list as plain text, for clipboard copy. */
export async function bibliographyText(workIds: string[], styleId: string): Promise<string> {
  const items = await cslItemsForWorks(workIds);
  return formatBibliography(items, styleId).join("\n");
}

/** Single work's formatted reference (no leading number), for snippet copy. */
export async function referenceForWork(workId: string, styleId: string): Promise<string> {
  const [item] = await cslItemsForWorks([workId]);
  return item ? formatEntry(item, styleId) : "";
}
