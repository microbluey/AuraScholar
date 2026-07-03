import type { WorkWithAuthors } from "@aurascholar/db/work-list";
import {
  listDeletedWorks as listDbDeletedWorks,
  listWorks as listDbWorks,
} from "@aurascholar/db/work-list";
import { getDb } from "./aura-db";

export async function listWorks(
  search?: string,
  collectionId?: string,
  limit?: number,
): Promise<WorkWithAuthors[]> {
  const db = await getDb();
  return listDbWorks(db, { search, collectionId, limit });
}

export async function listDeletedWorks(
  search?: string,
  limit?: number,
): Promise<WorkWithAuthors[]> {
  const db = await getDb();
  return listDbDeletedWorks(db, { search, limit });
}
