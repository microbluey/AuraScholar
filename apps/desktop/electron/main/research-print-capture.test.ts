import { describe, expect, it, vi } from "vitest";
import { EV } from "../shared";
import {
  captureResearchPrint,
  type ResearchPrintCaptureDependencies,
  type ResearchPrintCaptureInput,
} from "./research-print-capture";

function captureInput({
  isOriginLive = vi.fn(() => true),
  printToPdf = vi.fn(async () => new Uint8Array([1, 2])),
  send = vi.fn(),
}: {
  isOriginLive?: ReturnType<typeof vi.fn>;
  printToPdf?: ReturnType<typeof vi.fn>;
  send?: ReturnType<typeof vi.fn>;
} = {}): {
  input: ResearchPrintCaptureInput;
  isOriginLive: ReturnType<typeof vi.fn>;
  printToPdf: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} {
  return {
    input: {
      ensureDownloadDirectory: vi.fn(),
      getTitle: () => "Captured page",
      isOriginLive,
      originWindow: { isDestroyed: vi.fn(() => false), webContents: { send } },
      ownerTabId: "owner-tab",
      printToPdf,
      scholar: { doi: "10.4242/capture" },
      tabId: "source-tab",
      userDataRoot: () => "/user-data",
    },
    isOriginLive,
    printToPdf,
    send,
  };
}

function captureDependencies(
  overrides: {
    discard?: ReturnType<typeof vi.fn>;
    register?: ReturnType<typeof vi.fn>;
    writeFile?: ReturnType<typeof vi.fn>;
  } = {},
): {
  dependencies: ResearchPrintCaptureDependencies;
  discard: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
} {
  const discard = overrides.discard ?? vi.fn().mockResolvedValue(undefined);
  const register = overrides.register ?? vi.fn().mockResolvedValue({ downloadId: "download-id" });
  const writeFile = overrides.writeFile ?? vi.fn(() => "captured.pdf");
  return {
    dependencies: { discard, register, writeFile },
    discard,
    register,
    writeFile,
  };
}

describe("research print capture origin lifecycle", () => {
  it("writes, registers, and notifies the originating window while it remains live", async () => {
    const { input, send } = captureInput();
    const { dependencies, discard, register, writeFile } = captureDependencies();

    await expect(captureResearchPrint(input, dependencies)).resolves.toEqual({
      kind: "print",
      downloadId: "download-id",
      fileName: "captured.pdf",
    });

    expect(writeFile).toHaveBeenCalledWith(
      "/user-data",
      "Captured-page.pdf",
      new Uint8Array([1, 2]),
    );
    expect(register).toHaveBeenCalledWith("captured.pdf", "owner-tab");
    expect(discard).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      EV.researchDownloadFinished,
      expect.objectContaining({
        downloadId: "download-id",
        fileName: "captured.pdf",
        ownerTabId: "owner-tab",
        success: true,
        tabId: "source-tab",
      }),
    );
  });

  it("does not write or register when the originating tab closes while printing", async () => {
    let resolvePrint: ((pdf: Uint8Array) => void) | undefined;
    const printToPdf = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolvePrint = resolve;
        }),
    );
    let originLive = true;
    const { input, send } = captureInput({
      isOriginLive: vi.fn(() => originLive),
      printToPdf,
    });
    const { dependencies, discard, register, writeFile } = captureDependencies();

    const capture = captureResearchPrint(input, dependencies);
    await vi.waitFor(() => expect(printToPdf).toHaveBeenCalledOnce());
    originLive = false;
    if (!resolvePrint) throw new Error("print did not start");
    resolvePrint(new Uint8Array([1]));

    await expect(capture).resolves.toMatchObject({ kind: "none" });
    expect(writeFile).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("retires a receipt when the originating window closes during registration", async () => {
    let resolveRegistration: ((value: { downloadId: string }) => void) | undefined;
    const register = vi.fn(
      () =>
        new Promise<{ downloadId: string }>((resolve) => {
          resolveRegistration = resolve;
        }),
    );
    let originLive = true;
    const { input, send } = captureInput({ isOriginLive: vi.fn(() => originLive) });
    const { dependencies, discard } = captureDependencies({ register });

    const capture = captureResearchPrint(input, dependencies);
    await vi.waitFor(() => expect(register).toHaveBeenCalledWith("captured.pdf", "owner-tab"));
    originLive = false;
    if (!resolveRegistration) throw new Error("registration did not start");
    resolveRegistration({ downloadId: "download-id" });

    await expect(capture).resolves.toMatchObject({ kind: "none" });
    expect(discard).toHaveBeenCalledWith("captured.pdf");
    expect(send).not.toHaveBeenCalled();
  });

  it("retires a receipt when sending to the originating window fails", async () => {
    const send = vi.fn(() => {
      throw new Error("window closed");
    });
    const { input } = captureInput({ send });
    const { dependencies, discard } = captureDependencies();

    await expect(captureResearchPrint(input, dependencies)).resolves.toMatchObject({
      kind: "none",
    });

    expect(discard).toHaveBeenCalledWith("captured.pdf");
  });
});
