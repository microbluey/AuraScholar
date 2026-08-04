import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import type { LibraryNoticeInstance } from "./library-notice-lifecycle";
import { createLibraryNoticeLifecycleController } from "./library-notice-lifecycle";

export { libraryNoticeDuration } from "./library-notice-lifecycle";

/** Schedules notice animation and removal without resetting derived state in an effect. */
export function useLibraryNoticeLifecycle(input: {
  instance: LibraryNoticeInstance;
  message: string | null;
  onDismiss(expectedMessage: string): void;
  persistent: boolean;
}): boolean {
  const { instance, message, onDismiss, persistent } = input;
  const [controller] = useState(() => createLibraryNoticeLifecycleController());
  const dismissLatest = useEffectEvent((expectedMessage: string) => onDismiss(expectedMessage));
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.update({
      instance,
      message,
      onDismiss: dismissLatest,
      persistent,
    });
    return () => controller.clear(instance);
  }, [controller, instance, message, persistent]);

  useEffect(() => () => controller.dispose(), [controller]);

  return Boolean(
    message &&
    !persistent &&
    snapshot.instance === instance &&
    snapshot.message === message &&
    snapshot.leaving,
  );
}
