import type { Database } from "@aurascholar/db";
import type { ReadingStatus } from "@aurascholar/db/repos/works";
import type { ResearchProjectRow } from "@aurascholar/db/repos/research-projects";
import { searchWorksByMetadata, type WorkWithAuthorsAndTags } from "@aurascholar/db/work-list";
import type { ResearchProjectSummary, ResearchProjectWorkSummary } from "../data-command-contract";

interface ProjectCounts {
  canvasCount: number;
  sourceCount: number;
}

export async function projectSummaries(
  database: Database,
  libraryId: string,
  projects: ResearchProjectRow[],
): Promise<ResearchProjectSummary[]> {
  if (projects.length === 0) return [];
  const ids = projects.map((project) => project.id);
  const placeholders = ids.map(() => "?").join(",");
  const [sourceRows, canvasRows] = await Promise.all([
    database.query<{ count: number; project_id: string }>(
      `SELECT pw.project_id, COUNT(*) AS count
       FROM project_works pw
       JOIN research_projects p
         ON p.id = pw.project_id
        AND p.library_id = ?
       JOIN works w
         ON w.id = pw.work_id
        AND w.library_id = p.library_id
        AND w.deleted_at IS NULL
       WHERE pw.project_id IN (${placeholders}) AND pw.deleted_at IS NULL
       GROUP BY pw.project_id`,
      [libraryId, ...ids],
    ),
    database.query<{ count: number; project_id: string }>(
      `SELECT cw.project_id, COUNT(*) AS count
       FROM canvas_workspaces cw
       WHERE cw.library_id = ? AND cw.project_id IN (${placeholders})
       GROUP BY cw.project_id`,
      [libraryId, ...ids],
    ),
  ]);
  const counts = new Map<string, ProjectCounts>(
    ids.map((id) => [id, { canvasCount: 0, sourceCount: 0 }]),
  );
  for (const row of sourceRows) counts.get(row.project_id)!.sourceCount = Number(row.count);
  for (const row of canvasRows) counts.get(row.project_id)!.canvasCount = Number(row.count);
  return projects.map((project) => toProjectSummary(project, counts.get(project.id)!));
}

export function toProjectSummary(
  project: ResearchProjectRow,
  counts: ProjectCounts,
): ResearchProjectSummary {
  return {
    canvasCount: counts.canvasCount,
    createdAt: project.created_at,
    deletedAt: project.deleted_at,
    description: project.description,
    id: project.id,
    libraryId: project.library_id,
    name: project.name,
    sourceCount: counts.sourceCount,
    status: project.status,
    updatedAt: project.updated_at,
  };
}

interface WorkSummaryRow {
  authorNames: string[];
  doi: string | null;
  id: string;
  reading_status: string;
  starred: number;
  tagNames: string[];
  title: string;
  updated_at: number;
  venue_name: string | null;
  year: number | null;
}

interface WorkCounts {
  annotationCount: number;
  pdfCount: number;
}

export async function loadWorkSummaries(
  database: Database,
  libraryId: string,
  workIds: string[],
  options: { inProject: boolean },
): Promise<ResearchProjectWorkSummary[]> {
  if (workIds.length === 0) return [];
  const placeholders = workIds.map(() => "?").join(",");
  const rows = await database.query<Omit<WorkSummaryRow, "authorNames" | "tagNames">>(
    `SELECT id, doi, title, year, venue_name, reading_status, starred, updated_at
     FROM works
     WHERE library_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`,
    [libraryId, ...workIds],
  );
  const [authorRows, tagRows, counts] = await Promise.all([
    database.query<{ display_name: string; work_id: string }>(
      `SELECT wa.work_id, a.display_name
       FROM work_authors wa
       JOIN authors a ON a.id = wa.author_id AND a.library_id = ?
       WHERE wa.work_id IN (${placeholders})
       ORDER BY wa.work_id, wa.position`,
      [libraryId, ...workIds],
    ),
    database.query<{ name: string; work_id: string }>(
      `SELECT wt.work_id, t.name
       FROM work_tags wt
       JOIN tags t ON t.id = wt.tag_id AND t.library_id = ? AND t.deleted_at IS NULL
       WHERE wt.work_id IN (${placeholders})
       ORDER BY wt.work_id, t.name COLLATE NOCASE`,
      [libraryId, ...workIds],
    ),
    workCounts(database, workIds),
  ]);
  const authors = groupValues(authorRows, "display_name");
  const tags = groupValues(tagRows, "name");
  const byId = new Map(
    rows.map((row) => [
      row.id,
      toWorkSummary(
        {
          ...row,
          authorNames: authors.get(row.id) ?? [],
          tagNames: tags.get(row.id) ?? [],
        },
        counts.get(row.id),
        options.inProject,
      ),
    ]),
  );
  return workIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export async function searchLibraryWorkSummaries(
  database: Database,
  libraryId: string,
  query: string,
  limit: number,
  membership: ReadonlySet<string>,
): Promise<ResearchProjectWorkSummary[]> {
  const works = await searchWorksByMetadata(database, libraryId, query, limit);
  const counts = await workCounts(
    database,
    works.map((work) => work.id),
  );
  return works.map((work) => toWorkSummary(work, counts.get(work.id), membership.has(work.id)));
}

async function workCounts(database: Database, workIds: string[]): Promise<Map<string, WorkCounts>> {
  const counts = new Map(workIds.map((id) => [id, { annotationCount: 0, pdfCount: 0 }]));
  if (workIds.length === 0) return counts;
  const placeholders = workIds.map(() => "?").join(",");
  const [annotationRows, attachmentRows] = await Promise.all([
    database.query<{ count: number; work_id: string }>(
      `SELECT work_id, COUNT(*) AS count
       FROM annotations
       WHERE work_id IN (${placeholders}) AND deleted_at IS NULL
       GROUP BY work_id`,
      workIds,
    ),
    database.query<{ count: number; work_id: string }>(
      `SELECT work_id, COUNT(*) AS count
       FROM attachments
       WHERE work_id IN (${placeholders}) AND kind = 'pdf' AND deleted_at IS NULL
       GROUP BY work_id`,
      workIds,
    ),
  ]);
  for (const row of annotationRows) counts.get(row.work_id)!.annotationCount = Number(row.count);
  for (const row of attachmentRows) counts.get(row.work_id)!.pdfCount = Number(row.count);
  return counts;
}

function groupValues<T extends { work_id: string }>(
  rows: T[],
  field: keyof T,
): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const row of rows) {
    const value = row[field];
    if (typeof value !== "string") continue;
    const group = values.get(row.work_id) ?? [];
    group.push(value);
    values.set(row.work_id, group);
  }
  return values;
}

function toWorkSummary(
  work: WorkSummaryRow | WorkWithAuthorsAndTags,
  counts: WorkCounts | undefined,
  inProject: boolean,
): ResearchProjectWorkSummary {
  return {
    annotationCount: counts?.annotationCount ?? 0,
    authorNames: work.authorNames,
    doi: work.doi,
    id: work.id,
    inProject,
    pdfCount: counts?.pdfCount ?? 0,
    readingStatus: normalizeReadingStatus(work.reading_status),
    starred: work.starred === 1,
    tagNames: work.tagNames,
    title: work.title,
    updatedAt: work.updated_at,
    venueName: work.venue_name,
    year: work.year,
  };
}

function normalizeReadingStatus(value: string): ReadingStatus {
  return value === "reading" || value === "read" ? value : "unread";
}
