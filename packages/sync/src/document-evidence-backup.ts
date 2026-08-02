import { parseSourceAnchor } from "@aurascholar/anchors";

/** Document/Evidence tables in foreign-key-safe whole-Library import order. */
export const DOCUMENT_EVIDENCE_BACKUP_TABLES = [
  "document_assets",
  "document_revisions",
  "project_assets",
  "evidence_items",
  "project_evidence",
] as const;

export type DocumentEvidenceBackupTable = (typeof DOCUMENT_EVIDENCE_BACKUP_TABLES)[number];

export interface DocumentEvidenceBackupIdMaps {
  assets: ReadonlyMap<string, string>;
  attachments: ReadonlyMap<string, string>;
  evidence: ReadonlyMap<string, string>;
  projectAssets: ReadonlyMap<string, string>;
  projectEvidence: ReadonlyMap<string, string>;
  projects: ReadonlyMap<string, string>;
  revisions: ReadonlyMap<string, string>;
  works: ReadonlyMap<string, string>;
}

export interface DocumentEvidenceBackupRemapResult {
  redirected: boolean;
  row: Record<string, unknown>;
}

export interface DocumentEvidenceBackupRows {
  attachments?: readonly Record<string, unknown>[];
  document_assets?: readonly Record<string, unknown>[];
  document_revisions?: readonly Record<string, unknown>[];
  evidence_items?: readonly Record<string, unknown>[];
  project_assets?: readonly Record<string, unknown>[];
  project_evidence?: readonly Record<string, unknown>[];
  research_projects?: readonly Record<string, unknown>[];
  works?: readonly Record<string, unknown>[];
}

const DOCUMENT_EVIDENCE_REQUIRED_ORDER = [
  "works",
  "research_projects",
  "attachments",
  ...DOCUMENT_EVIDENCE_BACKUP_TABLES,
] as const;

const REVISION_BOUND_ANCHOR_KINDS = new Set(["pdf", "html", "docx", "markdown", "epub"]);

/**
 * Fails fast when whole-Library import would visit a child before a parent.
 * The linear order is intentionally stricter than the minimum partial order so
 * export, preview, import, and tests all expose one deterministic table graph.
 */
export function assertDocumentEvidenceBackupOrder(tables: readonly string[]): void {
  let previousIndex = -1;
  for (const table of DOCUMENT_EVIDENCE_REQUIRED_ORDER) {
    const index = tables.indexOf(table);
    if (index < 0) throw new Error(`Document/Evidence backup is missing table ${table}`);
    if (index <= previousIndex) {
      throw new Error(
        "Document/Evidence backup tables must be ordered works → research_projects → attachments → document_assets → document_revisions → project_assets → evidence_items → project_evidence",
      );
    }
    previousIndex = index;
  }
}

/**
 * Remaps one validated row while preserving separate id namespaces. Library
 * owner translation remains the caller's responsibility.
 */
export function remapDocumentEvidenceBackupRow(
  table: DocumentEvidenceBackupTable,
  row: Record<string, unknown>,
  maps: DocumentEvidenceBackupIdMaps,
): DocumentEvidenceBackupRemapResult {
  let next = row;
  let redirected = false;

  const update = (field: string, value: unknown) => {
    if (next === row) next = { ...row };
    next[field] = value;
    redirected = true;
  };
  const remap = (field: string, map: ReadonlyMap<string, string>) => {
    const current = optionalId(next[field], `${table}.${field}`);
    if (!current) return;
    const mapped = map.get(current);
    if (mapped && mapped !== current) update(field, mapped);
  };

  if (table === "document_assets") {
    remap("id", maps.assets);
    remap("work_id", maps.works);
    remap("current_revision_id", maps.revisions);
    return { redirected, row: next };
  }

  if (table === "document_revisions") {
    remap("id", maps.revisions);
    remap("asset_id", maps.assets);
    remap("attachment_id", maps.attachments);
    return { redirected, row: next };
  }

  if (table === "project_assets") {
    remap("id", maps.projectAssets);
    remap("project_id", maps.projects);
    remap("asset_id", maps.assets);
    return { redirected, row: next };
  }

  if (table === "evidence_items") {
    const sourceRevisionId = requiredId(next.revision_id, "evidence_items.revision_id");
    const anchor = parseRevisionBoundAnchorJson(next.anchor_json);
    if (anchor.revisionId !== sourceRevisionId) {
      throw new Error("Evidence backup anchor revision does not match evidence_items.revision_id");
    }

    remap("id", maps.evidence);
    remap("work_id", maps.works);
    remap("asset_id", maps.assets);
    remap("revision_id", maps.revisions);

    const mappedAnchorRevisionId = maps.revisions.get(anchor.revisionId) ?? anchor.revisionId;
    if (mappedAnchorRevisionId !== anchor.revisionId) {
      update(
        "anchor_json",
        JSON.stringify({ ...anchor.value, revisionId: mappedAnchorRevisionId }),
      );
    }
    return { redirected, row: next };
  }

  remap("id", maps.projectEvidence);
  remap("project_id", maps.projects);
  remap("evidence_id", maps.evidence);
  return { redirected, row: next };
}

