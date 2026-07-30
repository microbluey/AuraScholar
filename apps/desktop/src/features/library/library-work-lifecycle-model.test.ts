import { describe, expect, expectTypeOf, it } from "vitest";
import {
  MutationLease,
  reconcileTrashUndo,
  scopeSelectedIds,
} from "./library-work-lifecycle-model";
import type { LibraryTrashUndoState, MutationLeaseGrant } from "./library-work-lifecycle-model";

type WorkMutation = "purge" | "restore" | "trash";

describe("MutationLease", () => {
  it("acquires synchronously and rejects a duplicate in the same tick", () => {
    const lease = new MutationLease<WorkMutation>();

    const first = lease.tryAcquire("trash");
    const duplicate = lease.tryAcquire("trash");

    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();
    expect(lease.current).toBe(first);
  });

  it("keeps the action typed on the grant", () => {
    const lease = new MutationLease<WorkMutation>();
    const grant = lease.tryAcquire("restore");

    expectTypeOf(grant).toEqualTypeOf<MutationLeaseGrant<WorkMutation> | null>();
    expect(grant?.action).toBe("restore");
  });

  it("requires both the exact token and action to release", () => {
    const lease = new MutationLease<WorkMutation>();
    const grant = lease.tryAcquire("purge");
    expect(grant).not.toBeNull();
    if (!grant) return;

    const wrongAction = {
      action: "restore" as const,
      token: grant.token,
    };
    const wrongToken = new MutationLease<WorkMutation>().tryAcquire("purge");
    expect(wrongToken).not.toBeNull();
    if (!wrongToken) return;

    expect(lease.release(wrongAction)).toBe(false);
    expect(lease.release(wrongToken)).toBe(false);
    expect(lease.current).toBe(grant);
    expect(lease.release(grant)).toBe(true);
    expect(lease.current).toBeNull();
  });

  it("does not let an old token release a newer lease", () => {
    const lease = new MutationLease<WorkMutation>();
    const oldGrant = lease.tryAcquire("trash");
    expect(oldGrant).not.toBeNull();
    if (!oldGrant) return;

    expect(lease.release(oldGrant)).toBe(true);
    const newGrant = lease.tryAcquire("restore");
    expect(newGrant).not.toBeNull();

    expect(lease.release(oldGrant)).toBe(false);
    expect(lease.current).toBe(newGrant);
  });

  it("uses action identity when actions are objects", () => {
    const lease = new MutationLease<{ kind: string }>();
    const action = { kind: "trash" };
    const grant = lease.tryAcquire(action);
    expect(grant).not.toBeNull();
    if (!grant) return;

    expect(lease.release({ ...grant, action: { kind: "trash" } })).toBe(false);
    expect(lease.release(grant)).toBe(true);
  });
});

describe("scopeSelectedIds", () => {
  it("preserves visible order while excluding hidden selections", () => {
    const selected = new Set(["hidden", "third", "first"]);

    expect(scopeSelectedIds(selected, ["first", "second", "third"])).toEqual(["first", "third"]);
  });

  it("deduplicates visible IDs and does not mutate either input", () => {
    const selected = ["second", "first", "second"];
    const visible = ["first", "first", "second", "third", "second"];
    const selectedSnapshot = [...selected];
    const visibleSnapshot = [...visible];

    expect(scopeSelectedIds(selected, visible)).toEqual(["first", "second"]);
    expect(selected).toEqual(selectedSnapshot);
    expect(visible).toEqual(visibleSnapshot);
  });

  it("returns an empty mutation scope when nothing selected is visible", () => {
    expect(scopeSelectedIds(["hidden"], ["visible"])).toEqual([]);
  });
});

describe("reconcileTrashUndo", () => {
  const undo: LibraryTrashUndoState = {
    count: 3,
    ids: ["first", "second", "third"],
    message: "已将 3 篇文献移入回收站",
  };

  it("removes restored or permanently deleted IDs and updates count and message", () => {
    expect(reconcileTrashUndo(undo, ["second"])).toEqual({
      count: 2,
      ids: ["first", "third"],
      message: "已将 2 篇文献移入回收站",
    });
  });

  it("clears the undo when every remaining ID has been committed", () => {
    expect(reconcileTrashUndo(undo, ["third", "first", "second"])).toBeNull();
  });

  it("preserves an unrelated undo by identity", () => {
    expect(reconcileTrashUndo(undo, ["unrelated"])).toBe(undo);
    expect(reconcileTrashUndo(undo, [])).toBe(undo);
  });

  it("preserves preview wording while reconciling its count", () => {
    const previewUndo: LibraryTrashUndoState = {
      count: 2,
      ids: ["first", "second"],
      message: "已将 2 篇文献移入预览回收站",
    };

    expect(reconcileTrashUndo(previewUndo, ["first"])).toEqual({
      count: 1,
      ids: ["second"],
      message: "已将 1 篇文献移入预览回收站",
    });
  });

  it("keeps a message without a count phrase", () => {
    const titledUndo: LibraryTrashUndoState = {
      count: 2,
      ids: ["first", "second"],
      message: "已将《A Paper》移入回收站",
    };

    expect(reconcileTrashUndo(titledUndo, ["second"])).toEqual({
      count: 1,
      ids: ["first"],
      message: "已将《A Paper》移入回收站",
    });
  });

  it("handles a missing undo without materializing new state", () => {
    expect(reconcileTrashUndo(null, ["first"])).toBeNull();
  });
});
