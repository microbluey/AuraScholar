import { app, type BrowserWindow, type Session, type WebContentsView } from "electron";
import { EV, type ScholarIdentity } from "../shared";
import { discardResearchDownload, registerResearchDownload } from "./research-download-store";
import { createResearchDownloadFileName } from "./research-download-file-name";
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
  resolveIdentity(
    tab: ResearchDownloadSourceTab | undefined,
    url: string,
  ): ScholarIdentity | undefined;
}

/** Wire one research session's downloads to opaque, single-use main leases. */
export function wireResearchDownloadSession(
  sess: Session,
  context: ResearchDownloadEventContext,
): void {
  sess.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  sess.on("will-download", (_event, item, sourceWebContents) => {
    const sourceTab = context.findSourceTab(sourceWebContents);
    const sourceTabId = sourceTab?.tabId ?? "";
    const ownerTabId = sourceTab?.ownerTabId ?? "";
    const scholar = context.resolveIdentity(sourceTab, item.getURL());
    const fileName = createResearchDownloadFileName(item.getFilename());
    const displayName =
      item
        .getFilename()
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .slice(0, 120) || "download";
    const window = context.getWindow();
    window?.webContents.send(EV.researchDownloadStarted, {
      tabId: sourceTabId,
      fileName: displayName,
    });

    let target: ReturnType<typeof createResearchDownloadStreamTarget> | null = null;
    try {
      target = createResearchDownloadStreamTarget(app.getPath("userData"));
      item.setSavePath(target.absolutePath);
    } catch {
      item.cancel();
      if (target) void discardResearchDownload(fileName, target).catch(() => {});
      window?.webContents.send(EV.researchDownloadFinished, {
        tabId: sourceTabId,
        ownerTabId,
        fileName,
        downloadId: null,
        success: false,
        scholar,
      });
      return;
    }

    item.once("done", (_doneEvent, state) => {
      if (state !== "completed") {
        void discardResearchDownload(fileName, target).catch(() => {});
        context.getWindow()?.webContents.send(EV.researchDownloadFinished, {
          tabId: sourceTabId,
          ownerTabId,
          fileName,
          downloadId: null,
          success: false,
          scholar,
        });
        return;
      }
      void registerResearchDownload(fileName, ownerTabId, target)
        .then(({ downloadId }) => {
          context.getWindow()?.webContents.send(EV.researchDownloadFinished, {
            tabId: sourceTabId,
            ownerTabId,
            fileName,
            downloadId,
            success: true,
            scholar,
          });
        })
        .catch(() => {
          void discardResearchDownload(fileName, target).catch(() => {});
          context.getWindow()?.webContents.send(EV.researchDownloadFinished, {
            tabId: sourceTabId,
            ownerTabId,
            fileName,
            downloadId: null,
            success: false,
            scholar,
          });
        });
    });
  });
}
