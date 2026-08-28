import { app, type BrowserWindow, type Session, type WebContentsView } from "electron";
import { EV, type ScholarIdentity } from "../shared";
import {
  admitResearchDownloadInFlight,
  type ResearchDownloadInFlightAdmission,
  type ResearchDownloadInFlightGate,
} from "./research-download-inflight";
import {
  consumeResearchDownloadCaptureIntent,
  type ResearchDownloadUserIntentGate,
} from "./research-download-user-intent";
import { createResearchDownloadFileName } from "./research-download-file-name";
import {
  describeResearchDownloadFile,
  isResearchDownloadTransferWithinLimit,
} from "./research-download-file-policy";
import { MAX_RESEARCH_DOWNLOAD_BYTES } from "./research-download-limits";
import { discardResearchDownload, registerResearchDownload } from "./research-download-store";
import { createResearchDownloadStreamTarget } from "./research-download-stream-target";

export interface ResearchDownloadSourceTab {
  tabId: string;
  ownerTabId: string;
  view: WebContentsView | null;
  scholar?: ScholarIdentity;
}

export interface ResearchDownloadEventContext {
  findSourceTab(sourceWebContents: unknown): ResearchDownloadSourceTab | undefined;
  getWindow(): BrowserWindow | null;
  inFlightGate?: ResearchDownloadInFlightGate;
  userIntentGate?: ResearchDownloadUserIntentGate;
  resolveIdentity(
    tab: ResearchDownloadSourceTab | undefined,
    url: string,
  ): ScholarIdentity | undefined;
}

interface ResearchDownloadOrigin {
  ownerTabId: string;
  sourceTabId: string;
  sourceWebContents: unknown;
  window: BrowserWindow;
}

/** Wire one research session's downloads to opaque, single-use main leases. */
export function wireResearchDownloadSession(
  sess: Session,
  context: ResearchDownloadEventContext,
): void {
  sess.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  sess.on("will-download", (event, item, sourceWebContents) => {
    const sourceTab = context.findSourceTab(sourceWebContents);
    // A session can host untrusted pages. Only a live research tab is allowed
    // to allocate a main-owned stream directory or a download receipt.
    if (!sourceTab) {
      event.preventDefault();
      return;
    }

    const originWindow = context.getWindow();
    if (!originWindow) {
      event.preventDefault();
      return;
    }
    const origin: ResearchDownloadOrigin = {
      ownerTabId: sourceTab.ownerTabId,
      sourceTabId: sourceTab.tabId,
      sourceWebContents,
      window: originWindow,
    };
    if (!isResearchDownloadOriginLive(context, origin)) {
      event.preventDefault();
      return;
    }

    if (!isResearchDownloadUserIntended(item, sourceWebContents, context.userIntentGate)) {
      event.preventDefault();
      // A drive-by download never started a renderer task. Reject it silently
      // so an untrusted page cannot flood the app with failure events.
      return;
    }

    const scholar = context.resolveIdentity(sourceTab, item.getURL());
    const originalFileName = item.getFilename();
    const fileName = createResearchDownloadFileName(originalFileName);
    const filePolicy = describeResearchDownloadFile(fileName, MAX_RESEARCH_DOWNLOAD_BYTES);
    const displayName =
      originalFileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "download";
    const totalBytes = item.getTotalBytes();
    const sendFinished = (downloadId: string | null, success: boolean): boolean => {
      if (!isResearchDownloadOriginLive(context, origin)) return false;
      return sendDownloadFinished(
        origin.window,
        origin.sourceTabId,
        origin.ownerTabId,
        fileName,
        downloadId,
        success,
        scholar,
      );
    };
    if (!isResearchDownloadTransferWithinLimit(0, totalBytes, filePolicy.maxByteSize)) {
      event.preventDefault();
      sendFinished(null, false);
      return;
    }
    let admission: ResearchDownloadInFlightAdmission | null;
    try {
      admission = context.inFlightGate
        ? context.inFlightGate.admit(totalBytes)
        : admitResearchDownloadInFlight(totalBytes);
    } catch {
      admission = null;
    }
    // `preventDefault` rejects before Electron starts the write. Do not touch
    // the item afterwards: Electron invalidates it on the next tick.
    if (!admission) {
      event.preventDefault();
      sendFinished(null, false);
      return;
    }

    let target: ReturnType<typeof createResearchDownloadStreamTarget>;
    try {
      target = createResearchDownloadStreamTarget(app.getPath("userData"));
    } catch {
      event.preventDefault();
      admission.release();
      sendFinished(null, false);
      return;
    }

    let settling = false;
    let cancelRequested = false;
    const finishFailure = (): void => {
      if (settling) return;
      settling = true;
      void discardResearchDownload(fileName, target)
        .catch(() => {})
        .then(() => {
          admission.release();
          sendFinished(null, false);
        });
    };
    const finishSuccess = (): void => {
      if (settling) return;
      if (!isResearchDownloadOriginLive(context, origin)) {
        finishFailure();
        return;
      }
      settling = true;
      void registerResearchDownload(fileName, origin.ownerTabId, target)
        .then(({ downloadId }) => {
          if (!isResearchDownloadOriginLive(context, origin) || !sendFinished(downloadId, true)) {
            return discardResearchDownload(fileName, target)
              .catch(() => {})
              .then(() => admission.release());
          }
          admission.release();
        })
        .catch(() =>
          discardResearchDownload(fileName, target)
            .catch(() => {})
            .then(() => {
              admission.release();
              sendFinished(null, false);
            }),
        );
    };
    const cancelOnce = (): void => {
      if (cancelRequested) return;
      cancelRequested = true;
      try {
        item.cancel();
      } catch {
        // A terminal item cannot be cancelled, but it still needs cleanup.
      }
    };
    const exceedsAdmission = (): boolean => {
      try {
        const receivedBytes = item.getReceivedBytes();
        const observedTotalBytes = item.getTotalBytes();
        return (
          !isResearchDownloadTransferWithinLimit(
            receivedBytes,
            observedTotalBytes,
            filePolicy.maxByteSize,
          ) || !admission.observe(receivedBytes, observedTotalBytes)
        );
      } catch {
        return true;
      }
    };

    // Register terminal listeners before setting the target. This keeps a
    // rapid cancellation from leaking an admission reservation.
    item.on("updated", (_updatedEvent, _state) => {
      if (!isResearchDownloadOriginLive(context, origin) || exceedsAdmission()) cancelOnce();
    });
    item.once("done", (_doneEvent, state) => {
      if (exceedsAdmission()) cancelOnce();
      if (state !== "completed" || cancelRequested) {
        finishFailure();
        return;
      }
      finishSuccess();
    });

    try {
      item.setSavePath(target.absolutePath);
    } catch {
      event.preventDefault();
      finishFailure();
      return;
    }

    if (settling) return;
    if (
      !isResearchDownloadOriginLive(context, origin) ||
      !sendDownloadStarted(origin.window, origin.sourceTabId, displayName)
    ) {
      cancelOnce();
      return;
    }
    if (exceedsAdmission()) cancelOnce();
  });
}