/**
 * Validates the canonical Document/Evidence subgraph before import mutates a
 * database. Optional relationships may be absent, but any supplied id must
 * resolve inside the same backup and Library.
 */
export function assertDocumentEvidenceBackupRelationships(
  tables: DocumentEvidenceBackupRows,
): void {
  const works = indexRows("works", tables.works ?? []);
  const projects = indexRows("research_projects", tables.research_projects ?? []);
  const attachments = indexRows("attachments", tables.attachments ?? []);
  const assets = indexRows("document_assets", tables.document_assets ?? []);
  const revisions = indexRows("document_revisions", tables.document_revisions ?? []);
  const evidence = indexRows("evidence_items", tables.evidence_items ?? []);

  for (const asset of assets.values()) {
    const assetId = requiredId(asset.id, "document_assets.id");
    const workId = optionalId(asset.work_id, "document_assets.work_id");
    if (workId) {
      const work = requireIndexedRow(works, workId, "document_assets.work_id");
      assertMatchingLibrary(asset, work, "document_assets.work_id");
    }
    const revisionId = optionalId(asset.current_revision_id, "document_assets.current_revision_id");
    if (revisionId) {
      const revision = requireIndexedRow(
        revisions,
        revisionId,
        "document_assets.current_revision_id",
      );
      if (requiredId(revision.asset_id, "document_revisions.asset_id") !== assetId) {
        throw new Error("Document asset current revision belongs to another asset");
      }
    }
  }

  for (const revision of revisions.values()) {
    const assetId = requiredId(revision.asset_id, "document_revisions.asset_id");
    const asset = requireIndexedRow(assets, assetId, "document_revisions.asset_id");
    const attachmentId = optionalId(revision.attachment_id, "document_revisions.attachment_id");
    if (!attachmentId) continue;
    const attachment = requireIndexedRow(
      attachments,
      attachmentId,
      "document_revisions.attachment_id",
    );
    const assetWorkId = optionalId(asset.work_id, "document_assets.work_id");
    const attachmentWorkId = requiredId(attachment.work_id, "attachments.work_id");
    if (!assetWorkId || assetWorkId !== attachmentWorkId) {
      throw new Error("Document revision attachment belongs to another Work");
    }
  }

  assertProjectAssetRelationships(tables.project_assets ?? [], projects, assets);

  for (const item of evidence.values()) {
    const revisionId = requiredId(item.revision_id, "evidence_items.revision_id");
    const revision = requireIndexedRow(revisions, revisionId, "evidence_items.revision_id");
    const anchor = parseRevisionBoundAnchorJson(item.anchor_json);
    if (anchor.revisionId !== revisionId) {
      throw new Error("Evidence backup anchor revision does not match evidence_items.revision_id");
    }

    const evidenceLibraryId = requiredId(item.library_id, "evidence_items.library_id");
    const assetId = optionalId(item.asset_id, "evidence_items.asset_id");
    const revisionAssetId = requiredId(revision.asset_id, "document_revisions.asset_id");
    if (assetId && assetId !== revisionAssetId) {
      throw new Error("Evidence revision belongs to another asset");
    }
    const asset = requireIndexedRow(assets, revisionAssetId, "evidence_items.revision_id");
    if (requiredId(asset.library_id, "document_assets.library_id") !== evidenceLibraryId) {
      throw new Error("Evidence asset belongs to another Library");
    }

    const workId = optionalId(item.work_id, "evidence_items.work_id");
    if (workId) {
      const work = requireIndexedRow(works, workId, "evidence_items.work_id");
      assertMatchingLibrary(item, work, "evidence_items.work_id");
      const assetWorkId = optionalId(asset.work_id, "document_assets.work_id");
      if (assetWorkId && assetWorkId !== workId) {
        throw new Error("Evidence Work does not match its document asset");
      }
    }
  }

  assertProjectEvidenceRelationships(tables.project_evidence ?? [], projects, evidence);
}

