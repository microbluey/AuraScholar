import { useCallback, useEffect, useRef, useState } from "react";
import type { ResearchViewSuspensionLease } from "./research-view-suspension-lease";

type ConfirmationKind = "download" | "reference";

interface BrowserConfirmationRestorationOptions {
  downloadLease: ResearchViewSuspensionLease;
  hasDownloadConfirmation: boolean;
  hasReferenceConfirmation: boolean;
  isBrowserMode(): boolean;
  mode: "browser" | "home" | "opensource";
  referenceLease: ResearchViewSuspensionLease;
  showActiveBrowserTab(): void;
}

/** Restores a native view only after React has committed the closing modal. */
export function useBrowserConfirmationRestoration({
  downloadLease,
  hasDownloadConfirmation,
  hasReferenceConfirmation,
  isBrowserMode,
  mode,
  referenceLease,
  showActiveBrowserTab,
}: BrowserConfirmationRestorationOptions) {
  const [revision, setRevision] = useState(0);
  const failedRef = useRef(new Set<ConfirmationKind>());
  const inFlightRef = useRef(new Set<ConfirmationKind>());
  const mountedRef = useRef(true);
  const pendingRef = useRef(new Set<ConfirmationKind>());
  const hasConfirmationRef = useRef(false);
  hasConfirmationRef.current = hasDownloadConfirmation || hasReferenceConfirmation;
  const bump = useCallback(() => setRevision((current) => current + 1), []);

  const requestRestore = useCallback(
    (kind: ConfirmationKind) => {
      failedRef.current.delete(kind);
      pendingRef.current.add(kind);
      bump();
    },
    [bump],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingRef.current.clear();
      void downloadLease.dispose();
      void referenceLease.dispose();
    };
  }, [downloadLease, referenceLease]);

  useEffect(() => {
    if (mode === "browser") return;
    pendingRef.current.clear();
    failedRef.current.clear();
    const releases = [
      ...(hasDownloadConfirmation ? [] : [downloadLease.dispose()]),
      ...(hasReferenceConfirmation ? [] : [referenceLease.dispose()]),
    ];
    void Promise.all(releases)
      .then(() => {
        if (mountedRef.current && isBrowserMode()) bump();
      })
      .catch(() => {});
  }, [
    bump,
    downloadLease,
    hasDownloadConfirmation,
    hasReferenceConfirmation,
    isBrowserMode,
    mode,
    referenceLease,
  ]);

  useEffect(() => {
    if (mode !== "browser") return;
    for (const kind of pendingRef.current) {
      const ownConfirmation =
        kind === "download" ? hasDownloadConfirmation : hasReferenceConfirmation;
      if (ownConfirmation || failedRef.current.has(kind) || inFlightRef.current.has(kind)) continue;
      const lease = kind === "download" ? downloadLease : referenceLease;
      inFlightRef.current.add(kind);
      let released = false;
      void lease
        .release()
        .then((didRelease) => {
          released = didRelease;
          if (!didRelease || !mountedRef.current) return;
          pendingRef.current.delete(kind);
          if (
            isBrowserMode() &&
            !hasConfirmationRef.current &&
            !downloadLease.blocking &&
            !referenceLease.blocking
          ) {
            showActiveBrowserTab();
          }
        })
        .finally(() => {
          inFlightRef.current.delete(kind);
          if (!released) failedRef.current.add(kind);
          if (released && mountedRef.current) bump();
        });
    }
  }, [
    bump,
    downloadLease,
    hasDownloadConfirmation,
    hasReferenceConfirmation,
    isBrowserMode,
    mode,
    referenceLease,
    revision,
    showActiveBrowserTab,
  ]);

  useEffect(() => {
    if (mode !== "browser" || hasConfirmationRef.current) return;
    const blockedLeases = [downloadLease, referenceLease].filter((lease) => lease.blocking);
    if (blockedLeases.length === 0) {
      showActiveBrowserTab();
      return;
    }
    void Promise.all(blockedLeases.map((lease) => lease.release()))
      .then((released) => {
        if (
          released.every(Boolean) &&
          mountedRef.current &&
          isBrowserMode() &&
          !hasConfirmationRef.current &&
          !downloadLease.blocking &&
          !referenceLease.blocking
        ) {
          showActiveBrowserTab();
        }
      })
      .catch(() => {});
  }, [downloadLease, isBrowserMode, mode, referenceLease, revision, showActiveBrowserTab]);

  return requestRestore;
}
