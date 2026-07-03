// Bibliographic metadata service: load a work's full field set + author list
// (with roles) for the detail panel and editor, and persist edits.
import {
  WorksRepo,
  type WorkAuthorDetail,
  type WorkPatch,
  type WorkRow,
} from "@aurascholar/db/repos/works";
import { getDb } from "./tauri-db";

export interface WorkMetadata {
  work: WorkRow;
  authors: WorkAuthorDetail[];
  keywords: string[];
}

export async function loadWorkMetadata(workId: string): Promise<WorkMetadata | null> {
  const db = await getDb();
  const repo = new WorksRepo(db);
  const work = await repo.get(workId);
  if (!work) return null;
  const authors = await repo.authorsOf(workId);
  let keywords: string[] = [];
  if (work.keywords_json) {
    try {
      const parsed = JSON.parse(work.keywords_json);
      if (Array.isArray(parsed)) keywords = parsed.filter((k): k is string => typeof k === "string");
    } catch {
      keywords = [];
    }
  }
  return { work, authors, keywords };
}

export async function saveWorkMetadata(workId: string, patch: WorkPatch): Promise<void> {
  const db = await getDb();
  await new WorksRepo(db).update(workId, patch);
  window.dispatchEvent(new Event("aurascholar:library-updated"));
}
