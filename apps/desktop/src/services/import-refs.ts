// Reference-import service: preview stays a pure renderer transformation while
// persistence is owned by the typed main-process Library command.
import type { CslItem, ImportFormat } from "@aurascholar/cite";
import type { LibraryImportReferencesCommandResult } from "../../electron/data-command-contract";
import { parseImportableReferences } from "../shared/reference-import";

export type ImportSummary = LibraryImportReferencesCommandResult;

export function previewReferences(text: string, format?: ImportFormat): CslItem[] {
  return parseImportableReferences(text, format);
}

export async function importReferences(
  text: string,
  format?: ImportFormat,
): Promise<ImportSummary> {
  return window.aura.data.command("library.importReferences", {
    text,
    ...(format === undefined ? {} : { format }),
  });
}
