import type { Database } from "../database.js";
import { contentUnitCanonicalVisibilitySql } from "./content-unit-visibility.js";

/** A user-selected, Library-bound Knowledge corpus. */
export type KnowledgeCorpusScope =
  | { readonly kind: "library" }
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "works"; readonly workIds: readonly string[] }
  | { readonly kind: "asset"; readonly assetId: string };

/** Alias used by callers that distinguish a selection from its resolution. */
export type KnowledgeCorpusScopeSelection = KnowledgeCorpusScope;

export interface KnowledgeCorpusScopeResolution {
  /** Distinct canonical source identities, including context-only units. */
  readonly allSourceIds: string[];
  /** Distinct canonical source identities with at least one ready unit. */
  readonly readySourceIds: string[];
}

export class KnowledgeCorpusScopeError extends Error {
  constructor(
    readonly scopeId: string,
    readonly libraryId: string,
    message = `Knowledge corpus scope ${scopeId} is missing, inactive, or outside library ${libraryId}`,
  ) {
    super(message);
    this.name = "KnowledgeCorpusScopeError";
  }
}

const MAX_WORK_IDS = 500;

/**
 * Resolves a typed corpus selection into canonical source IDs before retrieval
 * or vector lookup. Every branch validates ownership and active state first;
 * malformed or cross-Library selections never degrade into a partial result.
 */
export class KnowledgeCorpusScopeRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    assertId(libraryId, "Library id");
  }

  async resolve(scope: KnowledgeCorpusScope): Promise<KnowledgeCorpusScopeResolution> {
    const normalized = normalizeScope(scope);
    await this.requireActiveLibrary();

    const { clause, params } = await this.scopeClause(normalized);
    const rows = await this.db.query<SourceIdRow>(
      `SELECT unit.source_id,
              MAX(CASE WHEN unit.state = 'ready' THEN 1 ELSE 0 END) AS has_ready
       FROM content_units unit
       WHERE unit.library_id = ?
         AND EXISTS (
           SELECT 1 FROM libraries scope_library
           WHERE scope_library.id = unit.library_id
             AND scope_library.deleted_at IS NULL
         )
         AND unit.deleted_at IS NULL
         AND ${contentUnitCanonicalVisibilitySql({ alias: "unit" })}
         AND ${clause}
       GROUP BY unit.source_id
       ORDER BY unit.source_id ASC`,
      [this.libraryId, ...params],
    );
    const allSourceIds = rows.map((row) => row.source_id);
    const readySourceIds = rows
      .filter((row) => Number(row.has_ready) === 1)
      .map((row) => row.source_id);
    return { allSourceIds, readySourceIds };
  }

  /** Explicitly named alias for callers that only need the resolved IDs. */
  async resolveSourceIds(scope: KnowledgeCorpusScope): Promise<KnowledgeCorpusScopeResolution> {
    return this.resolve(scope);
  }

  private async scopeClause(scope: KnowledgeCorpusScope): Promise<ScopeClause> {
    switch (scope.kind) {
      case "library":
        return { clause: "1 = 1", params: [] };
      case "works":
        await this.requireActiveWorks(scope.workIds);
        if (scope.workIds.length === 0) return { clause: "1 = 0", params: [] };
        return {
          clause: `(
            unit.work_id IN (${placeholders(scope.workIds.length)})
            OR EXISTS (
              SELECT 1
              FROM document_assets scope_asset
              WHERE scope_asset.id = unit.asset_id
                AND scope_asset.library_id = unit.library_id
                AND scope_asset.work_id IN (${placeholders(scope.workIds.length)})
                AND scope_asset.deleted_at IS NULL
            )
          )`,
          params: [...scope.workIds, ...scope.workIds],
        };
      case "asset":
        await this.requireActiveAsset(scope.assetId);
        return {
          clause: `(
            unit.asset_id = ?
            OR EXISTS (
              SELECT 1
              FROM document_revisions scope_revision
              WHERE scope_revision.id = unit.revision_id
                AND scope_revision.asset_id = ?
                AND scope_revision.deleted_at IS NULL
            )
          )`,
          params: [scope.assetId, scope.assetId],
        };
      case "project":
        await this.requireActiveProject(scope.projectId);
        return {
          clause: `(
            EXISTS (
              SELECT 1
              FROM project_works scope_project_work
              JOIN research_projects scope_project
                ON scope_project.id = scope_project_work.project_id
               AND scope_project.library_id = unit.library_id
               AND scope_project.status = 'active'
               AND scope_project.deleted_at IS NULL
              JOIN works scope_work
                ON scope_work.id = scope_project_work.work_id
               AND scope_work.library_id = ?
               AND scope_work.deleted_at IS NULL
              WHERE scope_project_work.project_id = ?
                AND (
                  scope_project_work.work_id = unit.work_id
                  OR EXISTS (
                    SELECT 1
                    FROM document_assets scope_work_asset
                    WHERE scope_work_asset.id = unit.asset_id
                      AND scope_work_asset.library_id = unit.library_id
                      AND scope_work_asset.work_id = scope_project_work.work_id
                      AND scope_work_asset.deleted_at IS NULL
                  )
                )
                AND scope_project_work.deleted_at IS NULL
            )
            OR EXISTS (
              SELECT 1
              FROM project_assets scope_project_asset
              JOIN research_projects scope_project
                ON scope_project.id = scope_project_asset.project_id
               AND scope_project.library_id = unit.library_id
               AND scope_project.status = 'active'
               AND scope_project.deleted_at IS NULL
              JOIN document_assets scope_asset
                ON scope_asset.id = scope_project_asset.asset_id
               AND scope_asset.library_id = ?
               AND scope_asset.deleted_at IS NULL
              WHERE scope_project_asset.project_id = ?
                AND scope_project_asset.asset_id = unit.asset_id
                AND scope_project_asset.deleted_at IS NULL
            )
            OR EXISTS (
              SELECT 1
              FROM project_evidence scope_project_evidence
              JOIN research_projects scope_project
                ON scope_project.id = scope_project_evidence.project_id
               AND scope_project.library_id = unit.library_id
               AND scope_project.status = 'active'
               AND scope_project.deleted_at IS NULL
              JOIN evidence_items scope_evidence
                ON scope_evidence.id = scope_project_evidence.evidence_id
               AND scope_evidence.library_id = ?
               AND scope_evidence.deleted_at IS NULL
              JOIN document_assets scope_evidence_asset
                ON scope_evidence_asset.id = scope_evidence.asset_id
               AND scope_evidence_asset.library_id = scope_evidence.library_id
               AND scope_evidence_asset.work_id = scope_evidence.work_id
               AND scope_evidence_asset.deleted_at IS NULL
              JOIN document_revisions scope_evidence_revision
                ON scope_evidence_revision.id = scope_evidence.revision_id
               AND scope_evidence_revision.asset_id = scope_evidence.asset_id
               AND scope_evidence_revision.deleted_at IS NULL
              JOIN works scope_evidence_work
                ON scope_evidence_work.id = scope_evidence.work_id
               AND scope_evidence_work.library_id = scope_evidence.library_id
               AND scope_evidence_work.deleted_at IS NULL
              WHERE scope_project_evidence.project_id = ?
                AND scope_project_evidence.evidence_id = unit.source_id
                AND unit.source_type = 'evidence'
                AND (
                  -- A legacy detached unit has no parent columns to compare;
                  -- active Evidence + typed membership still proves its source.
                  (
                    unit.work_id IS NULL
                    AND unit.asset_id IS NULL
                    AND unit.revision_id IS NULL
                  )
                  OR (
                    unit.work_id IS scope_evidence.work_id
                    AND unit.asset_id IS scope_evidence.asset_id
                    AND unit.revision_id IS scope_evidence.revision_id
                  )
                )
                AND scope_project_evidence.deleted_at IS NULL
            )
          )`,
          params: [
            this.libraryId,
            scope.projectId,
            this.libraryId,
            scope.projectId,
            this.libraryId,
            scope.projectId,
          ],
        };
    }
  }

  private async requireActiveLibrary(): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [this.libraryId],
    );
    if (!rows[0]) {
      throw new KnowledgeCorpusScopeError(
        this.libraryId,
        this.libraryId,
        `Library ${this.libraryId} is missing or removed`,
      );
    }
  }

  private async requireActiveProject(projectId: string): Promise<void> {
    const rows = await this.db.query<IdentityRow>(
      `SELECT id, library_id, status, deleted_at
       FROM research_projects WHERE id = ? LIMIT 1`,
      [projectId],
    );
    const row = rows[0];
    if (row && row.library_id !== this.libraryId) {
      throw new KnowledgeCorpusScopeError(projectId, this.libraryId);
    }
    if (!row || row.status !== "active" || row.deleted_at !== null) {
      throw new KnowledgeCorpusScopeError(
        projectId,
        this.libraryId,
        `Research project ${projectId} is missing, archived, or removed`,
      );
    }
  }

  private async requireActiveWorks(workIds: readonly string[]): Promise<void> {
    if (workIds.length === 0) return;
    const rows = await this.db.query<IdentityRow>(
      `SELECT id, library_id, 'active' AS status, deleted_at
       FROM works WHERE id IN (${placeholders(workIds.length)})`,
      [...workIds],
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const workId of workIds) {
      const row = byId.get(workId);
      if (row && row.library_id !== this.libraryId) {
        throw new KnowledgeCorpusScopeError(workId, this.libraryId);
      }
      if (!row || row.deleted_at !== null) {
        throw new KnowledgeCorpusScopeError(
          workId,
          this.libraryId,
          `Work ${workId} is missing or removed from library ${this.libraryId}`,
        );
      }
    }
  }

  private async requireActiveAsset(assetId: string): Promise<void> {
    const rows = await this.db.query<AssetIdentityRow>(
      `SELECT asset.id, asset.library_id, asset.work_id, asset.deleted_at,
              work.id AS joined_work_id, work.library_id AS work_library_id,
              work.deleted_at AS work_deleted_at
       FROM document_assets asset
       LEFT JOIN works work
         ON work.id = asset.work_id
       WHERE asset.id = ? LIMIT 1`,
      [assetId],
    );
    const row = rows[0];
    if (row && row.library_id !== this.libraryId) {
      throw new KnowledgeCorpusScopeError(assetId, this.libraryId);
    }
    if (
      !row ||
      row.deleted_at !== null ||
      (row.work_id !== null &&
        (row.joined_work_id !== row.work_id ||
          row.work_library_id !== this.libraryId ||
          row.work_deleted_at !== null))
    ) {
      throw new KnowledgeCorpusScopeError(
        assetId,
        this.libraryId,
        `Document asset ${assetId} is missing, removed, or has a removed Work`,
      );
    }
  }
}

