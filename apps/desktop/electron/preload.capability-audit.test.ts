import { afterEach, describe, expect, it, vi } from "vitest";
import { CH } from "./shared";

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

    await api.clipboard.writeText("clipboard write remains available");
    expect(mocks.invoke).toHaveBeenCalledWith(
      CH.clipboardWriteText,
      "clipboard write remains available",
    );
  });
});
