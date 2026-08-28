import { useCallback, useEffect, useRef } from "react";
import { resumeResearchViews, suspendResearchViews } from "../../services/research-browser";
import { describeSafeError } from "../../services/sensitive-text";

/** Keeps every modal's native-view lease alive until that modal explicitly closes. */
export function useResearchViewSuspensions(onMessage: (message: string) => void) {
  const mountedRef = useRef(true);
  const suspensionIdsRef = useRef(new Set<string>());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const suspensionIds = [...suspensionIdsRef.current];
      suspensionIdsRef.current.clear();
      for (const suspensionId of suspensionIds) {
        void resumeResearchViews(suspensionId).catch(() => {});
      }
    };
  }, []);

  const acquire = useCallback(async (): Promise<string | null> => {
    try {
      const suspensionId = await suspendResearchViews();
      if (!suspensionId) {
        onMessage("浏览器视图暂不可用，无法安全显示确认窗口");
        return null;
      }
      if (!mountedRef.current) {
        void resumeResearchViews(suspensionId).catch(() => {});
        return null;
      }
      suspensionIdsRef.current.add(suspensionId);
      return suspensionId;
    } catch (error) {
      if (mountedRef.current) onMessage(`浏览器视图隐藏失败:${describeSafeError(error)}`);
      return null;
    }
  }, [onMessage]);

  const release = useCallback(
    async (suspensionId: string | null): Promise<boolean> => {
      if (!suspensionId || !suspensionIdsRef.current.has(suspensionId)) return true;
      try {
        const released = await resumeResearchViews(suspensionId);
        if (!released) {
          onMessage("浏览器视图恢复失败:确认窗口状态已改变");
          return false;
        }
        suspensionIdsRef.current.delete(suspensionId);
        return true;
      } catch (error) {
        if (mountedRef.current) onMessage(`浏览器视图恢复失败:${describeSafeError(error)}`);
        return false;
      }
    },
    [onMessage],
  );

  return { acquire, release };
}