interface SourceIdRow {
  source_id: string;
  has_ready: number | bigint;
}

interface ScopeClause {
  clause: string;
  params: unknown[];
}

interface IdentityRow {
  id: string;
  library_id: string;
  status: string;
  deleted_at: number | null;
}

interface AssetIdentityRow {
  id: string;
  library_id: string;
  work_id: string | null;
  joined_work_id: string | null;
  work_library_id: string | null;
  deleted_at: number | null;
  work_deleted_at: number | null;
}

function normalizeScope(scope: KnowledgeCorpusScope): KnowledgeCorpusScope {
  if (!scope || typeof scope !== "object" || typeof scope.kind !== "string") {
    throw new Error("Knowledge corpus scope is invalid");
  }
  switch (scope.kind) {
    case "library":
      assertExactKeys(scope, ["kind"]);
      return { kind: "library" };
    case "project":
      assertExactKeys(scope, ["kind", "projectId"]);
      return { kind: "project", projectId: normalizeId(scope.projectId, "Research project id") };
    case "asset":
      assertExactKeys(scope, ["kind", "assetId"]);
      return { kind: "asset", assetId: normalizeId(scope.assetId, "Document asset id") };
    case "works": {
      assertExactKeys(scope, ["kind", "workIds"]);
      if (!Array.isArray(scope.workIds))
        throw new Error("Knowledge corpus Work ids must be an array");
      if (scope.workIds.length > MAX_WORK_IDS) {
        throw new Error(`Knowledge corpus Work scope is limited to ${MAX_WORK_IDS} ids`);
      }
      const workIds = scope.workIds.map((id, index) => {
        return normalizeId(id, `Knowledge corpus Work id at index ${index}`);
      });
      if (new Set(workIds).size !== workIds.length) {
        throw new Error("Knowledge corpus Work scope ids must be unique");
      }
      return { kind: "works", workIds };
    }
    default:
      throw new Error(
        `Unsupported Knowledge corpus scope: ${String((scope as { kind?: unknown }).kind)}`,
      );
  }
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function normalizeId(value: unknown, label: string): string {
  assertId(value, label);
  const normalized = value.trim();
  if (normalized.length > 512 || containsControlCharacter(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new Error("Knowledge corpus scope contains unsupported fields");
  }
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
