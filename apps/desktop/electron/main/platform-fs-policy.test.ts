import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteRendererResearchDownloadFile,
  readRendererReadableFile,
  resolveRendererBlobPdfPath,
  resolveRendererResearchDownloadDeletePath,
  resolveRendererResearchDownloadPath,
} from "./platform-fs-policy";

const roots: string[] = [];

async function appDataRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), "aurascholar-platform-fs-"));
  roots.push(root);
  return root;
}

async function createSymlink(
  target: string,
  link: string,
  type: "dir" | "file" | "junction",
): Promise<boolean> {
  try {
    await fs.symlink(target, link, type);
    return true;
  } catch (error) {
    // Windows can deny symlink/junction creation on locked-down developer
    // machines. Parser coverage still runs there; CI hosts normally permit it.
    if (process.platform === "win32" && isNodeError(error) && error.code === "EPERM") return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true }).catch(() => {})),
  );
});

describe("renderer filesystem deletion policy", () => {
  it("allows only individual main-created research downloads", async () => {
    const root = await appDataRoot();
    const download = join(root, "research-downloads", "captured.pdf");
    await fs.mkdir(join(root, "research-downloads"), { recursive: true });
    await fs.writeFile(download, "temporary PDF");
    await deleteRendererResearchDownloadFile(
      resolveRendererResearchDownloadDeletePath(root, "research-downloads/captured.pdf"),
    );
    await expect(fs.access(download)).rejects.toThrow();
    expect(() =>
      resolveRendererResearchDownloadDeletePath(root, "research-downloads/nested/file.pdf"),
    ).toThrow();
    expect(() =>
      resolveRendererResearchDownloadDeletePath(root, "exports/references.bib"),
    ).toThrow();
  });

  it("denies protected and non-download paths", () => {
    const root = join(tmpdir(), "aurascholar-user-data");
    for (const rel of [
      "blobs/ab/hash.pdf",
      ".ingest-staging/receipt",
      "library.sqlite",
      "secrets.json",
      "exports/report.bib",
      "research-downloads/nested/file.pdf",
    ]) {
      expect(() => resolveRendererResearchDownloadDeletePath(root, rel)).toThrow();
    }
  });

  it("rejects Windows aliases, alternate data streams, and mixed path separators", () => {
    const root = join(tmpdir(), "aurascholar-user-data");
    const aliases = [
      "blobs. /ab/hash.pdf",
      "BLOBS\\ab\\hash.pdf",
      ".ingest-staging.\\receipt",
      "exports \\report.bib",
      "exports/report.bib ",
      "exports/report.bib:alternate-stream",
      "exports:alternate-stream/report.bib",
      "exports\\..\\blobs\\hash.pdf",
      "exports//report.bib",
      "C:\\outside\\report.bib",
      "\\\\?\\C:\\outside\\report.bib",
      "exports/con.txt",
      "exports/COM¹.txt",
    ];

    for (const rel of aliases) {
      expect(() => resolveRendererResearchDownloadDeletePath(root, rel)).toThrow();
    }
    expect(() =>
      resolveRendererResearchDownloadDeletePath(root, "research-downloads\\report.pdf"),
    ).not.toThrow();
  });

  it("refuses directory and leaf symlinks instead of traversing into blobs", async () => {
    const root = await appDataRoot();
    const blobs = join(root, "blobs");
    const victim = join(blobs, "canonical.pdf");
    await fs.mkdir(blobs, { recursive: true });
    await fs.writeFile(victim, "canonical bytes");
    const downloadRoot = join(root, "research-downloads");
    if (
      !(await createSymlink(blobs, downloadRoot, process.platform === "win32" ? "junction" : "dir"))
    ) {
      return;
    }

    await expect(
      deleteRendererResearchDownloadFile(
        resolveRendererResearchDownloadDeletePath(root, "research-downloads/canonical.pdf"),
      ),
    ).rejects.toThrow("unsafe directory");
    await expect(fs.readFile(victim, "utf8")).resolves.toBe("canonical bytes");

    await fs.unlink(downloadRoot);
    await fs.mkdir(downloadRoot);
    const leafLink = join(downloadRoot, "leaf-link.pdf");
    if (!(await createSymlink(victim, leafLink, "file"))) return;
    await expect(
      deleteRendererResearchDownloadFile(
        resolveRendererResearchDownloadDeletePath(root, "research-downloads/leaf-link.pdf"),
      ),
    ).rejects.toThrow("target is unsafe");
    await expect(fs.readFile(victim, "utf8")).resolves.toBe("canonical bytes");
  });
});

describe("renderer filesystem read policy", () => {
  it("allows only canonical PDF blobs and one main-created research download", async () => {
    const root = await appDataRoot();
    const sha = "a".repeat(64);
    const blob = resolveRendererBlobPdfPath(root, sha);
    await fs.mkdir(join(root, "blobs", "aa"), { recursive: true });
    await fs.writeFile(blob.absolutePath, "pdf bytes");
    await expect(readRendererReadableFile(blob)).resolves.toEqual(
      new TextEncoder().encode("pdf bytes"),
    );

    const download = resolveRendererResearchDownloadPath(
      root,
      "research-downloads/1710000000000-paper.pdf",
    );
    await fs.mkdir(join(root, "research-downloads"), { recursive: true });
    await fs.writeFile(download.absolutePath, "temporary bytes");
    await expect(readRendererReadableFile(download)).resolves.toEqual(
      new TextEncoder().encode("temporary bytes"),
    );

    expect(() => resolveRendererBlobPdfPath(root, "not-a-sha")).toThrow();
    expect(() => resolveRendererResearchDownloadPath(root, "secrets.json")).toThrow();
    expect(() =>
      resolveRendererResearchDownloadPath(root, "research-downloads/nested/file.pdf"),
    ).toThrow();
  });

  it("does not follow a readable filename into a secrets file", async () => {
    const root = await appDataRoot();
    const sha = "b".repeat(64);
    const target = resolveRendererBlobPdfPath(root, sha);
    const secret = join(root, "secrets.json");
    await fs.mkdir(join(root, "blobs", "bb"), { recursive: true });
    await fs.writeFile(secret, "private token");
    if (!(await createSymlink(secret, target.absolutePath, "file"))) return;

    await expect(readRendererReadableFile(target)).rejects.toThrow("readable file is unsafe");
  });
});