function isResearchDownloadOriginLive(
  context: ResearchDownloadEventContext,
  origin: ResearchDownloadOrigin,
): boolean {
  try {
    if (origin.window.isDestroyed() || context.getWindow() !== origin.window) return false;
    const sourceTab = context.findSourceTab(origin.sourceWebContents);
    return sourceTab?.tabId === origin.sourceTabId && sourceTab.ownerTabId === origin.ownerTabId;
  } catch {
    return false;
  }
}

function sendDownloadStarted(window: BrowserWindow, tabId: string, fileName: string): boolean {
  try {
    if (window.isDestroyed()) return false;
    window.webContents.send(EV.researchDownloadStarted, { tabId, fileName });
    return true;
  } catch {
    return false;
  }
}

function sendDownloadFinished(
  window: BrowserWindow,
  tabId: string,
  ownerTabId: string,
  fileName: string,
  downloadId: string | null,
  success: boolean,
  scholar: ScholarIdentity | undefined,
): boolean {
  try {
    if (window.isDestroyed()) return false;
    window.webContents.send(EV.researchDownloadFinished, {
      tabId,
      ownerTabId,
      fileName,
      downloadId,
      success,
      scholar,
    });
    return true;
  } catch {
    return false;
  }
}

function isResearchDownloadUserIntended(
  item: { getURLChain(): string[]; hasUserGesture(): boolean },
  sourceWebContents: unknown,
  gate: ResearchDownloadUserIntentGate | undefined,
): boolean {
  try {
    if (item.hasUserGesture() === true) return true;
    const urlChain = item.getURLChain();
    return gate
      ? gate.consumeAppCapture(sourceWebContents, urlChain)
      : consumeResearchDownloadCaptureIntent(sourceWebContents, urlChain);
  } catch {
    return false;
  }
}