function assertProjectAssetRelationships(
  rows: readonly Record<string, unknown>[],
  projects: ReadonlyMap<string, Record<string, unknown>>,
  assets: ReadonlyMap<string, Record<string, unknown>>,
): void {
  const memberships = new Set<string>();
  for (const row of rows) {
    requiredId(row.id, "project_assets.id");
    const projectId = requiredId(row.project_id, "project_assets.project_id");
    const assetId = requiredId(row.asset_id, "project_assets.asset_id");
    const project = requireIndexedRow(projects, projectId, "project_assets.project_id");
    const asset = requireIndexedRow(assets, assetId, "project_assets.asset_id");
    assertMatchingLibrary(project, asset, "project_assets.asset_id");
    assertUniqueMembership(memberships, projectId, assetId, "project_assets");
  }
}

function assertProjectEvidenceRelationships(
  rows: readonly Record<string, unknown>[],
  projects: ReadonlyMap<string, Record<string, unknown>>,
  evidence: ReadonlyMap<string, Record<string, unknown>>,
): void {
  const memberships = new Set<string>();
  for (const row of rows) {
    requiredId(row.id, "project_evidence.id");
    const projectId = requiredId(row.project_id, "project_evidence.project_id");
    const evidenceId = requiredId(row.evidence_id, "project_evidence.evidence_id");
    const project = requireIndexedRow(projects, projectId, "project_evidence.project_id");
    const item = requireIndexedRow(evidence, evidenceId, "project_evidence.evidence_id");
    assertMatchingLibrary(project, item, "project_evidence.evidence_id");
    assertUniqueMembership(memberships, projectId, evidenceId, "project_evidence");
  }
}

function assertUniqueMembership(
  seen: Set<string>,
  projectId: string,
  targetId: string,
  table: string,
): void {
  const identity = JSON.stringify([projectId, targetId]);
  if (seen.has(identity)) throw new Error(`${table} contains a duplicate semantic membership`);
  seen.add(identity);
}

function indexRows(
  table: string,
  rows: readonly Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = requiredId(row.id, `${table}.id`);
    if (result.has(id)) throw new Error(`${table} contains duplicate id ${id}`);
    result.set(id, row);
  }
  return result;
}

function requireIndexedRow(
  rows: ReadonlyMap<string, Record<string, unknown>>,
  id: string,
  relation: string,
): Record<string, unknown> {
  const row = rows.get(id);
  if (!row) throw new Error(`Document/Evidence backup contains an invalid reference: ${relation}`);
  return row;
}

function assertMatchingLibrary(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  relation: string,
): void {
  const leftLibraryId = requiredId(left.library_id, `${relation} owner`);
  const rightLibraryId = requiredId(right.library_id, `${relation} target owner`);
  if (leftLibraryId !== rightLibraryId) {
    throw new Error(`Document/Evidence backup contains a cross-Library reference: ${relation}`);
  }
}

function parseRevisionBoundAnchorJson(value: unknown): {
  revisionId: string;
  value: Record<string, unknown>;
} {
  if (typeof value !== "string") throw new Error("Evidence backup anchor_json must be JSON text");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Evidence backup anchor_json is malformed");
  }
  if (!isRecord(parsed)) throw new Error("Evidence backup anchor_json is invalid");
  const anchor = parseSourceAnchor(parsed);
  if (!REVISION_BOUND_ANCHOR_KINDS.has(anchor.kind) || !("revisionId" in anchor)) {
    throw new Error(`Evidence backup anchor kind ${anchor.kind} is not revision-bound`);
  }
  return {
    revisionId: anchor.revisionId,
    value: parsed,
  };
}

function optionalId(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return requiredId(value, label);
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
