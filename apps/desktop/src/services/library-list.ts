import type { WorkWithAuthors } from "@aurascholar/db/work-list";
import {
  listDeletedWorks as listDbDeletedWorks,
  listWorks as listDbWorks,
  parseWorkMetadataSearch,
  searchWorksByMetadata as searchDbWorksByMetadata,
} from "@aurascholar/db/work-list";
import { getLibraryDb } from "./aura-db";

export async function listWorks(
  search?: string,
  collectionId?: string,
  limit?: number,
): Promise<WorkWithAuthors[]> {
  const { db, libraryId } = await getLibraryDb();
  return listDbWorks(db, libraryId, { search, collectionId, limit });
}

export async function listDeletedWorks(
  search?: string,
  limit?: number,
): Promise<WorkWithAuthors[]> {
  const { db, libraryId } = await getLibraryDb();
  return listDbDeletedWorks(db, libraryId, { search, limit });
}

export async function searchWorksByMetadata(search: string, limit = 40) {
  const { db, libraryId } = await getLibraryDb();
  return searchDbWorksByMetadata(db, libraryId, search, limit);
}

export { parseWorkMetadataSearch };
