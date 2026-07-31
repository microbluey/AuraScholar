import { AttachmentsRepo } from "@aurascholar/db/repos/attachments";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { getLibraryDb } from "./aura-db";

export async function libraryRepos() {
  const { db, libraryId } = await getLibraryDb();
  return {
    works: new WorksRepo(db, libraryId),
    attachments: new AttachmentsRepo(db, libraryId),
  };
}
