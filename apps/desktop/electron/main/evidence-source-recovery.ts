import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import type { Database } from "@aurascholar/db";
import { newId } from "@aurascholar/db/ids";
import {
  CH,
  type RecoverEvidenceSourceInput,
  type RecoverEvidenceSourceResult,
} from "../shared";
import { withMainDatabase, withMainDatabaseTransaction } from "./db";
import { handle } from "./ipc";
import { assertActiveLocalLibrary, isRecord, requireRecordId } from "./data-command-runtime";

const MAX_RECOVERY_BYTES = 512 * 1024 * 1024;

interface EvidenceSourceRecoveryRow {
  anchor_json: string;
  asset_deleted_at: number | null;
  asset_id: string;
  asset_library_id: string;
  attachment_byte_size: number | null;
  attachment_deleted_at: number | null;
  attachment_id: string | null;
  attachment_sha256: string | null;
  attachment_work_id: string | null;
  blob_sha256: string;
  byte_size: number;
  evidence_deleted_at: number | null;
  evidence_id: string;
  evidence_asset_id: string;
  evidence_library_id: string;
  evidence_revision_id: string;
  evidence_updated_at: number;
  mime_type: string;
  revision_deleted_at: number | null;
  revision_created_at: number;
  revision_id: string;
  work_deleted_at: number | null;
  work_id: string;
  work_library_id: string;
}

export interface EvidenceSourceRecoveryDependencies {
  inspect<T>(operation: (database: Database) => T | Promise<T>): Promise<T>;
  transaction<T>(operation: (database: Database) => T | Promise<T>): Promise<T>;
  writeBlob(sha256: string, bytes: Uint8Array): Promise<void>;
}

const defaultDependencies: EvidenceSourceRecoveryDependencies = {
  inspect: withMainDatabase,
  transaction: (operation) => withMainDatabaseTransaction("evidence.recoverSource", operation),
  writeBlob: writeEvidenceBlob,
};

export function registerEvidenceSourceRecoveryHandlers(): void {
  handle(CH.evidenceRecoverSource, (_event, value: unknown) =>
    recoverEvidenceSource(value, defaultDependencies),
  );
}

export async function recoverEvidenceSource(
  value: unknown,
  dependencies: EvidenceSourceRecoveryDependencies = defaultDependencies,
): Promise<RecoverEvidenceSourceResult> {
  const input = parseRecoveryInput(value);
  const prepared = await dependencies.inspect(async (database) => {
    await assertActiveLocalLibrary(database, input.libraryId);
    return requireRecoverableSource(database, input.libraryId, input.evidenceId);
  });
  if (prepared.byte_size !== input.bytes.byteLength) {
    throw new Error("所选文件大小与 Evidence 的原始修订不一致");
  }
  const actualSha256 = sha256(input.bytes);
  if (actualSha256 !== prepared.blob_sha256) {
    throw new Error("所选文件不是该 Evidence 对应的原始修订");
  }

  await dependencies.writeBlob(actualSha256, input.bytes);

  return dependencies.transaction(async (database) => {
    await assertActiveLocalLibrary(database, input.libraryId);
    const current = await requireRecoverableSource(database, input.libraryId, input.evidenceId);
    assertSourceUnchanged(prepared, current);
    const attachment = reusableAttachment(current);
    const attachmentId = attachment ? current.attachment_id! : newId();
    const now = Date.now();
    if (!attachment) {
      await database.run(
        `INSERT INTO attachments
           (id, work_id, kind, sha256, byte_size, original_filename, source_url,
            fetched_via, page_count, text_extracted_at, created_at, updated_at, deleted_at)
         VALUES (?, ?, 'pdf', ?, ?, ?, NULL, 'evidence-recovery', NULL, NULL, ?, ?, NULL)`,
        [
          attachmentId,
          current.work_id,
          current.blob_sha256,
          current.byte_size,
          input.fileName,
          current.revision_created_at,
          now,
        ],
      );
    }
    const changed = await database.run(
      `UPDATE document_revisions
       SET attachment_id = ?, availability_status = 'available', availability_checked_at = ?
       WHERE id = ? AND asset_id = ? AND blob_sha256 = ? AND byte_size = ?
         AND deleted_at IS NULL`,
      [
        attachmentId,
        now,
        current.revision_id,
        current.asset_id,
        current.blob_sha256,
        current.byte_size,
      ],
    );
    if (changed !== 1) throw new Error("原始修订在恢复期间发生变化，请刷新后重试");
    return {
      attachmentId,
      evidenceId: current.evidence_id,
      pageIndex: pageIndexFromAnchor(current.anchor_json),
      reusedAttachment: attachment,
      revisionId: current.revision_id,
      workId: current.work_id,
    };
  });
}

