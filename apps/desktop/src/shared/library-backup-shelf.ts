import type { UserBackupTable } from "./library-backup-config";
import { EVIDENCE_SHELF_BACKUP_VERSION } from "./library-backup-shelf-constants";
import { stableJson } from "./library-backup-shelf-preview";

export { EVIDENCE_SHELF_BACKUP_VERSION } from "./library-backup-shelf-constants";
export { validateEvidenceShelfBackupGraph } from "./library-backup-shelf-graph";

export interface EvidenceShelfBackupIdMaps {
  annotations: ReadonlyMap<string, string>;
  assets: ReadonlyMap<string, string>;
  evidence: ReadonlyMap<string, string>;
  projects: ReadonlyMap<string, string>;
  revisions: ReadonlyMap<string, string>;
  shelfItems: ReadonlyMap<string, string>;
  works: ReadonlyMap<string, string>;
}

export interface EvidenceShelfBackupRemapResult {
  redirected: boolean;
  row: Record<string, unknown>;
}

/**
 * Shelf rows were introduced after the v5 saved-search format. An empty Shelf
 * table is tolerated in older payloads for forward-compatible preview tooling,
 * while non-empty Shelf rows are never silently ignored.
 */
export function assertEvidenceShelfTablesMatchVersion(
  version: number,
  rawTables: Record<string, unknown>,
): void {
  const shelfRows = rawTables.evidence_shelf_items;
  if (version >= EVIDENCE_SHELF_BACKUP_VERSION) {
    // A complete v6 export always carries all membership tables, even when
    // they are empty. Requiring their containers whenever Shelf rows exist
    // prevents a forged payload from omitting the graph and bypassing the
    // project-ownership check in the structural validator.
    if (
      Array.isArray(shelfRows) &&
      shelfRows.length > 0 &&
      shelfRows.every((row) => isRecord(row))
    ) {
      for (const table of ["project_works", "project_assets", "project_evidence"] as const) {
        if (!Array.isArray(rawTables[table])) {
          throw new Error(`v${version} Evidence Shelf 备份缺少项目成员表：${table}`);
        }
      }
    }
    return;
  }
  if (Array.isArray(shelfRows) && shelfRows.length > 0) {
    throw new Error(
      `v${version} 备份不能包含 v${EVIDENCE_SHELF_BACKUP_VERSION} Evidence Shelf 表：evidence_shelf_items`,
    );
  }
}

/**
 * Remaps the durable foreign keys and the source identifiers embedded in a
 * Shelf preview. ContentUnit ids are intentionally left opaque: ContentUnits
 * are disposable and are regenerated from the imported canonical source.
 */
export function remapEvidenceShelfBackupRow(
  table: UserBackupTable,
  row: Record<string, unknown>,
  maps: EvidenceShelfBackupIdMaps,
): EvidenceShelfBackupRemapResult {
  if (table !== "evidence_shelf_items") return { redirected: false, row };

  let next = row;
  let redirected = false;
  const update = (field: string, value: unknown) => {
    if (next === row) next = { ...row };
    if (next[field] !== value) redirected = true;
    next[field] = value;
  };
  const remap = (field: string, map: ReadonlyMap<string, string>) => {
    const current = stringValue(next[field]);
    if (!current) return;
    const mapped = map.get(current);
    if (mapped && mapped !== current) update(field, mapped);
  };

  remap("id", maps.shelfItems);
  remap("project_id", maps.projects);
  remap("work_id", maps.works);
  remap("asset_id", maps.assets);
  remap("revision_id", maps.revisions);

  const anchor = parseJsonObject(row.anchor_snapshot_json);
  const anchorRevisionId = anchor ? stringValue(anchor.revisionId ?? anchor.revision_id) : null;
  if (anchor && anchorRevisionId) {
    const mappedRevisionId = maps.revisions.get(anchorRevisionId) ?? anchorRevisionId;
    if (mappedRevisionId !== anchorRevisionId) {
      const nextAnchor = { ...anchor };
      for (const field of ["revisionId", "revision_id"] as const) {
        if (stringValue(anchor[field]) === anchorRevisionId) nextAnchor[field] = mappedRevisionId;
      }
      if (JSON.stringify(nextAnchor) !== JSON.stringify(anchor)) {
        update("anchor_snapshot_json", JSON.stringify(nextAnchor));
      }
    }
  }

  const preview = parseJsonObject(row.preview_payload_json);
  if (preview) {
    const sourceType = stringValue(preview.sourceType ?? preview.source_type);
    const sourceMap =
      sourceType === "pdf"
        ? maps.revisions
        : sourceType === "annotation"
          ? maps.annotations
          : sourceType === "evidence"
            ? maps.evidence
            : null;
    const mappedSourceId = sourceMap
      ? remappedJsonValue(preview, "sourceId", sourceMap)
      : undefined;
    const mappedSourceSnakeId = sourceMap
      ? remappedJsonValue(preview, "source_id", sourceMap)
      : undefined;
    const mappedRevisionId = remappedJsonValue(preview, "revisionId", maps.revisions);
    const mappedRevisionSnakeId = remappedJsonValue(preview, "revision_id", maps.revisions);
    const mappedAssetId = remappedJsonValue(preview, "assetId", maps.assets);
    const mappedAssetSnakeId = remappedJsonValue(preview, "asset_id", maps.assets);
    const mappedWorkId = remappedJsonValue(preview, "workId", maps.works);
    const mappedWorkSnakeId = remappedJsonValue(preview, "work_id", maps.works);
    const nextPreview = {
      ...preview,
      ...(mappedSourceId !== undefined ? { sourceId: mappedSourceId } : {}),
      ...(mappedSourceSnakeId !== undefined ? { source_id: mappedSourceSnakeId } : {}),
      ...(mappedRevisionId !== undefined ? { revisionId: mappedRevisionId } : {}),
      ...(mappedRevisionSnakeId !== undefined ? { revision_id: mappedRevisionSnakeId } : {}),
      ...(mappedAssetId !== undefined ? { assetId: mappedAssetId } : {}),
      ...(mappedAssetSnakeId !== undefined ? { asset_id: mappedAssetSnakeId } : {}),
      ...(mappedWorkId !== undefined ? { workId: mappedWorkId } : {}),
      ...(mappedWorkSnakeId !== undefined ? { work_id: mappedWorkSnakeId } : {}),
    };
    if (JSON.stringify(nextPreview) !== JSON.stringify(preview)) {
      update("preview_payload_json", JSON.stringify(nextPreview));
    }
  }

  return { redirected, row: next };
}

