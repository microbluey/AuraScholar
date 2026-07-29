import type { Database } from "../database.js";
import { normalizeDoi } from "../ids.js";
import type { SentinelCreateInput, SentinelTaskRow } from "./sentinel.js";

export interface PreparedSentinelCreateInput {
  doi: string | null;
  title: string;
  workId?: string;
  targets?: string[];
  hintVenue?: string;
  hintAuthor?: string;
}

export function prepareCreateInput(input: SentinelCreateInput): PreparedSentinelCreateInput {
  const doi = input.doi ? (normalizeDoi(input.doi) ?? input.doi.trim().toLowerCase()) : null;
  return {
    doi,
    title: input.title.trim(),
    workId: input.workId,
    targets: input.targets,
    hintVenue: input.hintVenue?.trim() || undefined,
    hintAuthor: input.hintAuthor?.trim() || undefined,
  };
}

export function normalizeSentinelTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export async function findMatchingSentinelTask(
  db: Database,
  libraryId: string,
  input: PreparedSentinelCreateInput,
): Promise<SentinelTaskRow | null> {
  if (input.doi) {
    const rows = await db.query<SentinelTaskRow>(
      `SELECT * FROM sentinel_tasks
       WHERE library_id = ? AND doi = ?
       ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, created_at DESC
       LIMIT 1`,
      [libraryId, input.doi],
    );
    return rows[0] ?? null;
  }

  const targetTitle = normalizeSentinelTitle(input.title);
  const rows = await db.query<SentinelTaskRow>(
    `SELECT * FROM sentinel_tasks WHERE library_id = ? AND doi IS NULL`,
    [libraryId],
  );
  return (
    rows
      .filter((task) => normalizeSentinelTitle(task.title) === targetTitle)
      .sort(
        (a, b) =>
          Number(a.deleted_at !== null) - Number(b.deleted_at !== null) ||
          b.created_at - a.created_at,
      )[0] ?? null
  );
}