async function requireRecoverableSource(
  database: Database,
  libraryId: string,
  evidenceId: string,
): Promise<EvidenceSourceRecoveryRow> {
  const rows = await database.query<EvidenceSourceRecoveryRow>(
    `SELECT evidence.id AS evidence_id, evidence.library_id AS evidence_library_id,
            evidence.asset_id AS evidence_asset_id,
            evidence.revision_id AS evidence_revision_id,
            evidence.anchor_json, evidence.updated_at AS evidence_updated_at,
            evidence.deleted_at AS evidence_deleted_at,
            revision.id AS revision_id, revision.asset_id, revision.mime_type,
            revision.blob_sha256, revision.byte_size, revision.attachment_id,
            revision.created_at AS revision_created_at,
            revision.deleted_at AS revision_deleted_at,
            asset.library_id AS asset_library_id, asset.work_id,
            asset.deleted_at AS asset_deleted_at,
            work.library_id AS work_library_id, work.deleted_at AS work_deleted_at,
            attachment.sha256 AS attachment_sha256,
            attachment.byte_size AS attachment_byte_size,
            attachment.work_id AS attachment_work_id,
            attachment.deleted_at AS attachment_deleted_at
     FROM evidence_items evidence
     JOIN document_revisions revision ON revision.id = evidence.revision_id
     JOIN document_assets asset ON asset.id = revision.asset_id
     JOIN works work ON work.id = asset.work_id AND work.id = evidence.work_id
     LEFT JOIN attachments attachment ON attachment.id = revision.attachment_id
     WHERE evidence.id = ?
     LIMIT 1`,
    [evidenceId],
  );
  const source = rows[0];
  if (
    !source ||
    source.evidence_library_id !== libraryId ||
    source.asset_library_id !== libraryId ||
    source.work_library_id !== libraryId
  ) {
    throw new Error("Evidence 来源不存在或不属于当前 Library");
  }
  if (
    source.evidence_deleted_at !== null ||
    source.work_deleted_at !== null ||
    source.asset_deleted_at !== null ||
    source.revision_deleted_at !== null
  ) {
    throw new Error("Evidence 的原始来源已移除，不能重新关联");
  }
  if (
    source.evidence_revision_id !== source.revision_id ||
    source.evidence_asset_id !== source.asset_id
  ) {
    throw new Error("Evidence 与原始修订的绑定不一致");
  }
  if (source.mime_type !== "application/pdf") {
    throw new Error("当前仅支持恢复 PDF Evidence 来源");
  }
  return source;
}

function assertSourceUnchanged(
  prepared: EvidenceSourceRecoveryRow,
  current: EvidenceSourceRecoveryRow,
): void {
  if (
    current.evidence_updated_at !== prepared.evidence_updated_at ||
    current.evidence_asset_id !== prepared.evidence_asset_id ||
    current.asset_id !== prepared.asset_id ||
    current.revision_id !== prepared.revision_id ||
    current.revision_created_at !== prepared.revision_created_at ||
    current.work_id !== prepared.work_id ||
    current.blob_sha256 !== prepared.blob_sha256 ||
    current.byte_size !== prepared.byte_size
  ) {
    throw new Error("Evidence 来源在文件校验期间发生变化，请刷新后重试");
  }
}

function reusableAttachment(source: EvidenceSourceRecoveryRow): boolean {
  return Boolean(
    source.attachment_id &&
      source.attachment_deleted_at === null &&
      source.attachment_sha256 === source.blob_sha256 &&
      source.attachment_byte_size === source.byte_size &&
      source.attachment_work_id === source.work_id,
  );
}

function parseRecoveryInput(value: unknown): RecoverEvidenceSourceInput {
  if (!isRecord(value)) throw new Error("无效的 Evidence 来源恢复请求");
  const bytes = toUint8Array(value.bytes);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RECOVERY_BYTES) {
    throw new Error("恢复文件为空或超过 512 MiB 限制");
  }
  if (typeof value.fileName !== "string") throw new Error("恢复文件名无效");
  const fileName = value.fileName.trim();
  if (!fileName || fileName.length > 512) throw new Error("恢复文件名无效");
  return {
    bytes,
    evidenceId: requireRecordId(value.evidenceId, "Evidence id"),
    fileName,
    libraryId: requireRecordId(value.libraryId, "Library id"),
  };
}

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("恢复文件字节无效");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256")
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest("hex");
}

function pageIndexFromAnchor(anchorJson: string): number {
  try {
    const anchor = JSON.parse(anchorJson) as { pageIndex?: unknown };
    return typeof anchor.pageIndex === "number" && Number.isInteger(anchor.pageIndex)
      ? Math.max(0, anchor.pageIndex)
      : 0;
  } catch {
    return 0;
  }
}

async function writeEvidenceBlob(sha: string, bytes: Uint8Array): Promise<void> {
  const target = join(app.getPath("userData"), "blobs", sha.slice(0, 2), `${sha}.pdf`);
  await writeContentAddressedEvidenceBlob(target, sha, bytes);
}

export async function writeContentAddressedEvidenceBlob(
  target: string,
  expectedSha256: string,
  bytes: Uint8Array,
): Promise<void> {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.mkdir(dirname(target), { recursive: true });
  if (await contentAddressedFileMatches(target, expectedSha256, bytes.byteLength)) return;
  try {
    await fs.writeFile(
      temporary,
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      { flag: "wx", mode: 0o600 },
    );
    try {
      await fs.rename(temporary, target);
    } catch (error) {
      // Windows does not reliably replace an existing target with rename(). A
      // concurrent writer may already have committed the same content-addressed
      // blob, in which case this operation is already complete.
      if (await contentAddressedFileMatches(target, expectedSha256, bytes.byteLength)) return;
      // A mismatched target is already corrupt. Overwrite it from the verified
      // temporary file so Windows can recover too, then verify the final bytes.
      await fs.copyFile(temporary, target).catch(() => {
        throw error;
      });
      if (!(await contentAddressedFileMatches(target, expectedSha256, bytes.byteLength))) {
        throw new Error("恢复后的内容寻址文件校验失败", { cause: error });
      }
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function contentAddressedFileMatches(
  target: string,
  expectedSha256: string,
  expectedBytes: number,
): Promise<boolean> {
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size !== expectedBytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(target)) hash.update(chunk);
    return hash.digest("hex") === expectedSha256;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
