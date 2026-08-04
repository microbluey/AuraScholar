import { inferNoticeTone } from "../../components/inline-notice-model";

export const LIBRARY_NOTICE_EXIT_MS = 220;

export type LibraryNoticeInstance = string | number | symbol;

export interface LibraryNoticeScheduler {
  schedule(callback: () => void, delayMs: number): () => void;
}

export interface LibraryNoticeLifecycleInput {
  instance: LibraryNoticeInstance;
  message: string | null;
  onDismiss(expectedMessage: string): void;
  persistent: boolean;
}

export interface LibraryNoticeLifecycleSnapshot {
  instance: LibraryNoticeInstance | null;
  leaving: boolean;
  message: string | null;
}

export interface LibraryNoticeState {
  instance: number;
  message: string | null;
}

export type LibraryNoticeStateUpdate = string | null | ((current: string | null) => string | null);

type Listener = () => void;

const IDLE_SNAPSHOT: LibraryNoticeLifecycleSnapshot = {
  instance: null,
  leaving: false,
  message: null,
};

export const systemLibraryNoticeScheduler: LibraryNoticeScheduler = {
  schedule(callback, delayMs) {
    const timer = globalThis.setTimeout(callback, delayMs);
    return () => globalThis.clearTimeout(timer);
  },
};

export function libraryNoticeDuration(message: string): number {
  if (message.startsWith("撤销移入回收站失败，撤销入口仍保留")) return 10_000;
  const tone = inferNoticeTone(message);
  if (tone === "warning") return 6_500;
  if (tone === "danger") return 9_000;
  return 4_500;
}

export function reduceLibraryNoticeState(
  state: LibraryNoticeState,
  update: LibraryNoticeStateUpdate,
): LibraryNoticeState {
  const fromUpdater = typeof update === "function";
  const message = fromUpdater ? update(state.message) : update;
  if (fromUpdater && message === state.message) return state;
  return { instance: state.instance + 1, message };
}

/**
 * Owns one notice occurrence rather than one notice string.
 *
 * Every update advances the generation before cancelling timers. Generation
 * checks therefore remain correct even with a scheduler whose cancellation is
 * delayed or best-effort. The adapter gives every direct notice occurrence a
 * distinct instance, so repeated text cannot inherit an earlier occurrence's
 * leaving state.
 */
export class LibraryNoticeLifecycleController {
  private cancelDismiss: (() => void) | null = null;
  private cancelExit: (() => void) | null = null;
  private current: LibraryNoticeLifecycleInput | null = null;
  private generation = 0;
  private readonly listeners = new Set<Listener>();
  private snapshot: LibraryNoticeLifecycleSnapshot = IDLE_SNAPSHOT;

  constructor(private readonly scheduler: LibraryNoticeScheduler) {}

  readonly getSnapshot = (): LibraryNoticeLifecycleSnapshot => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(input: LibraryNoticeLifecycleInput): void {
    if (
      this.current?.instance === input.instance &&
      this.current.message === input.message &&
      this.current.persistent === input.persistent
    ) {
      this.current = input;
      return;
    }

    const generation = this.invalidateTimers();
    this.current = input;
    this.publish({
      instance: input.instance,
      leaving: false,
      message: input.message,
    });

    if (!input.message || input.persistent || inferNoticeTone(input.message) === "busy") return;

    const duration = libraryNoticeDuration(input.message);
    this.cancelExit = this.scheduler.schedule(() => {
      if (!this.isCurrent(input.instance, generation)) return;
      this.cancelExit = null;
      this.publish({
        instance: input.instance,
        leaving: true,
        message: input.message,
      });
    }, duration - LIBRARY_NOTICE_EXIT_MS);
    this.cancelDismiss = this.scheduler.schedule(() => {
      if (!this.isCurrent(input.instance, generation)) return;
      this.cancelDismiss = null;
      input.onDismiss(input.message!);
    }, duration);
  }

  clear(instance: LibraryNoticeInstance): void {
    if (this.current?.instance !== instance) return;
    this.invalidateTimers();
    this.current = null;
    this.publish(IDLE_SNAPSHOT);
  }

  dispose(): void {
    this.invalidateTimers();
    this.current = null;
    this.snapshot = IDLE_SNAPSHOT;
    this.listeners.clear();
  }

  private invalidateTimers(): number {
    this.generation += 1;
    this.cancelExit?.();
    this.cancelDismiss?.();
    this.cancelExit = null;
    this.cancelDismiss = null;
    return this.generation;
  }

  private isCurrent(instance: LibraryNoticeInstance, generation: number): boolean {
    return this.current?.instance === instance && this.generation === generation;
  }

  private publish(snapshot: LibraryNoticeLifecycleSnapshot): void {
    if (
      this.snapshot.instance === snapshot.instance &&
      this.snapshot.leaving === snapshot.leaving &&
      this.snapshot.message === snapshot.message
    ) {
      return;
    }
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

export function createLibraryNoticeLifecycleController(
  scheduler: LibraryNoticeScheduler = systemLibraryNoticeScheduler,
): LibraryNoticeLifecycleController {
  return new LibraryNoticeLifecycleController(scheduler);
}
