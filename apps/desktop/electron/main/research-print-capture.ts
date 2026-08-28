import { describeSafeError } from "@aurascholar/platform";
import { EV, type CaptureResult, type ScholarIdentity } from "../shared";
import { discardResearchDownload, registerResearchDownload } from "./research-download-store";
import { writeResearchPrintedFile } from "./research-download-print-file";

export interface ResearchPrintCaptureWindow {
  isDestroyed(): boolean;
  webContents: { send(channel: string, payload: unknown): void };
}

export interface ResearchPrintCaptureInput {
  ensureDownloadDirectory(): void;
  getTitle(): string;
  isOriginLive(): boolean;
  originWindow: ResearchPrintCaptureWindow;
  ownerTabId: string;
  printToPdf(): Promise<Uint8Array>;
  scholar?: ScholarIdentity;
  tabId: string;
  userDataRoot(): string;
}

export interface ResearchPrintCaptureDependencies {
  discard(fileName: string): Promise<void>;
  register(fileName: string, ownerTabId: string): Promise<{ downloadId: string }>;
  writeFile(userDataRoot: string, originalFileName: string, pdf: Uint8Array): string;
}

const STALE_CAPTURE_ERROR = "研究浏览器当前页面已失效";

/**
 * Persist a print capture only while its source window and tab still own it.
 * A replacement BrowserWindow must never receive a stale capture's receipt.
 */
export async function captureResearchPrint(
  input: ResearchPrintCaptureInput,
  dependencies: Partial<ResearchPrintCaptureDependencies> = {},
): Promise<CaptureResult> {
  const discard = dependencies.discard ?? discardResearchDownload;
  const register = dependencies.register ?? registerResearchDownload;
  const writeFile = dependencies.writeFile ?? writeResearchPrintedFile;
  let fileName: string | undefined;
  let wroteFile = false;

  const discardWrittenFile = async (): Promise<void> => {
    if (!fileName || !wroteFile) return;
    await discard(fileName).catch(() => {});
  };

  try {
    if (!input.isOriginLive()) return staleCapture();
    input.ensureDownloadDirectory();
    const pdf = await input.printToPdf();
    if (!input.isOriginLive()) return staleCapture();

    const base =
      input
        .getTitle()
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .slice(0, 80) || "page";
    fileName = writeFile(input.userDataRoot(), `${base}.pdf`, pdf);
    wroteFile = true;
    if (!input.isOriginLive()) {
      await discardWrittenFile();
      return staleCapture();
    }

    const { downloadId } = await register(fileName, input.ownerTabId);
    if (!input.isOriginLive() || !sendFinished(input, fileName, downloadId)) {
      await discardWrittenFile();
      return staleCapture();
    }
    return { kind: "print", downloadId, fileName };
  } catch (error) {
    await discardWrittenFile();
    return { kind: "none", error: describeSafeError(error) };
  }
}

function staleCapture(): CaptureResult {
  return { kind: "none", error: STALE_CAPTURE_ERROR };
}

function sendFinished(
  input: ResearchPrintCaptureInput,
  fileName: string,
  downloadId: string,
): boolean {
  try {
    if (input.originWindow.isDestroyed()) return false;
    input.originWindow.webContents.send(EV.researchDownloadFinished, {
      tabId: input.tabId,
      ownerTabId: input.ownerTabId,
      fileName,
      downloadId,
      success: true,
      scholar: input.scholar,
    });
    return true;
  } catch {
    return false;
  }
}
