import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Database } from "@aurascholar/db";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface CanonicalPdfBlobGcDependencies {
  /**
   * Must serialize with every durable attachment/revision writer. The main
   * database coordinator supplies this with a BEGIN IMMEDIATE transaction.
   */
  transaction<T>(
    commandName: string,
    operation: (database: Database) => Promise<T> | T,
  ): Promise<T>;
}

/**
 * Removes exactly one canonical PDF only when no durable database row refers
 * to it. The reference check and unlink run inside the main database
 * transaction, so another main command cannot publish an attachment or
 * revision between the check and deletion.
 */
export async function removeUnreferencedCanonicalPdfBlobAtUserDataRoot(
  userDataRoot: string,
  sha: string,
  dependencies: CanonicalPdfBlobGcDependencies,
): Promise<boolean> {
  if (!SHA256_PATTERN.test(sha)) throw new Error("Canonical PDF blob hash is invalid");

  return dependencies.transaction("library.collectStagedPdfBlob", async (database) => {
    if (await hasDurableCanonicalPdfBlobReference(database, sha)) return false;
    return removeCanonicalPdfBlobFile(userDataRoot, sha);
  });
}

/**
 * Deleted rows intentionally still protect bytes: restoration and historical
 * document revisions may require their original canonical blob later.
 */
async function hasDurableCanonicalPdfBlobReference(
  database: Database,
  sha: string,
): Promise<boolean> {
  const rows = await database.query<{ found: number }>(
    `SELECT 1 AS found
     WHERE EXISTS (SELECT 1 FROM attachments WHERE sha256 = ?)
        OR EXISTS (SELECT 1 FROM document_revisions WHERE blob_sha256 = ?)
     LIMIT 1`,
    [sha, sha],
  );
  return rows.length > 0;
}

async function removeCanonicalPdfBlobFile(userDataRoot: string, sha: string): Promise<boolean> {
  const target = join(userDataRoot, "blobs", sha.slice(0, 2), `${sha}.pdf`);
  try {
    // `unlink` never follows a symlink. Refuse any non-regular target as an
    // additional conservative guard if the userData tree was tampered with.
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    await fs.unlink(target);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
