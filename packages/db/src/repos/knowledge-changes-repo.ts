import type { Database } from "../database.js";
import { withDatabaseSavepoint } from "../savepoint.js";
import { withDatabaseWriteLock } from "./write-lock.js";
import type {
  AppendKnowledgeChangeInput,
  KnowledgeChangeRow,
  KnowledgeChangeStorageRow,
} from "./knowledge-contract.js";
import { normalizeChangeInput, toKnowledgeChangeRow } from "./knowledge-queue-support.js";
import { assertActiveLibrary, assertId, normalizeLimit } from "./knowledge-utils.js";

/**
 * Appends an outbox record without acquiring a second lock or transaction.
 * Canonical repositories call this inside their existing savepoint so source
 * mutation and invalidation either commit or roll back together.
 */
export async function appendKnowledgeChangeInTransaction(
  db: Database,
  input: AppendKnowledgeChangeInput,
): Promise<KnowledgeChangeRow> {
  const normalized = normalizeChangeInput(input);
  await assertActiveLibrary(db, normalized.libraryId);
  await db.run(
    `INSERT INTO knowledge_changes
       (library_id, source_type, source_id, change_kind,
        expected_revision_id, expected_content_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      normalized.libraryId,
      normalized.sourceType,
      normalized.sourceId,
      normalized.changeKind,
      normalized.expectedRevisionId,
      normalized.expectedContentHash,
      normalized.createdAt,
    ],
  );
  const seq = Number(await db.queryScalar("SELECT last_insert_rowid()"));
  if (!Number.isSafeInteger(seq) || seq <= 0) {
    throw new Error("Knowledge change did not receive a durable sequence number");
  }
  return {
    seq,
    libraryId: normalized.libraryId,
    sourceType: normalized.sourceType,
    sourceId: normalized.sourceId,
    changeKind: normalized.changeKind,
    expectedRevisionId: normalized.expectedRevisionId,
    expectedContentHash: normalized.expectedContentHash,
    createdAt: normalized.createdAt,
  };
}

export class KnowledgeChangesRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    assertId(libraryId, "Library id");
  }

  async append(input: Omit<AppendKnowledgeChangeInput, "libraryId">): Promise<KnowledgeChangeRow> {
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_change_append", () =>
        appendKnowledgeChangeInTransaction(this.db, { ...input, libraryId: this.libraryId }),
      ),
    );
  }

  async list(options: { afterSeq?: number; limit?: number } = {}): Promise<KnowledgeChangeRow[]> {
    const afterSeq = options.afterSeq ?? 0;
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new Error("afterSeq must be a non-negative integer");
    }
    const limit = normalizeLimit(options.limit, 100, "limit");
    const rows = await this.db.query<KnowledgeChangeStorageRow>(
      `SELECT seq, library_id, source_type, source_id, change_kind,
              expected_revision_id, expected_content_hash, created_at
       FROM knowledge_changes
       WHERE library_id = ? AND seq > ?
       ORDER BY seq ASC
       LIMIT ?`,
      [this.libraryId, afterSeq, limit],
    );
    return rows.map(toKnowledgeChangeRow);
  }
}
