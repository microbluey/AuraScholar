import type { Database } from "../database.js";
import { newId, projectWorkMembershipId } from "../ids.js";
import {
  DEFAULT_RESEARCH_PROJECT_ID,
  DEFAULT_RESEARCH_PROJECT_NAME,
  scopedDefaultResearchProjectId,
} from "../research-project-defaults.js";
import { withDatabaseWriteLock } from "./write-lock.js";

export type ResearchProjectStatus = "active" | "archived";

export interface ResearchProjectRow {
  id: string;
  library_id: string;
  name: string;
  description: string | null;
  status: ResearchProjectStatus;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface ResearchProjectInput {
  name: string;
  description?: string | null;
}

interface ProjectIdentityRow {
  id: string;
  library_id: string;
  status: ResearchProjectStatus;
  updated_at: number;
  deleted_at: number | null;
}

export class ResearchProjectScopeError extends Error {
  constructor(
    readonly projectId: string,
    readonly libraryId: string,
  ) {
    super(`Research project ${projectId} is outside library ${libraryId}`);
    this.name = "ResearchProjectScopeError";
  }
}

export class LastActiveResearchProjectError extends Error {
  constructor(readonly libraryId: string) {
    super(`Cannot archive the last active research project in library ${libraryId}`);
    this.name = "LastActiveResearchProjectError";
  }
}

/**
 * Library-scoped persistence for the normal research/retrieval boundary.
 *
 * A Project owns no Library Work. project_works is only recoverable membership:
 * archiving a Project or removing a membership never mutates works, attachments,
 * annotations, or source blobs.
 */
export class ResearchProjectsRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    if (!libraryId.trim()) throw new Error("libraryId must be a non-empty string");
  }

  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    return withDatabaseWriteLock(this.db, fn);
  }

  /**
   * Returns the oldest active Project, creating one only when the Library has
   * none. This is intentionally an invariant, not a persisted is_default flag.
   */
  async ensureDefault(): Promise<ResearchProjectRow> {
    return this.withWriteLock(async () => {
      const current = await this.oldestActive();
      if (current) return current;
      await this.assertActiveLibrary();
      return this.createUnlocked(
        { name: DEFAULT_RESEARCH_PROJECT_NAME },
        await this.availableDefaultProjectId(),
      );
    });
  }

  async create(input: ResearchProjectInput): Promise<ResearchProjectRow> {
    return this.withWriteLock(async () => {
      await this.assertActiveLibrary();
      return this.createUnlocked(input);
    });
  }

  async get(projectId: string): Promise<ResearchProjectRow | null> {
    assertRecordId(projectId, "Research project id");
    const rows = await this.db.query<ResearchProjectRow>(
      `${PROJECT_SELECT}
       WHERE id = ? AND library_id = ?
       LIMIT 1`,
      [projectId, this.libraryId],
    );
    return rows[0] ?? null;
  }

  /** Lists active and archived Projects; tombstones remain hidden. */
  async list(): Promise<ResearchProjectRow[]> {
    return this.db.query<ResearchProjectRow>(
      `${PROJECT_SELECT}
       WHERE library_id = ? AND deleted_at IS NULL
       ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
                created_at ASC, id ASC`,
      [this.libraryId],
    );
  }

  async rename(projectId: string, name: string): Promise<void> {
    const trimmed = normalizeName(name);
    await this.withWriteLock(async () => {
      const project = await this.requireOwned(projectId, { includeDeleted: false });
      const changed = await this.db.run(
        `UPDATE research_projects
         SET name = ?, updated_at = ?
         WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
        [trimmed, nextTimestamp(project.updated_at), projectId, this.libraryId],
      );
      assertChanged(changed, `Research project ${projectId} is missing or removed`);
    });
  }

  async archive(projectId: string): Promise<void> {
    await this.withWriteLock(async () => {
      const project = await this.requireOwned(projectId, { includeDeleted: false });
      if (project.status !== "active") {
        throw new Error(`Research project ${projectId} is already archived`);
      }
      const remaining = await this.db.query<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM research_projects
           WHERE library_id = ? AND status = 'active' AND deleted_at IS NULL AND id <> ?`,
        [this.libraryId, projectId],
      );
      if (Number(remaining[0]?.count ?? 0) === 0) {
        throw new LastActiveResearchProjectError(this.libraryId);
      }
      const changed = await this.db.run(
        `UPDATE research_projects
           SET status = 'archived', updated_at = ?
           WHERE id = ? AND library_id = ? AND status = 'active' AND deleted_at IS NULL`,
        [nextTimestamp(project.updated_at), projectId, this.libraryId],
      );
      assertChanged(changed, `Research project ${projectId} is missing or already archived`);
    });
  }

  /** Restores either an archived Project or a recoverable Project tombstone. */
  async restore(projectId: string): Promise<void> {
    await this.withWriteLock(async () => {
      const project = await this.requireOwned(projectId, { includeDeleted: true });
      if (project.status === "active" && project.deleted_at === null) {
        throw new Error(`Research project ${projectId} is already active`);
      }
      const changed = await this.db.run(
        `UPDATE research_projects
         SET status = 'active', deleted_at = NULL, updated_at = ?
         WHERE id = ? AND library_id = ?
           AND (status <> 'active' OR deleted_at IS NOT NULL)`,
        [nextTimestamp(project.updated_at), projectId, this.libraryId],
      );
      assertChanged(changed, `Research project ${projectId} could not be restored`);
    });
  }

  /**
   * Adds active Library Works and restores existing membership tombstones.
   * Duplicate work ids and already-active memberships are semantic no-ops.
   * Returns only the number of memberships inserted or restored.
   */
  async addWorks(projectId: string, workIds: string[]): Promise<number> {
    const ids = normalizeIds(workIds, "Work id");
    if (ids.length === 0) return 0;
    return this.withWriteLock(async () => {
      await this.requireActive(projectId);
      await this.assertWorksOwned(ids, { activeOnly: true });
      const now = Date.now();
      let changed = 0;
      for (const workId of ids) {
        changed += await this.db.run(
          `INSERT INTO project_works
               (id, project_id, work_id, role, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, 'source', ?, ?, NULL)
             ON CONFLICT(project_id, work_id) DO UPDATE SET
               role = excluded.role,
               deleted_at = NULL,
               updated_at = MAX(project_works.updated_at + 1, excluded.updated_at)
             WHERE project_works.deleted_at IS NOT NULL`,
          [projectWorkMembershipId(projectId, workId), projectId, workId, now, now],
        );
      }
      return changed;
    });
  }

  /**
   * Recoverably removes memberships. Missing memberships are no-ops, but every
   * supplied Work id must still resolve within this Library.
   */
  async removeWorks(projectId: string, workIds: string[]): Promise<number> {
    const ids = normalizeIds(workIds, "Work id");
    if (ids.length === 0) return 0;
    return this.withWriteLock(async () => {
      await this.requireActive(projectId);
      await this.assertWorksOwned(ids, { activeOnly: false });
      let removed = 0;
      for (const workId of ids) {
        const current = await this.db.query<{ updated_at: number }>(
          `SELECT pw.updated_at
             FROM project_works pw
             JOIN research_projects p
               ON p.id = pw.project_id AND p.library_id = ?
             WHERE pw.project_id = ? AND pw.work_id = ? AND pw.deleted_at IS NULL
             LIMIT 1`,
          [this.libraryId, projectId, workId],
        );
        if (!current[0]) continue;
        removed += await this.db.run(
          `UPDATE project_works
             SET deleted_at = ?, updated_at = ?
             WHERE project_id = ? AND work_id = ? AND deleted_at IS NULL`,
          [Date.now(), nextTimestamp(current[0].updated_at), projectId, workId],
        );
      }
      return removed;
    });
  }

  /** Active memberships whose Library Works are currently available. */
  async listWorkIds(projectId: string): Promise<string[]> {
    await this.requireActive(projectId);
    const rows = await this.db.query<{ work_id: string }>(
      `SELECT pw.work_id
       FROM project_works pw
       JOIN research_projects p
         ON p.id = pw.project_id
        AND p.library_id = ?
        AND p.status = 'active'
        AND p.deleted_at IS NULL
       JOIN works w
         ON w.id = pw.work_id
        AND w.library_id = p.library_id
        AND w.deleted_at IS NULL
       WHERE pw.project_id = ? AND pw.deleted_at IS NULL
       ORDER BY pw.created_at ASC, pw.work_id ASC`,
      [this.libraryId, projectId],
    );
    return rows.map((row) => row.work_id);
  }

  private async createUnlocked(
    input: ResearchProjectInput,
    id = newId(),
  ): Promise<ResearchProjectRow> {
    const name = normalizeName(input.name);
    const description = normalizeDescription(input.description);
    const now = Date.now();
    const changed = await this.db.run(
      `INSERT INTO research_projects
         (id, library_id, name, description, status, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, NULL)`,
      [id, this.libraryId, name, description, now, now],
    );
    assertChanged(changed, `Research project "${name}" was not created`);
    const created = await this.get(id);
    if (!created) throw new Error(`Research project ${id} was not readable after creation`);
    return created;
  }

  private async availableDefaultProjectId(): Promise<string> {
    const root = await this.db.query<{ library_id: string }>(
      `SELECT library_id FROM research_projects WHERE id = ? LIMIT 1`,
      [DEFAULT_RESEARCH_PROJECT_ID],
    );
    if (!root[0] || root[0].library_id === this.libraryId) {
      return DEFAULT_RESEARCH_PROJECT_ID;
    }

    const scopedId = scopedDefaultResearchProjectId(this.libraryId);
    const scoped = await this.db.query<{ library_id: string }>(
      `SELECT library_id FROM research_projects WHERE id = ? LIMIT 1`,
      [scopedId],
    );
    if (scoped[0] && scoped[0].library_id !== this.libraryId) {
      throw new ResearchProjectScopeError(scopedId, this.libraryId);
    }
    return scopedId;
  }

  private async oldestActive(): Promise<ResearchProjectRow | null> {
    const rows = await this.db.query<ResearchProjectRow>(
      `${PROJECT_SELECT}
       WHERE library_id = ? AND status = 'active' AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
      [this.libraryId],
    );
    return rows[0] ?? null;
  }

  private async requireActive(projectId: string): Promise<ProjectIdentityRow> {
    const project = await this.requireOwned(projectId, { includeDeleted: false });
    if (project.status !== "active") {
      throw new Error(`Research project ${projectId} is archived`);
    }
    return project;
  }

  private async requireOwned(
    projectId: string,
    options: { includeDeleted: boolean },
  ): Promise<ProjectIdentityRow> {
    assertRecordId(projectId, "Research project id");
    const rows = await this.db.query<ProjectIdentityRow>(
      `SELECT id, library_id, status, updated_at, deleted_at
       FROM research_projects
       WHERE id = ?
       LIMIT 1`,
      [projectId],
    );
    const project = rows[0];
    if (project && project.library_id !== this.libraryId) {
      throw new ResearchProjectScopeError(projectId, this.libraryId);
    }
    if (!project || (!options.includeDeleted && project.deleted_at !== null)) {
      throw new Error(`Research project ${projectId} is missing or removed`);
    }
    return project;
  }

  private async assertActiveLibrary(): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [this.libraryId],
    );
    if (!rows[0]) throw new Error(`Library ${this.libraryId} is missing or removed`);
  }

  private async assertWorksOwned(
    workIds: string[],
    options: { activeOnly: boolean },
  ): Promise<void> {
    for (let offset = 0; offset < workIds.length; offset += 500) {
      const chunk = workIds.slice(offset, offset + 500);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = await this.db.query<{
        id: string;
        library_id: string;
        deleted_at: number | null;
      }>(
        `SELECT id, library_id, deleted_at
         FROM works
         WHERE id IN (${placeholders})`,
        chunk,
      );
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const workId of chunk) {
        const work = byId.get(workId);
        if (work && work.library_id !== this.libraryId) {
          throw new Error(`Work ${workId} is outside library ${this.libraryId}`);
        }
        if (!work || (options.activeOnly && work.deleted_at !== null)) {
          throw new Error(`Work ${workId} is missing or removed`);
        }
      }
    }
  }
}

const PROJECT_SELECT = `SELECT id, library_id, name, description, status,
                               created_at, updated_at, deleted_at
                        FROM research_projects`;

function normalizeName(name: string): string {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Research project name must be a non-empty string");
  }
  return name.trim();
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("Research project description must be a string");
  return value.trim() || null;
}

function normalizeIds(values: string[], label: string): string[] {
  if (!Array.isArray(values)) throw new Error(`${label}s must be an array`);
  return [
    ...new Set(
      values.map((value) => {
        assertRecordId(value, label);
        return value.trim();
      }),
    ),
  ];
}

function assertRecordId(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertChanged(changed: number, message: string): void {
  if (changed === 0) throw new Error(message);
}

function nextTimestamp(previous: number): number {
  return Math.max(Date.now(), previous + 1);
}
