import { describe, expect, it } from "vitest";
import {
  CORPUS_SCOPE_SNAPSHOT_VERSION,
  createCorpusScopeSnapshot,
  type CorpusScopeSnapshotInput,
} from "./index.js";

function input(overrides: Partial<CorpusScopeSnapshotInput> = {}): CorpusScopeSnapshotInput {
  return {
    libraryId: " library-1 ",
    scope: { kind: "works", workIds: ["work-2", "work-1"] },
    allowedSourceIds: ["source-2", " source-1 ", "source-2"],
    capturedAt: 1_725_000_000_000,
    ...overrides,
  };
}

describe("CorpusScopeSnapshot", () => {
  it("normalizes source ids, computes a stable hash, and freezes the snapshot", async () => {
    const originalSourceIds = ["source-2", " source-1 ", "source-2"];
    const snapshot = await createCorpusScopeSnapshot(
      input({ allowedSourceIds: originalSourceIds }),
    );
    const equivalent = await createCorpusScopeSnapshot(
      input({
        allowedSourceIds: ["source-1", "source-2"],
        libraryId: "library-1",
        scope: { kind: "works", workIds: ["work-1", "work-2"] },
      }),
    );

    expect(originalSourceIds).toEqual(["source-2", " source-1 ", "source-2"]);
    expect(snapshot).toMatchObject({
      version: CORPUS_SCOPE_SNAPSHOT_VERSION,
      libraryId: "library-1",
      scope: { kind: "works", workIds: ["work-1", "work-2"] },
      allowedSourceIds: ["source-1", "source-2"],
      capturedAt: 1_725_000_000_000,
    });
    expect(snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.hash).toBe("c402937f6ee49770168e054c6fba6e8601460c1c95f05bf977972bb55ebf560e");
    expect(snapshot.hash).toBe(equivalent.hash);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.scope)).toBe(true);
    if (snapshot.scope.kind === "works") {
      expect(Object.isFrozen(snapshot.scope.workIds)).toBe(true);
    }
    expect(Object.isFrozen(snapshot.allowedSourceIds)).toBe(true);
    expect(() => (snapshot.allowedSourceIds as string[]).push("source-3")).toThrow();
    expect(() => ((snapshot as { libraryId: string }).libraryId = "foreign")).toThrow();
  });

  it("supports every user-selectable scope kind", async () => {
    await expect(
      createCorpusScopeSnapshot(input({ scope: { kind: "library" } })),
    ).resolves.toMatchObject({ scope: { kind: "library" } });
    await expect(
      createCorpusScopeSnapshot(input({ scope: { kind: "project", projectId: " project-1 " } })),
    ).resolves.toMatchObject({ scope: { kind: "project", projectId: "project-1" } });
    await expect(
      createCorpusScopeSnapshot(input({ scope: { kind: "asset", assetId: " asset-1 " } })),
    ).resolves.toMatchObject({ scope: { kind: "asset", assetId: "asset-1" } });
    await expect(
      createCorpusScopeSnapshot(input({ scope: { kind: "works", workIds: [] } })),
    ).resolves.toMatchObject({ scope: { kind: "works", workIds: [] } });
  });

  it("rejects malformed identity, selection, source, and timestamp inputs", async () => {
    await expect(createCorpusScopeSnapshot(input({ libraryId: "   " }))).rejects.toThrow(
      "Library id",
    );
    await expect(
      createCorpusScopeSnapshot(input({ scope: { kind: "project", projectId: " " } })),
    ).rejects.toThrow("Project id");
    await expect(
      createCorpusScopeSnapshot(input({ scope: { kind: "works", workIds: ["work-1", "work-1"] } })),
    ).rejects.toThrow("must be unique");
    await expect(
      createCorpusScopeSnapshot(input({ allowedSourceIds: ["source-1", "\n"] })),
    ).rejects.toThrow("Allowed source id");
    await expect(createCorpusScopeSnapshot(input({ capturedAt: -1 }))).rejects.toThrow(
      "capturedAt",
    );
    await expect(createCorpusScopeSnapshot(input({ capturedAt: Number.NaN }))).rejects.toThrow(
      "capturedAt",
    );
    await expect(
      createCorpusScopeSnapshot(input({ scope: { kind: "library", unexpected: true } } as never)),
    ).rejects.toThrow("unsupported fields");
  });

  it("changes the digest when any canonical scope field changes", async () => {
    const baseline = await createCorpusScopeSnapshot(input());
    const variants = await Promise.all([
      createCorpusScopeSnapshot(input({ libraryId: "library-2" })),
      createCorpusScopeSnapshot(input({ capturedAt: baseline.capturedAt + 1 })),
      createCorpusScopeSnapshot(input({ scope: { kind: "project", projectId: "project-1" } })),
      createCorpusScopeSnapshot(input({ allowedSourceIds: ["source-3"] })),
    ]);

    for (const variant of variants) expect(variant.hash).not.toBe(baseline.hash);
  });
});
