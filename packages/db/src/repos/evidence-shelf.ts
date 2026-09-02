import type { Database } from "../database.js";
import { newId } from "../ids.js";
import { withDatabaseSavepoint } from "../savepoint.js";
import { isUniqueConstraint } from "../sqlite-errors.js";
import { withDatabaseWriteLock } from "./write-lock.js";
import {
  SHELF_SELECT,
  EvidenceShelfScopeError,
  assertEvidenceShelfProjectSourceMembership,
  assertEvidenceShelfHash,
  assertEvidenceShelfId,
  assertEvidenceShelfSourceActive,
  canonicalEvidenceShelfUnit,
  canonicalizeEvidenceShelfJson,
  isEvidenceShelfRecord,
  sameEvidenceShelfSource,
  serializeEvidenceShelfJson,
  serializeEvidenceShelfPreview,
  toEvidenceShelfItem,
} from "./evidence-shelf-support.js";
import type {
  EvidenceShelfItem,
  EvidenceShelfSourceIdentity,
  EvidenceShelfStorageRow,
  NormalizedEvidenceShelfStage,
} from "./evidence-shelf-support.js";

export type { EvidenceShelfItem, EvidenceShelfStatus } from "./evidence-shelf-support.js";
export { EvidenceShelfScopeError } from "./evidence-shelf-support.js";

export interface EvidenceShelfScope {
  kind: "project";
  projectId: string;
}

export interface EvidenceShelfStageInput {
  /** Optional caller assertion; the Repo constructor remains authoritative. */
  libraryId?: string;
  projectId: string;
  itemId?: string;
  /** Canonical ContentUnit identity. Renderer-provided source fields are never authoritative. */
  contentUnitId: string;
  anchorSnapshot: unknown;
  previewPayload: unknown;
}

export interface EvidenceShelfStageResult {
  item: EvidenceShelfItem;
  created: boolean;
}

export interface EvidenceShelfListInput {
  libraryId?: string;
  projectId: string;
  includeDeleted?: boolean;
  /** Optional bounded read window for IPC adapters. */
  limit?: number;
}

export interface EvidenceShelfRemoveInput {
  libraryId?: string;
  projectId: string;
  itemId: string;
  expectedUpdatedAt?: number;
}

export interface EvidenceShelfResolveForSaveInput {
  libraryId?: string;
  projectId?: string;
  itemId: string;
  expectedRevisionId: string | null;
  expectedSourceContentHash?: string;
  /** Alias accepted by main-process adapters. */
  expectedHash?: string;
}

export interface EvidenceShelfResolveForSaveResult {
  item: EvidenceShelfItem | null;
  stale: boolean;
}

