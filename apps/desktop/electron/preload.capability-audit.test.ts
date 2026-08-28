import { afterEach, describe, expect, it, vi } from "vitest";
import { CH, type ResearchDownloadContent } from "./shared";

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  off: vi.fn(),
  on: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: mocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: mocks.invoke,
    off: mocks.off,
    on: mocks.on,
  },
}));

interface ExposedAuraApi {
  citationBridgePort?: unknown;
  cancelHttp?: unknown;
  clipboard: {
    readText?: unknown;
    writeText(text: string): Promise<void>;
  };
  deviceId?: unknown;
  http?: unknown;
  openExternal?: unknown;
  fs?: unknown;
  files?: unknown;
  research: {
    consumeDownload(input: { downloadId: string }): Promise<ResearchDownloadContent>;
    resume(suspensionId: string): Promise<boolean>;
    suspend(): Promise<string>;
  };
}

const originalArgv = [...process.argv];

afterEach(() => {
  mocks.exposeInMainWorld.mockClear();
  mocks.invoke.mockClear();
  mocks.off.mockClear();
  mocks.on.mockClear();
  process.argv.splice(0, process.argv.length, ...originalArgv);
  vi.resetModules();
});

async function exposeAuraApi(): Promise<ExposedAuraApi> {
  await import("./preload");
  expect(mocks.exposeInMainWorld).toHaveBeenCalledOnce();
  return mocks.exposeInMainWorld.mock.calls[0]![1] as ExposedAuraApi;
}

describe("preload unused capability audit", () => {
  it("keeps clipboard writes while withholding unconsumed renderer capabilities", async () => {
    const api = await exposeAuraApi();

    expect(api.clipboard).not.toHaveProperty("readText");
    expect(api).not.toHaveProperty("deviceId");
    expect(api).not.toHaveProperty("http");
    expect(api).not.toHaveProperty("cancelHttp");
    expect(api).not.toHaveProperty("openExternal");
    expect(api).not.toHaveProperty("citationBridgePort");
    expect(api).not.toHaveProperty("fs");
    expect(api).not.toHaveProperty("files");

    await api.clipboard.writeText("clipboard write remains available");
    expect(mocks.invoke).toHaveBeenCalledWith(
      CH.clipboardWriteText,
      "clipboard write remains available",
    );

    await api.research.consumeDownload({ downloadId: "download-id" });
    expect(mocks.invoke).toHaveBeenCalledWith(CH.researchConsumeDownload, {
      downloadId: "download-id",
    });

    mocks.invoke.mockResolvedValueOnce("research-modal-lease");
    await expect(api.research.suspend()).resolves.toBe("research-modal-lease");
    mocks.invoke.mockResolvedValueOnce(true);
    await expect(api.research.resume("research-modal-lease")).resolves.toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith(CH.researchSuspend);
    expect(mocks.invoke).toHaveBeenCalledWith(CH.researchResume, "research-modal-lease");
  });
});
