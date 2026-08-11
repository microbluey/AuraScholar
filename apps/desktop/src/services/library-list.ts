import { parseWorkMetadataSearch } from "@aurascholar/db/work-list";
import type {
  LibraryListWork,
  LibraryMetadataSearchWork,
} from "../../electron/data-command-contract";

export type {
  LibraryListWork,
  LibraryMetadataSearchWork,
} from "../../electron/data-command-contract";

/**
 * Lists recently added active works for lightweight desktop surfaces. The
 * main process owns scope resolution and database access.
 */
export async function listWorks(limit?: number): Promise<LibraryListWork[]> {
  return (
    await window.aura.data.command("library.listWorks", {
      ...(limit === undefined ? {} : { limit }),
    })
  ).works;
}

/** Searches active works across title, author, venue, year, and active tags. */
export async function searchWorksByMetadata(
  search: string,
  limit = 40,
): Promise<LibraryMetadataSearchWork[]> {
  return (await window.aura.data.command("library.searchWorksByMetadata", { limit, search })).works;
}

export { parseWorkMetadataSearch };
