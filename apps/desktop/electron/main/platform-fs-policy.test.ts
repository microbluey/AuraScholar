import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRendererReadableFile, resolveRendererBlobPdfPath } from "./platform-fs-policy";

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

describe("renderer filesystem read policy", () => {
  it("allows only canonical PDF blobs", async () => {
    const root = await appDataRoot();
    const sha = "a".repeat(64);
    const blob = resolveRendererBlobPdfPath(root, sha);
    await fs.mkdir(join(root, "blobs", "aa"), { recursive: true });
    await fs.writeFile(blob.absolutePath, "pdf bytes");
    await expect(readRendererReadableFile(blob)).resolves.toEqual(
      new TextEncoder().encode("pdf bytes"),
    );

    expect(() => resolveRendererBlobPdfPath(root, "not-a-sha")).toThrow();
  });

  it("does not follow a readable filename into a secrets file", async () => {
    const root = await appDataRoot();
    const sha = "b".repeat(64);
    const target = resolveRendererBlobPdfPath(root, sha);
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

    await expect(readRendererReadableFile(target)).rejects.toThrow("readable file is unsafe");
  });
});

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
