import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CanonicalPdfBlobReadLimitError,
  readCanonicalPdfBlobFile,
  resolveCanonicalPdfBlobPath,
} from "./platform-fs-policy";
import { MAX_READER_PDF_IPC_BYTES } from "../reader-pdf-ipc-limit";

const roots: string[] = [];

async function appDataRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), "aurascholar-platform-fs-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true }).catch(() => {})),
  );
});

describe("main canonical PDF blob read policy", () => {
  it("allows only canonical PDF blobs", async () => {
    const root = await appDataRoot();
    const sha = "a".repeat(64);
    const blob = resolveCanonicalPdfBlobPath(root, sha);
    await fs.mkdir(join(root, "blobs", "aa"), { recursive: true });
    await fs.writeFile(blob.absolutePath, "pdf bytes");
    await expect(readCanonicalPdfBlobFile(blob)).resolves.toEqual(
      new TextEncoder().encode("pdf bytes"),
    );

    expect(() => resolveCanonicalPdfBlobPath(root, "not-a-sha")).toThrow();
  });

  it("does not follow a readable filename into a secrets file", async () => {
    const root = await appDataRoot();
    const sha = "b".repeat(64);
    const target = resolveCanonicalPdfBlobPath(root, sha);
    const secret = join(root, "secrets.json");
    await fs.mkdir(join(root, "blobs", "bb"), { recursive: true });
    await fs.writeFile(secret, "private token");
    try {
      await fs.symlink(secret, target.absolutePath, "file");
    } catch (error) {
      if (!(process.platform === "win32" && isNodeError(error) && error.code === "EPERM")) {
        throw error;
      }
      return;
    }

    await expect(readCanonicalPdfBlobFile(target)).rejects.toThrow("Canonical PDF blob is unsafe");
  });

  it("uses trusted size expectations to bound a canonical PDF read", async () => {
    const root = await appDataRoot();
    const sha = "c".repeat(64);
    const target = resolveCanonicalPdfBlobPath(root, sha);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await fs.mkdir(join(root, "blobs", "cc"), { recursive: true });
    await fs.writeFile(target.absolutePath, bytes);

    await expect(
      readCanonicalPdfBlobFile(target, {
        expectedByteSize: bytes.byteLength,
        maxBytes: bytes.byteLength,
      }),
    ).resolves.toEqual(bytes);
    await expect(
      readCanonicalPdfBlobFile(target, { expectedByteSize: bytes.byteLength, maxBytes: 3 }),
    ).rejects.toBeInstanceOf(CanonicalPdfBlobReadLimitError);
    await expect(
      readCanonicalPdfBlobFile(target, { expectedByteSize: 3, maxBytes: bytes.byteLength }),
    ).rejects.toThrow("Canonical PDF blob size does not match its attachment record");
    await expect(fs.readFile(target.absolutePath)).resolves.toEqual(Buffer.from(bytes));
  });

  it("rejects a sparse oversized PDF before allocating its contents", async () => {
    const root = await appDataRoot();
    const sha = "d".repeat(64);
    const target = resolveCanonicalPdfBlobPath(root, sha);
    const byteSize = MAX_READER_PDF_IPC_BYTES + 1;
    await fs.mkdir(join(root, "blobs", "dd"), { recursive: true });
    await fs.writeFile(target.absolutePath, new Uint8Array());
    await fs.truncate(target.absolutePath, byteSize);

    await expect(
      readCanonicalPdfBlobFile(target, {
        expectedByteSize: byteSize,
        maxBytes: MAX_READER_PDF_IPC_BYTES,
      }),
    ).rejects.toBeInstanceOf(CanonicalPdfBlobReadLimitError);
    await expect(fs.stat(target.absolutePath)).resolves.toMatchObject({ size: byteSize });
  });
});

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
