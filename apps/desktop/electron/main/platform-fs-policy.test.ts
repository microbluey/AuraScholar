import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteRendererMutableFile,
  isRendererMutableAppDataPath,
  mkdirpRendererMutablePath,
  readRendererReadableFile,
  resolveRendererBlobPdfPath,
  resolveRendererMutableAppDataPath,
  resolveRendererResearchDownloadPath,
  writeRendererMutableFile,
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

describe("renderer filesystem mutation policy", () => {
  it("keeps normal export writes and download cleanup inside explicit operation roots", async () => {
    const root = await appDataRoot();
    const exportFile = resolveRendererMutableAppDataPath(root, "exports/bib/works.bib", "write");
    await writeRendererMutableFile(exportFile, new TextEncoder().encode("@article{demo}"));
    await expect(fs.readFile(join(root, "exports", "bib", "works.bib"), "utf8")).resolves.toBe(
      "@article{demo}",
    );

    await mkdirpRendererMutablePath(
      resolveRendererMutableAppDataPath(root, "exports/reports/2026", "mkdirp"),
    );
    expect((await fs.stat(join(root, "exports", "reports", "2026"))).isDirectory()).toBe(true);

    const download = join(root, "research-downloads", "captured.pdf");
    await fs.mkdir(join(root, "research-downloads"), { recursive: true });
    await fs.writeFile(download, "temporary PDF");
    await deleteRendererMutableFile(
      resolveRendererMutableAppDataPath(root, "research-downloads/captured.pdf", "delete"),
    );
    await expect(fs.access(download)).rejects.toThrow();

    expect(isRendererMutableAppDataPath(root, join(root, "research-downloads", "other.pdf"))).toBe(
      true,
    );
    expect(isRendererMutableAppDataPath(root, join(root, "exports", "references.bib"))).toBe(true);
  });

  it("denies every mutation operation outside its allowlist", () => {
    const root = join(tmpdir(), "aurascholar-user-data");
    const operations = ["delete", "mkdirp", "write"] as const;
    for (const rel of [
      "blobs/ab/hash.pdf",
      ".ingest-staging/receipt",
      "library.sqlite",
      "secrets.json",
    ]) {
      for (const operation of operations) {
        expect(() => resolveRendererMutableAppDataPath(root, rel, operation)).toThrow();
      }
    }
    for (const [rel, operation] of [
      ["research-downloads/new.pdf", "write"],
      ["research-downloads/new-directory", "mkdirp"],
      ["research-downloads/nested/file.pdf", "delete"],
    ] as const) {
      expect(() => resolveRendererMutableAppDataPath(root, rel, operation)).toThrow();
    }
    expect(isRendererMutableAppDataPath(root, join(root, "blobs", "ab", "hash.pdf"))).toBe(false);
    expect(isRendererMutableAppDataPath(root, join(root, ".ingest-staging", "receipt"))).toBe(
      false,
    );
  });

  it("rejects Windows aliases, alternate data streams, and mixed path separators on every OS", () => {
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
      expect(() => resolveRendererMutableAppDataPath(root, rel, "write")).toThrow();
    }
    expect(() =>
      resolveRendererMutableAppDataPath(root, "exports\\report.bib", "write"),
    ).not.toThrow();
  });

  it("refuses directory and leaf symlinks instead of traversing into blobs", async () => {
    const root = await appDataRoot();
    const blobs = join(root, "blobs");
    const victim = join(blobs, "canonical.pdf");
    await fs.mkdir(blobs, { recursive: true });
    await fs.writeFile(victim, "canonical bytes");
    await fs.mkdir(join(root, "exports"), { recursive: true });

    const nestedLink = join(root, "exports", "blob-link");
    if (
      !(await createSymlink(blobs, nestedLink, process.platform === "win32" ? "junction" : "dir"))
    ) {
      return;
    }

    await expect(
      writeRendererMutableFile(
        resolveRendererMutableAppDataPath(root, "exports/blob-link/canonical.pdf", "write"),
        new TextEncoder().encode("renderer replacement"),
      ),
    ).rejects.toThrow("unsafe directory");
    await expect(
      deleteRendererMutableFile(
        resolveRendererMutableAppDataPath(root, "exports/blob-link/canonical.pdf", "delete"),
      ),
    ).rejects.toThrow("unsafe directory");
    await expect(
      mkdirpRendererMutablePath(
        resolveRendererMutableAppDataPath(root, "exports/blob-link/new-directory", "mkdirp"),
      ),
    ).rejects.toThrow("unsafe directory");
    await expect(fs.readFile(victim, "utf8")).resolves.toBe("canonical bytes");

    const leafLink = join(root, "exports", "leaf-link.pdf");
    if (!(await createSymlink(victim, leafLink, "file"))) return;
    await expect(
      writeRendererMutableFile(
        resolveRendererMutableAppDataPath(root, "exports/leaf-link.pdf", "write"),
        new TextEncoder().encode("renderer replacement"),
      ),
    ).rejects.toThrow("target is unsafe");
    await expect(fs.readFile(victim, "utf8")).resolves.toBe("canonical bytes");
  });

  it("rejects an allowlisted root when the directory itself is a blob symlink", async () => {
    const root = await appDataRoot();
    const blobs = join(root, "blobs");
    await fs.mkdir(blobs, { recursive: true });
    if (
      !(await createSymlink(
        blobs,
        join(root, "research-downloads"),
        process.platform === "win32" ? "junction" : "dir",
      ))
    ) {
      return;
    }

    await expect(
      deleteRendererMutableFile(
        resolveRendererMutableAppDataPath(root, "research-downloads/canonical.pdf", "delete"),
      ),
    ).rejects.toThrow("unsafe directory");
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
