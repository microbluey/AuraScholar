import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { activateResearchTab } from "../../services/research-browser";
import { describeSafeError } from "../../services/sensitive-text";
import type { ResearchViewSuspensionLease } from "./research-view-suspension-lease";

interface BrowserPresentationActivationOptions {
  browserActiveRef: MutableRefObject<boolean>;
  downloadLease: ResearchViewSuspensionLease;
  hasDownloadConfirmation: boolean;
  hasReferenceConfirmation: boolean;
  mode: "browser" | "home" | "opensource";
  onMessage(message: string): void;
  referenceLease: ResearchViewSuspensionLease;
}

/** Delays a renderer-requested tab attachment until its browser host is safe to show. */
export function useBrowserPresentationActivation({
  browserActiveRef,
  downloadLease,
  hasDownloadConfirmation,
  hasReferenceConfirmation,
  mode,
  onMessage,
  referenceLease,
}: BrowserPresentationActivationOptions) {
  const [revision, setRevision] = useState(0);
  const pendingTabIdRef = useRef<string | null>(null);
  const request = useCallback((tabId: string) => {
    pendingTabIdRef.current = tabId;
    setRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    if (mode !== "browser") {
      pendingTabIdRef.current = null;
      return;
    }
    const tabId = pendingTabIdRef.current;
    if (
      !tabId ||
      !browserActiveRef.current ||
      hasDownloadConfirmation ||
      hasReferenceConfirmation ||
      downloadLease.blocking ||
      referenceLease.blocking
    ) {
      return;
    }
    pendingTabIdRef.current = null;
    void activateResearchTab(tabId).catch((error) =>
      onMessage(`显示浏览器标签失败:${describeSafeError(error)}`),
    );
  }, [
    browserActiveRef,
    downloadLease,
    hasDownloadConfirmation,
    hasReferenceConfirmation,
    mode,
    onMessage,
    referenceLease,
    revision,
  ]);

  return request;
}
