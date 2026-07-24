import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canvasNoteDraftSourceToken,
  canvasNoteDraftStorageKey,
  canvasNoteFingerprint,
  clearCanvasNoteDraft,
  clearCanvasNoteDraftsForWorkspace,
  readCanvasNoteDraft,
  readCanvasNoteDraftOwned,
  resolveCanvasNoteDraftOwned,
  writeCanvasNoteDraft,
  writeCanvasNoteDraftOwned,
  type CanvasNoteDraftValue,
} from "./canvas-note-draft";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  failGet = false;
  failSet = false;
  failRemove = false;
  failKeys = false;

  get length(): number {
    if (this.failKeys) throw new Error("length unavailable");
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    if (this.failGet) throw new Error("get unavailable");
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    if (this.failKeys) throw new Error("keys unavailable");
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    if (this.failRemove) throw new Error("remove unavailable");
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error("set unavailable");
    this.values.set(key, value);
  }
}

const BASE: CanvasNoteDraftValue = {
  title: "研究假设",
  contentMarkdown: "原始内容",
};
const DIRTY: CanvasNoteDraftValue = {
  title: "  研究假设 🧪  ",
  contentMarkdown: "  ## 证据\n\n$$\nE = mc^2\n$$\n\n",
};

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

describe("canvas note draft storage", () => {
  it("uses versioned workspace and node scoped keys", () => {
    const first = canvasNoteDraftStorageKey("canvas:one", "node:one");
    const second = canvasNoteDraftStorageKey("canvas:one", "node:two");
    const otherWorkspace = canvasNoteDraftStorageKey("canvas:two", "node:one");

    expect(first).toMatch(/^aurascholar:canvas-note-draft:v1:/);
    expect(new Set([first, second, otherWorkspace]).size).toBe(3);
    expect(canvasNoteDraftStorageKey("", "node:one")).toBeNull();
  });

  it("writes and recovers the exact Unicode, Markdown whitespace, and LaTeX content", () => {
    const result = writeCanvasNoteDraft({
      workspaceId: "canvas:研究",
      nodeId: "note:α",
      baseValue: BASE,
      value: DIRTY,
      savedAt: 1_234,
    });

    expect(result).toEqual({
      status: "saved",
      draft: {
        version: 1,
        workspaceId: "canvas:研究",
        nodeId: "note:α",
        baseFingerprint: canvasNoteFingerprint(BASE),
        value: DIRTY,
        savedAt: 1_234,
      },
    });
    expect(
      readCanvasNoteDraft({
        workspaceId: "canvas:研究",
        nodeId: "note:α",
        baseValue: BASE,
      }),
    ).toEqual({ status: "recoverable", draft: result.status === "saved" ? result.draft : null });
  });

  it("clears a draft when its value is identical to the persisted base", () => {
    writeCanvasNoteDraft({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      baseValue: BASE,
      value: DIRTY,
    });

    expect(
      writeCanvasNoteDraft({
        workspaceId: "canvas:one",
        nodeId: "note:one",
        baseValue: BASE,
        value: BASE,
      }),
    ).toEqual({ status: "cleared" });
    expect(
      readCanvasNoteDraft({
        workspaceId: "canvas:one",
        nodeId: "note:one",
        baseValue: BASE,
      }),
    ).toEqual({ status: "none" });
  });

  it("distinguishes conflicts from recoverable drafts using content fingerprints", () => {
    const saved = writeCanvasNoteDraft({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      baseValue: BASE,
      value: DIRTY,
      savedAt: 9,
    });
    const changedBase = { title: "外部更改", contentMarkdown: "新的持久内容" };

    const conflict = readCanvasNoteDraft({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      baseValue: changedBase,
    });
    expect(conflict.status).toBe("conflict");
    expect(conflict.status === "conflict" ? conflict.draft : null).toEqual(
      saved.status === "saved" ? saved.draft : null,
    );
  });

  it("clears a stale draft when its value has already become the persisted content", () => {
    writeCanvasNoteDraft({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      baseValue: BASE,
      value: DIRTY,
    });

    expect(
      readCanvasNoteDraft({
        workspaceId: "canvas:one",
        nodeId: "note:one",
        baseValue: DIRTY,
      }),
    ).toEqual({ status: "stale-cleared" });
    expect(storage.values.size).toBe(0);
  });

  it("discards malformed, wrong-version, mismatched-identity, and oversized records", () => {
    const key = canvasNoteDraftStorageKey("canvas:one", "note:one");
    expect(key).not.toBeNull();

    const invalidRecords: string[] = [
      "{not-json",
      JSON.stringify({
        version: 2,
        workspaceId: "canvas:one",
        nodeId: "note:one",
        baseFingerprint: canvasNoteFingerprint(BASE),
        value: DIRTY,
        savedAt: 1,
      }),
      JSON.stringify({
        version: 1,
        workspaceId: "canvas:other",
        nodeId: "note:one",
        baseFingerprint: canvasNoteFingerprint(BASE),
        value: DIRTY,
        savedAt: 1,
      }),
      "x".repeat(2_000_001),
    ];

    for (const raw of invalidRecords) {
      storage.setItem(key!, raw);
      expect(
        readCanvasNoteDraft({
          workspaceId: "canvas:one",
          nodeId: "note:one",
          baseValue: BASE,
        }),
      ).toEqual({ status: "invalid-discarded" });
      expect(storage.getItem(key!)).toBeNull();
    }
  });

  it("never throws for unavailable get, set, remove, or key enumeration", () => {
    storage.failGet = true;
    expect(
      readCanvasNoteDraft({
        workspaceId: "canvas:one",
        nodeId: "note:one",
        baseValue: BASE,
      }),
    ).toEqual({ status: "unavailable" });
    storage.failGet = false;

    storage.failSet = true;
    expect(
      writeCanvasNoteDraft({
        workspaceId: "canvas:one",
        nodeId: "note:one",
        baseValue: BASE,
        value: DIRTY,
      }),
    ).toEqual({ status: "unavailable" });
    storage.failSet = false;

    storage.failRemove = true;
    expect(clearCanvasNoteDraft("canvas:one", "note:one")).toEqual({
      status: "unavailable",
    });
    storage.failRemove = false;

    storage.failKeys = true;
    expect(clearCanvasNoteDraftsForWorkspace("canvas:one")).toEqual({
      status: "unavailable",
      removed: 0,
    });
  });

  it("keeps the previous recoverable draft when a replacement write fails", () => {
    const original = writeCanvasNoteDraft({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      baseValue: BASE,
      value: DIRTY,
      savedAt: 1,
    });
    storage.failSet = true;

    expect(
      writeCanvasNoteDraft({
        workspaceId: "canvas:one",
        nodeId: "note:one",
        baseValue: BASE,
        value: { title: "replacement", contentMarkdown: "replacement" },
        savedAt: 2,
      }),
    ).toEqual({ status: "unavailable" });
    storage.failSet = false;
    expect(
      readCanvasNoteDraft({
        workspaceId: "canvas:one",
        nodeId: "note:one",
        baseValue: BASE,
      }),
    ).toEqual({
      status: "recoverable",
      draft: original.status === "saved" ? original.draft : null,
    });
  });

  it("clears one draft or an exact workspace prefix without touching other workspaces", () => {
    for (const [workspaceId, nodeId] of [
      ["canvas:one", "note:one"],
      ["canvas:one", "note:two"],
      ["canvas:one-more", "note:one"],
    ] as const) {
      writeCanvasNoteDraft({ workspaceId, nodeId, baseValue: BASE, value: DIRTY });
    }

    expect(clearCanvasNoteDraft("canvas:one", "note:one")).toEqual({ status: "cleared" });
    expect(clearCanvasNoteDraftsForWorkspace("canvas:one")).toEqual({
      status: "cleared",
      removed: 1,
    });
    expect(
      readCanvasNoteDraft({
        workspaceId: "canvas:one-more",
        nodeId: "note:one",
        baseValue: BASE,
      }).status,
    ).toBe("recoverable");
  });

  it("keeps different browser owners in immutable keys and exposes alternate drafts", () => {
    const first = writeCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      ownerId: "owner-a",
      writeId: "write-a",
      baseValue: BASE,
      value: { title: "A", contentMarkdown: "owner A" },
      savedAt: 10,
    });
    const second = writeCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      ownerId: "owner-b",
      writeId: "write-b",
      baseValue: BASE,
      value: { title: "B", contentMarkdown: "owner B" },
      savedAt: 20,
    });

    expect(first.status).toBe("saved");
    expect(second.status).toBe("saved");
    expect(storage.values.size).toBe(2);
    const recovered = readCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      baseValue: BASE,
    });
    expect(recovered.status).toBe("recoverable");
    if (recovered.status !== "recoverable") return;
    expect(recovered.draft.value.contentMarkdown).toBe("owner B");
    expect(recovered.alternates.map((candidate) => candidate.draft.value.contentMarkdown)).toEqual([
      "owner A",
    ]);
  });

  it("never lets an older revision clear a newer revision or another owner", () => {
    const first = writeCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      ownerId: "owner-a",
      writeId: "write-a1",
      baseValue: BASE,
      value: { title: "A1", contentMarkdown: "owner A revision 1" },
      savedAt: 10,
    });
    expect(first.status).toBe("saved");
    if (first.status !== "saved") return;
    const second = writeCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      ownerId: "owner-a",
      writeId: "write-a2",
      previousToken: first.token,
      baseValue: BASE,
      value: { title: "A2", contentMarkdown: "owner A revision 2" },
      savedAt: 20,
    });
    const other = writeCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      ownerId: "owner-b",
      writeId: "write-b1",
      baseValue: BASE,
      value: { title: "B1", contentMarkdown: "owner B revision 1" },
      savedAt: 30,
    });
    expect(second.status).toBe("saved");
    expect(other.status).toBe("saved");
    if (second.status !== "saved" || other.status !== "saved") return;

    expect(resolveCanvasNoteDraftOwned("canvas:one", "note:one", "owner-a", first.token)).toEqual({
      status: "cleared",
    });
    const recovered = readCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      baseValue: BASE,
    });
    expect(recovered.status).toBe("recoverable");
    if (recovered.status !== "recoverable") return;
    expect(
      new Set([
        recovered.draft.value.contentMarkdown,
        ...recovered.alternates.map((candidate) => candidate.draft.value.contentMarkdown),
      ]),
    ).toEqual(new Set(["owner A revision 2", "owner B revision 1"]));
  });

  it("physically removes only the exact resolved owned revision", () => {
    const older = writeCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      ownerId: "owner-b",
      writeId: "write-b1",
      baseValue: BASE,
      value: { title: "B1", contentMarkdown: "older" },
      savedAt: 10,
    });
    const newer = writeCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      ownerId: "owner-b",
      writeId: "write-b2",
      baseValue: BASE,
      value: { title: "B2", contentMarkdown: "newer" },
      savedAt: 20,
    });
    expect(older.status).toBe("saved");
    expect(newer.status).toBe("saved");
    if (older.status !== "saved" || newer.status !== "saved") return;

    expect(resolveCanvasNoteDraftOwned("canvas:one", "note:one", "owner-a", older.token)).toEqual({
      status: "cleared",
    });
    expect(storage.getItem(older.token.storageKey)).toBeNull();
    expect(storage.getItem(newer.token.storageKey)).not.toBeNull();
    const recovered = readCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      baseValue: BASE,
    });
    expect(recovered.status).toBe("recoverable");
    if (recovered.status === "recoverable") {
      expect(recovered.draft.value.contentMarkdown).toBe("newer");
      expect(recovered.alternates).toEqual([]);
    }
  });

  it("keeps the last owned revision when its replacement cannot be written", () => {
    const first = writeCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      ownerId: "owner-a",
      writeId: "write-a1",
      baseValue: BASE,
      value: DIRTY,
      savedAt: 10,
    });
    expect(first.status).toBe("saved");
    if (first.status !== "saved") return;
    storage.failSet = true;
    expect(
      writeCanvasNoteDraftOwned({
        workspaceId: "canvas:one",
        nodeId: "note:one",
        ownerId: "owner-a",
        writeId: "write-a2",
        previousToken: first.token,
        baseValue: BASE,
        value: { title: "new", contentMarkdown: "new" },
        savedAt: 20,
      }),
    ).toEqual({ status: "unavailable" });
    storage.failSet = false;

    const recovered = readCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      baseValue: BASE,
    });
    expect(recovered.status).toBe("recoverable");
    if (recovered.status === "recoverable") {
      expect(recovered.draft.value).toEqual(DIRTY);
    }
  });

  it("reads legacy drafts alongside owned drafts without overwriting the legacy key", () => {
    const legacy = writeCanvasNoteDraft({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      baseValue: BASE,
      value: DIRTY,
      savedAt: 10,
    });
    const legacyKey = canvasNoteDraftStorageKey("canvas:one", "note:one");
    const legacyRaw = legacyKey ? storage.getItem(legacyKey) : null;
    expect(legacy.status).toBe("saved");

    expect(
      writeCanvasNoteDraftOwned({
        workspaceId: "canvas:one",
        nodeId: "note:one",
        ownerId: "owner-a",
        writeId: "write-a",
        baseValue: BASE,
        value: { title: "owned", contentMarkdown: "owned" },
        savedAt: 20,
      }).status,
    ).toBe("saved");
    expect(legacyKey ? storage.getItem(legacyKey) : null).toBe(legacyRaw);
    const recovered = readCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      baseValue: BASE,
    });
    expect(recovered.status).toBe("recoverable");
    if (recovered.status === "recoverable") {
      expect(recovered.alternates).toHaveLength(1);
    }
  });

  it("does not adopt an unseen recoverable revision over an existing inline edit", () => {
    writeCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      ownerId: "owner-a",
      writeId: "write-a",
      baseValue: BASE,
      value: DIRTY,
      savedAt: 10,
    });
    const recoverable = readCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      baseValue: BASE,
    });

    expect(canvasNoteDraftSourceToken(recoverable, true)).toBeNull();
    expect(canvasNoteDraftSourceToken(recoverable, false)?.ownerId).toBe("owner-a");

    const conflict = readCanvasNoteDraftOwned({
      workspaceId: "canvas:one",
      nodeId: "note:one",
      baseValue: { title: "external", contentMarkdown: "external" },
    });
    expect(canvasNoteDraftSourceToken(conflict, true)?.ownerId).toBe("owner-a");
  });
});
