import { describe, expect, it } from "vitest";
import { MemorySyncProvider } from "./memory-provider";
import { LibraryScopedSyncProvider } from "./scoped-provider";

class InterruptibleMemorySyncProvider extends MemorySyncProvider {
  failNextPutPath: string | null = null;

  override async put(path: string, data: Uint8Array): Promise<void> {
    if (path === this.failNextPutPath) {
      this.failNextPutPath = null;
      throw new Error(`interrupted copy: ${path}`);
    }
    await super.put(path, data);
  }
}

describe("LibraryScopedSyncProvider", () => {
  it("keeps identical journal paths isolated by Library", async () => {
    const remote = new MemorySyncProvider();
    const libraryA = new LibraryScopedSyncProvider(remote, "library-a");
    const libraryB = new LibraryScopedSyncProvider(remote, "library-b");
    const path = "journal/device/000000000001-000000000001.jsonl";

    await libraryA.put(path, new TextEncoder().encode("a"));
    await libraryB.put(path, new TextEncoder().encode("b"));

    await expect(libraryA.list("journal/")).resolves.toEqual([expect.objectContaining({ path })]);
    await expect(libraryB.list("journal/")).resolves.toEqual([expect.objectContaining({ path })]);
    await expect(libraryA.get(path)).resolves.toEqual(new TextEncoder().encode("a"));
    await expect(libraryB.get(path)).resolves.toEqual(new TextEncoder().encode("b"));
    expect([...remote.objects.keys()]).toHaveLength(2);
  });

  it("encodes unsafe Library ids into one provider path segment", async () => {
    const remote = new MemorySyncProvider();
    const scoped = new LibraryScopedSyncProvider(remote, "../研究/library");

    await scoped.put("journal/device/segment.jsonl", new Uint8Array([1]));

    const [storedPath] = [...remote.objects.keys()];
    expect(storedPath).toMatch(/^libraries\/[0-9a-f]+\/journal\/device\/segment\.jsonl$/);
    expect(storedPath).not.toContain("..");
    expect(storedPath).not.toContain("研究");
  });

  it("merges legacy and scoped journals until the bootstrap marker is published", async () => {
    const remote = new MemorySyncProvider();
    const legacyPath = "journal/legacy-device/000000000001-000000000001.jsonl";
    const scopedPath = "journal/current-device/000000000002-000000000002.jsonl";
    const legacy = new TextEncoder().encode("legacy");
    const current = new TextEncoder().encode("scoped");
    await remote.put(legacyPath, legacy);
    const scoped = new LibraryScopedSyncProvider(remote, "shared-remote-scope", {
      legacyReadFallback: true,
    });
    await scoped.put(scopedPath, current);

    await expect(scoped.list("journal/")).resolves.toEqual([
      expect.objectContaining({ path: scopedPath }),
      expect.objectContaining({ path: legacyPath }),
    ]);
    await expect(scoped.get(legacyPath)).resolves.toEqual(legacy);
    await expect(scoped.get(scopedPath)).resolves.toEqual(current);

    await scoped.markBootstrapComplete();
    await expect(scoped.list("journal/")).resolves.toEqual([
      expect.objectContaining({ path: scopedPath }),
      expect.objectContaining({ path: legacyPath }),
    ]);
    await expect(scoped.get(legacyPath)).resolves.toEqual(legacy);
    await expect(remote.get(`${scoped.prefix}${legacyPath}`)).resolves.toEqual(legacy);
    await expect(remote.get(legacyPath)).resolves.toEqual(legacy);
  });

  it("rejects conflicting bytes at the same legacy and scoped journal path", async () => {
    const remote = new MemorySyncProvider();
    const path = "journal/device/000000000001-000000000001.jsonl";
    await remote.put(path, new TextEncoder().encode("legacy"));
    const scoped = new LibraryScopedSyncProvider(remote, "shared-remote-scope", {
      legacyReadFallback: true,
    });
    await scoped.put(path, new TextEncoder().encode("different"));

    await expect(scoped.list("journal/")).rejects.toThrow(
      `Conflicting legacy and scoped sync objects at ${path}`,
    );
    await expect(scoped.markBootstrapComplete()).rejects.toThrow(
      `Conflicting legacy and scoped sync objects at ${path}`,
    );
  });

  it("resumes an interrupted legacy copy and publishes the marker last", async () => {
    const remote = new InterruptibleMemorySyncProvider();
    const firstPath = "journal/device/000000000001-000000000001.jsonl";
    const secondPath = "journal/device/000000000002-000000000002.jsonl";
    const first = new TextEncoder().encode("first");
    const second = new TextEncoder().encode("second");
    await remote.put(firstPath, first);
    await remote.put(secondPath, second);
    const scoped = new LibraryScopedSyncProvider(remote, "shared-remote-scope", {
      legacyReadFallback: true,
    });
    remote.failNextPutPath = `${scoped.prefix}${secondPath}`;

    await expect(scoped.markBootstrapComplete()).rejects.toThrow("interrupted copy");
    await expect(remote.get(`${scoped.prefix}${firstPath}`)).resolves.toEqual(first);
    expect(remote.objects.has(`${scoped.prefix}journal/.library-scope-v2-complete`)).toBe(false);

    await scoped.markBootstrapComplete();
    await scoped.markBootstrapComplete();

    await expect(remote.get(`${scoped.prefix}${firstPath}`)).resolves.toEqual(first);
    await expect(remote.get(`${scoped.prefix}${secondPath}`)).resolves.toEqual(second);
    expect(remote.objects.has(`${scoped.prefix}journal/.library-scope-v2-complete`)).toBe(true);
  });

  it("rejects paths that could escape the scoped prefix", async () => {
    const remote = new MemorySyncProvider();
    const scoped = new LibraryScopedSyncProvider(remote, "scope");

    await expect(scoped.put("../journal/segment", new Uint8Array([1]))).rejects.toThrow(
      /cannot contain/,
    );
    await expect(scoped.get("journal\\..\\secret")).rejects.toThrow(/cannot contain/);
  });

  it("does not collapse distinct transport scopes by trimming their ids", () => {
    const remote = new MemorySyncProvider();
    const plain = new LibraryScopedSyncProvider(remote, "scope");
    const padded = new LibraryScopedSyncProvider(remote, " scope ");

    expect(plain.prefix).not.toBe(padded.prefix);
  });
});