/**
 * Canonicalizes imported Shelf JSON before it is persisted. ContentUnit
 * anchors are compared byte-for-byte by the stale probe, so alias spellings
 * and object-key order must not strand an otherwise valid detached candidate.
 */
export function canonicalizeEvidenceShelfAnchorJson(value: unknown): string {
  if (typeof value !== "string") throw new Error("Evidence Shelf anchor snapshot is invalid");
  const anchor = parseJsonObject(value);
  if (!anchor) throw new Error("Evidence Shelf anchor snapshot is invalid");
  // ContentUnits persist the parsed SourceAnchor with its schema-defined key
  // order, and the stale probe intentionally compares that immutable JSON
  // byte-for-byte. Preserve an already-canonical payload exactly; sorting all
  // keys here would make every normal staged row stale after import. Only
  // rewrite the legacy snake_case alias, retaining the remaining insertion
  // order so old exports stay compatible with the stored anchor encoding.
  if (!hasOwn(anchor, "revision_id")) return value;
  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(anchor)) {
    if (key === "revision_id") {
      if (!hasOwn(anchor, "revisionId")) next.revisionId = nested;
      continue;
    }
    next[key] = nested;
  }
  return JSON.stringify(next);
}

/** Normalizes supported snake_case preview aliases while retaining additive metadata. */
export function canonicalizeEvidenceShelfPreviewJson(value: unknown): string {
  const preview = parseJsonObject(value);
  if (!preview) throw new Error("Evidence Shelf preview payload is invalid");
  const next = { ...preview };
  for (const [camel, snake] of [
    ["contentUnitId", "content_unit_id"],
    ["sourceType", "source_type"],
    ["sourceId", "source_id"],
    ["revisionId", "revision_id"],
    ["assetId", "asset_id"],
    ["workId", "work_id"],
    ["parentUnitId", "parent_unit_id"],
    ["sourceContentHash", "source_content_hash"],
    ["headingPath", "heading_path"],
    ["tokenCount", "token_count"],
    ["workTitle", "work_title"],
  ] as const) {
    if (hasOwn(next, snake)) {
      if (!hasOwn(next, camel)) next[camel] = next[snake];
      delete next[snake];
    }
  }
  return stableJson(next);
}

function remappedJsonValue(
  value: Record<string, unknown>,
  field: string,
  map: ReadonlyMap<string, string>,
): string | undefined {
  if (!hasOwn(value, field)) return undefined;
  const current = stringValue(value[field]);
  if (!current) return current ?? undefined;
  return map.get(current) ?? current;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function hasOwn(value: Record<string, unknown>, field: string): boolean {
  return Object.hasOwn(value, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
