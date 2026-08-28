import type { Migration } from "./migrations.js";

const SAVED_SEARCH_CRITERIA_SQL = "ALTER TABLE saved_searches ADD COLUMN criteria_json TEXT;";

/** Additive Library query migrations that do not require a table rebuild. */
export const libraryMaintenanceMigrations: Migration[] = [
  { version: 24, name: "saved_search_criteria", sql: SAVED_SEARCH_CRITERIA_SQL },
  {
    version: 25,
    name: "research_project_source_paging",
    sql: `
      CREATE INDEX IF NOT EXISTS project_works_project_active_created_work_idx
        ON project_works(project_id, deleted_at, created_at, work_id);
    `,
  },
];
