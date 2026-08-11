import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "@aurascholar/db";
import { WorksRepo } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { DocumentAssetsRepo } from "@aurascholar/db/repos/document-assets";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseCoordinator } from "./database-coordinator";
import { removeUnreferencedCanonicalPdfBlobAtUserDataRoot } from "./library-pdf-blob-gc";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nstaged GC fixture\n%%EOF");
const PDF_SHA = createHash("sha256").update(PDF_BYTES).digest("hex");
const roots: string[] = [];

let database: Database;
let coordinator: DatabaseCoordinator;
let libraryId: string;

async function root(): Promise<string> {
  const directory = await fs.mkdtemp(join(tmpdir(), "aurascholar-pdf-gc-"));
  roots.push(directory);
  return directory;
}

function canonicalPath(userDataRoot: string): string {
  return join(userDataRoot, "blobs", PDF_SHA.slice(0, 2), `${PDF_SHA}.pdf`);
}

async function writeCanonicalFixture(userDataRoot: string): Promise<void> {
  const target = canonicalPath(userDataRoot);
  await fs.mkdir(join(userDataRoot, "blobs", PDF_SHA.slice(0, 2)), { recursive: true });
  await fs.writeFile(target, PDF_BYTES);
}

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "library-pdf-gc-device",
    deviceName: "Library PDF GC",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
});

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

function gcDependencies(commands: string[] = []) {
  return {
    transaction<T>(
      commandName: string,
      operation: (target: Database) => Promise<T> | T,
    ): Promise<T> {
      commands.push(commandName);
      return coordinator.transaction(commandName, operation);
    },
  };
}

describe("staged canonical PDF blob GC", () => {
  it("unlinks an unreferenced canonical blob inside the main database transaction", async () => {
    const userDataRoot = await root();
    const commands: string[] = [];
    await writeCanonicalFixture(userDataRoot);

    await expect(
      removeUnreferencedCanonicalPdfBlobAtUserDataRoot(
        userDataRoot,
        PDF_SHA,
        gcDependencies(commands),
      ),
    ).resolves.toBe(true);
    expect(commands).toEqual(["library.collectStagedPdfBlob"]);
    await expect(fs.access(canonicalPath(userDataRoot))).rejects.toThrow();
  });

  it("never deletes a blob retained by an attachment, including a soft-deleted attachment", async () => {
    const userDataRoot = await root();
    const work = await new WorksRepo(database, libraryId).upsert({ title: "Retained attachment" });
    const now = Date.now();
    await database.run(
      `INSERT INTO attachments
         (id, work_id, kind, sha256, byte_size, original_filename, source_url, fetched_via,
          page_count, text_extracted_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, 'pdf', ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
      ["attachment:retained", work.id, PDF_SHA, PDF_BYTES.byteLength, now, now, now],
    );
    await writeCanonicalFixture(userDataRoot);

    await expect(
      removeUnreferencedCanonicalPdfBlobAtUserDataRoot(userDataRoot, PDF_SHA, gcDependencies()),
    ).resolves.toBe(false);
    await expect(fs.readFile(canonicalPath(userDataRoot))).resolves.toEqual(Buffer.from(PDF_BYTES));
  });

  it("never deletes a blob retained only by a document revision", async () => {
    const userDataRoot = await root();
    const assets = new DocumentAssetsRepo(database, libraryId);
    const asset = await assets.create({ kind: "pdf", title: "Historical revision" });
    const revision = await assets.createRevision(asset.id, {
      blobSha256: PDF_SHA,
      byteSize: PDF_BYTES.byteLength,
      mimeType: "application/pdf",
    });
    // Historical/deleted revisions remain a durable reference too.
    await database.run(`UPDATE document_revisions SET deleted_at = ? WHERE id = ?`, [
      Date.now(),
      revision.id,
    ]);
    await writeCanonicalFixture(userDataRoot);

    await expect(
      removeUnreferencedCanonicalPdfBlobAtUserDataRoot(userDataRoot, PDF_SHA, gcDependencies()),
    ).resolves.toBe(false);
    await expect(fs.readFile(canonicalPath(userDataRoot))).resolves.toEqual(Buffer.from(PDF_BYTES));
  });
});
