import { describe, expect, it, vi } from "vitest";
import {
  LIBRARY_NOTICE_EXIT_MS,
  createLibraryNoticeLifecycleController,
  libraryNoticeDuration,
  reduceLibraryNoticeState,
  type LibraryNoticeScheduler,
} from "./library-notice-lifecycle";

describe("LibraryNoticeLifecycleController", () => {
  it("gives repeated direct messages a new occurrence but preserves updater no-ops", () => {
    const first = reduceLibraryNoticeState({ instance: 0, message: "已保存" }, "已保存");
    expect(first).toEqual({ instance: 1, message: "已保存" });

    const unchanged = reduceLibraryNoticeState(first, (current) => current);
    expect(unchanged).toBe(first);

    expect(reduceLibraryNoticeState(first, null)).toEqual({
      instance: 2,
      message: null,
    });
  });

  it.each<[string, number]>([
    ["普通通知", 4_500],
    ["请先选择文献", 6_500],
    ["操作失败，请重试", 9_000],
    ["撤销移入回收站失败，撤销入口仍保留，可重新撤销", 10_000],
  ])("uses the expected lifecycle for %s", (message, duration) => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      const controller = createLibraryNoticeLifecycleController();
      controller.update({ instance: "notice", message, onDismiss, persistent: false });

      expect(libraryNoticeDuration(message)).toBe(duration);
      expect(controller.getSnapshot().leaving).toBe(false);

      vi.advanceTimersByTime(duration - LIBRARY_NOTICE_EXIT_MS - 1);
      expect(controller.getSnapshot().leaving).toBe(false);
      expect(onDismiss).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(controller.getSnapshot().leaving).toBe(true);
      expect(onDismiss).not.toHaveBeenCalled();

      vi.advanceTimersByTime(LIBRARY_NOTICE_EXIT_MS - 1);
      expect(onDismiss).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onDismiss).toHaveBeenCalledOnce();
      expect(onDismiss).toHaveBeenCalledWith(message);

      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each<[string, boolean]>([
    ["正在读取文献库...", false],
    ["已移动到回收站", true],
  ])("does not schedule %s when persistent is %s", (message, persistent) => {
    const scheduler = recordingScheduler();
    const controller = createLibraryNoticeLifecycleController(scheduler);

    controller.update({
      instance: "notice",
      message,
      onDismiss: vi.fn(),
      persistent,
    });

    expect(scheduler.delays).toEqual([]);
    expect(controller.getSnapshot()).toEqual({
      instance: "notice",
      leaving: false,
      message,
    });
  });

  it("prevents stale timers from dismissing or changing a newer notice", () => {
    const scheduler = adversarialScheduler();
    const dismissFirst = vi.fn();
    const dismissSecond = vi.fn();
    const controller = createLibraryNoticeLifecycleController(scheduler);

    controller.update({
      instance: "first",
      message: "第一条通知",
      onDismiss: dismissFirst,
      persistent: false,
    });
    controller.update({
      instance: "second",
      message: "第二条通知",
      onDismiss: dismissSecond,
      persistent: false,
    });

    scheduler.runTasks(0, 2);
    expect(controller.getSnapshot()).toEqual({
      instance: "second",
      leaving: false,
      message: "第二条通知",
    });
    expect(dismissFirst).not.toHaveBeenCalled();

    scheduler.runTasks(2, 4);
    expect(controller.getSnapshot().leaving).toBe(true);
    expect(dismissSecond).toHaveBeenCalledOnce();
    expect(dismissSecond).toHaveBeenCalledWith("第二条通知");
  });

  it("does not reuse leaving state when the same text returns after null", () => {
    const scheduler = adversarialScheduler();
    const onDismiss = vi.fn();
    const controller = createLibraryNoticeLifecycleController(scheduler);
    const message = "相同文案";

    controller.update({ instance: "first", message, onDismiss, persistent: false });
    scheduler.runTasks(0, 1);
    expect(controller.getSnapshot().leaving).toBe(true);

    controller.update({ instance: "empty", message: null, onDismiss, persistent: false });
    expect(controller.getSnapshot()).toEqual({
      instance: "empty",
      leaving: false,
      message: null,
    });

    controller.update({ instance: "second", message, onDismiss, persistent: false });
    expect(controller.getSnapshot()).toEqual({
      instance: "second",
      leaving: false,
      message,
    });

    scheduler.runTasks(1, 2);
    expect(controller.getSnapshot().leaving).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();

    scheduler.runTasks(2, 3);
    expect(controller.getSnapshot().leaving).toBe(true);
  });
});

function recordingScheduler(): LibraryNoticeScheduler & { delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    schedule(_callback, delayMs) {
      delays.push(delayMs);
      return () => undefined;
    },
  };
}

function adversarialScheduler(): LibraryNoticeScheduler & {
  runTasks(from: number, to: number): void;
} {
  const tasks: Array<() => void> = [];
  return {
    runTasks(from, to) {
      tasks.slice(from, to).forEach((task) => task());
    },
    schedule(callback) {
      tasks.push(callback);
      // Deliberately ignore cancellation to exercise the generation lease.
      return () => undefined;
    },
  };
}
