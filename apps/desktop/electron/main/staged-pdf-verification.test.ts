import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  StagedPdfVerificationError,
  verifyStagedPdfAtUserDataRoot,
} from "./staged-pdf-verification";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nstaged blob verification\n%%EOF");
const PDF_SHA = createHash("sha256").update(PDF_BYTES).digest("hex");

function canonicalPath(root: string, sha = PDF_SHA): string {
  return join(root, "blobs", sha.slice(0, 2), `${sha}.pdf`);
}

async function withUserDataRoot(test: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), "aurascholar-staged-pdf-"));
  try {
    await test(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

async function writeCanonicalBlob(root: string, bytes = PDF_BYTES, sha = PDF_SHA): Promise<string> {
  const target = canonicalPath(root, sha);
  await fs.mkdir(dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  return target;
}

async function expectVerificationFailure(
  root: string,
  receipt: { byteSize: number; sha: string },
  reason: StagedPdfVerificationError["reason"],
): Promise<void> {
  try {
    await verifyStagedPdfAtUserDataRoot(root, receipt);
    throw new Error("Expected staged PDF verification to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(StagedPdfVerificationError);
    expect(error).toMatchObject({ reason });
    expect(String(error)).not.toContain(root);
  }
}

describe("staged PDF verification", () => {
  it("accepts a regular canonical blob whose streamed bytes match its receipt", async () => {
    await withUserDataRoot(async (root) => {
      await writeCanonicalBlob(root);

      await expect(
        verifyStagedPdfAtUserDataRoot(root, { byteSize: PDF_BYTES.byteLength, sha: PDF_SHA }),
      ).resolves.toBeUndefined();
    });
  });

  it("rejects a missing canonical blob without including its path in the error", async () => {
    await withUserDataRoot(async (root) => {
      const target = canonicalPath(root);
      await fs.mkdir(dirname(target), { recursive: true });

      await expectVerificationFailure(
        root,
        { byteSize: PDF_BYTES.byteLength, sha: PDF_SHA },
        "blob-missing",
      );
    });
  });

  it("rejects a non-file canonical target", async () => {
    await withUserDataRoot(async (root) => {
      const target = canonicalPath(root);
      await fs.mkdir(target, { recursive: true });

      await expectVerificationFailure(
        root,
        { byteSize: PDF_BYTES.byteLength, sha: PDF_SHA },
        "blob-unsafe",
      );
    });
  });

  it("rejects a canonical blob whose byte size does not match its receipt", async () => {
    await withUserDataRoot(async (root) => {
      await writeCanonicalBlob(root);

      await expectVerificationFailure(
        root,
        { byteSize: PDF_BYTES.byteLength + 1, sha: PDF_SHA },
        "size-mismatch",
      );
    });
  });

  it("rejects a same-sized canonical blob whose streamed SHA-256 does not match", async () => {
    await withUserDataRoot(async (root) => {
      const corrupt = new Uint8Array(PDF_BYTES);
      corrupt[0] = (corrupt[0] ?? 0) ^ 1;
      await writeCanonicalBlob(root, corrupt);

      await expectVerificationFailure(
        root,
        { byteSize: PDF_BYTES.byteLength, sha: PDF_SHA },
        "hash-mismatch",
      );
    });
  });

  it("rejects a symlink even when its target bytes match the receipt", async () => {
    await withUserDataRoot(async (root) => {
      const target = canonicalPath(root);
      const source = join(root, "outside.pdf");
      await fs.mkdir(dirname(target), { recursive: true });
      await fs.writeFile(source, PDF_BYTES);
      await fs.symlink(source, target);

      await expectVerificationFailure(
        root,
        { byteSize: PDF_BYTES.byteLength, sha: PDF_SHA },
        "blob-unsafe",
      );
    });
  });

  it("rejects symlinked blob directories before resolving a target", async () => {
    await withUserDataRoot(async (root) => {
      const externalBlobs = join(root, "external-blobs");
      await fs.mkdir(join(externalBlobs, PDF_SHA.slice(0, 2)), { recursive: true });
      await fs.symlink(externalBlobs, join(root, "blobs"));

      await expectVerificationFailure(
        root,
        { byteSize: PDF_BYTES.byteLength, sha: PDF_SHA },
        "blob-unsafe",
      );
    });
  });

  it("rejects a symlinked SHA bucket before resolving a target", async () => {
    await withUserDataRoot(async (root) => {
      const bucket = PDF_SHA.slice(0, 2);
      const externalBucket = join(root, "external-bucket");
      await fs.mkdir(join(root, "blobs"), { recursive: true });
      await fs.mkdir(externalBucket, { recursive: true });
      await fs.symlink(externalBucket, join(root, "blobs", bucket));

      await expectVerificationFailure(
        root,
        { byteSize: PDF_BYTES.byteLength, sha: PDF_SHA },
        "blob-unsafe",
      );
    });
  });

  it("rejects noncanonical receipts before deriving a filesystem path", async () => {
    await withUserDataRoot(async (root) => {
      await expectVerificationFailure(
        root,
        { byteSize: PDF_BYTES.byteLength, sha: "../outside" },
        "invalid-receipt",
      );
      await expectVerificationFailure(root, { byteSize: 0, sha: PDF_SHA }, "invalid-receipt");
      await expectVerificationFailure(
        root,
        { byteSize: Number.MAX_SAFE_INTEGER + 1, sha: PDF_SHA },
        "invalid-receipt",
      );
    });
  });
});
