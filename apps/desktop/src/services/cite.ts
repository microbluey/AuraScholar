// Citation service: turns selected library works into CSL items, then formats
// or exports them. Reads csl_json directly (WorkRow doesn't carry it) and
// backfills from columns via @aurascholar/cite's toCslItem.
import {
  toCslItem,
  toBibTeX,
  toRIS,
  toCslJson,
  formatBibliography,
  type CslItem,
  type WorkLike,
} from "@aurascholar/cite";
import { getDb } from "./tauri-db";

interface CiteRow {
  id: string;
  title: string;
  doi: string | null;
  year: number | null;
  publication_date: string | null;
  venue_name: string | null;
  type: string;
  csl_json: unknown;
}

/** Loads CSL items for the given work ids, preserving the requested order. */
export async function cslItemsForWorks(workIds: string[]): Promise<CslItem[]> {
  if (workIds.length === 0) return [];
  const db = await getDb();
  const placeholders = workIds.map(() => "?").join(",");
  const rows = await db.query<CiteRow>(
    `SELECT id, title, doi, year, publication_date, venue_name, type, csl_json
     FROM works WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    workIds,
  );
  // Author names per work (CSL author objects come from csl_json when present;
  // this backfills the synthesized path).
  const authorRows = await db.query<{ work_id: string; display_name: string }>(
    `SELECT wa.work_id, a.display_name
     FROM work_authors wa JOIN authors a ON a.id = wa.author_id
     WHERE wa.work_id IN (${placeholders})
     ORDER BY wa.position`,
    workIds,
  );
  const authorsByWork = new Map<string, string[]>();
  for (const r of authorRows) {
    const list = authorsByWork.get(r.work_id) ?? [];
    list.push(r.display_name);
    authorsByWork.set(r.work_id, list);
  }

  const byId = new Map<string, WorkLike>();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      title: row.title,
      doi: row.doi,
      year: row.year,
      publicationDate: row.publication_date,
      venueName: row.venue_name,
      type: row.type,
      authorNames: authorsByWork.get(row.id) ?? [],
      cslJson: parseJson(row.csl_json),
    });
  }
  return workIds.map((id) => byId.get(id)).filter((w): w is WorkLike => !!w).map(toCslItem);
}

export type ExportFormat = "bibtex" | "ris" | "csljson";

const EXT: Record<ExportFormat, string> = { bibtex: "bib", ris: "ris", csljson: "json" };

export async function exportWorks(workIds: string[], format: ExportFormat): Promise<void> {
  const items = await cslItemsForWorks(workIds);
  const content =
    format === "bibtex" ? toBibTeX(items) : format === "ris" ? toRIS(items) : toCslJson(items);
  const mime =
    format === "csljson" ? "application/json" : "text/plain;charset=utf-8";
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `aurascholar-references.${EXT[format]}`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Returns a numbered reference list as plain text, for clipboard copy. */
export async function bibliographyText(workIds: string[], styleId: string): Promise<string> {
  const items = await cslItemsForWorks(workIds);
  return formatBibliography(items, styleId).join("\n");
}

// csl_json may arrive as a string (raw tauri-sql driver) or already-parsed
// object (drizzle json mode) depending on the driver — handle both.
function parseJson(value: unknown): unknown {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}
