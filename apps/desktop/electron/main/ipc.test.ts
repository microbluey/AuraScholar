import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: mocks.handle },
}));

import { handle, setTrustedSender } from "./ipc";

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function fakeSender(mainFrame: WebFrameMain): WebContents {
  return {
    isDestroyed: vi.fn(() => false),
    mainFrame,
    once: vi.fn(),
  } as unknown as WebContents;
}

function registeredHandler(): InvokeHandler {
  const callback = mocks.handle.mock.calls.at(-1)?.[1];
  expect(callback).toEqual(expect.any(Function));
  return callback as InvokeHandler;
}

beforeEach(() => {
  mocks.handle.mockReset();
});

describe("privileged IPC frame gate", () => {
  it("forwards an invocation from the trusted webContents main frame", async () => {
    const mainFrame = {} as WebFrameMain;
    const sender = fakeSender(mainFrame);
    const downstream = vi.fn((_event: unknown, ...args: unknown[]) => args.join(":"));
    const event = { sender, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
    setTrustedSender(sender);

    handle("test:trusted", downstream as never);

    expect(registeredHandler()(event, "one", "two")).toBe("one:two");
    expect(downstream).toHaveBeenCalledWith(event, "one", "two");
  });

  it("rejects a subframe even when it shares the trusted webContents", async () => {
    const mainFrame = {} as WebFrameMain;
    const sender = fakeSender(mainFrame);
    const event = {
      sender,
      senderFrame: {} as WebFrameMain,
    } as unknown as IpcMainInvokeEvent;
    setTrustedSender(sender);
    handle("test:subframe", vi.fn() as never);

    expect(() => registeredHandler()(event)).toThrow(
      "IPC test:subframe: rejected untrusted sender",
    );
  });

  it("rejects missing frames, foreign senders, and destroyed trusted contents", async () => {
    const mainFrame = {} as WebFrameMain;
    const sender = fakeSender(mainFrame);
    const foreignSender = fakeSender(mainFrame);
    setTrustedSender(sender);
    handle("test:boundary", vi.fn() as never);
    const invoke = registeredHandler();

    expect(() => invoke({ sender, senderFrame: null } as unknown as IpcMainInvokeEvent)).toThrow(
      "rejected untrusted sender",
    );
    expect(() =>
      invoke({ sender: foreignSender, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent),
    ).toThrow("rejected untrusted sender");

    (sender.isDestroyed as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    expect(() => invoke({ sender, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent)).toThrow(
      "rejected untrusted sender",
    );
  });
});