export class EvidenceShelfRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    assertEvidenceShelfId(libraryId, "Library id");
  }

  async stage(input: EvidenceShelfStageInput): Promise<EvidenceShelfStageResult> {
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "evidence_shelf_stage", async () => {
        await this.requireActiveLibrary();
        const normalized = await this.normalizeStageInput(input);
        await this.requireActiveProject(normalized.projectId);
        await assertEvidenceShelfProjectSourceMembership(
          this.db,
          this.libraryId,
          normalized.projectId,
          normalized,
        );

        const explicit = normalized.itemId ? await this.storageById(normalized.itemId, true) : null;
        if (explicit) {
          if (explicit.library_id !== this.libraryId) {
            throw new EvidenceShelfScopeError(explicit.id, this.libraryId);
          }
          if (!sameEvidenceShelfSource(explicit, normalized)) {
            throw new Error(
              `Evidence shelf item ${explicit.id} already exists with different content`,
            );
          }
          if (explicit.deleted_at !== null) {
            await this.restoreRow(explicit.id, explicit.updated_at);
          }
          const item = await this.get(explicit.id, { includeDeleted: false });
          if (!item) throw new Error(`Evidence shelf item ${explicit.id} was not readable`);
          return { item, created: false };
        }

        const duplicate = await this.findBySource(normalized);
        if (duplicate) {
          if (duplicate.deleted_at !== null) {
            await this.restoreRow(duplicate.id, duplicate.updated_at);
          }
          const item = await this.get(duplicate.id, { includeDeleted: false });
          if (!item) throw new Error(`Evidence shelf item ${duplicate.id} was not readable`);
          return { item, created: false };
        }

        const id = normalized.itemId ?? newId();
        const now = Date.now();
        try {
          await this.db.run(
            `INSERT INTO evidence_shelf_items
               (id, library_id, project_id, work_id, asset_id, revision_id,
                anchor_snapshot_json, preview_payload_json, source_content_hash,
                status, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'staged', ?, ?, NULL)`,
            [
              id,
              this.libraryId,
              normalized.projectId,
              normalized.workId,
              normalized.assetId,
              normalized.revisionId,
              normalized.anchorJson,
              normalized.previewJson,
              normalized.sourceContentHash,
              now,
              now,
            ],
          );
        } catch (error) {
          // A second Database wrapper can race this preflight despite the
          // per-wrapper write queue. Let the active unique index choose the
          // winner, then return that row just like the serialized path.
          if (!isUniqueConstraint(error)) throw error;
          const raced = await this.findBySource(normalized);
          if (!raced) throw error;
          if (raced.deleted_at !== null) await this.restoreRow(raced.id, raced.updated_at);
          const item = await this.get(raced.id, { includeDeleted: false });
          if (!item)
            throw new Error(`Evidence shelf item ${raced.id} was not readable`, { cause: error });
          return { item, created: false };
        }
        const item = await this.get(id);
        if (!item) throw new Error(`Evidence shelf item ${id} was not readable after staging`);
        return { item, created: true };
      }),
    );
  }

  async list(input: EvidenceShelfListInput | string): Promise<EvidenceShelfItem[]> {
    const projectId = typeof input === "string" ? input : input.projectId;
    const includeDeleted = typeof input === "string" ? false : input.includeDeleted === true;
    const limit = typeof input === "string" ? undefined : input.limit;
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
      throw new Error("Evidence shelf list limit is invalid");
    }
    this.assertInputLibrary(typeof input === "string" ? undefined : input.libraryId);
    await this.requireActiveLibrary();
    await this.requireActiveProject(projectId);
    const rows = await this.db.query<EvidenceShelfStorageRow>(
      `${SHELF_SELECT}
       WHERE shelf.library_id = ? AND shelf.project_id = ?
         ${includeDeleted ? "" : "AND shelf.deleted_at IS NULL"}
       ORDER BY shelf.updated_at DESC, shelf.id DESC${limit === undefined ? "" : " LIMIT ?"}`,
      limit === undefined ? [this.libraryId, projectId] : [this.libraryId, projectId, limit],
    );
    return rows.map(toEvidenceShelfItem);
  }

  async get(
    itemId: string,
    options: { includeDeleted?: boolean; projectId?: string; libraryId?: string } = {},
  ): Promise<EvidenceShelfItem | null> {
    assertEvidenceShelfId(itemId, "Evidence shelf item id");
    this.assertInputLibrary(options.libraryId);
    await this.requireActiveLibrary();
    if (options.projectId !== undefined) await this.requireActiveProject(options.projectId);
    const row = await this.storageById(itemId, options.includeDeleted === true);
    if (!row) return null;
    if (row.library_id !== this.libraryId)
      throw new EvidenceShelfScopeError(itemId, this.libraryId);
    if (options.projectId !== undefined && row.project_id !== options.projectId) {
      throw new Error(`Evidence shelf item ${itemId} is outside project ${options.projectId}`);
    }
    return toEvidenceShelfItem(row);
  }

  async remove(input: EvidenceShelfRemoveInput): Promise<boolean>;
  async remove(projectId: string, itemId: string, expectedUpdatedAt?: number): Promise<boolean>;
  async remove(
    inputOrProjectId: EvidenceShelfRemoveInput | string,
    positionalItemId?: string,
    positionalUpdatedAt?: number,
  ): Promise<boolean> {
    const input: EvidenceShelfRemoveInput =
      typeof inputOrProjectId === "string"
        ? {
            projectId: inputOrProjectId,
            itemId: positionalItemId ?? "",
            expectedUpdatedAt: positionalUpdatedAt,
          }
        : inputOrProjectId;
    this.assertInputLibrary(input.libraryId);
    assertEvidenceShelfId(input.itemId, "Evidence shelf item id");
    return withDatabaseWriteLock(this.db, async () => {
      await this.requireActiveLibrary();
      await this.requireActiveProject(input.projectId);
      const row = await this.storageById(input.itemId, true);
      if (!row) return false;
      if (row.library_id !== this.libraryId) {
        throw new EvidenceShelfScopeError(input.itemId, this.libraryId);
      }
      this.assertOwnedProject(row, input.projectId);
      if (row.deleted_at !== null) return false;
      if (input.expectedUpdatedAt !== undefined && row.updated_at !== input.expectedUpdatedAt) {
        throw new Error("Evidence shelf item changed; reload it before removing");
      }
      const now = Math.max(Date.now(), row.updated_at + 1);
      const changed = await this.db.run(
        `UPDATE evidence_shelf_items
         SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND library_id = ? AND project_id = ?
           AND deleted_at IS NULL${
             input.expectedUpdatedAt === undefined ? "" : " AND updated_at = ?"
           }`,
        input.expectedUpdatedAt === undefined
          ? [now, now, input.itemId, this.libraryId, input.projectId]
          : [now, now, input.itemId, this.libraryId, input.projectId, input.expectedUpdatedAt],
      );
      return changed === 1;
    });
  }

  async clear(projectId: string | { projectId: string; libraryId?: string }): Promise<number> {
    const id = typeof projectId === "string" ? projectId : projectId.projectId;
    this.assertInputLibrary(typeof projectId === "string" ? undefined : projectId.libraryId);
    return withDatabaseWriteLock(this.db, async () => {
      await this.requireActiveLibrary();
      await this.requireActiveProject(id);
      const now = Date.now();
      return this.db.run(
        `UPDATE evidence_shelf_items
         SET deleted_at = ?, updated_at = MAX(updated_at + 1, ?)
         WHERE library_id = ? AND project_id = ? AND deleted_at IS NULL`,
        [now, now, this.libraryId, id],
      );
    });
  }

  async resolveForSave(
    input: EvidenceShelfResolveForSaveInput,
  ): Promise<EvidenceShelfResolveForSaveResult>;
  async resolveForSave(
    itemId: string,
    expectedRevisionId: string | null,
    expectedSourceContentHash: string,
    projectId?: string,
  ): Promise<EvidenceShelfResolveForSaveResult>;
  async resolveForSave(
    inputOrItemId: EvidenceShelfResolveForSaveInput | string,
    positionalRevisionId?: string | null,
    positionalHash?: string,
    positionalProjectId?: string,
  ): Promise<EvidenceShelfResolveForSaveResult> {
    const input: EvidenceShelfResolveForSaveInput =
      typeof inputOrItemId === "string"
        ? {
            itemId: inputOrItemId,
            expectedRevisionId: positionalRevisionId ?? null,
            expectedSourceContentHash: positionalHash,
            projectId: positionalProjectId,
          }
        : {
            ...inputOrItemId,
            // JavaScript callers can still omit a field despite the TypeScript
            // contract. Treat an omitted revision as the explicit detached
            // (`NULL`) snapshot rather than turning a valid row stale.
            expectedRevisionId: inputOrItemId.expectedRevisionId ?? null,
          };
    this.assertInputLibrary(input.libraryId);
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "evidence_shelf_resolve", async () => {
        await this.requireActiveLibrary();
        assertEvidenceShelfId(input.itemId, "Evidence shelf item id");
        if (input.expectedRevisionId !== null && input.expectedRevisionId !== undefined) {
          assertEvidenceShelfId(input.expectedRevisionId, "Expected revision id");
        }
        if (
          input.expectedSourceContentHash !== undefined &&
          input.expectedHash !== undefined &&
          input.expectedSourceContentHash !== input.expectedHash
        ) {
          throw new Error("Evidence shelf expected hashes disagree");
        }
        const expectedHash = input.expectedSourceContentHash ?? input.expectedHash;
        assertEvidenceShelfHash(expectedHash);
        if (input.projectId !== undefined) await this.requireActiveProject(input.projectId);
        const row = await this.storageById(input.itemId, true);
        if (!row) return { item: null, stale: true };
        if (row.library_id !== this.libraryId) {
          throw new EvidenceShelfScopeError(input.itemId, this.libraryId);
        }
        if (input.projectId !== undefined) {
          this.assertOwnedProject(row, input.projectId);
        } else {
          // A save resolution is project-scoped even for legacy callers that
          // omit projectId. Do not allow an archived/deleted project to reuse
          // a shelf row through the positional compatibility overload.
          await this.requireActiveProject(row.project_id);
        }
        if (row.deleted_at !== null) return { item: null, stale: true };
        const stale =
          Number(row.is_stale) !== 0 ||
          row.revision_id !== input.expectedRevisionId ||
          row.source_content_hash !== expectedHash;
        if (stale !== (row.status === "stale")) {
          await this.db.run(
            `UPDATE evidence_shelf_items
             SET status = ?, updated_at = MAX(updated_at + 1, ?)
             WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
            [stale ? "stale" : "staged", Date.now(), row.id, this.libraryId],
          );
        }
        const item = await this.get(row.id);
        return { item, stale };
      }),
    );
  }

  private async normalizeStageInput(
    input: EvidenceShelfStageInput,
  ): Promise<NormalizedEvidenceShelfStage> {
    if (!input || typeof input !== "object")
      throw new Error("Evidence shelf stage input is invalid");
    this.assertInputLibrary(input.libraryId);
    assertEvidenceShelfId(input.projectId, "Research project id");
    assertEvidenceShelfId(input.contentUnitId, "ContentUnit id");
    if (input.itemId !== undefined) assertEvidenceShelfId(input.itemId, "Evidence shelf item id");

    const unit = await canonicalEvidenceShelfUnit(this.db, this.libraryId, input.contentUnitId);
    const source = {
      workId: unit.work_id,
      assetId: unit.asset_id,
      revisionId: unit.revision_id,
      sourceType: unit.source_type,
      sourceId: unit.source_id,
    } satisfies EvidenceShelfSourceIdentity;
    const anchorJson = serializeEvidenceShelfJson(input.anchorSnapshot, "anchor snapshot");
    if (!isEvidenceShelfRecord(JSON.parse(anchorJson))) {
      throw new Error("Evidence shelf anchor snapshot must be a JSON object");
    }
    const canonicalAnchor = JSON.parse(unit.anchor_json) as unknown;
    if (!isEvidenceShelfRecord(canonicalAnchor)) {
      throw new Error("Canonical ContentUnit anchor snapshot must be a JSON object");
    }
    if (anchorJson !== canonicalizeEvidenceShelfJson(unit.anchor_json)) {
      throw new Error("Evidence shelf anchor snapshot does not match the canonical ContentUnit");
    }
    const previewJson = serializeEvidenceShelfPreview(input.previewPayload, {
      contentUnitId: unit.id,
      sourceType: unit.source_type,
      sourceId: unit.source_id,
      text: unit.text,
      ordinal: unit.ordinal,
      headingPath: unit.heading_path_json === null ? null : JSON.parse(unit.heading_path_json),
      language: unit.language,
      tokenCount: unit.token_count,
    });
    assertEvidenceShelfHash(unit.content_hash);
    await assertEvidenceShelfSourceActive(this.db, this.libraryId, source);
    return {
      projectId: input.projectId,
      itemId: input.itemId,
      ...source,
      // Keep the exact canonical unit encoding used by the source row. This
      // makes later stale probes compare the same immutable anchor bytes.
      anchorJson: unit.anchor_json,
      previewJson,
      sourceContentHash: unit.content_hash,
    };
  }

  private async requireActiveProject(projectId: string): Promise<void> {
    assertEvidenceShelfId(projectId, "Research project id");
    const rows = await this.db.query<{ id: string; library_id: string }>(
      `SELECT id, library_id FROM research_projects
       WHERE id = ? AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
      [projectId],
    );
    if (rows[0] && rows[0].library_id !== this.libraryId)
      throw new EvidenceShelfScopeError(projectId, this.libraryId);
    if (!rows[0]) throw new Error(`Research project ${projectId} is missing, archived, or removed`);
  }

  private async requireActiveLibrary(): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [this.libraryId],
    );
    if (!rows[0]) throw new Error(`Library ${this.libraryId} is missing or removed`);
  }

  private assertInputLibrary(inputLibraryId: string | undefined): void {
    if (inputLibraryId !== undefined && inputLibraryId !== this.libraryId) {
      throw new EvidenceShelfScopeError(inputLibraryId, this.libraryId);
    }
  }

  private async storageById(
    itemId: string,
    includeDeleted: boolean,
  ): Promise<EvidenceShelfStorageRow | null> {
    const rows = await this.db.query<EvidenceShelfStorageRow>(
      `${SHELF_SELECT} WHERE shelf.id = ? LIMIT 1`,
      [itemId],
    );
    const row = rows[0];
    if (!row || (!includeDeleted && row.deleted_at !== null)) return null;
    return row;
  }

  private async findBySource(
    source: NormalizedEvidenceShelfStage,
  ): Promise<EvidenceShelfStorageRow | null> {
    const rows = await this.db.query<EvidenceShelfStorageRow>(
      `${SHELF_SELECT}
       WHERE shelf.library_id = ? AND shelf.project_id = ?
         AND shelf.work_id IS ? AND shelf.asset_id IS ? AND shelf.revision_id IS ?
         AND COALESCE(
           json_extract(shelf.preview_payload_json, '$.sourceType'),
           json_extract(shelf.preview_payload_json, '$.source_type')
         ) = ?
         AND COALESCE(
           json_extract(shelf.preview_payload_json, '$.sourceId'),
           json_extract(shelf.preview_payload_json, '$.source_id')
         ) = ?
         AND shelf.source_content_hash = ?
         AND shelf.anchor_snapshot_json = ?
       ORDER BY shelf.deleted_at IS NULL DESC, shelf.updated_at DESC, shelf.id ASC
       LIMIT 1`,
      [
        this.libraryId,
        source.projectId,
        source.workId,
        source.assetId,
        source.revisionId,
        source.sourceType,
        source.sourceId,
        source.sourceContentHash,
        source.anchorJson,
      ],
    );
    return rows[0] ?? null;
  }

  private async restoreRow(itemId: string, updatedAt: number): Promise<void> {
    const changed = await this.db.run(
      `UPDATE evidence_shelf_items SET deleted_at = NULL, status = 'staged',
              updated_at = MAX(updated_at + 1, ?)
       WHERE id = ? AND library_id = ? AND updated_at = ? AND deleted_at IS NOT NULL`,
      [Date.now(), itemId, this.libraryId, updatedAt],
    );
    if (changed !== 1) throw new Error(`Evidence shelf item ${itemId} changed while restoring`);
  }

  private assertOwnedProject(row: EvidenceShelfStorageRow, projectId: string): void {
    if (row.project_id !== projectId)
      throw new Error(`Evidence shelf item ${row.id} is outside project ${projectId}`);
  }
}
