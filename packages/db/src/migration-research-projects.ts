import { projectWorkMembershipId } from "./ids.js";
import {
  DEFAULT_RESEARCH_PROJECT_ID,
  DEFAULT_RESEARCH_PROJECT_NAME,
  scopedDefaultResearchProjectId,
} from "./research-project-defaults.js";
import type { SqlExecutor } from "./migrations.js";

interface LibrarySeedRow {
  id: string;
  created_at: number;
  updated_at: number;
}

interface WorkSeedRow {
  id: string;
  library_id: string;
  created_at: number;
  updated_at: number;
}

export async function applyResearchProjectsV18(db: SqlExecutor): Promise<void> {
  await db.exec(`
    CREATE TABLE research_projects (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES libraries(id),
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX research_projects_library_status_idx
      ON research_projects(library_id, deleted_at, status, updated_at);

    CREATE TABLE project_works (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'source' CHECK (length(trim(role)) > 0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      UNIQUE(project_id, work_id)
    );
    CREATE INDEX project_works_project_active_idx
      ON project_works(project_id, deleted_at, updated_at);
    CREATE INDEX project_works_work_active_idx
      ON project_works(work_id, deleted_at);
  `);

  const libraries = await db.query<LibrarySeedRow>(
    `SELECT id, created_at, updated_at
     FROM libraries
     ORDER BY created_at, id`,
  );
  const projectIdByLibrary = new Map<string, string>();
  for (const [index, library] of libraries.entries()) {
    const projectId =
      index === 0 ? DEFAULT_RESEARCH_PROJECT_ID : scopedDefaultResearchProjectId(library.id);
    const timestamp = Math.max(library.created_at, library.updated_at);
    await db.run(
      `INSERT INTO research_projects
         (id, library_id, name, description, status, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, NULL, 'active', ?, ?, NULL)`,
      [projectId, library.id, DEFAULT_RESEARCH_PROJECT_NAME, timestamp, timestamp],
    );
    projectIdByLibrary.set(library.id, projectId);
  }

  const works = await db.query<WorkSeedRow>(
    `SELECT id, library_id, created_at, updated_at
     FROM works
     ORDER BY created_at, id`,
  );
  for (const work of works) {
    const projectId = projectIdByLibrary.get(work.library_id);
    if (!projectId) throw new Error(`Work ${work.id} has no owning Library project`);
    await db.run(
      `INSERT INTO project_works
         (id, project_id, work_id, role, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'source', ?, ?, NULL)`,
      [
        projectWorkMembershipId(projectId, work.id),
        projectId,
        work.id,
        work.created_at,
        work.updated_at,
      ],
    );
  }

  await db.exec(`
    CREATE TABLE canvas_workspaces_v18 (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES libraries(id),
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
      viewport_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  for (const [libraryId, projectId] of projectIdByLibrary) {
    await db.run(
      `INSERT INTO canvas_workspaces_v18
         (id, library_id, project_id, name, description, schema_version,
          viewport_json, created_at, updated_at)
       SELECT id, library_id, ?, name, description, schema_version,
              viewport_json, created_at, updated_at
       FROM canvas_workspaces
       WHERE library_id = ?`,
      [projectId, libraryId],
    );
  }
  await db.exec(`
    DROP TRIGGER IF EXISTS canvas_nodes_library_insert;
    DROP TRIGGER IF EXISTS canvas_nodes_library_update;
    DROP TRIGGER IF EXISTS canvas_edges_workspace_insert;
    DROP TRIGGER IF EXISTS canvas_edges_workspace_update;
    DROP TABLE canvas_workspaces;
    ALTER TABLE canvas_workspaces_v18 RENAME TO canvas_workspaces;
    CREATE INDEX canvas_workspaces_library_updated_idx
      ON canvas_workspaces(library_id, updated_at);
    CREATE INDEX canvas_workspaces_project_updated_idx
      ON canvas_workspaces(project_id, updated_at);

    CREATE TRIGGER research_projects_library_immutable
    BEFORE UPDATE OF library_id ON research_projects
    WHEN OLD.library_id <> NEW.library_id
    BEGIN
      SELECT RAISE(ABORT, 'research project library ownership is immutable');
    END;

    CREATE TRIGGER research_projects_last_active_update
    BEFORE UPDATE OF status, deleted_at ON research_projects
    WHEN OLD.status = 'active'
      AND OLD.deleted_at IS NULL
      AND (NEW.status <> 'active' OR NEW.deleted_at IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM research_projects sibling
        WHERE sibling.library_id = OLD.library_id
          AND sibling.id <> OLD.id
          AND sibling.status = 'active'
          AND sibling.deleted_at IS NULL
      )
    BEGIN
      SELECT RAISE(ABORT, 'cannot archive or delete the last active research project');
    END;

    CREATE TRIGGER research_projects_last_active_delete
    BEFORE DELETE ON research_projects
    WHEN OLD.status = 'active'
      AND OLD.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM research_projects sibling
        WHERE sibling.library_id = OLD.library_id
          AND sibling.id <> OLD.id
          AND sibling.status = 'active'
          AND sibling.deleted_at IS NULL
      )
    BEGIN
      SELECT RAISE(ABORT, 'cannot delete the last active research project');
    END;

    CREATE TRIGGER project_works_library_insert
    BEFORE INSERT ON project_works
    WHEN NOT EXISTS (
      SELECT 1
      FROM research_projects project
      JOIN works work ON work.id = NEW.work_id
      WHERE project.id = NEW.project_id
        AND project.library_id = work.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'project work must stay within its library');
    END;

    CREATE TRIGGER project_works_library_update
    BEFORE UPDATE OF project_id, work_id ON project_works
    WHEN NOT EXISTS (
      SELECT 1
      FROM research_projects project
      JOIN works work ON work.id = NEW.work_id
      WHERE project.id = NEW.project_id
        AND project.library_id = work.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'project work must stay within its library');
    END;

    CREATE TRIGGER canvas_workspaces_library_immutable
    BEFORE UPDATE OF library_id ON canvas_workspaces
    WHEN OLD.library_id <> NEW.library_id
    BEGIN
      SELECT RAISE(ABORT, 'canvas workspace library ownership is immutable');
    END;

    CREATE TRIGGER canvas_workspaces_project_insert
    BEFORE INSERT ON canvas_workspaces
    WHEN NOT EXISTS (
      SELECT 1 FROM research_projects project
      WHERE project.id = NEW.project_id
        AND project.library_id = NEW.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'canvas workspace project must stay within its library');
    END;

    CREATE TRIGGER canvas_workspaces_project_update
    BEFORE UPDATE OF library_id, project_id ON canvas_workspaces
    WHEN NOT EXISTS (
      SELECT 1 FROM research_projects project
      WHERE project.id = NEW.project_id
        AND project.library_id = NEW.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'canvas workspace project must stay within its library');
    END;

    CREATE TRIGGER canvas_nodes_library_insert
    BEFORE INSERT ON canvas_nodes
    WHEN NEW.work_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM canvas_workspaces workspace
      JOIN works work ON work.id = NEW.work_id
      WHERE workspace.id = NEW.workspace_id
        AND workspace.library_id = work.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'canvas node work must stay within its library');
    END;

    CREATE TRIGGER canvas_nodes_library_update
    BEFORE UPDATE OF workspace_id, work_id ON canvas_nodes
    WHEN NEW.work_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM canvas_workspaces workspace
      JOIN works work ON work.id = NEW.work_id
      WHERE workspace.id = NEW.workspace_id
        AND workspace.library_id = work.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'canvas node work must stay within its library');
    END;

    CREATE TRIGGER canvas_edges_workspace_insert
    BEFORE INSERT ON canvas_edges
    WHEN NOT EXISTS (
      SELECT 1 FROM canvas_nodes source
      JOIN canvas_nodes target ON target.id = NEW.target_id
      WHERE source.id = NEW.source_id
        AND source.workspace_id = NEW.workspace_id
        AND target.workspace_id = NEW.workspace_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'canvas edge nodes must belong to its workspace');
    END;

    CREATE TRIGGER canvas_edges_workspace_update
    BEFORE UPDATE OF workspace_id, source_id, target_id ON canvas_edges
    WHEN NOT EXISTS (
      SELECT 1 FROM canvas_nodes source
      JOIN canvas_nodes target ON target.id = NEW.target_id
      WHERE source.id = NEW.source_id
        AND source.workspace_id = NEW.workspace_id
        AND target.workspace_id = NEW.workspace_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'canvas edge nodes must belong to its workspace');
    END;
  `);
}
