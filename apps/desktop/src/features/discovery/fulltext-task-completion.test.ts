import { describe, expect, it, vi } from "vitest";
import {
  completeAttachedOaFulltextTask,
  exitCompletedFulltextTask,
} from "./fulltext-task-completion";

function actions() {
  const calls: string[] = [];
  let finishHiding: ((hidden: boolean) => void) | null = null;
  let rejectHiding: ((reason?: unknown) => void) | null = null;
  let current = true;
  return {
    actions: {
      hideBrowserViews: vi.fn(
        () =>
          new Promise<boolean>((resolve, reject) => {
            finishHiding = (hidden) => resolve(hidden);
            rejectHiding = reject;
          }),
      ),
      isCurrent: vi.fn(() => current),
      navigate: vi.fn((path: string) => calls.push(`navigate:${path}`)),
      notifyLibraryUpdated: vi.fn(() => calls.push("library-updated")),
      onExit: vi.fn(() => calls.push("exit")),
      onMessage: vi.fn((message: string) => calls.push(`message:${message}`)),
      onMode: vi.fn((mode: "opensource") => calls.push(`mode:${mode}`)),
    },
    calls,
    finishHiding: (hidden = true) => {
      if (!finishHiding) throw new Error("browser views were not asked to hide");
      finishHiding(hidden);
    },
    rejectHiding: () => {
      if (!rejectHiding) throw new Error("browser views were not asked to hide");
      rejectHiding(new Error("native view hide failed"));
    },
    setCurrent: (next: boolean) => {
      current = next;
    },
  };
}

async function finishHiding(finish: (hidden?: boolean) => void, hidden = true): Promise<void> {
  finish(hidden);
  await Promise.resolve();
}

async function rejectHiding(reject: () => void): Promise<void> {
  reject();
  await Promise.resolve();
}

describe("completed full-text task exit", () => {
  it("connects a direct OA attachment to the safe handoff return", async () => {
    const { actions: callbacks, calls, finishHiding: finish } = actions();

    expect(completeAttachedOaFulltextTask({ returnTo: "/reader?work=work-1" }, callbacks)).toBe(
      true,
    );

    expect(calls).toEqual(["message:已找到并挂载开放获取 PDF", "library-updated"]);
    await finishHiding(finish);
    expect(calls).toEqual([
      "message:已找到并挂载开放获取 PDF",
      "library-updated",
      "exit",
      "navigate:/reader?work=work-1",
    ]);
  });

  it("waits for native browser views to hide before returning to a handoff route", async () => {
    const { actions: callbacks, calls, finishHiding: finish } = actions();

    expect(exitCompletedFulltextTask({ returnTo: "/reader?work=work-1" }, callbacks)).toBe(true);

    expect(calls).toEqual([]);
    await finishHiding(finish);
    expect(calls).toEqual(["exit", "navigate:/reader?work=work-1"]);
    expect(callbacks.onMode).not.toHaveBeenCalled();
  });

  it("returns a completed discovery task to open-source search after hiding", async () => {
    const { actions: callbacks, calls, finishHiding: finish } = actions();

    expect(exitCompletedFulltextTask({ origin: "discovery" }, callbacks)).toBe(true);

    expect(calls).toEqual([]);
    await finishHiding(finish);
    expect(calls).toEqual(["exit", "mode:opensource"]);
    expect(callbacks.navigate).not.toHaveBeenCalled();
  });

  it("does nothing without a safe completion destination", () => {
    const { actions: callbacks, calls } = actions();

    expect(exitCompletedFulltextTask({ origin: "reader" }, callbacks)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("keeps the current route when native browser teardown is not confirmed", async () => {
    const { actions: callbacks, calls, finishHiding: finish } = actions();

    expect(exitCompletedFulltextTask({ returnTo: "/library?work=work-1" }, callbacks)).toBe(true);
    await finishHiding(finish, false);

    expect(calls).toEqual([]);
    expect(callbacks.navigate).not.toHaveBeenCalled();
  });

  it("keeps the current route when native browser teardown rejects", async () => {
    const { actions: callbacks, calls, rejectHiding: reject } = actions();

    expect(exitCompletedFulltextTask({ returnTo: "/library?work=work-1" }, callbacks)).toBe(true);
    await rejectHiding(reject);

    expect(calls).toEqual([]);
    expect(callbacks.onExit).not.toHaveBeenCalled();
    expect(callbacks.navigate).not.toHaveBeenCalled();
  });

  it("does not apply a stale return after a newer task or route takes over", async () => {
    const { actions: callbacks, calls, finishHiding: finish, setCurrent } = actions();

    expect(exitCompletedFulltextTask({ returnTo: "/reader?work=work-1" }, callbacks)).toBe(true);
    setCurrent(false);
    await finishHiding(finish);

    expect(calls).toEqual([]);
    expect(callbacks.onExit).not.toHaveBeenCalled();
    expect(callbacks.navigate).not.toHaveBeenCalled();
  });
});
