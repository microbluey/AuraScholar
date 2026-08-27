import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertResearchDownloadConsumeInput,
  createResearchDownloadStore,
  MAX_RESEARCH_DOWNLOAD_ID_LENGTH,
  MAX_PENDING_RESEARCH_DOWNLOAD_BYTES,
  RESEARCH_DOWNLOAD_TTL_MS,
} from "./research-download-store";

const roots: string[] = [];
const BYTES = new TextEncoder().encode("main-owned research download");

async function root(): Promise<string> {
  const directory = await fs.mkdtemp(join(tmpdir(), "aurascholar-research-download-"));
  await fs.mkdir(join(directory, "research-downloads"));
  roots.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe("main-owned research download leases", () => {
  it("issues an opaque bearer receipt and consumes it once while unlinking first", async () => {
    const userDataRoot = await root();
    const fileName = "1710000000000-paper.pdf";
    const filePath = join(userDataRoot, "research-downloads", fileName);
    await fs.writeFile(filePath, BYTES, { mode: 0o600 });
    const store = createResearchDownloadStore(userDataRoot, { id: () => "download-id" });

    const lease = await store.register(fileName, "owner-tab");
    expect(lease).toEqual({ downloadId: "download-id", fileName, ownerTabId: "owner-tab" });
    await expect(store.consume(lease.downloadId)).resolves.toEqual(BYTES);
    await expect(fs.access(filePath)).rejects.toThrow();
    await expect(store.consume(lease.downloadId)).rejects.toThrow("unavailable");
  });

  it("rejects concurrent consumption and retires a failed receipt safely", async () => {
    const userDataRoot = await root();
    const fileName = "concurrent.pdf";
    const filePath = join(userDataRoot, "research-downloads", fileName);
    await fs.writeFile(filePath, BYTES);
    const store = createResearchDownloadStore(userDataRoot, { id: () => "concurrent-id" });
    const lease = await store.register(fileName, "owner-tab");

    const first = store.consume(lease.downloadId);
    const second = store.consume(lease.downloadId);
    await expect(Promise.all([first, second])).rejects.toThrow("unavailable");
    await first.catch(() => {});
    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it("counts in-flight registrations toward the bounded receipt cap", async () => {
    const userDataRoot = await root();
    const directory = join(userDataRoot, "research-downloads");
    await fs.writeFile(join(directory, "one.pdf"), BYTES);
    await fs.writeFile(join(directory, "two.pdf"), BYTES);
    const store = createResearchDownloadStore(userDataRoot, {
      maxPendingDownloads: 2,
      id: (() => {
        let n = 0;
        return () => `burst-${++n}`;
      })(),
    });

    const [one, two] = await Promise.all([
      store.register("one.pdf", "owner-tab"),
      store.register("two.pdf", "owner-tab"),
    ]);
    expect(new Set([one.downloadId, two.downloadId])).toEqual(new Set(["burst-1", "burst-2"]));
    await expect(store.register("one.pdf", "owner-tab")).rejects.toThrow("Too many");
  });

  it("rejects duplicate concurrent paths and enforces aggregate byte quota", async () => {
    const userDataRoot = await root();
    const directory = join(userDataRoot, "research-downloads");
    await fs.writeFile(join(directory, "same.pdf"), BYTES);
    const duplicateStore = createResearchDownloadStore(userDataRoot, {
      id: (() => {
        let n = 0;
        return () => `same-${++n}`;
      })(),
    });
    const duplicate = await Promise.allSettled([
      duplicateStore.register("same.pdf", "owner-tab"),
      duplicateStore.register("same.pdf", "owner-tab"),
    ]);
    expect(duplicate.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(duplicate.filter((result) => result.status === "rejected")).toHaveLength(1);

    await fs.writeFile(join(directory, "quota.pdf"), BYTES);
    const quotaStore = createResearchDownloadStore(userDataRoot, {
      maxPendingBytes: BYTES.byteLength,
      id: () => "quota-id",
    });
    await expect(quotaStore.register("quota.pdf", "owner-tab")).resolves.toBeTruthy();
    await expect(quotaStore.register("same.pdf", "owner-tab")).rejects.toThrow("quota");
    expect(MAX_PENDING_RESEARCH_DOWNLOAD_BYTES).toBeGreaterThan(BYTES.byteLength);
  });

  it("fails closed for symlinks and hard links without deleting the target", async () => {
    const userDataRoot = await root();
    const directory = join(userDataRoot, "research-downloads");
    const outside = join(userDataRoot, "outside.pdf");
    await fs.writeFile(outside, BYTES);
    const symlinkName = "symlink.pdf";
    const hardlinkName = "hardlink.pdf";
    try {
      await fs.symlink(outside, join(directory, symlinkName));
    } catch (error) {
      if (!(process.platform === "win32" && isNodeError(error) && error.code === "EPERM")) {
        throw error;
      }
    }
    await fs.link(outside, join(directory, hardlinkName));
    const store = createResearchDownloadStore(userDataRoot, {
      id: (() => {
        let n = 0;
        return () => `unsafe-${++n}`;
      })(),
    });

    if (await exists(join(directory, symlinkName))) {
      await expect(store.register(symlinkName, "owner-tab")).rejects.toThrow("unsafe");
      expect(new Uint8Array(await fs.readFile(outside))).toEqual(BYTES);
    }
    await expect(store.register(hardlinkName, "owner-tab")).rejects.toThrow("unsafe");
    expect(new Uint8Array(await fs.readFile(outside))).toEqual(BYTES);
  });

  it("expires and recovers only safe temporary files", async () => {
    const userDataRoot = await root();
    let now = 10_000;
    const fileName = "expired.pdf";
    const filePath = join(userDataRoot, "research-downloads", fileName);
    await fs.writeFile(filePath, BYTES);
    const store = createResearchDownloadStore(userDataRoot, {
      now: () => now,
      id: () => "expired-id",
    });
    const lease = await store.register(fileName, "owner-tab");
    now += RESEARCH_DOWNLOAD_TTL_MS;
    await expect(store.consume(lease.downloadId)).rejects.toThrow("unavailable");
    await expect(fs.access(filePath)).rejects.toThrow();

    const recoveredName = "crash-leftover.pdf";
    const recoveredPath = join(userDataRoot, "research-downloads", recoveredName);
    await fs.writeFile(recoveredPath, BYTES);
    await store.recover();
    await expect(fs.access(recoveredPath)).rejects.toThrow();
  });

  it("closes registration before teardown and can reopen for a fresh window", async () => {
    const userDataRoot = await root();
    const fileName = "reopen.pdf";
    const filePath = join(userDataRoot, "research-downloads", fileName);
    await fs.writeFile(filePath, BYTES);
    const store = createResearchDownloadStore(userDataRoot, { id: () => "reopen-id" });

    await store.shutdown();
    await expect(store.register(fileName, "owner-tab")).rejects.toThrow("closed");
    store.reopen();
    await expect(store.register(fileName, "owner-tab")).resolves.toMatchObject({
      downloadId: "reopen-id",
    });
  });
});

describe("research.consumeDownload input", () => {
  it("accepts exactly one bounded opaque id", () => {
    expect(assertResearchDownloadConsumeInput({ downloadId: "abc_123" })).toEqual({
      downloadId: "abc_123",
    });
    for (const value of [
      null,
      {},
      { downloadId: "" },
      { downloadId: "a".repeat(MAX_RESEARCH_DOWNLOAD_ID_LENGTH + 1) },
      { downloadId: "download id" },
      { downloadId: "valid", extra: true },
    ]) {
      expect(() => assertResearchDownloadConsumeInput(value)).toThrow();
    }
  });
});

async function exists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path);
    return true;
  } catch {
    return false;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
